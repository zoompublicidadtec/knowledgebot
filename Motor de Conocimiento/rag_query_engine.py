"""
============================================================================
RAG_QUERY_ENGINE.PY — Motor de Consulta RAG con Búsqueda Híbrida
============================================================================
Recibe query en lenguaje natural → genera embedding → busca vectores
→ filtra metadatos → inyecta contexto en Gemini Pro → responde.
============================================================================
"""

import json
import re
from typing import Optional

from google import genai
from google.genai import types
from google.cloud import aiplatform, firestore

from config import (
    GOOGLE_API_KEY, OPENROUTER_API_KEY, GCP_PROJECT_ID, GCP_REGION,
    EMBEDDING_MODEL, EMBEDDING_DIMENSIONS,
    LLM_MODEL, LLM_TEMPERATURE, LLM_MAX_OUTPUT_TOKENS,
    VECTOR_ENDPOINT_DISPLAY_NAME,
    RAG_TOP_K, RAG_RERANK_TOP_N, RAG_SIMILARITY_THRESHOLD,
    FIRESTORE_COLLECTION, PRODUCTS_JSON_DIR, EMBEDDINGS_DIR,
)
from utils import setup_logger, load_json

logger = setup_logger("rag_engine", "rag_query_audit.log")

# Clientes
gemini_client = None
if GOOGLE_API_KEY:
    gemini_client = genai.Client(api_key=GOOGLE_API_KEY)


# ============================================================================
# 1. GENERACIÓN DE EMBEDDING DE CONSULTA
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


def generate_query_embedding(query: str) -> list[float]:
    """
    Genera embedding de la consulta del usuario usando
    task_type RETRIEVAL_QUERY para óptima recuperación.
    """
    if OPENROUTER_API_KEY and OPENROUTER_API_KEY.startswith("sk-or-"):
        try:
            return call_openrouter_embeddings_api(query)
        except Exception as e:
            logger.warning(f"[EMBEDDING] Error al generar embedding en OpenRouter: {e}")
            return [0.0] * EMBEDDING_DIMENSIONS

    try:
        if not gemini_client:
            raise ValueError("gemini_client no está inicializado")
        result = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=[query],
            config=types.EmbedContentConfig(
                task_type="RETRIEVAL_QUERY",
                output_dimensionality=EMBEDDING_DIMENSIONS,
            )
        )
        
        if result.embeddings and len(result.embeddings) > 0:
            return result.embeddings[0].values
    except Exception as e:
        logger.warning(f"[EMBEDDING] Error al generar embedding, usando fallback a vector de ceros: {e}")
        return [0.0] * EMBEDDING_DIMENSIONS
        
    raise ValueError("No se pudo generar embedding de consulta")


# ============================================================================
# 2. BÚSQUEDA VECTORIAL (VERTEX AI)
# ============================================================================

def vector_search(
    query_embedding: list[float],
    top_k: int = RAG_TOP_K,
    filters: Optional[dict] = None,
) -> list[dict]:
    """
    Busca los vecinos más cercanos en Vertex AI Vector Search.
    Soporta filtrado por metadatos (categoría, stock, etc.).
    
    Args:
        query_embedding: Vector de consulta (3072-d).
        top_k: Número de resultados a retornar.
        filters: Dict con filtros de metadatos opcionales.
            Ej: {"category": "TECNOLOGÍA", "min_stock": 10}
    
    Returns:
        Lista de resultados con id, score y metadata.
    """
    aiplatform.init(project=GCP_PROJECT_ID, location=GCP_REGION)
    
    # Obtener endpoint desplegado
    endpoints = aiplatform.MatchingEngineIndexEndpoint.list(
        filter=f'display_name="{VECTOR_ENDPOINT_DISPLAY_NAME}"'
    )
    
    if not endpoints:
        raise RuntimeError(
            f"No se encontró endpoint: {VECTOR_ENDPOINT_DISPLAY_NAME}. "
            "Ejecuta vector_db_setup.py primero."
        )
    
    endpoint = endpoints[0]
    
    # Construir restricciones de filtrado
    restricts = []
    numeric_restricts = []
    
    if filters:
        if "category" in filters:
            restricts.append({
                "namespace": "category",
                "allow_list": [filters["category"]],
            })
        if "subcategory" in filters:
            restricts.append({
                "namespace": "subcategory",
                "allow_list": [filters["subcategory"]],
            })
        if "min_stock" in filters:
            numeric_restricts.append({
                "namespace": "total_stock",
                "value_int": filters["min_stock"],
                "op": "GREATER_EQUAL",
            })
    
    # Ejecutar búsqueda
    response = endpoint.find_neighbors(
        deployed_index_id="cataprom_deployed_v1",
        queries=[query_embedding],
        num_neighbors=top_k,
    )
    
    results = []
    if response and len(response) > 0:
        for neighbor in response[0]:
            results.append({
                "id": neighbor.id,
                "score": neighbor.distance,
            })
    
    logger.info(f"[SEARCH] {len(results)} resultados encontrados")
    return results


# ============================================================================
# 3. BÚSQUEDA LOCAL (FALLBACK SIN GCP)
# ============================================================================

def local_vector_search(
    query_embedding: list[float],
    top_k: int = RAG_TOP_K,
    filters: Optional[dict] = None,
) -> list[dict]:
    """
    Búsqueda vectorial local usando cosine similarity.
    Fallback cuando no hay Vertex AI desplegado.
    Carga embeddings desde archivo JSON local.
    """
    import numpy as np
    from pathlib import Path
    
    embeddings_file = EMBEDDINGS_DIR / "product_embeddings.json"
    if not embeddings_file.exists():
        logger.error("[LOCAL SEARCH] No hay embeddings locales")
        return []
    
    datapoints = load_json(embeddings_file)
    query_vec = np.array(query_embedding)
    
    # Aplicar filtros de metadatos (solo categorías EXPLÍCITAS del cliente)
    filtered = datapoints
    if filters:
        cat_filter = filters.get("explicit_category") or filters.get("category")
        if cat_filter:
            filtered = [
                d for d in filtered
                if d.get("metadata", {}).get("category", "").upper()
                == cat_filter.upper()
            ]
        subcat_filter = filters.get("explicit_subcategory") or filters.get("subcategory")
        if subcat_filter:
            filtered = [
                d for d in filtered
                if d.get("metadata", {}).get("subcategory", "").upper()
                == subcat_filter.upper()
            ]
        if "min_stock" in filters:
            filtered = [
                d for d in filtered
                if d.get("metadata", {}).get("total_stock", 0)
                >= filters["min_stock"]
            ]
    
    # Calcular similitud coseno
    results = []
    for dp in filtered:
        doc_vec = np.array(dp["embedding"])
        similarity = np.dot(query_vec, doc_vec) / (
            np.linalg.norm(query_vec) * np.linalg.norm(doc_vec)
        )
        
        if similarity >= RAG_SIMILARITY_THRESHOLD:
            results.append({
                "id": dp["id"],
                "score": float(similarity),
                "metadata": dp.get("metadata", {}),
                "text_content": dp.get("text_content", ""),
            })
    
    # Ordenar por similitud descendente
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


# ----------------------------------------------------------------------------
# Diccionario de jerga colombiana -> terminos formales del catalogo.
# Cada jerga mapea a una lista de terminos canonicos que se añaden a la
# consulta antes de buscar por palabras clave. Asi el RAG recupera bien aun
# cuando el bot NO haya traducido la jerga o cuando se llame a /query directo.
# ----------------------------------------------------------------------------
JARGON_SYNONYMS: dict[str, list[str]] = {
    # Bebidas / vasos
    "pocillo": ["mug", "pocillo", "taza"],
    "tinto": ["mug", "cafe", "taza"],
    "taza": ["mug", "taza"],
    "botilito": ["termo", "botilito", "botella", "caramañola"],
    "caramañola": ["termo", "botilito", "botella"],
    "caramanola": ["termo", "botilito", "botella"],
    "termo": ["termo", "botilito"],
    "vaso": ["vaso", "mug"],
    "vasito": ["vaso", "shot"],
    # Gorras / cabezal
    "cachucha": ["gorra"],
    "cachuchas": ["gorra"],
    "gorra": ["gorra"],
    "gorras": ["gorra"],
    "sombrero": ["sombrero", "gorra"],
    # Escritura
    "esfero": ["boligrafo", "esfero", "lapicero"],
    "esferos": ["boligrafo", "esfero", "lapicero"],
    "lapicero": ["boligrafo", "esfero", "lapicero"],
    "lapiceros": ["boligrafo", "esfero", "lapicero"],
    "boligrafo": ["boligrafo", "esfero"],
    "pluma": ["pluma", "boligrafo"],
    # SINONIMOS TARJETAS (9 jul 2026) - el bot busca en singular, RAG necesita plural
    "tarjeta mate": ["tarjetas", "mate uv", "tarjetas mate uv"],
    "tarjeta de presentacion mate": ["tarjetas", "mate uv", "tarjetas mate uv"],
    "tarjeta de presentación mate": ["tarjetas", "mate uv", "tarjetas mate uv"],
    "tarjetas mate": ["tarjetas", "mate uv", "tarjetas mate uv"],
    "tarjeta uv": ["tarjetas", "mate uv", "tarjetas mate uv"],
    "tarjeta imanada": ["tarjetas", "imanadas", "tarjetas imanadas"],
    "tarjeta brillante": ["tarjetas", "brillantes", "tarjetas brillantes"],
    "tarjeta de presentacion": ["tarjetas", "tarjetas presentacion"],
    "tarjeta de presentación": ["tarjetas", "tarjetas presentacion"],
    "lapiz": ["lapiz", "lapicero"],
    "retractil": ["mecanismo push", "retractil", "boligrafo"],
    "retractiles": ["mecanismo push", "retractil", "boligrafo"],
    "push": ["mecanismo push", "retractil", "boligrafo"],
    "click": ["mecanismo push", "retractil", "boligrafo"],
    "clic": ["mecanismo push", "retractil", "boligrafo"],
    # Cuadernos / libretas
    "agenda": ["cuaderno", "agenda"],
    "libreta": ["cuaderno", "libreta"],
    "libretica": ["cuaderno", "libreta"],
    "cuadernito": ["cuaderno", "libreta"],
    # Tecnologia
    "usb": ["usb", "memoria"],
    "memoria": ["usb", "memoria"],
    "powerbank": ["power bank", "cargador"],
    "audifono": ["audifonos", "audifono"],
    "audifonos": ["audifonos", "audifono"],
    "mouse": ["mouse", "raton"],
    "raton": ["mouse", "raton"],
    # Textiles
    "buso": ["hoodie", "buzo", "chaqueta"],
    "buzo": ["hoodie", "buzo", "chaqueta"],
    "saco": ["chaqueta", "hoodie"],
    "camiseta": ["camiseta", "playera", "tshirt"],
    "camibuso": ["hoodie", "buzo"],
    # Llaveros / hogar
    "llavero": ["llavero"],
    "llaveros": ["llavero"],
    "paraguas": ["paraguas", "sombrilla"],
    "sombrilla": ["paraguas", "sombrilla"],
    "impermeable": ["impermeable", "paraguas"],
    "reloj": ["reloj"],
    "relojes": ["reloj"],
    # Herramientas
    "herramienta": ["herramienta"],
    "herramientas": ["herramienta"],
    # Bolsos
    "morral": ["mochila", "morral", "bolso"],
    "mochila": ["mochila", "morral", "bolso"],
    "maletin": ["maletin", "bolso", "portafolio"],
    "bolso": ["bolso", "maletin", "mochila"],
}


def _stem(word: str) -> str:
    """Singulariza/normaliza una palabra en español (plurales simples)."""
    w = word.lower()
    if len(w) > 4 and w.endswith("es") and not w.endswith("mes") and not w.endswith("res"):
        w = w[:-2]
    elif len(w) > 3 and w.endswith("s") and not w.endswith("as") and not w.endswith("os") and not w.endswith("is"):
        w = w[:-1]
    elif len(w) > 4 and w.endswith("s"):
        # casos genericos: gorras -> gorra
        w = w[:-1]
    return w


def _expand_jargon(query: str) -> list[str]:
    """
    Devuelve la lista de terminos de busqueda a partir de la consulta,
    aplicando traduccion de jerga colombiana y stemming.
    """
    raw_words = [w for w in remove_accents(query.lower()).split() if w]
    terms: list[str] = []
    seen = set()

    def add(term: str):
        t = remove_accents(term.lower().strip())
        if t and t not in ("de", "para", "pal", "el", "la", "los", "las", "y", "con", "en", "un", "una"):
            if t not in seen:
                seen.add(t)
                terms.append(t)

    for w in raw_words:
        w_norm = remove_accents(w)
        # jerga exacta
        if w_norm in JARGON_SYNONYMS:
            for syn in JARGON_SYNONYMS[w_norm]:
                add(syn)
        add(w_norm)
        add(_stem(w_norm))
    return terms


def keyword_fallback_search(query: str, filters: Optional[dict] = None, top_k: int = RAG_TOP_K) -> list[dict]:
    """
    Búsqueda por palabras clave e IDs de productos como fallback.
    Es el motor principal de recuperación porque el catálogo (6.790 productos)
    está mayormente sin embeddings (solo 21).

    Características:
    - Traducción de jerga colombiana (pocillo->mug, cachucha->gorra...).
    - Stemming básico (gorras->gorra).
    - Tolerante a acentos.
    - NO aplica el filtro de categoría derivada automáticamente, porque los
      productos del catálogo están dispersos entre categorías inesperadas
      (ej. mugs en DEPORTES/ECO NATURE, no solo en MUGS...). Solo respeta
      categorías indicadas explícitamente por el caller vía custom_filters
      (prefijo 'explicit_').
    """
    logger.info(f"[KEYWORD SEARCH] Buscando coincidencia de texto para: '{query}'")
    products_file = PRODUCTS_JSON_DIR / "all_products.json"
    if not products_file.exists():
        logger.warning(f"[KEYWORD SEARCH] No existe all_products.json en {products_file}")
        return []

    products = load_json(products_file)

    # Filtros EXPLÍCITOS del caller (no los derivados automáticamente).
    explicit_category = None
    explicit_subcategory = None
    if filters:
        explicit_category = filters.get("explicit_category")
        explicit_subcategory = filters.get("explicit_subcategory")

    terms = _expand_jargon(query)
    terms_set = set(terms)
    logger.info(f"[KEYWORD SEARCH] Términos expandidos: {terms}")

    # === CORRECCIÓN ORTOGRÁFICA ===
    # Para cada palabra de la consulta que no se reconozca, buscar palabras
    # parecidas del catálogo y añadirlas a los términos. Así "lapisero" se
    # convierte en "lapicero" sin perder el término original.
    global _CATALOG_VOCABULARY_CACHE
    if _CATALOG_VOCABULARY_CACHE is None:
        _CATALOG_VOCABULARY_CACHE = _build_catalog_vocabulary(products)
    corrections_added = []
    for w in remove_accents(query.lower()).split():
        w_clean = re.sub(r'[^a-z0-9]', '', w)
        if len(w_clean) >= 4:
            suggestions = _fuzzy_correct(w_clean, _CATALOG_VOCABULARY_CACHE)
            for s in suggestions:
                if s not in terms_set:
                    terms_set.add(s)
                    terms.append(s)
                    corrections_added.append(f"{w_clean}->{s}")
    if corrections_added:
        logger.info(f"[KEYWORD SEARCH] Correcciones ortográficas: {corrections_added}")

    results = []
    query_lower = remove_accents(query.lower().strip())

    for p in products:
        p_id = remove_accents(p.get("product_id", "").lower().strip())
        p_name = remove_accents(p.get("name", "").lower())
        p_desc = remove_accents(p.get("description", "").lower())
        p_search = remove_accents(p.get("search_text", "")).lower()
        hayden = f"{p_id} {p_name} {p_desc} {p_search}"

        # Aplicar filtros EXPLICITOS del caller
        if explicit_category and p.get("category", "").upper() != explicit_category.upper():
            continue
        if explicit_subcategory and p.get("subcategory", "").upper() != explicit_subcategory.upper():
            continue

        score = 0.0
        # 1. Coincidencia exacta por ID
        if query_lower == p_id:
            score = 1.0
        elif p_id and query_lower in p_id:
            score = 0.95
        else:
            # 2. Coincidencia de términos (con stemming + jerga) contra el nombre
            name_hits = sum(1 for t in terms_set if _contains_whole_word(t, p_name))
            # 3. Coincidencia contra descripción/search_text (peso menor)
            desc_hits = sum(1 for t in terms_set if t in p_desc or t in p_search)
            # Palabras de la consulta original (sin jerga) que aparecen en nombre
            raw_terms = [remove_accents(w) for w in query_lower.split() if len(w) > 2]
            raw_name_hits = sum(1 for t in raw_terms if _contains_whole_word(t, p_name))

            # === PRIORIZACIÓN DE PALABRA PRINCIPAL ===
            # La PRIMERA palabra de la búsqueda casi siempre es el tipo de
            # producto (bolígrafo, termo, gorra). Le damos peso extra para que
            # un "Bolígrafo Plástico" le gane siempre a una "Botella Plástica".
            query_words = [w for w in query_lower.split() if len(w) > 2]
            primary_word = query_words[0] if query_words else ""
            # Si la primera palabra fue corregida ortográficamente, usar la corrección
            if primary_word and primary_word not in terms_set:
                # buscar si hay una corrección para la palabra principal
                primary_suggestions = _fuzzy_correct(primary_word, _CATALOG_VOCABULARY_CACHE) if _CATALOG_VOCABULARY_CACHE else []
                if primary_suggestions:
                    primary_word = primary_suggestions[0]

            has_primary_in_name = (
                primary_word and _contains_whole_word(primary_word, p_name)
            )
            starts_with_primary = (
                primary_word and p_name.startswith(primary_word)
            )

            if name_hits > 0:
                score = 0.55 + min(name_hits, 4) * 0.1
                if raw_name_hits > 0:
                    score += 0.05
                # CAMBIO: la palabra principal pesa extra
                if has_primary_in_name:
                    score += 0.30
                # CAMBIO: bonus si el nombre empieza con la palabra principal
                if starts_with_primary:
                    score += 0.15
            elif raw_name_hits > 0:
                score = 0.45 + min(raw_name_hits, 3) * 0.05
                if has_primary_in_name:
                    score += 0.30
                if starts_with_primary:
                    score += 0.15
            elif desc_hits > 0:
                # CAMBIO: si coincide solo en descripción PERO le falta la
                # palabra principal en el nombre, penalizar (no debería ganarle
                # a un producto que sí tiene la palabra principal).
                if primary_word and not has_primary_in_name:
                    score = 0.10 + min(desc_hits, 3) * 0.02
                else:
                    score = 0.25 + min(desc_hits, 3) * 0.03

        if score > 0.0:
            # === PREFERITISMO PARA PRODUCTOS DEL EXCEL DE ZOOM ===
            # Los productos propios (UUID) con foto real Y precio reciben un
            # puntaje extra SIEMPRE. Esto garantiza que, cuando compiten contra
            # un importado con score similar, el producto de ZOOM gane y quede
            # de primero. Si no se aplica, importados con descripciones largas
            # empatan o superan a los propios y el bot mezcla productos.
            if is_preferente(p):
                score += 0.40
            results.append({
                "id": p.get("product_id"),
                "score": score,
                "metadata": {
                    "category": p.get("category", ""),
                    "subcategory": p.get("subcategory", ""),
                    "name": p.get("name", "")
                },
                "text_content": f"Producto: {p.get('name')} (ID: {p.get('product_id')}). Desc: {p.get('description')}"
            })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


# ============================================================================
# 4. RECUPERACIÓN DE CONTEXTO COMPLETO
# ============================================================================

def retrieve_product_context(
    search_results: list[dict],
    max_products: int = RAG_RERANK_TOP_N,
) -> str:
    """
    Recupera el contexto completo de los productos encontrados.
    Combina datos de embeddings + JSON de productos.
    
    Returns:
        Texto de contexto formateado para inyectar en el LLM.
    """
    # Cargar catálogo completo para lookup
    products_file = PRODUCTS_JSON_DIR / "all_products.json"
    all_products = {}
    
    if products_file.exists():
        products_list = load_json(products_file)
        all_products = {p["product_id"]: p for p in products_list}
    
    context_parts = []
    
    for i, result in enumerate(search_results[:max_products], 1):
        product_id = result["id"]
        score = result.get("score", 0)
        
        # Obtener datos completos del producto
        product = all_products.get(product_id, {})
        
        # Si tiene text_content del embedding, usarlo
        text_content = result.get("text_content", "")
        
        if product:
            part = f"""
--- Producto {i} (Relevancia: {score:.3f}) ---
ID: {product.get('product_id', product_id)}
Nombre: {product.get('name', 'N/A')}
Categoría: {product.get('category', 'N/A')}
Subcategoría: {product.get('subcategory', 'N/A')}
Precio: {product.get('price', 'No disponible')}
Descripción: {product.get('description', 'N/A')}
Stock: {product.get('stock', {}).get('total', 'N/A')} unidades
En stock: {'Sí' if product.get('stock', {}).get('has_stock') else 'No'}
"""
            # Agregar especificaciones
            specs = product.get("specifications", {})
            if specs:
                spec_text = "\n".join(f"  - {k}: {v}" for k, v in specs.items())
                part += f"Especificaciones:\n{spec_text}\n"
            
            # Agregar colores
            variants = product.get("variants", [])
            if variants:
                colors = [v.get("color", str(v)) for v in variants]
                part += f"Colores: {', '.join(colors)}\n"
            
            context_parts.append(part)
        elif text_content:
            context_parts.append(
                f"--- Producto {i} (Relevancia: {score:.3f}) ---\n"
                f"{text_content}\n"
            )
    
    return "\n".join(context_parts)


def remove_accents(text: str) -> str:
    import unicodedata
    return "".join(
        c for c in unicodedata.normalize('NFD', text)
        if unicodedata.category(c) != 'Mn'
    )


# ============================================================================
# JERARQUÍA DE CATÁLOGOS — Boosting de Producción Interna
# ----------------------------------------------------------------------------
# Evita la colisión semántica entre productos fabricados por ZOOM Publicidad
# (PRODUCCION_INTERNA) y los catálogos importados/promocionales (IMPORTADO).
# Si para la consulta existe un match FUERTE de producción interna, se aplica
# un multiplicador para que domine el Top 3 y desplace las coincidencias
# parciales importadas (ej. "Tarjetas" interna aplasta a "Portatarjetas"
# importado; "Mugs" de sublimación propia sobre los promocionales genéricos).
# ============================================================================

# Vocabulario de las líneas de manufactura propia de ZOOM Publicidad
# (extraído del Excel interno de producción). Cualquier producto cuyo nombre o
# subcategoría contenga uno de estos términos se considera PRODUCCION_INTERNA.
INTERNAL_PRODUCTION_KEYWORDS = {
    "bolsa", "bolsas", "bolsatex", "yute", "kraft", "organza", "satin", "pad mouse",
    "boton", "botones", "sello", "sellos", "usb", "memorias usb", "abanico", "abanicos",
    "sombrilla", "sombrillas", "paraguas", "impermeables", "mug", "mugs", "pocillo", "pocillos",
    "vinilo", "vinilos", "banner", "banners", "carnet", "carnets", "portacarnet", "portacarnets",
    "retablo", "retablos", "banderin", "banderines", "calandra", "poliestireno",
    "manilla", "manillas", "plastisol", "silicona", "llavero", "llaveros", "pin", "pines",
    "acrilico", "acrilicos", "tarjeta", "tarjetas", "volante", "volantes", "talonario", "talonarios",
    "camiseta", "camisetas", "gorra", "gorras", "chaqueta", "chaquetas", "chaleco", "chalecos",
    "rompevientos", "dtf", "screen", "tampografia", "laser", "cuaderno", "cuadernos", "agenda", "agendas",
    "inserto", "insertos", "filtro uv", "guardas", "impresion", "litografia",
}

# Pistas adicionales en la subcategoría (no en el nombre del producto).
INTERNAL_SUBCATEGORY_HINTS = (
    "nacional", "produccion nacional", "producción nacional",
    "sublimacion", "sublimación", "litografia", "litografía",
)
IMPORTED_SUBCATEGORY_HINTS = (
    "importado", "gildan",
)

INTERNAL_BOOST = 1.8          # multiplicador a internos en match fuerte
IMPORTED_PENALTY = 0.5        # multiplicador a importados de match parcial
STRONG_MATCH_THRESHOLD = 0.5  # score mínimo para considerar "match fuerte"



def _contains_whole_word(needle: str, haystack: str) -> bool:
    """Devuelve True si needle aparece como palabra COMPLETA en haystack.
    Acepta singular y plural: 'tarjeta' SI coincide con 'tarjetas' pero NO con 'portatarjetas'."""
    if not needle or not haystack:
        return False
    # Buscar la palabra exacta y su plural (singular + 's' o 'es')
    variantes = [needle]
    if not needle.endswith('s'):
        variantes.append(needle + 's')
        if not needle.endswith('e') and len(needle) > 3:
            variantes.append(needle + 'es')
    for v in variantes:
        pattern = r'\b' + re.escape(v) + r'\b'
        if re.search(pattern, haystack):
            return True
    return False


# ============================================================================
# CORRECCIÓN ORTOGRÁFICA (Fuzzy Matching)
# ----------------------------------------------------------------------------
# Cuando el cliente escribe una palabra que NO existe en el catálogo, busca
# la palabra real más parecida (máximo 2 letras de diferencia) y la usa.
# Esto cubre errores de tipeo como "lapisero" -> "lapicero".
#
# Seguridad:
#  - Solo aplica si la diferencia es <= 2 letras (no adivina cosas muy raras).
#  - Solo compara contra palabras reales del catálogo + sinónimos conocidos.
#  - NO reemplaza los términos originales: los AÑADE para no perder nada.
# ============================================================================
_CATALOG_VOCABULARY_CACHE: set = None


def _levenshtein(a: str, b: str) -> int:
    """Distancia de Levenshtein: cuántas letras hay que cambiar/mover/borrar."""
    if len(a) < len(b):
        a, b = b, a
    if len(b) == 0:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a):
        curr = [i + 1]
        for j, cb in enumerate(b):
            ins = prev[j + 1] + 1
            dele = curr[j] + 1
            sub = prev[j] + (ca != cb)
            curr.append(min(ins, dele, sub))
        prev = curr
    return prev[-1]


def _build_catalog_vocabulary(products: list) -> set:
    """Construye el conjunto de palabras conocidas del catálogo."""
    vocab = set()
    # Sinónimos de jerga conocidos (esfero, lapicero, botilito, etc.)
    for syns in JARGON_SYNONYMS.values():
        for s in syns:
            vocab.add(remove_accents(s.lower()))
    # Palabras de los nombres de productos del catálogo
    for p in products:
        name = remove_accents((p.get("name") or "").lower())
        for w in name.split():
            w_clean = re.sub(r'[^a-z0-9]', '', w)
            if len(w_clean) >= 3:
                vocab.add(w_clean)
    return vocab


def _fuzzy_correct(word: str, vocabulary: set, max_distance: int = 2) -> list:
    """Devuelve palabras del vocabulario parecidas a 'word' (distancia <= max).
    Solo corrige palabras de 4+ letras para no corregir preposiciones cortas.
    Ordena por menor distancia (mejor coincidencia primero)."""
    w = remove_accents(word.lower().strip())
    if len(w) < 4:
        return []
    # Si la palabra ya existe en el vocabulario, no necesita corrección
    if w in vocabulary:
        return []
    candidates = []
    for v in vocabulary:
        # Optimización: solo comparar si la diferencia de longitud es razonable
        if abs(len(v) - len(w)) > max_distance:
            continue
        dist = _levenshtein(w, v)
        if dist <= max_distance and dist > 0:
            candidates.append((dist, v))
    candidates.sort()
    return [v for _, v in candidates[:3]]  # máximo 3 sugerencias


# Patrón para reconocer un product_id tipo UUID (producción propia de ZOOM).
# Los importados usan códigos de catálogo (VA-666, CAP-22, TE-455...).
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
# Placeholder de foto falsa que no debe contar como "foto real".
_PLACEHOLDER_IMG = "9039_bolsas_ecol_cambrel_comunes"


def _has_real_photo(product: dict) -> bool:
    """True si el producto tiene al menos una foto que NO sea el placeholder de bolsa."""
    imgs = product.get("local_image_paths") or []
    if not imgs:
        return False
    return any((_PLACEHOLDER_IMG not in str(im)) for im in imgs)


def _has_price(product: dict) -> bool:
    """True si el producto tiene un precio no vacío."""
    price = product.get("price")
    return bool(price) and str(price).strip() not in ("None", "", "0")


def classify_origen(product: dict) -> str:
    """Clasifica un producto como 'PRODUCCION_INTERNA', 'IMPORTADO' o 'DESCONOCIDO'.

    ORDEN DE PRIORIDAD (criterio principal = tipo de ID, no palabras del nombre):
      1. product_id tipo UUID  -> PRODUCCION_INTERNA (fabricado por ZOOM).
      2. product_id tipo código de catálogo (VA-666, CAP-22) -> IMPORTADO.
      3. Si no se puede determinar por ID, se usan las pistas de subcategoría
         y las palabras clave como respaldo (comportamiento anterior).

    NOTA: Antes esto se basaba en palabras del nombre ("chaqueta", "gorra"...),
    pero 1.667 importados también contienen esas palabras y quedaban marcados
    como propios por error. El tipo de ID es la frontera confiable.
    """
    pid = str(product.get("product_id") or "")
    if _UUID_RE.match(pid):
        return "PRODUCCION_INTERNA"
    # Si tiene código de catálogo (letras-guion-números) es importado
    if re.match(r"^[A-Z]{2,5}-\d", pid, re.IGNORECASE):
        return "IMPORTADO"
    # Respaldo: pistas de subcategoría + palabras clave (casos sin ID claro)
    name = remove_accents((product.get("name") or "").lower())
    subcat = remove_accents((product.get("subcategory") or "").lower())
    haystack = f"{name} {subcat}"
    if any(h in subcat for h in INTERNAL_SUBCATEGORY_HINTS):
        return "PRODUCCION_INTERNA"
    if any(h in subcat for h in IMPORTED_SUBCATEGORY_HINTS):
        return "IMPORTADO"
    if any(_contains_whole_word(k, haystack) for k in INTERNAL_PRODUCTION_KEYWORDS):
        return "PRODUCCION_INTERNA"
    return "DESCONOCIDO"


def is_preferente(product: dict) -> bool:
    """True si el producto es PREFERENTE: producción propia (UUID) CON foto real Y precio.

    Estos son los productos que el bot debe ofrecer primero (preferitismo).
    Los UUID sin foto o sin precio no son preferentes hasta completarse.
    """
    pid = str(product.get("product_id") or "")
    if not _UUID_RE.match(pid):
        return False
    return _has_real_photo(product) and _has_price(product)


def apply_internal_boost(results: list[dict], query: str, top_k: int) -> list[dict]:
    """Aplica el boosting de jerarquía de catálogos (preferitismo).

    PREFERITISMO (criterio principal): si hay al menos un resultado PREFERENTE
    (UUID de producción propia CON foto real Y precio) que además sea match fuerte
    de la consulta, entonces:
      - Los preferentes reciben INTERNAL_BOOST (suben al top).
      - Los importados que NO sean match fuerte reciben IMPORTED_PENALTY (bajan).

    El criterio preferente se basa en el tipo de ID (UUID = propio) + foto + precio,
    NO en palabras del nombre, porque 1.667 importados comparten palabras del nombre
    y generaban falsos positivos.

    Además, inyecta metadata['origen'] y metadata['preferente'] en cada resultado.
    """
    if not results:
        return results

    products_file = PRODUCTS_JSON_DIR / "all_products.json"
    all_products: dict = {}
    if products_file.exists():
        for p in load_json(products_file):
            all_products[p.get("product_id")] = p

    # Término canónico principal de la consulta (ya con jerga+stemming)
    q_terms = _expand_jargon(query)
    q_core = q_terms[0] if q_terms else remove_accents(query.lower().strip())

    # 1. Clasificar origen/preferencia y detectar match fuerte preferente
    has_strong_preferente = False
    enriched: list[tuple[dict, str, bool, bool]] = []
    for r in results:
        prod = all_products.get(r.get("id"), {})
        origen = classify_origen(prod)
        preferente = is_preferente(prod)

        r = dict(r)
        r["metadata"] = dict(r.get("metadata") or {})
        r["metadata"]["origen"] = origen
        r["metadata"]["preferente"] = preferente

        name_norm = remove_accents((prod.get("name") or "").lower())
        score = r.get("score", 0)
        is_strong = (score >= STRONG_MATCH_THRESHOLD) and _contains_whole_word(q_core, name_norm)

        if preferente and is_strong:
            has_strong_preferente = True
        enriched.append((r, origen, is_strong, preferente))

    # 2. Solo boosting si hay match fuerte preferente (no degrada consultas genéricas)
    if has_strong_preferente:
        boosted = []
        for r, origen, is_strong, preferente in enriched:
            if preferente:
                r["score"] = r.get("score", 0) * INTERNAL_BOOST
            elif origen == "IMPORTADO" and not is_strong:
                r["score"] = r.get("score", 0) * IMPORTED_PENALTY
            boosted.append(r)
        results = boosted

    results.sort(key=lambda x: x.get("score", 0), reverse=True)
    return results[:top_k]


# ============================================================================
# 5. PARSEO DE FILTROS DESDE LENGUAJE NATURAL
# ============================================================================

def parse_query_filters(query: str) -> tuple[str, dict]:
    """
    Extrae filtros de metadatos desde la consulta en lenguaje natural.

    IMPORTANTE: NO deriva automáticamente una categoría a partir del TIPO de
    producto (gorra, mug, termo...) porque en este catálogo los productos del
    mismo tipo están dispersos entre varias categorías (ej. los mugs aparecen
    en DEPORTES, ECO NATURE y MUGS...). Filtrar por una categoría derivada
    destruía la gran mayoría de las búsquedas.

    Solo se asigna una categoría cuando el cliente la nombra de forma
    EXPLÍCITA (ej. "quiero algo de tecnología", "en la línea eco"). En ese
    caso se guarda como `explicit_category`, que sí respeta el keyword fallback.

    Returns:
        Tupla (query_limpio, filtros_dict).
    """
    filters = {}
    clean_query = query

    # Categorías nombradas de forma EXPLÍCITA por el cliente (no derivadas).
    explicit_category_keywords = {
        "tecnologia": "TECNOLOGÍA",
        "tecnología": "TECNOLOGÍA",
        "hogar": "HOGAR",
        "deportes": "DEPORTES",
        "oficina": "OFICINA",
        "ecologico": "ECOLOGÍA (ECOPROMO)",
        "ecológico": "ECOLOGÍA (ECOPROMO)",
        "eco nature": "ECO NATURE",
        "econature": "ECO NATURE",
        "infantil": "INFANTIL",
        "iluminacion": "ILUMINACIÓN",
        "iluminación": "ILUMINACIÓN",
        "juegos": "JUEGOS & ENTRETENIMIENTO",
        "golf": "GOLF",
        "medico": "MEDICOS & FARMACÉUTICOS",
        "médico": "MEDICOS & FARMACÉUTICOS",
        "futbol": "PRODUCTOS FÚTBOL",
        "fútbol": "PRODUCTOS FÚTBOL",
        "relojes": "RELOJES",
    }
    # Frases que indican intención de acotar por categoría.
    explicit_markers = ("en tecnologia", "de tecnologia", "linea eco", "línea eco",
                        "lo verde", "categoria", "categoría", "de la seccion",
                        "de la sección")

    query_normalized = remove_accents(query.lower())
    found_explicit = any(m in query_normalized for m in remove_accents_markers(explicit_markers))
    if found_explicit:
        for keyword, category in explicit_category_keywords.items():
            if remove_accents(keyword) in query_normalized:
                filters["explicit_category"] = category
                break

    # Detectar filtro de stock
    if "en stock" in query_normalized or "disponible" in query_normalized:
        filters["min_stock"] = 1

    # Detectar rango de precio (para futuro uso)
    price_match = re.search(
        r"\$(\d+(?:\.\d+)?)\s*(?:y|a|-)\s*\$(\d+(?:\.\d+)?)",
        query
    )
    if price_match:
        filters["price_min"] = float(price_match.group(1))
        filters["price_max"] = float(price_match.group(2))

    return clean_query, filters


def remove_accents_markers(markers) -> list[str]:
    """Normaliza una lista de frases quitando acentos (helper)."""
    return [remove_accents(m) for m in markers]


# ============================================================================
# 6. GENERACIÓN DE RESPUESTA CON LLM
# ============================================================================

def call_openrouter_chat_api(prompt: str, system_prompt: str) -> str:
    """
    Genera respuesta de chat via OpenRouter (API pagada) en vez de Gemini gratis.
    """
    import os
    import urllib.request
    import json

    if not OPENROUTER_API_KEY or not OPENROUTER_API_KEY.startswith("sk-or-"):
        raise RuntimeError("OPENROUTER_API_KEY no configurada o invalida")

    chat_model = os.getenv("RAG_CHAT_MODEL", "google/gemini-2.5-flash")

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": chat_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
        "temperature": LLM_TEMPERATURE,
        "max_tokens": LLM_MAX_OUTPUT_TOKENS,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            res_data = response.read().decode("utf-8")
            data = json.loads(res_data)
            if "choices" in data and len(data["choices"]) > 0:
                return data["choices"][0]["message"]["content"]
            raise ValueError(f"OpenRouter chat respuesta vacia/invalida: {data}")
    except urllib.error.HTTPError as e:
        error_content = e.read().decode("utf-8")
        raise RuntimeError(f"OpenRouter chat HTTP Error {e.code}: {error_content}")
    except Exception as e:
        raise RuntimeError(f"OpenRouter chat Error: {e}")


def generate_rag_response(
    query: str,
    context: str,
    system_prompt: Optional[str] = None,
) -> str:
    """
    Genera respuesta usando Gemini con el contexto recuperado.
    
    Args:
        query: Pregunta original del usuario.
        context: Contexto de productos recuperados.
        system_prompt: Prompt de sistema personalizado.
    
    Returns:
        Respuesta generada por el LLM.
    """
    default_system = """Eres un asistente experto en artículos promocionales 
del catálogo CATAPROM Colombia. Tu función es ayudar a los clientes a 
encontrar el producto perfecto para sus necesidades promocionales.

REGLAS:
1. SOLO responde basándote en los productos del contexto proporcionado.
2. Si no encuentras un producto relevante, dilo claramente.
3. Incluye siempre el ID del producto, nombre, y disponibilidad.
4. Si hay información de precios, inclúyela.
5. Sugiere alternativas cuando sea posible.
6. Responde en español."""

    prompt = f"""CONTEXTO DE PRODUCTOS DEL CATÁLOGO:
{context}

PREGUNTA DEL USUARIO:
{query}

Proporciona una respuesta detallada y útil basada exclusivamente en los 
productos del contexto anterior."""

    try:
        # Usa OpenRouter (pagado) en vez de Gemini gratis (que se agota).
        return call_openrouter_chat_api(prompt, system_prompt or default_system)
    except Exception as e:
        logger.warning(f"[LLM GENERATE] Error en generación LLM con OpenRouter, usando fallback estático: {e}")
        
        fallback_msg = "Hola! En este momento presento alta demanda en mi servicio de lenguaje, pero he recuperado los siguientes productos de mi catálogo que coinciden con tu búsqueda:\n\n"
        
        # El contexto viene delimitado por "--- Producto "
        parts = context.split("--- Producto ")
        valid_products = 0
        
        for part in parts:
            if not part.strip():
                continue
            lines = part.strip().split("\n")
            name = ""
            ref = ""
            price = ""
            stock = ""
            desc = ""
            for line in lines:
                if line.startswith("ID: "):
                    ref = line.replace("ID: ", "").strip()
                elif line.startswith("Nombre: "):
                    name = line.replace("Nombre: ", "").strip()
                elif line.startswith("Precio: "):
                    price = line.replace("Precio: ", "").strip()
                elif line.startswith("Stock: "):
                    stock = line.replace("Stock: ", "").strip()
                elif line.startswith("Descripción: "):
                    desc = line.replace("Descripción: ", "").strip()
            
            if name or ref:
                valid_products += 1
                fallback_msg += f"📦 *{name or 'Producto'}* (Ref: `{ref or 'N/A'}`)\n"
                if price and price != "No disponible":
                    fallback_msg += f"💰 Precio: {price}\n"
                if stock and stock != "N/A":
                    fallback_msg += f"📊 Stock: {stock}\n"
                if desc and desc != "N/A":
                    # Limitar largo de descripción
                    if len(desc) > 200:
                        desc = desc[:200] + "..."
                    fallback_msg += f"📝 Detalle: {desc}\n"
                fallback_msg += "\n"
        
        if valid_products == 0:
            return "Lo siento, no encontré productos que coincidan con tu búsqueda. ¿Podrías intentar con otros términos?"
            
        fallback_msg += "Por favor indícame si te interesa alguno de estos artículos para darte más información."
        return fallback_msg


# ============================================================================
# 7. PIPELINE COMPLETO DE CONSULTA
# ============================================================================

def query(
    user_query: str,
    use_local: bool = True,
    top_k: int = RAG_TOP_K,
    custom_filters: Optional[dict] = None,
) -> dict:
    """
    Pipeline completo de consulta RAG:
    1. Parsea filtros del lenguaje natural
    2. Genera embedding de consulta
    3. Busca vectores más cercanos
    4. Recupera contexto completo
    5. Genera respuesta con LLM
    
    Args:
        user_query: Pregunta en lenguaje natural.
        use_local: Si True, usa búsqueda local (sin Vertex AI).
        top_k: Número de resultados de búsqueda.
        custom_filters: Filtros adicionales manuales.
    
    Returns:
        Dict con response, sources, filters, scores.
    """
    logger.info(f"[QUERY] Nueva consulta: '{user_query}'")

    # 1. Parsear filtros
    clean_query, auto_filters = parse_query_filters(user_query)
    filters = {**auto_filters, **(custom_filters or {})}
    logger.info(f"[QUERY] Filtros detectados: {filters}")

    # 2. Buscar SIEMPRE por palabras clave (motor principal: cubre los 6.790
    # productos del catálogo y aplica traducción de jerga colombiana). Como
    # solo 21 productos tienen embeddings, la búsqueda vectorial por sí sola
    # devuelve casi siempre los mismos productos irrelevantes (toallas,
    # chaquetas), por eso la búsqueda por palabras clave es la base.
    keyword_results = keyword_fallback_search(
        clean_query, filters=filters, top_k=top_k
    )
    logger.info(f"[QUERY] Keyword search: {len(keyword_results)} resultados")

    # 3. Buscar por vectores (refuerzo semántico sobre los embeddings locales)
    vector_results: list[dict] = []
    try:
        query_embedding = generate_query_embedding(clean_query)
        logger.info(f"[QUERY] Embedding generado ({len(query_embedding)}d)")
        if use_local:
            vector_results = local_vector_search(
                query_embedding, top_k=top_k, filters=filters
            )
        else:
            vector_results = vector_search(
                query_embedding, top_k=top_k, filters=filters
            )
    except Exception as e:
        logger.warning(f"[QUERY] Vector search falló, se usa solo keyword: {e}")
    logger.info(f"[QUERY] Vector search: {len(vector_results)} resultados")

    # 4. FUSIONAR: keyword primero (más relevantes y con jerga), luego vector.
    # Penalizamos los resultados vectoriales para que no desplacen a los
    # keyword cuando ambos coinciden, y evitamos duplicados por product_id.
    search_results: list[dict] = []
    seen_ids: set = set()
    for r in keyword_results:
        pid = r.get("id")
        if pid and pid not in seen_ids:
            seen_ids.add(pid)
            search_results.append(r)
    for r in vector_results:
        pid = r.get("id")
        if pid and pid not in seen_ids:
            seen_ids.add(pid)
            # Penalización: los resultados puramente vectoriales bajan de score
            r = dict(r)
            r["score"] = r.get("score", 0) * 0.4
            search_results.append(r)

    search_results = search_results[:top_k]
    logger.info(f"[QUERY] {len(search_results)} resultados fusionados")

    # 5. BOOSTING DE JERARQUÍA DE CATÁLOGOS:
    # Si hay match fuerte de producción interna (ZOOM) para esta consulta,
    # los productos internos dominan el Top 3 y desplazan los importados
    # parciales (ej. "Tarjetas" interna > "Portatarjetas" importado).
    search_results = apply_internal_boost(search_results, clean_query, top_k)
    logger.info(f"[QUERY] {len(search_results)} resultados tras boosting de jerarquía")

    if not search_results:
        return {
            "response": "No encontré productos que coincidan con tu búsqueda. "
                       "Intenta con otros términos o categorías.",
            "sources": [],
            "filters": filters,
            "scores": [],
        }
    
    # 4. Recuperar contexto
    context = retrieve_product_context(search_results)
    
    # 5. Generar respuesta
    response = generate_rag_response(user_query, context)
    
    result = {
        "response": response,
        "sources": [r["id"] for r in search_results[:top_k]],
        "filters": filters,
        "scores": [r["score"] for r in search_results[:top_k]],
    }
    
    logger.info(f"[QUERY] ✓ Respuesta generada — {len(result['sources'])} fuentes")
    return result


# ============================================================================
# 8. INTERFAZ INTERACTIVA (CLI)
# ============================================================================

def interactive_cli():
    """Interfaz de línea de comandos para consultas interactivas."""
    print("=" * 60)
    print("  🎖️ CATAPROM RAG — Motor de Búsqueda Inteligente")
    print("  Escribe tu pregunta o 'salir' para terminar")
    print("=" * 60)
    
    while True:
        user_input = input("\n🔍 Tu consulta: ").strip()
        
        if user_input.lower() in ("salir", "exit", "quit", "q"):
            print("\n¡Hasta luego! 👋")
            break
        
        if not user_input:
            continue
        
        try:
            result = query(user_input)
            
            print(f"\n{'─' * 50}")
            print(f"📋 Respuesta:\n{result['response']}")
            print(f"\n📦 Fuentes: {', '.join(result['sources'])}")
            print(f"🎯 Scores: {[f'{s:.3f}' for s in result['scores']]}")
            if result['filters']:
                print(f"🔧 Filtros: {result['filters']}")
            print(f"{'─' * 50}")
            
        except Exception as e:
            print(f"\n❌ Error: {e}")
            logger.error(f"[CLI] Error en consulta: {e}")


# ============================================================================
# 9. ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    interactive_cli()
