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
    GOOGLE_API_KEY, GCP_PROJECT_ID, GCP_REGION,
    EMBEDDING_MODEL, EMBEDDING_DIMENSIONS,
    LLM_MODEL, LLM_TEMPERATURE, LLM_MAX_OUTPUT_TOKENS,
    VECTOR_ENDPOINT_DISPLAY_NAME,
    RAG_TOP_K, RAG_RERANK_TOP_N, RAG_SIMILARITY_THRESHOLD,
    FIRESTORE_COLLECTION, PRODUCTS_JSON_DIR, EMBEDDINGS_DIR,
)
from utils import setup_logger, load_json

logger = setup_logger("rag_engine", "rag_query_audit.log")

# Clientes
gemini_client = genai.Client(api_key=GOOGLE_API_KEY)


# ============================================================================
# 1. GENERACIÓN DE EMBEDDING DE CONSULTA
# ============================================================================

def generate_query_embedding(query: str) -> list[float]:
    """
    Genera embedding de la consulta del usuario usando
    task_type RETRIEVAL_QUERY para óptima recuperación.
    """
    try:
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
    
    # Aplicar filtros de metadatos
    filtered = datapoints
    if filters:
        if "category" in filters:
            filtered = [
                d for d in filtered
                if d.get("metadata", {}).get("category", "").upper()
                == filters["category"].upper()
            ]
        if "subcategory" in filters:
            filtered = [
                d for d in filtered
                if d.get("metadata", {}).get("subcategory", "").upper()
                == filters["subcategory"].upper()
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


def keyword_fallback_search(query: str, filters: Optional[dict] = None, top_k: int = RAG_TOP_K) -> list[dict]:
    """
    Búsqueda por palabras clave e IDs de productos como fallback.
    """
    logger.info(f"[KEYWORD SEARCH] Buscando coincidencia de texto para: '{query}'")
    products_file = PRODUCTS_JSON_DIR / "all_products.json"
    if not products_file.exists():
        logger.warning(f"[KEYWORD SEARCH] No existe all_products.json en {products_file}")
        return []
        
    products = load_json(products_file)
    results = []
    query_lower = query.lower().strip()
    
    for p in products:
        p_id = p.get("product_id", "").lower().strip()
        p_name = p.get("name", "").lower()
        p_desc = p.get("description", "").lower()
        
        # Aplicar filtros si existen
        if filters:
            if "category" in filters:
                if p.get("category", "").upper() != filters["category"].upper():
                    continue
            if "subcategory" in filters:
                if p.get("subcategory", "").upper() != filters["subcategory"].upper():
                    continue
                    
        score = 0.0
        if query_lower == p_id:
            score = 1.0
        elif query_lower in p_id:
            score = 0.9
        elif query_lower in p_name:
            score = 0.8
        else:
            # Buscar coincidencia parcial de palabras individuales
            query_words = [w for w in query_lower.split() if len(w) > 3]
            if query_words:
                matched_words_name = sum(1 for w in query_words if w in p_name)
                matched_words_desc = sum(1 for w in query_words if w in p_desc)
                if matched_words_name > 0:
                    score = 0.5 + (matched_words_name / len(query_words)) * 0.3
                elif matched_words_desc > 0:
                    score = 0.3 + (matched_words_desc / len(query_words)) * 0.2
                    
        if score > 0.0:
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


# ============================================================================
# 5. PARSEO DE FILTROS DESDE LENGUAJE NATURAL
# ============================================================================

def parse_query_filters(query: str) -> tuple[str, dict]:
    """
    Extrae filtros de metadatos desde la consulta en lenguaje natural.
    
    Ejemplo: "bolígrafos azules entre $1 y $5 en tecnología"
    → clean_query="bolígrafos azules", filters={"category": "TECNOLOGÍA"}
    
    Returns:
        Tupla (query_limpio, filtros_dict).
    """
    filters = {}
    clean_query = query
    
    # Detectar categoría mencionada
    categories_keywords = {
        "escritura": "ARTÍCULOS DE ESCRITURA",
        "bolígrafo": "ARTÍCULOS DE ESCRITURA",
        "pluma": "ARTÍCULOS DE ESCRITURA",
        "tecnología": "TECNOLOGÍA",
        "usb": "MEMORIAS USB",
        "memoria": "MEMORIAS USB",
        "hogar": "HOGAR",
        "deportes": "DEPORTES",
        "gorras": "GORRAS",
        "gorra": "GORRAS",
        "maletín": "MALETINES & BOLSOS",
        "bolso": "MALETINES & BOLSOS",
        "mug": "MUGS, BOTILITOS, VASOS Y TERMOS",
        "vaso": "MUGS, BOTILITOS, VASOS Y TERMOS",
        "termo": "MUGS, BOTILITOS, VASOS Y TERMOS",
        "paraguas": "PARAGUAS E IMPERMEABLES",
        "reloj": "RELOJES",
        "ecológico": "ECO NATURE",
        "llavero": "LLAVEROS",
        "herramienta": "HERRAMIENTAS",
    }
    
    query_lower = query.lower()
    for keyword, category in categories_keywords.items():
        if keyword in query_lower:
            filters["category"] = category
            break
    
    # Detectar filtro de stock
    if "en stock" in query_lower or "disponible" in query_lower:
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


# ============================================================================
# 6. GENERACIÓN DE RESPUESTA CON LLM
# ============================================================================

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
        response = gemini_client.models.generate_content(
            model=LLM_MODEL,
            contents=[prompt],
            config=types.GenerateContentConfig(
                system_instruction=system_prompt or default_system,
                temperature=LLM_TEMPERATURE,
                max_output_tokens=LLM_MAX_OUTPUT_TOKENS,
            ),
        )
        return response.text
    except Exception as e:
        logger.warning(f"[LLM GENERATE] Error en generación LLM, usando fallback estático: {e}")
        
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
    
    # 2. Generar embedding
    query_embedding = generate_query_embedding(clean_query)
    logger.info(f"[QUERY] Embedding generado ({len(query_embedding)}d)")
    
    # 3. Buscar vectores
    if use_local:
        search_results = local_vector_search(
            query_embedding, top_k=top_k, filters=filters
        )
    else:
        search_results = vector_search(
            query_embedding, top_k=top_k, filters=filters
        )
        
    # Fallback si no hay resultados vectoriales (o no hay embeddings cargados)
    if not search_results:
        logger.info("[QUERY] Búsqueda vectorial sin resultados, ejecutando fallback de palabras clave")
        search_results = keyword_fallback_search(
            clean_query, filters=filters, top_k=top_k
        )
    
    logger.info(f"[QUERY] {len(search_results)} resultados de búsqueda")
    
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
        "sources": [r["id"] for r in search_results[:RAG_RERANK_TOP_N]],
        "filters": filters,
        "scores": [r["score"] for r in search_results[:RAG_RERANK_TOP_N]],
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
