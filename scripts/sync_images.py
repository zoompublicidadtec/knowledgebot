import os
import re
import json
import subprocess
import urllib.request
import urllib.error
import sys

def print_flush(*args, **kwargs):
    print(*args, **kwargs)
    sys.stdout.flush()

def run():
    print_flush("--- Python Supabase Image Sync ---")
    
    env_vars = {}
    
    # 1. Try loading from .env.local
    env_path = os.path.join(os.getcwd(), '.env.local')
    if not os.path.exists(env_path):
        env_path = '/root/knowledgebot/.env.local'
        
    if os.path.exists(env_path):
        print_flush(f"Reading from {env_path}...")
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                parts = line.split('=', 1)
                if len(parts) == 2:
                    key = parts[0].strip()
                    val = parts[1].strip()
                    if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                        val = val[1:-1]
                    env_vars[key] = val
    else:
        # Fallback: Extract from docker container configuration
        print_flush("No .env.local found. Extracting from docker container...")
        try:
            env_json = subprocess.check_output(
                "docker inspect knowledgebot-app --format '{{json .Config.Env}}'", 
                shell=True
            ).decode('utf-8').strip()
            if env_json.startswith("'") and env_json.endswith("'"):
                env_json = env_json[1:-1]
            env_list = json.loads(env_json)
            for item in env_list:
                if '=' in item:
                    k, v = item.split('=', 1)
                    env_vars[k] = v
            print_flush("Successfully extracted variables from docker container.")
        except Exception as e:
            print_flush(f"❌ Failed to extract from docker: {e}")

    supabase_url = env_vars.get('NEXT_PUBLIC_SUPABASE_URL')
    supabase_key = env_vars.get('SUPABASE_SERVICE_ROLE_KEY')

    if not supabase_url or not supabase_key:
        print_flush("❌ Error: Missing Supabase URL or Service Role Key.")
        return

    # 2. Check if image_url column exists in products table
    print_flush("Checking Supabase products table schema...")
    test_url = f"{supabase_url}/rest/v1/products?select=image_url&limit=1"
    req = urllib.request.Request(test_url)
    req.add_header('apikey', supabase_key)
    req.add_header('Authorization', f"Bearer {supabase_key}")
    
    try:
        with urllib.request.urlopen(req) as response:
            response.read()
            print_flush("✅ Column 'image_url' exists in 'products' table.")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        if 'image_url' in err_body:
            print_flush("❌ Error: La columna 'image_url' no existe en la tabla 'products' de Supabase.")
            print_flush("Por favor ejecute primero este comando SQL en el editor de Supabase:")
            print_flush("ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;")
            return
        else:
            print_flush(f"❌ Error checking column: {e.code} - {err_body}")
            return

    # 3. Determine images directory
    possible_paths = [
        os.path.join(os.getcwd(), 'catalogo_catalogospromocionales', 'imagenes_productos'),
        '/root/knowledgebot/catalogo_catalogospromocionales/imagenes_productos',
    ]
    
    images_dir = None
    for p in possible_paths:
        if os.path.exists(p) and os.path.isdir(p):
            images_dir = p
            break

    if not images_dir:
        print_flush("❌ Error: Catalog images directory not found!")
        return

    print_flush(f"Found images directory at: {images_dir}")

    # 4. Fetch all product references from Supabase
    print_flush("Fetching product references from Supabase...")
    fetch_url = f"{supabase_url}/rest/v1/products?select=id,reference,name,image_url"
    req = urllib.request.Request(fetch_url)
    req.add_header('apikey', supabase_key)
    req.add_header('Authorization', f"Bearer {supabase_key}")
    
    try:
        with urllib.request.urlopen(req) as response:
            db_products = json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print_flush(f"❌ Error fetching products: {e}")
        return

    print_flush(f"Loaded {len(db_products)} products from Supabase.")

    # 5. Scan directory and map
    folders = os.listdir(images_dir)
    print_flush(f"Scanning {len(folders)} folders...")
    
    matched_count = 0
    updated_count = 0

    # Index db products by lowercase reference for O(1) matching
    db_by_ref = {}
    for p in db_products:
        ref = p.get('reference')
        if ref:
            ref_key = ref.lower().strip()
            if ref_key not in db_by_ref:
                db_by_ref[ref_key] = []
            db_by_ref[ref_key].append(p)

    for folder in folders:
        folder_path = os.path.join(images_dir, folder)
        if not os.path.isdir(folder_path):
            continue

        # Parse reference
        match = re.match(r'^\d+_(.*?)__', folder)
        reference = None
        if match:
            reference = match.group(1).strip()
        else:
            parts = folder.split('_')
            if len(parts) > 1:
                reference = parts[1].strip()

        if not reference:
            continue

        ref_key = reference.lower().strip()
        if ref_key in db_by_ref:
            # Find principal image
            possible_images = ['principal.jpg', 'principal.png', 'galeria_1.jpg', 'galeria_1.png']
            selected_image = None
            for img in possible_images:
                if os.path.exists(os.path.join(folder_path, img)):
                    selected_image = img
                    break

            if not selected_image:
                # Fallback
                try:
                    files = os.listdir(folder_path)
                    for f in files:
                        if f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                            selected_image = f
                            break
                except Exception:
                    continue

            if not selected_image:
                continue

            matched_count += 1
            remote_image_url = f"/api/products/images/{folder}/{selected_image}"
            
            for prod in db_by_ref[ref_key]:
                if prod.get('image_url') != remote_image_url:
                    print_flush(f"Mapping [{prod['reference']}]: {prod['name']} -> {remote_image_url}")
                    
                    update_url = f"{supabase_url}/rest/v1/products?id=eq.{prod['id']}"
                    patch_req = urllib.request.Request(update_url, method='PATCH')
                    patch_req.add_header('apikey', supabase_key)
                    patch_req.add_header('Authorization', f"Bearer {supabase_key}")
                    patch_req.add_header('Content-Type', 'application/json')
                    patch_req.add_header('Prefer', 'return=minimal')
                    
                    body = json.dumps({"image_url": remote_image_url}).encode('utf-8')
                    try:
                        with urllib.request.urlopen(patch_req, data=body) as response:
                            response.read()
                            updated_count += 1
                    except Exception as e:
                        print_flush(f"  ❌ Error updating {prod['reference']}: {e}")

    print_flush("\n--- Sync Completed ---")
    print_flush(f"Total product folders mapped: {matched_count}")
    print_flush(f"Total database products updated: {updated_count}")

if __name__ == '__main__':
    run()
