"""
============================================================================
SUPABASE_LOADER.PY — Fuente única de productos desde Supabase
============================================================================
Reemplaza la lectura estática de all_products.json. Trae los productos desde
Supabase (la BD que edita el panel) para que el bot use SIEMPRE el catálogo
actualizado. Así, cuando editas/creas un producto en el panel, el bot lo
conoce sin pasos manuales.

Diseño defensivo (no rompe lo que funciona):
  - Si Supabase responde  → usa los productos de Supabase.
  - Si Supabase cae        → cae al all_products.json local (red de seguridad).
  - Caché en memoria (TTL 60s) para no saturar la API en cada búsqueda.
  - Mapea los campos de Supabase al formato que rag_query_engine espera
    (product_id, name, category NAME no id, subcategory, search_text, etc.).

No toca la lógica de búsqueda (keyword_fallback_search, boosting, etc.):
solo cambia la FUENTE de datos.
============================================================================
"""

import os
import time
import threading
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

from config import PRODUCTS_JSON_DIR
from utils import load_json, setup_logger

logger = setup_logger("supabase_loader", "supabase_loader.log")

# ── Cargar variables de entorno ───────────────────────────────────────────
# El motor carga su propio .env, pero las credenciales de Supabase viven en
# el .env.production de la app Next.js (un nivel arriba). Las cargamos aquí
# para que el loader tenga acceso sin duplicar secretos.
load_dotenv()  # .env del motor (prioridad)
_APP_ENV = Path(__file__).resolve().parent.parent / ".env.production"
if _APP_ENV.exists():
    load_dotenv(_APP_ENV)  # .env.production de la app (fallback)

# ── Configuración Supabase (lee del entorno de la app Next.js) ────────────
SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or ""
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""

# Caché en memoria (60s de TTL). El catálogo cambia poco por mensaje.
_CACHE_TTL_SECONDS = 60
_cache_lock = threading.Lock()
_cache: dict = {
    "products": None,        # list[dict] en formato-motor
    "loaded_at": 0.0,        # epoch
    "count": 0,
}


def _is_available() -> bool:
    """True si hay URL + service role key configurados."""
    return bool(SUPABASE_URL and SUPABASE_KEY)


def _map_supabase_row(row: dict, category_name: str) -> dict:
    """Convierte una fila de products (Supabase) al formato-motor.

    El motor espera: product_id, name, category, subcategory, price,
    description, search_text, local_image_paths, etc. Aquí normalizamos.
    """
    # product_id: preferimos la referencia comercial (MU-12-2) sobre el UUID,
    # porque así coinciden los embeddings y el bot muestra Ref: MU-12-2.
    ref = (row.get("reference") or "").strip()
    pid = ref if ref else row.get("id", "")

    # Precio: Supabase NO guarda precio en products (va en price_tiers).
    # Lo dejamos vacío; la calculadora del agente (getProductPrice) lo resuelve.
    price = ""

    # Imagen: Supabase guarda image_url (URL pública o relativa).
    image_url = (row.get("image_url") or "").strip()
    local_image_paths = [image_url] if image_url else []

    return {
        "product_id": pid,
        "name": row.get("name", "") or "",
        "category": category_name or "",
        "subcategory": "",  # Supabase no la separa; va dentro de notes/search_text
        "price": price,
        "description": row.get("description", "") or "",
        "search_text": row.get("search_text", "") or "",
        "notes": row.get("notes", "") or "",
        "unit": row.get("unit", "unidad") or "unidad",
        "local_image_paths": local_image_paths,
        "image_urls": local_image_paths,
        "_supabase_id": row.get("id", ""),  # UUID real, por si se necesita
    }


def _fetch_categories(client: httpx.Client) -> dict:
    """Trae el mapa id->nombre de categorías."""
    mapping: dict = {}
    try:
        resp = client.get(
            f"{SUPABASE_URL}/rest/v1/categories",
            params={"select": "id,name"},
            headers=_headers(),
            timeout=15,
        )
        if resp.status_code == 200:
            for c in resp.json():
                mapping[c["id"]] = c.get("name", "")
    except Exception as e:
        logger.warning(f"[SUPABASE] No se pudieron cargar categorías: {e}")
    return mapping


def _headers() -> dict:
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }


def _fetch_products_from_supabase() -> Optional[list]:
    """Trae TODOS los productos activos de Supabase, ya mapeados al formato-motor."""
    if not _is_available():
        return None

    try:
        # Sin timeout global del cliente: usamos por-request.
        with httpx.Client(timeout=30) as client:
            categories = _fetch_categories(client)
            logger.info(f"[SUPABASE] {len(categories)} categorías cargadas")

            products: list = []
            page_size = 1000
            offset = 0
            total = None

            while True:
                # Pedimos solo los campos que el motor usa. Excluimos embedding
                # (viene como string gigante de 1536D y no nos sirve aquí).
                resp = client.get(
                    f"{SUPABASE_URL}/rest/v1/products",
                    params={
                        "select": "id,category_id,name,reference,description,"
                                  "search_text,notes,unit,image_url",
                        "active": "eq.true",
                        "order": "id.asc",
                        "limit": page_size,
                        "offset": offset,
                    },
                    headers={**_headers(), "Prefer": "count=exact"},
                    timeout=30,
                )
                if resp.status_code not in (200, 206):
                    logger.warning(
                        f"[SUPABASE] products devolvió HTTP {resp.status_code}: "
                        f"{resp.text[:200]}"
                    )
                    return None

                batch = resp.json()
                if total is None:
                    # Primer respuesta: leer el count total del header.
                    cr = resp.headers.get("content-range", "")
                    if "/" in cr:
                        try:
                            total = int(cr.rsplit("/", 1)[1])
                        except ValueError:
                            total = None

                for row in batch:
                    cat_name = categories.get(row.get("category_id", ""), "")
                    products.append(_map_supabase_row(row, cat_name))

                if len(batch) < page_size:
                    break
                offset += page_size
                # Salvaguarda anti-loop infinito.
                if total and offset >= total:
                    break

            logger.info(f"[SUPABASE] {len(products)} productos cargados (total BD: {total})")
            return products

    except Exception as e:
        logger.warning(f"[SUPABASE] Falló la carga de productos: {e}")
        return None


def _fallback_local_json() -> list:
    """Red de seguridad: si Supabase cae, usa el all_products.json local."""
    products_file = PRODUCTS_JSON_DIR / "all_products.json"
    if products_file.exists():
        logger.warning(
            f"[SUPABASE] Usando fallback local: {products_file} "
            "(Supabase no respondió)"
        )
        return load_json(products_file)
    logger.error("[SUPABASE] Ni Supabase ni el JSON local están disponibles")
    return []


def get_products(force_refresh: bool = False) -> list:
    """
    Devuelve la lista de productos en formato-motor.

    Fuente de verdad: Supabase (lo que edita el panel).
    Fallback: all_products.json local (si Supabase cae).
    Caché en memoria 60s salvo force_refresh.

    Esta es la ÚNICA función que rag_query_engine debe llamar en vez de
    load_json(PRODUCTS_JSON_DIR / "all_products.json").
    """
    now = time.time()

    # ¿Caché vigente?
    if not force_refresh and _cache["products"] is not None:
        age = now - _cache["loaded_at"]
        if age < _CACHE_TTL_SECONDS:
            return _cache["products"]

    with _cache_lock:
        # Doble check (otro hilo pudo haber cargado mientras esperábamos).
        if not force_refresh and _cache["products"] is not None:
            if (now - _cache["loaded_at"]) < _CACHE_TTL_SECONDS:
                return _cache["products"]

        products = _fetch_products_from_supabase()
        if products is None or len(products) == 0:
            products = _fallback_local_json()

        _cache["products"] = products
        _cache["loaded_at"] = time.time()
        _cache["count"] = len(products)
        return products


def clear_cache() -> None:
    """Invalida el caché. Úsalo tras un reindex para forzar recarga."""
    with _cache_lock:
        _cache["products"] = None
        _cache["loaded_at"] = 0.0
        _cache["count"] = 0


def get_stats() -> dict:
    """Diagnóstico: cuántos productos cargados, desde dónde, hace cuánto."""
    with _cache_lock:
        loaded_at = _cache["loaded_at"]
        count = _cache["count"]
    return {
        "available": _is_available(),
        "count": count,
        "source": "supabase" if _is_available() else "local_json_fallback",
        "loaded_seconds_ago": round(time.time() - loaded_at, 1) if loaded_at else None,
    }
