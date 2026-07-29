"""Test aislado del supabase_loader (NO toca el motor en producción)."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

from supabase_loader import get_products, get_stats

p = get_products()
s = get_stats()
print('STATS:', s)
print('TOTAL cargados:', len(p))
if p:
    print('PRIMER producto keys:', list(p[0].keys()))
    print('MUESTRA:', p[0].get('product_id'), '|', p[0].get('name', '')[:50], '| cat:', p[0].get('category'))
    # contar con imagen
    con_img = sum(1 for x in p if x.get('local_image_paths'))
    print(f'Con imagen: {con_img} de {len(p)}')
