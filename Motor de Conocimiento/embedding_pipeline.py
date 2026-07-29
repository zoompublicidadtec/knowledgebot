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
import threading
import time
from io import BytesIO
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image
from google import genai
from google.genai import types

from config import (
    GOOGLE_API_KEY, OPENROUTER_API_KEY, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS,
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
# 1. CLIENTE GEMINI / OPENROUTER
# ============================================================================

client = None
if not (OPENROUTER_API_KEY and OPENROUTER_API_KEY.startswith("sk-or-")):
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

def call_openrouter_embeddings_api(text: str) -> list[float]:
    import urllib.request
    import json
    
    url = "https://openrouter.ai/api/v1/embeddings"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": EMBEDDING_MODEL,
        "input": text
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            res_data = response.read().decode("utf-8")
            data = json.loads(res_data)
            if "data" in data and len(data["data"]) > 0:
                return data["data"][0]["embedding"]
            raise ValueError(f"OpenRouter empty/invalid response: {data}")
    except urllib.error.HTTPError as e:
        error_content = e.read().decode("utf-8")
        if e.code == 429:
            raise RuntimeError(f"OpenRouter 429 RESOURCE_EXHAUSTED: {error_content}")
        raise RuntimeError(f"OpenRouter HTTP Error {e.code}: {error_content}")
    except Exception as e:
        raise RuntimeError(f"OpenRouter Error: {e}")


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
    # Si usamos OpenRouter, llamamos a la API de OpenRouter (que solo soporta texto para embeddings)
    if OPENROUTER_API_KEY and OPENROUTER_API_KEY.startswith("sk-or-"):
        try:
            return call_openrouter_embeddings_api(text)
        except Exception as e:
            logger.error(f"[EMBED] Error en OpenRouter: {e}")
            raise

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
    if OPENROUTER_API_KEY and OPENROUTER_API_KEY.startswith("sk-or-"):
        try:
            return call_openrouter_embeddings_api(query_text)
        except Exception as e:
            logger.error(f"[QUERY EMBED] Error en OpenRouter: {e}")
            raise

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




# ============================================================================
# Resolvedor de ruta de imagen (HTTP relativa -> disco) para reembed
# ============================================================================
def _resolve_image_to_disk(image_path: str) -> str:
    """
    Convierte una ruta de imagen (HTTP relativa del loader, o ruta absoluta)
    en una ruta de disco que PIL pueda abrir.

    El loader entrega local_image_paths como rutas HTTP relativas:
    '/api/products/images/3272_REF__.../principal.jpg' o '/images/...'.
    Esas rutas NO existen en disco tal cual; el archivo vive en
    {LOCAL_CATALOG_PATH}/imagenes_productos/{parte final}.

    Si la ruta ya es de disco y existe, se devuelve intacta.
    """
    from config import LOCAL_CATALOG_PATH

    p = Path(image_path)
    if p.exists():
        return str(p)

    base = LOCAL_CATALOG_PATH or '/root/knowledgebot/catalogo_catalogospromocionales'
    img_root = Path(base) / 'imagenes_productos'

    s = image_path
    for prefix in ('/api/products/images/', '/images/', '/api/catalog-images/'):
        if s.startswith(prefix):
            rel = s[len(prefix):]
            candidate = img_root / rel
            if candidate.exists():
                return str(candidate)
            break

    if 'imagenes_productos/' in s:
        rel = s.split('imagenes_productos/', 1)[1]
        candidate = img_root / rel
        if candidate.exists():
            return str(candidate)

    return image_path

# ============================================================================
# 4b. RE-EMBED DE UN SOLO PRODUCTO (para upload de imagen)
# ============================================================================
# Serializa la escritura del indice vectorial. reembed_product hace un
# read-modify-write del JSON completo (2.252 datapoints, ~138 MB): dos re-embeds
# simultaneos leerian la misma lista y el ultimo en guardar borraria el vector
# del otro sin avisar.
_REEMBED_LOCK = threading.Lock()


def _upsert_datapoint(datapoint: dict, embeddings_output: Path,
                      jsonl_output: Path) -> int:
    """Sustituye (o anade) un datapoint en el indice y lo persiste.

    Devuelve el total de datapoints. Todo el read-modify-write ocurre bajo
    _REEMBED_LOCK. save_json escribe a .tmp y renombra, asi que el indice nunca
    queda a medias aunque el proceso muera durante el guardado.
    """
    with _REEMBED_LOCK:
        all_datapoints = []
        if embeddings_output.exists():
            try:
                all_datapoints = load_json(embeddings_output)
            except Exception as e:
                logger.warning(f"[REEMBED] error cargando embeddings: {e}")
                all_datapoints = []

        pid = datapoint["id"]
        all_datapoints = [dp for dp in all_datapoints if dp["id"] != pid]
        all_datapoints.append(datapoint)

        save_json(all_datapoints, embeddings_output)
        try:
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
        except Exception as e:
            logger.warning(f"[REEMBED] JSONL no actualizado (no critico): {e}")

        return len(all_datapoints)


def reembed_product(product_id: str, product: Optional[dict] = None) -> Optional[dict]:
    """
    Re-genera el embedding multimodal de UN solo producto y lo actualiza en
    data/embeddings/product_embeddings.json (lista de datapoints).

    Esto es obligatorio tras subir/cambiar la imagen de un producto: el
    embedding es MULTIMODAL (texto+imagen en el mismo vector), asi que si la
    imagen cambia, el vector debe regenerarse para que el RAG sea coherente.

    Args:
        product_id: referencia comercial del producto (ej. "ZM-MUG-007").
        product: dict del producto (formato-motor) ya cargado. Si es None,
                 se busca en la fuente canonica (loader Supabase -> all_products.json).

    Returns:
        El datapoint actualizado, o None si fallo.
    """
    if product is None:
        # Fuente canonica: loader Supabase (trae local_image_paths desde image_url).
        # Cae a all_products.json si Supabase no responde (red de seguridad del loader).
        try:
            import supabase_loader
            # force_refresh=True: el panel acaba de actualizar image_url en
            # Supabase; forzamos recarga para no leer el caché con la ruta vieja.
            productos = supabase_loader.get_products(force_refresh=True)
            if productos:
                product = next((p for p in productos
                                if p.get("product_id") == product_id), None)
        except Exception as e:
            logger.warning(f"[REEMBED] loader fallo para {product_id}: {e}")
            product = None
        if product is None:
            # Red de seguridad: all_products.json
            try:
                todos = load_json(PRODUCTS_JSON_DIR / "all_products.json")
                product = next((p for p in todos
                                if p.get("product_id") == product_id), None)
            except Exception as e:
                logger.error(f"[REEMBED] no se encontro {product_id}: {e}")
                return None

    if product is None:
        logger.error(f"[REEMBED] producto no encontrado: {product_id}")
        return None

    # CRITICO: el loader entrega local_image_paths como rutas HTTP relativas
    # ('/api/products/images/.../principal.jpg'). PIL no puede abrirlas tal cual,
    # asi que las resolvemos a rutas de disco reales. Sin esto el embedding
    # quedaria solo-texto (la imagen nunca se incorpora al vector).
    product = dict(product)  # copia para no mutar el original en cache
    raw_imgs = product.get("local_image_paths") or []
    resolved_imgs = []
    for img in raw_imgs:
        r = _resolve_image_to_disk(img)
        if r != img:
            logger.info(f"[REEMBED] ruta resuelta: {img} -> {r}")
        resolved_imgs.append(r)
    if resolved_imgs:
        product["local_image_paths"] = resolved_imgs

    embeddings_output = EMBEDDINGS_DIR / "product_embeddings.json"
    jsonl_output = EMBEDDINGS_DIR / "product_embeddings.jsonl"

    # Re-embeddar con manejo de rate limit (igual que el pipeline masivo)
    retries = 0
    max_429_retries = 10
    datapoint = None
    while datapoint is None and retries < max_429_retries:
        try:
            datapoint = process_product_embedding(product)
        except Exception as e:
            error_msg = str(e)
            if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg or "Quota exceeded" in error_msg:
                retries += 1
                wait_time = 60 * retries
                logger.warning(f"[REEMBED] 429 para {product_id}. Reintento {retries}/{max_429_retries} - Esperando {wait_time}s...")
                time.sleep(wait_time)
            else:
                logger.error(f"[REEMBED] error procesando {product_id}: {e}")
                return None

    if not datapoint:
        logger.error(f"[REEMBED] embedding vacio para {product_id}")
        return None

    # Dedup + append + persistencia, serializados (ver _upsert_datapoint)
    pid = datapoint["id"]
    total = _upsert_datapoint(datapoint, embeddings_output, jsonl_output)

    logger.info(f"[REEMBED] [OK] {pid} re-embedado a {len(datapoint['embedding'])}d (total: {total})")
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
            
            retries = 0
            max_429_retries = 10
            success = False
            while not success and retries < max_429_retries:
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
                        logger.info(f"[EMBED] [OK] {pid} — vector {len(datapoint['embedding'])}d")
                    else:
                        checkpoint.mark_failed(f"embed:{pid}", "Empty embedding")
                    success = True
                        
                except Exception as e:
                    error_msg = str(e)
                    if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg or "Quota exceeded" in error_msg:
                        retries += 1
                        wait_time = 60 * retries
                        logger.warning(f"[RATE LIMIT] 429 RESOURCE_EXHAUSTED para {pid}. Reintento {retries}/{max_429_retries} - Esperando {wait_time}s...")
                        time.sleep(wait_time)
                    else:
                        logger.error(f"[EMBED] [ERROR] {pid}: {e}")
                        checkpoint.mark_failed(f"embed:{pid}", str(e))
                        audit_log.append(generate_audit_record(
                            pid, "embedding_generated", "FAILED", {"error": str(e)}
                        ))
                        success = True
        
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
        if batch_start + EMBEDDING_BATCH_SIZE < len(products) and batch_has_new:
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
