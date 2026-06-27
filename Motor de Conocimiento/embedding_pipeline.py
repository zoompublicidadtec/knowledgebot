"""
============================================================================
EMBEDDING_PIPELINE.PY — Pipeline de Embeddings Multimodales Gemini
============================================================================
Procesa el JSON de productos, descarga imágenes, genera embeddings
combinados texto+imagen usando gemini-embedding-2 (3072 dimensiones).
============================================================================
"""

import asyncio
import json
import time
from io import BytesIO
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image
from google import genai
from google.genai import types

from config import (
    GOOGLE_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS,
    EMBEDDING_TASK_TYPE_DOCUMENT, EMBEDDING_TASK_INSTRUCTION,
    EMBEDDING_MAX_TOKENS, EMBEDDING_BATCH_SIZE,
    EMBEDDING_RATE_LIMIT_DELAY, EMBEDDING_IMAGE_RESIZE_MAX_DIM,
    PRODUCTS_JSON_DIR, EMBEDDINGS_DIR, IMAGES_DIR,
)
from utils import (
    setup_logger, CheckpointManager, save_json, load_json,
    truncate_text, generate_audit_record,
)

logger = setup_logger("embedding", "embedding_audit.log")

# ============================================================================
# 1. CLIENTE GEMINI
# ============================================================================

client = genai.Client(api_key=GOOGLE_API_KEY)


# ============================================================================
# 2. PREPARACIÓN DE CONTENIDO
# ============================================================================

def build_product_text(product: dict) -> str:
    """
    Construye el texto descriptivo completo de un producto
    para embedding. Optimizado para búsqueda semántica.
    """
    parts = []
    
    # Identificación
    parts.append(f"ID: {product.get('product_id', 'N/A')}")
    parts.append(f"Producto: {product.get('name', 'Sin nombre')}")
    parts.append(f"Categoría: {product.get('category', 'N/A')}")
    
    if product.get("subcategory"):
        parts.append(f"Subcategoría: {product['subcategory']}")
    
    # Precio
    if product.get("price"):
        parts.append(f"Precio: ${product['price']}")
    
    # Descripción
    if product.get("description"):
        parts.append(f"Descripción: {product['description']}")
    
    # Especificaciones
    specs = product.get("specifications", {})
    if specs:
        spec_lines = [f"  {k}: {v}" for k, v in specs.items()]
        parts.append("Especificaciones:\n" + "\n".join(spec_lines))
    
    # Variantes de color
    variants = product.get("variants", [])
    if variants:
        colors = []
        for v in variants:
            color = v.get("color", v.get("colores", ""))
            if color:
                colors.append(color)
        if colors:
            parts.append(f"Colores disponibles: {', '.join(colors)}")
    
    # Stock
    stock = product.get("stock", {})
    if stock:
        parts.append(f"Stock total: {stock.get('total', 0)} unidades")
        parts.append(f"En stock: {'Sí' if stock.get('has_stock') else 'No'}")
    
    full_text = "\n".join(parts)
    return truncate_text(full_text)


def prepare_image_bytes(image_path: str) -> Optional[bytes]:
    """
    Lee y optimiza una imagen para el API de embeddings.
    Redimensiona si excede el tamaño máximo.
    """
    try:
        path = Path(image_path)
        if not path.exists():
            logger.warning(f"[IMAGE] Archivo no encontrado: {image_path}")
            return None
        
        img = Image.open(path)
        
        # Convertir a RGB si es necesario
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        
        # Redimensionar si es muy grande
        max_dim = EMBEDDING_IMAGE_RESIZE_MAX_DIM
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        
        # Convertir a bytes JPEG
        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=85)
        return buffer.getvalue()
        
    except Exception as e:
        logger.warning(f"[IMAGE] Error procesando {image_path}: {e}")
        return None


# ============================================================================
# 3. GENERACIÓN DE EMBEDDINGS
# ============================================================================

def generate_multimodal_embedding(
    text: str,
    image_bytes: Optional[bytes] = None,
    pdf_bytes: Optional[bytes] = None,
) -> Optional[list[float]]:
    """
    Genera un embedding multimodal combinando texto + imagen/PDF
    usando gemini-embedding-2.
    
    Args:
        text: Texto descriptivo del producto.
        image_bytes: Bytes de la imagen principal (opcional).
        pdf_bytes: Bytes de ficha técnica PDF (opcional).
    
    Returns:
        Vector de 3072 dimensiones o None si falla.
    """
    try:
        # Construir contenido multimodal
        contents = [text]
        
        # Agregar imagen si disponible
        if image_bytes:
            contents.append(
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type="image/jpeg",
                )
            )
        
        # Agregar PDF si disponible
        if pdf_bytes:
            contents.append(
                types.Part.from_bytes(
                    data=pdf_bytes,
                    mime_type="application/pdf",
                )
            )
        
        # Generar embedding con task instruction
        result = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=contents,
            config=types.EmbedContentConfig(
                task_type=EMBEDDING_TASK_TYPE_DOCUMENT,
                output_dimensionality=EMBEDDING_DIMENSIONS,
            )
        )
        
        if result.embeddings and len(result.embeddings) > 0:
            vector = result.embeddings[0].values
            return vector
        
        logger.warning("[EMBED] Respuesta vacía del API")
        return None
        
    except Exception as e:
        logger.error(f"[EMBED] Error generando embedding: {e}")
        raise


def generate_query_embedding(query_text: str) -> Optional[list[float]]:
    """
    Genera embedding para una consulta de búsqueda.
    Usa task_type RETRIEVAL_QUERY para óptima recuperación.
    """
    try:
        result = client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=[query_text],
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_QUERY",
                output_dimensionality=EMBEDDING_DIMENSIONS,
            )
        )
        
        if result.embeddings and len(result.embeddings) > 0:
            return result.embeddings[0].values
        return None
        
    except Exception as e:
        logger.error(f"[QUERY EMBED] Error: {e}")
        raise


# ============================================================================
# 4. PIPELINE DE PROCESAMIENTO POR LOTES
# ============================================================================

def process_product_embedding(product: dict) -> Optional[dict]:
    """
    Procesa un solo producto: construye texto, carga imagen,
    genera embedding multimodal y retorna el datapoint.
    """
    product_id = product["product_id"]
    
    # Construir texto
    text = build_product_text(product)
    
    # Cargar imagen principal
    image_bytes = None
    local_images = product.get("local_image_paths", [])
    if local_images:
        image_bytes = prepare_image_bytes(local_images[0])
    
    # Cargar PDF si existe
    pdf_bytes = None
    pdf_path = product.get("local_pdf_path", "")
    if pdf_path and Path(pdf_path).exists():
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()
    
    # Generar embedding
    vector = generate_multimodal_embedding(text, image_bytes, pdf_bytes)
    
    if not vector:
        return None
    
    # Construir datapoint para Vector Search
    datapoint = {
        "id": product_id,
        "embedding": vector,
        "metadata": {
            "product_id": product_id,
            "name": product.get("name", ""),
            "category": product.get("category", ""),
            "subcategory": product.get("subcategory", ""),
            "has_stock": product.get("stock", {}).get("has_stock", False),
            "total_stock": product.get("stock", {}).get("total", 0),
            "price": product.get("price"),
            "image_count": len(product.get("image_urls", [])),
        },
        "text_content": text,
    }
    
    return datapoint


def run_embedding_pipeline(products_file: Optional[str] = None) -> list[dict]:
    """
    Pipeline principal: procesa todos los productos y genera embeddings.
    
    Args:
        products_file: Ruta al JSON de productos. Si None, usa all_products.json.
    
    Returns:
        Lista de datapoints con embeddings.
    """
    checkpoint = CheckpointManager("embedding")
    audit_log = []
    
    # Cargar productos
    if products_file:
        products = load_json(Path(products_file))
    else:
        products = load_json(PRODUCTS_JSON_DIR / "all_products.json")
    
    logger.info("=" * 70)
    logger.info(f"[INICIO] Pipeline de Embeddings — {len(products)} productos")
    logger.info(f"[CONFIG] Modelo: {EMBEDDING_MODEL}")
    logger.info(f"[CONFIG] Dimensiones: {EMBEDDING_DIMENSIONS}")
    logger.info(f"[CONFIG] Batch size: {EMBEDDING_BATCH_SIZE}")
    logger.info("=" * 70)
    
    embeddings_output = EMBEDDINGS_DIR / "product_embeddings.json"
    jsonl_output = EMBEDDINGS_DIR / "product_embeddings.jsonl"
    
    all_datapoints = []
    processed_ids = set()
    
    # Cargar embeddings existentes para no perder progreso
    if embeddings_output.exists():
        try:
            all_datapoints = load_json(embeddings_output)
            processed_ids = {dp["id"] for dp in all_datapoints}
            logger.info(f"[LOAD] Cargados {len(all_datapoints)} embeddings existentes desde {embeddings_output}")
        except Exception as e:
            logger.warning(f"[LOAD] Error al cargar embeddings existentes: {e}")
    
    for batch_start in range(0, len(products), EMBEDDING_BATCH_SIZE):
        batch = products[batch_start:batch_start + EMBEDDING_BATCH_SIZE]
        batch_num = (batch_start // EMBEDDING_BATCH_SIZE) + 1
        total_batches = (len(products) + EMBEDDING_BATCH_SIZE - 1) // EMBEDDING_BATCH_SIZE
        
        logger.info(f"[BATCH {batch_num}/{total_batches}] Procesando {len(batch)} productos...")
        
        batch_has_new = False
        for product in batch:
            pid = product.get("product_id", "UNKNOWN")
            
            if checkpoint.is_processed(f"embed:{pid}") and pid in processed_ids:
                logger.debug(f"[SKIP] Embedding ya existe: {pid}")
                continue
            
            try:
                datapoint = process_product_embedding(product)
                
                if datapoint:
                    # Eliminar duplicado si existe
                    all_datapoints = [dp for dp in all_datapoints if dp["id"] != pid]
                    all_datapoints.append(datapoint)
                    processed_ids.add(pid)
                    checkpoint.mark_processed(f"embed:{pid}")
                    batch_has_new = True
                    
                    audit_log.append(generate_audit_record(
                        pid, "embedding_generated", "SUCCESS",
                        {"dimensions": len(datapoint["embedding"])}
                    ))
                    logger.info(f"[EMBED] ✓ {pid} — vector {len(datapoint['embedding'])}d")
                else:
                    checkpoint.mark_failed(f"embed:{pid}", "Empty embedding")
                    
            except Exception as e:
                logger.error(f"[EMBED] ✗ {pid}: {e}")
                checkpoint.mark_failed(f"embed:{pid}", str(e))
                audit_log.append(generate_audit_record(
                    pid, "embedding_generated", "FAILED", {"error": str(e)}
                ))
        
        # Guardar progreso al final de cada batch si hubo cambios
        if batch_has_new:
            save_json(all_datapoints, embeddings_output)
            with open(jsonl_output, "w", encoding="utf-8") as f:
                for dp in all_datapoints:
                    line = {
                        "id": dp["id"],
                        "embedding": dp["embedding"],
                        "restricts": [
                            {"namespace": "category", "allow": [dp["metadata"]["category"]]},
                            {"namespace": "subcategory", "allow": [dp["metadata"]["subcategory"]]},
                        ],
                        "numeric_restricts": [
                            {"namespace": "total_stock", "value_int": dp["metadata"]["total_stock"]},
                        ],
                    }
                    f.write(json.dumps(line, ensure_ascii=False) + "\n")
            logger.info(f"[SAVE] Progreso guardado: {len(all_datapoints)} embeddings.")
        
        # Rate limiting entre batches
        if batch_start + EMBEDDING_BATCH_SIZE < len(products):
            logger.debug(f"[RATE LIMIT] Esperando {EMBEDDING_RATE_LIMIT_DELAY}s...")
            time.sleep(EMBEDDING_RATE_LIMIT_DELAY)
    
    # Guardar audit log al final
    save_json(audit_log, EMBEDDINGS_DIR / "embedding_audit_log.json")
    
    stats = checkpoint.get_stats()
    logger.info("=" * 70)
    logger.info(f"[COMPLETADO] {len(all_datapoints)} embeddings en total")
    logger.info(f"[STATS] Procesados en esta sesión: {stats['total_processed']}")
    logger.info(f"[STATS] Fallidos: {stats['total_failed']}")
    logger.info(f"[OUTPUT] JSON: {embeddings_output}")
    logger.info(f"[OUTPUT] JSONL: {jsonl_output}")
    logger.info("=" * 70)
    
    return all_datapoints


# ============================================================================
# 5. GENERACIÓN DE EMBEDDINGS POR IMAGEN INDIVIDUAL
# ============================================================================

def generate_per_image_embeddings(product: dict) -> list[dict]:
    """
    Genera un embedding separado por cada imagen del producto.
    Útil para búsqueda visual precisa.
    
    Returns:
        Lista de datapoints, uno por imagen.
    """
    product_id = product["product_id"]
    text = build_product_text(product)
    datapoints = []
    
    local_images = product.get("local_image_paths", [])
    
    for i, img_path in enumerate(local_images):
        image_bytes = prepare_image_bytes(img_path)
        if not image_bytes:
            continue
        
        vector = generate_multimodal_embedding(text, image_bytes)
        if not vector:
            continue
        
        dp_id = f"{product_id}_img{i}"
        datapoints.append({
            "id": dp_id,
            "embedding": vector,
            "metadata": {
                "product_id": product_id,
                "image_index": i,
                "image_path": img_path,
                "category": product.get("category", ""),
                "name": product.get("name", ""),
            }
        })
        
        logger.info(f"[PER-IMAGE] ✓ {dp_id}")
        time.sleep(EMBEDDING_RATE_LIMIT_DELAY)
    
    return datapoints


# ============================================================================
# 6. ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    datapoints = run_embedding_pipeline()
    print(f"\n{'='*50}")
    print(f"Pipeline completado: {len(datapoints)} embeddings")
    print(f"{'='*50}")
