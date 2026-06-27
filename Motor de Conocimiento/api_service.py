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

class QueryResponse(BaseModel):
    response: str
    products: List[ProductResponse]
    filters: dict

def normalize_image_path(absolute_path: str) -> str:
    """Normaliza ruta de imagen local a URL relativa web."""
    try:
        abs_p = Path(absolute_path)
        parts = abs_p.parts
        if "imagenes_productos" in parts:
            idx = parts.index("imagenes_productos")
            rel_parts = parts[idx+1:]
            # Reemplazar espacios y caracteres raros
            return "/".join(rel_parts)
    except Exception:
        pass
    return ""

@app.post("/query", response_model=QueryResponse)
async def query_rag(request: QueryRequest):
    try:
        # Ejecutar consulta en el motor RAG
        # Habilitar use_local=True ya que usamos los embeddings locales indexados
        raw_result = rag_query_engine.query(
            user_query=request.query,
            use_local=True,
            top_k=request.top_k or 5,
            custom_filters=request.filters
        )
        
        # Cargar catálogo completo para recuperar imágenes y metadatos adicionales
        products_file = PRODUCTS_JSON_DIR / "all_products.json"
        all_products = {}
        if products_file.exists():
            products_list = load_json(products_file)
            all_products = {p["product_id"]: p for p in products_list}
            
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
                if rel_path:
                    # Devolver URL relativa que apunta a nuestro mount estático
                    web_imgs.append(f"/images/{rel_path}")
            
            product_data = ProductResponse(
                product_id=doc_id,
                name=prod_detail.get("name", ""),
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api_service:app", host="0.0.0.0", port=8001, reload=True)
