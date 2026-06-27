"""
============================================================================
VECTOR_DB_SETUP.PY — Vertex AI Vector Search Setup & Management
============================================================================
Inicializa el índice vectorial, configura metadatos filtrables,
despliega endpoint, y maneja operaciones CRUD de datapoints.
============================================================================
"""

import json
import time
from pathlib import Path
from typing import Optional

from google.cloud import aiplatform
from google.cloud.aiplatform.matching_engine import (
    MatchingEngineIndex,
    MatchingEngineIndexEndpoint,
)

from config import (
    GCP_PROJECT_ID, GCP_REGION, GCS_BUCKET_NAME,
    VECTOR_INDEX_DISPLAY_NAME, VECTOR_INDEX_DESCRIPTION,
    VECTOR_ENDPOINT_DISPLAY_NAME, VECTOR_INDEX_UPDATE_METHOD,
    VECTOR_DISTANCE_MEASURE, VECTOR_SHARD_SIZE,
    VECTOR_APPROXIMATE_NEIGHBORS_COUNT, EMBEDDING_DIMENSIONS,
    EMBEDDINGS_DIR,
)
from utils import setup_logger, load_json

logger = setup_logger("vector_db", "vector_db_audit.log")


# ============================================================================
# 1. INICIALIZACIÓN DE VERTEX AI
# ============================================================================

def init_vertex_ai():
    """Inicializa el SDK de Vertex AI con proyecto y región."""
    aiplatform.init(
        project=GCP_PROJECT_ID,
        location=GCP_REGION,
    )
    logger.info(
        f"[INIT] Vertex AI inicializado — "
        f"Proyecto: {GCP_PROJECT_ID}, Región: {GCP_REGION}"
    )


# ============================================================================
# 2. CREACIÓN DEL ÍNDICE VECTORIAL
# ============================================================================

def create_vector_index(
    display_name: Optional[str] = None,
    dimensions: int = EMBEDDING_DIMENSIONS,
) -> MatchingEngineIndex:
    """
    Crea un índice en Vertex AI Vector Search con:
    - Algoritmo TreeAH para búsqueda aproximada
    - STREAM_UPDATE para actualizaciones incrementales
    - Distancia coseno
    - Metadatos filtrables configurados
    
    Returns:
        Objeto MatchingEngineIndex creado.
    """
    name = display_name or VECTOR_INDEX_DISPLAY_NAME
    
    logger.info(f"[INDEX] Creando índice: {name}")
    logger.info(f"[INDEX] Dimensiones: {dimensions}")
    logger.info(f"[INDEX] Método update: {VECTOR_INDEX_UPDATE_METHOD}")
    
    index = MatchingEngineIndex.create_tree_ah_index(
        display_name=name,
        description=VECTOR_INDEX_DESCRIPTION,
        dimensions=dimensions,
        distance_measure_type=VECTOR_DISTANCE_MEASURE,
        shard_size=VECTOR_SHARD_SIZE,
        approximate_neighbors_count=VECTOR_APPROXIMATE_NEIGHBORS_COUNT,
        index_update_method=VECTOR_INDEX_UPDATE_METHOD,
        # Configuración de TreeAH
        leaf_node_embedding_count=500,
        leaf_nodes_to_search_percent=7,
    )
    
    logger.info(f"[INDEX] ✓ Índice creado: {index.resource_name}")
    return index


def get_or_create_index() -> MatchingEngineIndex:
    """Obtiene un índice existente o crea uno nuevo."""
    # Buscar índice existente
    existing = MatchingEngineIndex.list(
        filter=f'display_name="{VECTOR_INDEX_DISPLAY_NAME}"'
    )
    
    if existing:
        index = existing[0]
        logger.info(f"[INDEX] Índice existente encontrado: {index.resource_name}")
        return index
    
    return create_vector_index()


# ============================================================================
# 3. CREACIÓN Y DESPLIEGUE DEL ENDPOINT
# ============================================================================

def create_index_endpoint(
    display_name: Optional[str] = None,
) -> MatchingEngineIndexEndpoint:
    """Crea un endpoint para servir consultas de vector search."""
    name = display_name or VECTOR_ENDPOINT_DISPLAY_NAME
    
    logger.info(f"[ENDPOINT] Creando endpoint: {name}")
    
    endpoint = MatchingEngineIndexEndpoint.create(
        display_name=name,
        description="Endpoint de búsqueda vectorial para catálogo CATAPROM",
        public_endpoint_enabled=True,
    )
    
    logger.info(f"[ENDPOINT] ✓ Endpoint creado: {endpoint.resource_name}")
    return endpoint


def get_or_create_endpoint() -> MatchingEngineIndexEndpoint:
    """Obtiene un endpoint existente o crea uno nuevo."""
    existing = MatchingEngineIndexEndpoint.list(
        filter=f'display_name="{VECTOR_ENDPOINT_DISPLAY_NAME}"'
    )
    
    if existing:
        endpoint = existing[0]
        logger.info(f"[ENDPOINT] Endpoint existente: {endpoint.resource_name}")
        return endpoint
    
    return create_index_endpoint()


def deploy_index_to_endpoint(
    index: MatchingEngineIndex,
    endpoint: MatchingEngineIndexEndpoint,
    deployed_index_id: str = "cataprom_deployed_v1",
) -> None:
    """Despliega el índice en el endpoint para servir consultas."""
    logger.info(f"[DEPLOY] Desplegando índice en endpoint...")
    logger.info(f"[DEPLOY] Index: {index.resource_name}")
    logger.info(f"[DEPLOY] Endpoint: {endpoint.resource_name}")
    
    endpoint.deploy_index(
        index=index,
        deployed_index_id=deployed_index_id,
        display_name=f"{VECTOR_INDEX_DISPLAY_NAME}-deployed",
        # Configuración de recursos
        machine_type="e2-standard-2",
        min_replica_count=1,
        max_replica_count=2,
    )
    
    logger.info(f"[DEPLOY] ✓ Índice desplegado: {deployed_index_id}")


# ============================================================================
# 4. OPERACIONES CRUD DE DATAPOINTS
# ============================================================================

def upsert_datapoints(
    index: MatchingEngineIndex,
    datapoints: list[dict],
    batch_size: int = 100,
) -> None:
    """
    Inserta o actualiza datapoints en el índice vectorial.
    Usa STREAM_UPDATE para actualización incremental.
    
    Args:
        index: Índice de Vector Search.
        datapoints: Lista de dicts con 'id', 'embedding', 'metadata'.
        batch_size: Tamaño del batch para upsert.
    """
    total = len(datapoints)
    logger.info(f"[UPSERT] Iniciando upsert de {total} datapoints...")
    
    for i in range(0, total, batch_size):
        batch = datapoints[i:i + batch_size]
        batch_num = (i // batch_size) + 1
        total_batches = (total + batch_size - 1) // batch_size
        
        # Formatear para el API de Vertex AI
        formatted_batch = []
        for dp in batch:
            point = {
                "datapoint_id": dp["id"],
                "feature_vector": dp["embedding"],
            }
            
            # Agregar restricciones (filtros) de metadatos
            restricts = []
            if dp.get("metadata", {}).get("category"):
                restricts.append({
                    "namespace": "category",
                    "allow_list": [dp["metadata"]["category"]],
                })
            if dp.get("metadata", {}).get("subcategory"):
                restricts.append({
                    "namespace": "subcategory",
                    "allow_list": [dp["metadata"]["subcategory"]],
                })
            
            if restricts:
                point["restricts"] = restricts
            
            # Agregar restricciones numéricas
            numeric_restricts = []
            stock = dp.get("metadata", {}).get("total_stock", 0)
            numeric_restricts.append({
                "namespace": "total_stock",
                "value_int": stock,
            })
            
            if numeric_restricts:
                point["numeric_restricts"] = numeric_restricts
            
            formatted_batch.append(point)
        
        try:
            index.upsert_datapoints(datapoints=formatted_batch)
            logger.info(
                f"[UPSERT] ✓ Batch {batch_num}/{total_batches} — "
                f"{len(formatted_batch)} datapoints"
            )
        except Exception as e:
            logger.error(f"[UPSERT] ✗ Batch {batch_num}: {e}")
            raise
    
    logger.info(f"[UPSERT] ✓ Completado: {total} datapoints")


def remove_datapoints(
    index: MatchingEngineIndex,
    datapoint_ids: list[str],
) -> None:
    """Elimina datapoints del índice por ID."""
    logger.info(f"[DELETE] Eliminando {len(datapoint_ids)} datapoints...")
    index.remove_datapoints(datapoint_ids=datapoint_ids)
    logger.info(f"[DELETE] ✓ {len(datapoint_ids)} eliminados")


# ============================================================================
# 5. CARGA MASIVA DESDE ARCHIVOS
# ============================================================================

def upload_embeddings_to_gcs(
    embeddings_file: Optional[str] = None,
) -> str:
    """
    Sube el archivo JSONL de embeddings a GCS para carga batch.
    
    Returns:
        URI de GCS del archivo subido.
    """
    from google.cloud import storage
    
    file_path = Path(embeddings_file) if embeddings_file else (
        EMBEDDINGS_DIR / "product_embeddings.jsonl"
    )
    
    if not file_path.exists():
        raise FileNotFoundError(f"No se encontró: {file_path}")
    
    client = storage.Client(project=GCP_PROJECT_ID)
    bucket = client.bucket(GCS_BUCKET_NAME)
    blob = bucket.blob(f"embeddings/{file_path.name}")
    
    blob.upload_from_filename(str(file_path))
    gcs_uri = f"gs://{GCS_BUCKET_NAME}/embeddings/{file_path.name}"
    
    logger.info(f"[GCS] ✓ Archivo subido: {gcs_uri}")
    return gcs_uri


def load_embeddings_from_file() -> list[dict]:
    """Carga embeddings desde el archivo JSON local."""
    embeddings_file = EMBEDDINGS_DIR / "product_embeddings.json"
    if not embeddings_file.exists():
        raise FileNotFoundError(
            f"No se encontró {embeddings_file}. "
            "Ejecuta embedding_pipeline.py primero."
        )
    return load_json(embeddings_file)


# ============================================================================
# 6. SETUP COMPLETO (ORQUESTADOR)
# ============================================================================

def run_full_setup(skip_deploy: bool = False) -> dict:
    """
    Ejecuta el setup completo del sistema vectorial:
    1. Inicializa Vertex AI
    2. Crea/obtiene índice
    3. Carga embeddings
    4. Upsert datapoints
    5. Crea/obtiene endpoint
    6. Despliega índice en endpoint
    
    Returns:
        Dict con index_name, endpoint_name, total_datapoints.
    """
    logger.info("=" * 70)
    logger.info("[SETUP] Configuración de Vertex AI Vector Search")
    logger.info("=" * 70)
    
    # 1. Init
    init_vertex_ai()
    
    # 2. Índice
    index = get_or_create_index()
    
    # 3. Cargar embeddings
    datapoints = load_embeddings_from_file()
    logger.info(f"[SETUP] {len(datapoints)} embeddings cargados")
    
    # 4. Upsert
    upsert_datapoints(index, datapoints)
    
    result = {
        "index_name": index.resource_name,
        "total_datapoints": len(datapoints),
    }
    
    if not skip_deploy:
        # 5. Endpoint
        endpoint = get_or_create_endpoint()
        
        # 6. Deploy
        deploy_index_to_endpoint(index, endpoint)
        result["endpoint_name"] = endpoint.resource_name
    
    logger.info("=" * 70)
    logger.info("[SETUP] ✓ Setup completado")
    for k, v in result.items():
        logger.info(f"  {k}: {v}")
    logger.info("=" * 70)
    
    return result


# ============================================================================
# 7. ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    run_full_setup()
