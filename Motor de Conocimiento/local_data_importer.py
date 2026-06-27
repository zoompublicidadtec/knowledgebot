"""
============================================================================
LOCAL_DATA_IMPORTER.PY — Adaptador para Base de Datos Local Existente
============================================================================
Este script reemplaza al scraper. Lee la base de datos de 8GB previamente
extraída (JSONs e imágenes) y la formatea para que el Motor RAG 
(embedding_pipeline.py) la pueda consumir sin tocar internet.
============================================================================
"""

import os
import json
import logging
from pathlib import Path
from dotenv import load_dotenv

# Cargar variables de entorno del archivo .env
load_dotenv()

# Configuración básica de logs
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("local_importer")

# Obtener la ruta de la carpeta pesada desde el .env
LOCAL_CATALOG_PATH = os.getenv("LOCAL_CATALOG_PATH")

# Ruta donde el RAG espera encontrar los datos procesados
RAG_DATA_DIR = Path(__file__).parent / "data" / "products"


def run_import():
    if not LOCAL_CATALOG_PATH:
        logger.error("❌ ERROR: No definiste LOCAL_CATALOG_PATH en tu archivo .env")
        logger.error("Ejemplo: LOCAL_CATALOG_PATH=/var/www/catalogo_catalogospromocionales")
        return

    base_path = Path(LOCAL_CATALOG_PATH)
    
    # Rutas dentro de tu carpeta pesada
    json_path = base_path / "BASE_DE_DATOS" / "productos_detalle.json"
    images_dir = base_path / "imagenes_productos"
    
    if not json_path.exists():
        logger.error(f"❌ ERROR: No encuentro el archivo {json_path}")
        return
        
    if not images_dir.exists():
        logger.error(f"❌ ERROR: No encuentro la carpeta de imágenes {images_dir}")
        return

    logger.info("="*60)
    logger.info(f"🚀 Iniciando importación desde: {base_path}")
    logger.info("="*60)

    # 1. Pre-escanear las carpetas de imágenes para una búsqueda O(1)
    logger.info("📁 Escaneando carpeta de imágenes para indexar...")
    folder_by_ref = {}
    for carpeta in images_dir.iterdir():
        if carpeta.is_dir():
            # Extraer la referencia de nombres como "0001_VA-666__Chaqueta_Urban_Travel_Wear"
            parts = carpeta.name.split("__")
            if parts:
                subparts = parts[0].split("_")
                if len(subparts) >= 2:
                    ref = "_".join(subparts[1:]) # VA-666 o Bol_Flaggy
                    folder_by_ref[ref.lower()] = carpeta
                    # También guardar con guiones reemplazados por espacios para mayor tolerancia
                    folder_by_ref[ref.lower().replace("_", " ")] = carpeta
            # Siempre guardar el nombre de la carpeta completo por si acaso
            folder_by_ref[carpeta.name.lower()] = carpeta

    # 2. Cargar tus datos originales
    with open(json_path, "r", encoding="utf-8") as f:
        tus_productos = json.load(f)
    
    logger.info(f"📦 Se encontraron {len(tus_productos)} productos en tu JSON.")

    productos_para_rag = []
    
    # 3. Transformar tus datos al formato del Motor RAG
    for prod in tus_productos.values():
        prod_id = prod.get("referencia", prod.get("id", prod.get("codigo", "SIN_ID")))
        
        # Buscar la carpeta de imágenes usando nuestro índice O(1)
        imagenes_locales = []
        prod_ref_clean = prod_id.lower().strip()
        
        carpeta = folder_by_ref.get(prod_ref_clean)
        if not carpeta:
            # Intentar con guiones bajos reemplazados por espacios o viceversa
            carpeta = folder_by_ref.get(prod_ref_clean.replace(" ", "_"))
            
        if carpeta:
            for img_file in carpeta.iterdir():
                if img_file.suffix.lower() in ['.jpg', '.jpeg', '.png']:
                    imagenes_locales.append(str(img_file.absolute()))

        # Procesar stock
        existencias_str = prod.get("existenciasLista", "0")
        try:
            total_stock = int(existencias_str.replace(",", "").replace(".", ""))
        except Exception:
            total_stock = 0

        # Procesar variantes de color desde inventario
        filas = prod.get("inventario", {}).get("filas", [])
        variantes = []
        if len(filas) > 1:
            for fila in filas[1:]:
                if fila and len(fila) > 0:
                    color_name = fila[0]
                    if color_name.startswith("."):
                        color_name = color_name.lstrip(". ").strip()
                    variantes.append({"color": color_name})

        # Formatear el producto para el RAG
        producto_rag = {
            "product_id": prod_id,
            "name": prod.get("nombre", ""),
            "category": prod.get("categoria", "GENERAL"),
            "subcategory": prod.get("subcategoria", ""),
            "price": prod.get("precio", None),
            "description": prod.get("descripcionCompleta", ""),
            "specifications": {
                "medidas": prod.get("medidas", ""),
                "marca": prod.get("marca", ""),
                "fichaPdf": prod.get("fichaPdf", ""),
                "embalaje": prod.get("embalaje", {}),
                "vista360": prod.get("vista360", "")
            },
            "variants": variantes,
            "stock": {
                "total": total_stock,
                "has_stock": total_stock > 0
            },
            "local_image_paths": imagenes_locales 
        }
        
        productos_para_rag.append(producto_rag)

    # 4. Guardar en la carpeta donde el RAG lo espera
    RAG_DATA_DIR.mkdir(parents=True, exist_ok=True)
    output_file = RAG_DATA_DIR / "all_products.json"
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(productos_para_rag, f, indent=2, ensure_ascii=False)
        
    logger.info("="*60)
    logger.info("✅ IMPORTACIÓN COMPLETADA EXITOSAMENTE")
    logger.info(f"🎯 Archivo listo para el Motor RAG: {output_file}")
    logger.info("👉 Siguiente paso: Ejecutar 'python embedding_pipeline.py'")
    logger.info("="*60)

if __name__ == "__main__":
    run_import()
