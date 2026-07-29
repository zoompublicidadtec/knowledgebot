import os
import sys
from pathlib import Path
from typing import Optional, List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv

# Asegurar que el directorio actual esté en el PATH
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))

# Cargar dotenv
load_dotenv()

import rag_query_engine
from config import LOCAL_CATALOG_PATH, EMBEDDINGS_DIR, PRODUCTS_JSON_DIR
from utils import load_json
import supabase_loader  # FASE 1: fuente única de productos desde el panel

app = FastAPI(
    title="KnowledgeBot RAG Engine API",
    description="Servicio de Consulta RAG Multimodal para Catálogo Promocional",
    version="1.0.0"
)

# Habilitar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montar carpeta de imágenes si existe
if LOCAL_CATALOG_PATH:
    images_dir = Path(LOCAL_CATALOG_PATH) / "imagenes_productos"
    if images_dir.exists():
        app.mount("/images", StaticFiles(directory=str(images_dir)), name="images")
        print(f"Directory of images mounted statically on /images from: {images_dir}")
    else:
        print(f"WARNING: Directory not found: {images_dir}")

class QueryRequest(BaseModel):
    query: str
    top_k: Optional[int] = 5
    filters: Optional[dict] = None

class ProductResponse(BaseModel):
    product_id: str
    name: str
    category: str
    subcategory: str
    price: Optional[str] = None
    description: str
    stock: int
    has_stock: bool
    image_urls: List[str] = []
    score: float
    # Produccion propia de ZOOM. El motor ya lo calcula (is_preferente /
    # classify_origen); se publica para que el agente pueda priorizarlo sin
    # adivinar por el prefijo de la referencia.
    es_propio: bool = False

class QueryResponse(BaseModel):
    response: str
    products: List[ProductResponse]
    filters: dict

def normalize_image_path(absolute_path: str) -> str:
    """Normaliza ruta de imagen local a URL relativa web.

    FASE 2a — FIX CRÍTICO: las rutas del catálogo vienen en formato Windows
    ('D:\\\\KNOWLEDGE...\\\\galeria_1.jpg'). En Linux, las barras invertidas (\\\\)
    son caracteres NORMALES del nombre, no separadores, así que Path( ).parts
    no las divide y la función devolvía siempre "" (por eso image_urls llegaba
    vacío al bot). Solución: normalizar \\\\ -> / antes de parsear.
    """
    try:
        if not absolute_path:
            return ""
        # Las rutas que llegan de Supabase ya son URLs web servidas por la app
        # (/api/products/images/<carpeta>/<archivo>). Se devuelven intactas.
        if absolute_path.startswith("/api/") or absolute_path.startswith("http"):
            return absolute_path
        # Normalizar separadores Windows -> Unix (clave del fix).
        normalized = absolute_path.replace("\\", "/")
        # Ocasionalmente queda 'D://...' o doble barra; colapsar.
        while "//" in normalized:
            normalized = normalized.replace("//", "/")

        parts = Path(normalized).parts
        if "imagenes_productos" in parts:
            idx = parts.index("imagenes_productos")
            rel_parts = parts[idx + 1:]
            # Codificar espacios/acentos para URL. rel_parts ya es string ascii-safe
            # por la estructura de carpetas, pero por seguridad usamos quote.
            from urllib.parse import quote
            return "/".join(quote(p) for p in rel_parts)
        # Fallback: si por algún motivo no está 'imagenes_productos' pero hay
        # un segmento con galeria/principal, devolver el último segmento útil.
        if parts:
            from urllib.parse import quote
            return quote(parts[-1])
    except Exception as e:
        print(f"[normalize_image_path] error: {e} para {absolute_path[:80]}")
    return ""

@app.post("/query", response_model=QueryResponse)
async def query_rag(request: QueryRequest):
    try:
        print(f"[API DEBUG] Request query: '{request.query}', top_k parameter: {request.top_k}")
        # Ejecutar consulta en el motor RAG
        # Habilitar use_local=True ya que usamos los embeddings locales indexados
        raw_result = rag_query_engine.query(
            user_query=request.query,
            use_local=True,
            top_k=request.top_k or 5,
            custom_filters=request.filters
        )
        print(f"[API DEBUG] Query engine returned {len(raw_result.get('sources', []))} sources")
        
        # Detalles del producto: Supabase manda (es lo que edita el panel), y el
        # JSON local solo completa los campos que Supabase no guarda.
        all_products = {}
        products_file = PRODUCTS_JSON_DIR / "all_products.json"
        if products_file.exists():
            for p in load_json(products_file):
                all_products[p["product_id"]] = p
        for p in supabase_loader.get_products():
            pid = p.get("product_id")
            if not pid:
                continue
            base = all_products.get(pid, {})
            merged = {**base, **{k: v for k, v in p.items() if v}}
            all_products[pid] = merged


        matched_products = []
        
        # Mapear las fuentes (product_ids) a respuestas detalladas
        for i, doc_id in enumerate(raw_result.get("sources", [])):
            prod_detail = all_products.get(doc_id, {})
            score = raw_result.get("scores", [])[i] if i < len(raw_result.get("scores", [])) else 0.0
            
            # Formatear URLs de imágenes locales
            local_imgs = prod_detail.get("local_image_paths", [])
            web_imgs = []
            for img in local_imgs:
                rel_path = normalize_image_path(img)
                if not rel_path:
                    continue
                # Ya es una URL servida por la app Next.js: se usa tal cual.
                if rel_path.startswith("/api/") or rel_path.startswith("http"):
                    web_imgs.append(rel_path)
                else:
                    web_imgs.append(f"/images/{rel_path}")
            
            meta = {}
            for s in raw_result.get("sources_metadata", []) or []:
                if s.get("id") == doc_id:
                    meta = s
                    break
            es_propio = bool(
                meta.get("preferente")
                or rag_query_engine.is_preferente(prod_detail)
                or str(doc_id).upper().startswith("ZM-")
            )

            product_data = ProductResponse(
                product_id=doc_id,
                name=prod_detail.get("name", ""),
                es_propio=es_propio,
                category=prod_detail.get("category", ""),
                subcategory=prod_detail.get("subcategory", ""),
                price=prod_detail.get("price"),
                description=prod_detail.get("description", ""),
                stock=prod_detail.get("stock", {}).get("total", 0),
                has_stock=prod_detail.get("stock", {}).get("has_stock", False),
                image_urls=web_imgs,
                score=float(score)
            )
            matched_products.append(product_data)
            
        return QueryResponse(
            response=raw_result.get("response", ""),
            products=matched_products,
            filters=raw_result.get("filters", {})
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    # Verificar si el archivo de embeddings existe
    embeddings_file = EMBEDDINGS_DIR / "product_embeddings.json"
    has_embeddings = embeddings_file.exists()
    num_embeddings = 0
    if has_embeddings:
        try:
            data = load_json(embeddings_file)
            num_embeddings = len(data)
        except Exception:
            pass
            
    return {
        "status": "ok",
        "embeddings": {
            "loaded": has_embeddings,
            "count": num_embeddings
        }
    }

@app.post("/reindex")
async def reindex_catalog():
    """
    FASE 1 — Invalida el caché del catálogo para que la próxima búsqueda lea
    los productos actualizados desde Supabase (lo que edita el panel).

    El panel llama a este endpoint cada vez que se guarda/edita/elimina un
    producto. Así el bot refleja el cambio de inmediato (en <1s) sin pasos
    manuales ni reinicios.

    Nota: el re-embedding vectorial (3072D) de productos específicos puede
    añadirse aquí después como mejora incremental; hoy la búsqueda por
    palabras clave (motor principal) ya cubre los productos nuevos al instante.
    """
    try:
        supabase_loader.clear_cache()
        stats = supabase_loader.get_stats()
        return {
            "success": True,
            "message": "Caché invalidado. El próximo query leerá de Supabase.",
            "stats": stats,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/stats")
async def catalog_stats():
    """
    FASE 4 — Diagnóstico del catálogo para el panel (/motor).
    Devuelve: cuántos productos cargados, desde qué fuente, embeddings activos
    y cobertura (productos vs embeddings).
    """
    try:
        loader_stats = supabase_loader.get_stats()
        embeddings_file = EMBEDDINGS_DIR / "product_embeddings.json"
        num_embeddings = 0
        if embeddings_file.exists():
            try:
                num_embeddings = len(load_json(embeddings_file))
            except Exception:
                pass
        count = loader_stats.get("count", 0)
        coverage = round((num_embeddings / count * 100), 1) if count else 0
        return {
            "catalog": loader_stats,
            "embeddings": num_embeddings,
            "vector_coverage_pct": coverage,
            "images_mount": bool(LOCAL_CATALOG_PATH and
                                 (Path(LOCAL_CATALOG_PATH) / "imagenes_productos").exists()),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))




@app.post("/reembed")
async def reembed_product_endpoint(payload: dict):
    """
    Re-genera el embedding multimodal de UN producto.
    Llamado por el panel tras subir/cambiar la imagen de un producto, para
    mantener coherente el indice vectorial (texto+imagen en el mismo vector).

    Body: {"product_id": "ZM-MUG-007"}
    """
    pid = (payload or {}).get("product_id")
    if not pid:
        raise HTTPException(status_code=400, detail="product_id requerido")
    try:
        import asyncio
        from embedding_pipeline import reembed_product
        # to_thread: re-embedar tarda ~12s. Llamarlo directo bloquea el event
        # loop y el bot se queda sin /query mientras el panel sube una foto.
        datapoint = await asyncio.to_thread(reembed_product, pid)
        if not datapoint:
            raise HTTPException(status_code=500, detail=f"No se pudo re-embedar {pid}")
        return {
            "success": True,
            "product_id": datapoint["id"],
            "dimensions": len(datapoint.get("embedding", [])),
            "image_count": datapoint.get("metadata", {}).get("image_count", 0),
        }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
if __name__ == "__main__":
    import uvicorn
    # reload=False: con recarga automática, cualquier escritura en el directorio
    # tumbaba el motor en producción y el bot se quedaba sin catálogo.
    uvicorn.run("api_service:app", host="0.0.0.0", port=8001, reload=False)
