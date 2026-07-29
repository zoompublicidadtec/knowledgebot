"""
Parche: integra supabase_loader en rag_query_engine.py (VPS).
Reemplaza las 3 cargas de all_products.json por get_products() de Supabase.
IDAEMPOTENTE: si ya está parcheado, no hace nada.
Operación segura: backup ya creado externamente.
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
TARGET = Path('/root/knowledgebot/Motor de Conocimiento/rag_query_engine.py')
src = TARGET.read_text(encoding='utf-8')

# Marca de idempotencia
if 'from supabase_loader import get_products' in src:
    print('[SKIP] rag_query_engine.py ya está parcheado con supabase_loader.')
    sys.exit(0)

# 1. Agregar import después de los imports existentes de utils/config.
import_anchor = 'from utils import setup_logger, load_json'
if import_anchor not in src:
    print('[ERROR] No encontré el anchor de import.'); sys.exit(1)
src = src.replace(
    import_anchor,
    import_anchor + '\nfrom supabase_loader import get_products  # FASE 1: fuente única = Supabase',
    1,
)

# 2. Reemplazar las 3 cargas. Patrón común:
#    products_file = PRODUCTS_JSON_DIR / "all_products.json"
#    (posibles líneas intermedias de chequeo .exists())
#    products = load_json(products_file)
#
# Estrategia: reemplazar el bloque 'load_json(products_file)' por 'get_products()'
# y dejar que el fallback viva dentro de get_products (ya contempla JSON si Supabase cae).

count_load = src.count('products = load_json(products_file)')
src = src.replace(
    'products = load_json(products_file)',
    'products = get_products()  # FASE 1: Supabase (fallback a JSON automático)',
)
print(f'[OK] Reemplazadas {count_load} cargas load_json -> get_products()')

# 3. En keyword_fallback_search hay un bloque que chequea products_file.exists().
# Como ya no usamos el archivo directo, volvemos el chequeo inocuo: si get_products()
# devuelve [], get_products ya logueó el fallback. Simplemente quitamos el return [].
old_check = (
    '    products_file = PRODUCTS_JSON_DIR / "all_products.json"\n'
    '    if not products_file.exists():\n'
    '        logger.warning(f"[KEYWORD SEARCH] No existe all_products.json en {products_file}")\n'
    '        return []\n'
)
new_check = (
    '    # FASE 1: la fuente es Supabase vía get_products(); el fallback al JSON\n'
    '    # vive dentro del loader, así que aquí no hace falta chequear el archivo.\n'
)
if old_check in src:
    src = src.replace(old_check, new_check, 1)
    print('[OK] Bloque de chequeo de archivo eliminado en keyword_fallback_search.')

# 4. En retrieve_product_context y en la de línea ~827, el patrón es:
#    products_file = PRODUCTS_JSON_DIR / "all_products.json"
#    all_products = {}
#    if products_file.exists():
#        products_list = load_json(products_file)
#        all_products = {p["product_id"]: p for p in products_list}
# Reemplazamos por get_products().
# 4. En retrieve_product_context (línea ~551) y apply_internal_boost (~827).
#    Patrón común:
#       products_file = PRODUCTS_JSON_DIR / "all_products.json"
#       all_products... = {}
#       if products_file.exists():
#           <carga>
#    Reemplazamos products_file (ya no se usa el archivo) y el .exists() por True,
#    porque el fallback al JSON vive dentro de get_products().
src = src.replace(
    '    products_file = PRODUCTS_JSON_DIR / "all_products.json"\n',
    '    # FASE 1: fuente única Supabase (fallback a JSON dentro del loader).\n',
)
# El 'if products_file.exists():' queda sin sentido; lo volvemos siempre-true.
src = src.replace(
    '    if products_file.exists():',
    '    if True:  # FASE 1: get_products() ya gestiona la disponibilidad',
)
src = src.replace(
    '        if products_file.exists():',
    '        if True:  # FASE 1: get_products() ya gestiona la disponibilidad',
)
old_load_list = '        products_list = load_json(products_file)'
new_load_list = '        products_list = get_products()'
if old_load_list in src:
    src = src.replace(old_load_list, new_load_list)
    print('[OK] retrieve_product_context actualizado a get_products().')

# 5. El bloque suelto 'for p in load_json(products_file):' (línea ~830).
old_loop = '        for p in load_json(products_file):'
new_loop = '        for p in get_products():'
if old_loop in src:
    src = src.replace(old_loop, new_loop)
    print('[OK] Loop de carga directo actualizado a get_products().')

TARGET.write_text(src, encoding='utf-8')
print('[DONE] rag_query_engine.py parcheado y guardado.')

# Verificación: compilar para detectar errores de sintaxis.
import py_compile
try:
    py_compile.compile(str(TARGET), doraise=True)
    print('[VERIFY] Sintaxis OK.')
except py_compile.PyCompileError as e:
    print('[ERROR SINTAXIS]', e)
    sys.exit(1)
