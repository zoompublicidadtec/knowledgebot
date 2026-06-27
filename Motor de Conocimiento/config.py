"""
============================================================================
CONFIG.PY — Configuración Central del Sistema RAG Militar
============================================================================
Todas las constantes, credenciales y parámetros globales del pipeline.
Diseñado para desacoplamiento total entre módulos.
============================================================================
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno del archivo .env
load_dotenv()

# ============================================================================
# 1. RUTAS DEL PROYECTO
# ============================================================================
PROJECT_ROOT = Path(__file__).parent
DATA_DIR = PROJECT_ROOT / "data"
PRODUCTS_JSON_DIR = DATA_DIR / "products"
IMAGES_DIR = DATA_DIR / "images"
PDFS_DIR = DATA_DIR / "pdfs"
EMBEDDINGS_DIR = DATA_DIR / "embeddings"
LOGS_DIR = PROJECT_ROOT / "logs"
CHECKPOINT_DIR = DATA_DIR / "checkpoints"

# Ruta de catálogo local
LOCAL_CATALOG_PATH = os.getenv("LOCAL_CATALOG_PATH")

# Crear directorios automáticamente
for d in [DATA_DIR, PRODUCTS_JSON_DIR, IMAGES_DIR, PDFS_DIR,
          EMBEDDINGS_DIR, LOGS_DIR, CHECKPOINT_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ============================================================================
# 2. CREDENCIALES DEL SITIO WEB (CATAPROM)
# ============================================================================
CATALOG_BASE_URL = "https://www.catalogospromocionales.com"
CATALOG_AUTH_USER = os.getenv("CATALOG_USER", "distribuidor")
CATALOG_AUTH_PASS = os.getenv("CATALOG_PASS", "21122112")
CATALOG_ENTRY_URL = f"{CATALOG_BASE_URL}/seccion/subcategorias.html"

# ============================================================================
# 3. GOOGLE CLOUD / GEMINI
# ============================================================================
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID", "")
GCP_REGION = os.getenv("GCP_REGION", "us-central1")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "cataprom-rag-assets")

# Gemini Embedding 2
EMBEDDING_MODEL = "gemini-embedding-2"
EMBEDDING_DIMENSIONS = 3072
EMBEDDING_TASK_TYPE_DOCUMENT = "RETRIEVAL_DOCUMENT"
EMBEDDING_TASK_TYPE_QUERY = "RETRIEVAL_QUERY"
EMBEDDING_TASK_INSTRUCTION = (
    "product retrieval and semantic search for promotional items catalog"
)
EMBEDDING_MAX_TOKENS = 8192

# Gemini LLM para RAG
LLM_MODEL = "gemini-2.0-flash"
LLM_TEMPERATURE = 0.2
LLM_MAX_OUTPUT_TOKENS = 4096

# ============================================================================
# 4. VERTEX AI VECTOR SEARCH
# ============================================================================
VECTOR_INDEX_DISPLAY_NAME = "cataprom-product-index"
VECTOR_INDEX_DESCRIPTION = "Índice vectorial multimodal de catálogo promocional CATAPROM"
VECTOR_ENDPOINT_DISPLAY_NAME = "cataprom-search-endpoint"
VECTOR_INDEX_UPDATE_METHOD = "STREAM_UPDATE"
VECTOR_DISTANCE_MEASURE = "COSINE_DISTANCE"
VECTOR_SHARD_SIZE = "SHARD_SIZE_SMALL"  # Para <10K vectores iniciales
VECTOR_APPROXIMATE_NEIGHBORS_COUNT = 150

# Metadatos filtrables en Vector Search
FILTERABLE_METADATA_FIELDS = [
    {"field_name": "category", "field_type": "STRING"},
    {"field_name": "subcategory", "field_type": "STRING"},
    {"field_name": "product_id", "field_type": "STRING"},
    {"field_name": "has_stock", "field_type": "BOOLEAN"},
    {"field_name": "total_stock", "field_type": "NUMERIC"},
]

# ============================================================================
# 5. FIRESTORE
# ============================================================================
FIRESTORE_COLLECTION = "cataprom_products"

# ============================================================================
# 6. SCRAPING
# ============================================================================
SCRAPER_MAX_CONCURRENCY = 3         # Peticiones simultáneas máximas
SCRAPER_DELAY_MIN = 1.0             # Segundos mínimos entre requests
SCRAPER_DELAY_MAX = 3.0             # Segundos máximos entre requests
SCRAPER_TIMEOUT = 30000             # Timeout de Playwright en ms
SCRAPER_MAX_RETRIES = 5             # Reintentos por página
SCRAPER_BACKOFF_BASE = 2            # Base exponencial para backoff
SCRAPER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# ============================================================================
# 7. EMBEDDING PIPELINE
# ============================================================================
EMBEDDING_BATCH_SIZE = 5            # Productos por batch (rate limiting)
EMBEDDING_RATE_LIMIT_DELAY = 1.0    # Segundos entre batches
EMBEDDING_MAX_IMAGE_SIZE_MB = 20    # Máximo tamaño de imagen para API
EMBEDDING_IMAGE_RESIZE_MAX_DIM = 1024  # Redimensionar imágenes grandes

# ============================================================================
# 8. RAG QUERY ENGINE
# ============================================================================
RAG_TOP_K = 10                      # Resultados de vector search
RAG_RERANK_TOP_N = 5                # Resultados después de reranking
RAG_SIMILARITY_THRESHOLD = 0.5      # Umbral mínimo de similitud
