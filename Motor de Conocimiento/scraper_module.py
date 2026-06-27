"""
============================================================================
SCRAPER_MODULE.PY — Web Scraping Autenticado para CATAPROM
============================================================================
Crawl completo del catálogo promocional con Playwright.
Resistente a fallos con checkpoints y backoff exponencial.
============================================================================
"""

import asyncio
import json
import random
import re
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

from playwright.async_api import async_playwright, Page, BrowserContext
from bs4 import BeautifulSoup

from config import (
    CATALOG_BASE_URL, CATALOG_AUTH_USER, CATALOG_AUTH_PASS,
    CATALOG_ENTRY_URL, PRODUCTS_JSON_DIR, IMAGES_DIR, PDFS_DIR,
    SCRAPER_MAX_CONCURRENCY, SCRAPER_DELAY_MIN, SCRAPER_DELAY_MAX,
    SCRAPER_TIMEOUT, SCRAPER_MAX_RETRIES, SCRAPER_USER_AGENT,
)
from utils import (
    setup_logger, retry_with_backoff, CheckpointManager,
    save_json, save_binary, sanitize_filename, generate_audit_record,
)

logger = setup_logger("scraper", "scraper_audit.log")


# ============================================================================
# 1. NAVEGACIÓN AUTENTICADA
# ============================================================================

async def create_authenticated_context(playwright) -> BrowserContext:
    """Crea contexto de navegador con autenticación HTTP Basic."""
    browser = await playwright.chromium.launch(headless=True)
    context = await browser.new_context(
        user_agent=SCRAPER_USER_AGENT,
        http_credentials={
            "username": CATALOG_AUTH_USER,
            "password": CATALOG_AUTH_PASS,
        },
        viewport={"width": 1920, "height": 1080},
        java_script_enabled=True,
    )
    context.set_default_timeout(SCRAPER_TIMEOUT)
    return context


async def random_delay():
    """Delay aleatorio anti-detección."""
    await asyncio.sleep(random.uniform(SCRAPER_DELAY_MIN, SCRAPER_DELAY_MAX))


# ============================================================================
# 2. EXTRACCIÓN DE CATEGORÍAS Y SUBCATEGORÍAS
# ============================================================================

async def extract_categories(page: Page) -> list[dict]:
    """
    Extrae TODAS las categorías y subcategorías de la página principal.
    
    Returns:
        Lista de dicts con name, url, subcategories.
    """
    logger.info("[CATEGORÍAS] Navegando a página de categorías...")
    await page.goto(CATALOG_ENTRY_URL, wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    
    html = await page.content()
    soup = BeautifulSoup(html, "lxml")
    
    categories = []
    
    # Las categorías están en bloques con ícono + nombre + subcategorías
    # Buscar todos los bloques de categoría en la grilla
    category_blocks = soup.select("div.col-lg-3, div.col-md-3, div.col-sm-6")
    
    if not category_blocks:
        # Fallback: buscar enlaces directos a categorías
        category_blocks = soup.select("div[class*='col-']")
    
    # Estrategia alternativa: extraer todos los enlaces que apuntan a /promocionales/
    all_links = soup.find_all("a", href=True)
    seen_categories = set()
    
    for link in all_links:
        href = link.get("href", "")
        text = link.get_text(strip=True)
        
        if not text or not href:
            continue
            
        full_url = urljoin(CATALOG_BASE_URL, href)
        
        # Detectar enlaces de categoría/subcategoría
        if "/promocionales/" in href or "/seccion/" in href:
            # Determinar si es categoría principal o subcategoría
            parent_el = link.find_parent("div", class_=re.compile(r"col-"))
            
            # Buscar el nombre de categoría principal (suele ser el primer enlace grande)
            category_name = text.upper().strip()
            
            if category_name == "TODOS" or category_name == "":
                continue
            
            if category_name not in seen_categories:
                seen_categories.add(category_name)
                categories.append({
                    "name": category_name,
                    "url": full_url,
                    "subcategories": [],
                })
    
    # Si no encontramos categorías con la estrategia anterior,
    # usar extracción por JavaScript directo
    if len(categories) < 5:
        logger.warning("[CATEGORÍAS] Pocos resultados con BS4. Usando JS extraction...")
        categories = await _extract_categories_via_js(page)
    
    logger.info(f"[CATEGORÍAS] Extraídas {len(categories)} categorías")
    return categories


async def _extract_categories_via_js(page: Page) -> list[dict]:
    """Extrae categorías directamente via evaluación JavaScript."""
    result = await page.evaluate("""
        () => {
            const categories = [];
            const seen = new Set();
            
            // Buscar todos los enlaces relevantes
            const links = document.querySelectorAll('a[href*="promocionales"], a[href*="seccion"]');
            
            links.forEach(link => {
                const text = link.textContent.trim();
                const href = link.href;
                
                if (text && text !== 'Todos' && text.length > 2 && !seen.has(text)) {
                    seen.add(text);
                    categories.push({
                        name: text,
                        url: href,
                        subcategories: []
                    });
                }
            });
            
            return categories;
        }
    """)
    return result


# ============================================================================
# 3. EXTRACCIÓN DE PRODUCTOS POR CATEGORÍA
# ============================================================================

async def extract_products_from_category(
    page: Page, 
    category: dict,
    checkpoint: CheckpointManager
) -> list[dict]:
    """
    Extrae todos los productos de una categoría/subcategoría.
    Maneja paginación y el botón "Ver todos".
    """
    category_name = category["name"]
    url = category["url"]
    products = []
    
    logger.info(f"[CATEGORÍA] Procesando: {category_name} — {url}")
    
    try:
        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await random_delay()
        
        # Intentar hacer clic en "Ver todos" para cargar todos los productos
        try:
            ver_todos_btn = page.locator("a:has-text('Ver todos'), button:has-text('Ver todos')")
            if await ver_todos_btn.count() > 0:
                await ver_todos_btn.first.click()
                await page.wait_for_load_state("networkidle")
                logger.info(f"[CATEGORÍA] Clic en 'Ver todos' exitoso para {category_name}")
                await random_delay()
        except Exception:
            pass  # No hay botón "Ver todos", continuar normalmente
        
        # Extraer productos de la página actual
        page_products = await _parse_product_listing(page, category_name)
        products.extend(page_products)
        
        # Manejar paginación
        while True:
            next_page = await _get_next_page_url(page)
            if not next_page:
                break
            
            logger.info(f"[PAGINACIÓN] Siguiente página: {next_page}")
            await page.goto(next_page, wait_until="domcontentloaded")
            await page.wait_for_load_state("networkidle")
            await random_delay()
            
            page_products = await _parse_product_listing(page, category_name)
            if not page_products:
                break
            products.extend(page_products)
        
        logger.info(
            f"[CATEGORÍA] {category_name}: {len(products)} productos encontrados"
        )
        
    except Exception as e:
        logger.error(f"[CATEGORÍA] Error en {category_name}: {e}")
        checkpoint.mark_failed(f"category:{category_name}", str(e))
    
    return products


async def _parse_product_listing(page: Page, category_name: str) -> list[dict]:
    """Parsea la grilla de productos de una página de listado."""
    html = await page.content()
    soup = BeautifulSoup(html, "lxml")
    products = []
    
    # Los productos están en cards/bloques con imagen, nombre e ID
    # Buscar contenedores de producto
    product_cards = soup.select(
        "div.product-item, div.producto, div[class*='product'], "
        "div.col-lg-4, div.col-md-4"
    )
    
    # Fallback: buscar por estructura de enlaces a /p/
    if not product_cards:
        product_links = soup.find_all("a", href=re.compile(r"/p/"))
        for link in product_links:
            card = link.find_parent("div", class_=re.compile(r"col-"))
            if card and card not in product_cards:
                product_cards.append(card)
    
    for card in product_cards:
        try:
            product = _extract_product_from_card(card, category_name)
            if product and product.get("product_id"):
                products.append(product)
        except Exception as e:
            logger.warning(f"[PARSE] Error parseando card: {e}")
            continue
    
    return products


def _extract_product_from_card(card, category_name: str) -> Optional[dict]:
    """Extrae datos básicos de un producto desde su card en el listado."""
    # Buscar enlace al detalle del producto
    detail_link = card.find("a", href=re.compile(r"/p/"))
    if not detail_link:
        return None
    
    detail_url = detail_link.get("href", "")
    if not detail_url.startswith("http"):
        detail_url = urljoin(CATALOG_BASE_URL, detail_url)
    
    # Buscar nombre del producto
    name_el = card.find(["h3", "h4", "h5", "span", "p"], class_=re.compile(r"name|titulo|title", re.I))
    if not name_el:
        # Buscar en texto de enlaces
        name_el = detail_link
    name = name_el.get_text(strip=True) if name_el else ""
    
    # Buscar ID del producto (suele estar en texto más pequeño o como código)
    product_id = ""
    id_candidates = card.find_all(["span", "p", "small", "a"], 
                                   string=re.compile(r"^[A-Z0-9]+-?[A-Z0-9]*$"))
    for candidate in id_candidates:
        txt = candidate.get_text(strip=True)
        if 3 <= len(txt) <= 30 and txt != name:
            product_id = txt
            break
    
    # Si no encontramos ID, extraer del URL
    if not product_id and "/p/" in detail_url:
        parts = detail_url.split("/p/")
        if len(parts) > 1:
            slug = parts[1].split("/")[0]
            product_id = slug.upper()
    
    # Buscar imagen principal
    img = card.find("img")
    img_url = ""
    if img:
        img_url = img.get("src") or img.get("data-src") or img.get("data-lazy") or ""
        if img_url and not img_url.startswith("http"):
            img_url = urljoin(CATALOG_BASE_URL, img_url)
    
    # Buscar stock/existencias
    stock_info = {}
    stock_el = card.find(string=re.compile(r"Existencias|existencias", re.I))
    if stock_el:
        parent = stock_el.find_parent()
        if parent:
            numbers = re.findall(r"[\d,]+", parent.get_text())
            if numbers:
                stock_info["existencias"] = int(numbers[0].replace(",", ""))
    
    return {
        "product_id": product_id,
        "name": name.split(" - ")[0].strip() if name else "",
        "category": category_name,
        "subcategory": "",
        "detail_url": detail_url,
        "thumbnail_url": img_url,
        "stock_summary": stock_info,
        "_needs_detail_scrape": True,
    }


async def _get_next_page_url(page: Page) -> Optional[str]:
    """Detecta y retorna la URL de la siguiente página de paginación."""
    try:
        next_link = await page.evaluate("""
            () => {
                // Buscar enlace "siguiente" o ">"
                const selectors = [
                    'a.next', 'a.siguiente', 'li.next a',
                    'a[rel="next"]', '.pagination a:last-child'
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.href) return el.href;
                }
                // Buscar por texto
                const links = document.querySelectorAll('a');
                for (const a of links) {
                    if (a.textContent.includes('›') || 
                        a.textContent.includes('»') ||
                        a.textContent.includes('Siguiente')) {
                        return a.href;
                    }
                }
                return null;
            }
        """)
        return next_link
    except Exception:
        return None


# ============================================================================
# 4. EXTRACCIÓN DE DETALLE DE PRODUCTO
# ============================================================================

@retry_with_backoff(max_retries=SCRAPER_MAX_RETRIES, base_delay=2.0)
async def extract_product_detail(page: Page, product: dict) -> dict:
    """
    Navega al detalle de un producto y extrae TODA la información.
    
    Extrae: descripción, especificaciones, materiales, dimensiones,
    todas las imágenes, variantes de color, ficha técnica PDF, stock.
    """
    url = product["detail_url"]
    product_id = product["product_id"]
    
    logger.debug(f"[DETALLE] Extrayendo: {product_id} — {url}")
    
    await page.goto(url, wait_until="domcontentloaded")
    await page.wait_for_load_state("networkidle")
    await random_delay()
    
    html = await page.content()
    soup = BeautifulSoup(html, "lxml")
    
    # ---- NOMBRE COMPLETO ----
    name_el = soup.find(["h1", "h2"], class_=re.compile(r"product|titulo|name", re.I))
    if not name_el:
        name_el = soup.find("h1")
    full_name = name_el.get_text(strip=True) if name_el else product.get("name", "")
    
    # ---- DESCRIPCIÓN ----
    description = ""
    desc_candidates = soup.find_all(
        ["div", "p", "span"], 
        class_=re.compile(r"desc|detail|info|especif", re.I)
    )
    for el in desc_candidates:
        text = el.get_text(strip=True)
        if len(text) > len(description):
            description = text
    
    # ---- ESPECIFICACIONES (tabla o lista) ----
    specifications = {}
    spec_tables = soup.find_all("table")
    for table in spec_tables:
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            if len(cells) >= 2:
                key = cells[0].get_text(strip=True).lower()
                val = cells[1].get_text(strip=True)
                if key and val:
                    specifications[key] = val
    
    # Buscar especificaciones en formato lista
    spec_lists = soup.find_all(["ul", "dl"], class_=re.compile(r"spec|caract|detail", re.I))
    for lst in spec_lists:
        items = lst.find_all(["li", "dd"])
        for item in items:
            text = item.get_text(strip=True)
            if ":" in text:
                parts = text.split(":", 1)
                specifications[parts[0].strip().lower()] = parts[1].strip()
    
    # ---- TODAS LAS IMÁGENES ----
    image_urls = []
    # Buscar imágenes del producto (galería, thumbnails, principal)
    img_selectors = [
        "img[class*='product']", "img[class*='galeri']",
        "div[class*='gallery'] img", "div[class*='slider'] img",
        "div[class*='image'] img", "a[data-fancybox] img",
        "img[src*='productos']", "img[data-src*='productos']",
    ]
    
    for selector in img_selectors:
        imgs = soup.select(selector)
        for img in imgs:
            src = (img.get("src") or img.get("data-src") or 
                   img.get("data-lazy") or img.get("data-zoom-image") or "")
            if src and "productos" in src.lower():
                full_src = urljoin(CATALOG_BASE_URL, src)
                if full_src not in image_urls:
                    image_urls.append(full_src)
    
    # Buscar también en enlaces que apuntan a imágenes grandes
    for a_tag in soup.find_all("a", href=re.compile(r"\.(jpg|jpeg|png|webp)", re.I)):
        href = urljoin(CATALOG_BASE_URL, a_tag["href"])
        if href not in image_urls:
            image_urls.append(href)
    
    # Asegurar al menos la thumbnail
    if not image_urls and product.get("thumbnail_url"):
        image_urls.append(product["thumbnail_url"])
    
    # ---- VARIANTES DE COLOR ----
    variants = []
    color_elements = soup.find_all(
        ["div", "span", "td", "tr"],
        class_=re.compile(r"color|variant|opci", re.I)
    )
    
    # También buscar en tablas de stock por color
    stock_table = soup.find("table", class_=re.compile(r"stock|color|variant", re.I))
    if not stock_table:
        # Buscar cualquier tabla con columnas de color
        for table in soup.find_all("table"):
            headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
            if any(h in headers for h in ["color", "colores", "referencia"]):
                stock_table = table
                break
    
    if stock_table:
        rows = stock_table.find_all("tr")
        header_cells = rows[0].find_all(["th", "td"]) if rows else []
        headers = [h.get_text(strip=True).lower() for h in header_cells]
        
        for row in rows[1:]:
            cells = row.find_all("td")
            if not cells:
                continue
            variant = {}
            for i, cell in enumerate(cells):
                key = headers[i] if i < len(headers) else f"col_{i}"
                variant[key] = cell.get_text(strip=True)
            if variant:
                variants.append(variant)
    
    # ---- FICHA TÉCNICA PDF ----
    pdf_url = ""
    pdf_link = soup.find("a", href=re.compile(r"\.(pdf)", re.I))
    if pdf_link:
        pdf_url = urljoin(CATALOG_BASE_URL, pdf_link["href"])
    
    # ---- PRECIO ----
    price = None
    price_el = soup.find(
        ["span", "div", "p"], 
        class_=re.compile(r"price|precio", re.I)
    )
    if price_el:
        price_text = price_el.get_text(strip=True)
        price_match = re.search(r"[\d,.]+", price_text)
        if price_match:
            price = price_match.group()
    
    # ---- STOCK TOTAL ----
    total_stock = 0
    stock_elements = soup.find_all(string=re.compile(r"Existencias|Stock", re.I))
    for el in stock_elements:
        parent = el.find_parent()
        if parent:
            nums = re.findall(r"[\d,]+", parent.get_text())
            for n in nums:
                try:
                    total_stock += int(n.replace(",", ""))
                except ValueError:
                    pass
    
    # Construir producto completo
    product_complete = {
        "product_id": product_id,
        "name": full_name,
        "category": product.get("category", ""),
        "subcategory": product.get("subcategory", ""),
        "price": price,
        "description": description,
        "specifications": specifications,
        "image_urls": image_urls,
        "variants": variants,
        "technical_sheet_url": pdf_url,
        "stock": {
            "total": total_stock,
            "has_stock": total_stock > 0,
        },
        "detail_url": url,
        "_scraped_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(),
    }
    
    # Eliminar flag interno
    product_complete.pop("_needs_detail_scrape", None)
    
    logger.info(
        f"[DETALLE] ✓ {product_id}: {len(image_urls)} imgs, "
        f"{len(variants)} variantes, stock={total_stock}"
    )
    
    return product_complete


# ============================================================================
# 5. DESCARGA DE ASSETS (IMÁGENES + PDFs)
# ============================================================================

async def download_product_assets(
    context: BrowserContext,
    product: dict,
    checkpoint: CheckpointManager
) -> dict:
    """Descarga todas las imágenes y PDFs de un producto."""
    product_id = product["product_id"]
    safe_id = sanitize_filename(product_id)
    downloaded_images = []
    
    # Descargar imágenes
    for i, img_url in enumerate(product.get("image_urls", [])):
        try:
            ext = Path(img_url).suffix or ".jpg"
            filename = f"{safe_id}_{i}{ext}"
            filepath = IMAGES_DIR / filename
            
            if filepath.exists():
                downloaded_images.append(str(filepath))
                continue
            
            page = await context.new_page()
            response = await page.goto(img_url)
            if response and response.ok:
                body = await response.body()
                save_binary(body, filepath)
                downloaded_images.append(str(filepath))
                logger.debug(f"[DOWNLOAD] ✓ Imagen: {filename}")
            await page.close()
            
        except Exception as e:
            logger.warning(f"[DOWNLOAD] ✗ Imagen {img_url}: {e}")
    
    # Descargar PDF de ficha técnica
    pdf_path = ""
    pdf_url = product.get("technical_sheet_url", "")
    if pdf_url:
        try:
            pdf_filename = f"{safe_id}_ficha.pdf"
            pdf_filepath = PDFS_DIR / pdf_filename
            
            if not pdf_filepath.exists():
                page = await context.new_page()
                response = await page.goto(pdf_url)
                if response and response.ok:
                    body = await response.body()
                    save_binary(body, pdf_filepath)
                    pdf_path = str(pdf_filepath)
                    logger.debug(f"[DOWNLOAD] ✓ PDF: {pdf_filename}")
                await page.close()
            else:
                pdf_path = str(pdf_filepath)
                
        except Exception as e:
            logger.warning(f"[DOWNLOAD] ✗ PDF {pdf_url}: {e}")
    
    product["local_image_paths"] = downloaded_images
    product["local_pdf_path"] = pdf_path
    
    return product


# ============================================================================
# 6. ORQUESTADOR PRINCIPAL
# ============================================================================

async def run_full_scrape() -> list[dict]:
    """
    Ejecuta el pipeline completo de scraping:
    1. Extrae categorías
    2. Recorre cada categoría → lista productos
    3. Para cada producto → extrae detalle completo
    4. Descarga todos los assets
    5. Guarda JSON final
    """
    checkpoint = CheckpointManager("scraper")
    all_products = []
    audit_log = []
    
    logger.info("=" * 70)
    logger.info("[INICIO] Pipeline de Scraping CATAPROM — Nivel Militar")
    logger.info("=" * 70)
    
    async with async_playwright() as pw:
        context = await create_authenticated_context(pw)
        page = await context.new_page()
        
        # FASE 1: Extraer categorías
        categories = await extract_categories(page)
        save_json(
            categories,
            PRODUCTS_JSON_DIR / "categories_index.json"
        )
        logger.info(f"[FASE 1] {len(categories)} categorías indexadas")
        
        # FASE 2: Extraer productos por categoría
        for cat_idx, category in enumerate(categories, 1):
            cat_name = category["name"]
            cat_key = f"cat:{cat_name}"
            
            if checkpoint.is_processed(cat_key):
                logger.info(f"[SKIP] Categoría ya procesada: {cat_name}")
                # Cargar productos guardados previamente
                cat_file = PRODUCTS_JSON_DIR / f"{sanitize_filename(cat_name)}.json"
                if cat_file.exists():
                    from utils import load_json
                    all_products.extend(load_json(cat_file))
                continue
            
            logger.info(
                f"[FASE 2] [{cat_idx}/{len(categories)}] "
                f"Categoría: {cat_name}"
            )
            
            try:
                products = await extract_products_from_category(
                    page, category, checkpoint
                )
                
                # FASE 3: Detalle de cada producto
                detailed_products = []
                for prod_idx, product in enumerate(products, 1):
                    pid = product["product_id"]
                    
                    if checkpoint.is_processed(f"detail:{pid}"):
                        logger.debug(f"[SKIP] Producto ya procesado: {pid}")
                        continue
                    
                    try:
                        detailed = await extract_product_detail(page, product)
                        
                        # FASE 4: Descargar assets
                        detailed = await download_product_assets(
                            context, detailed, checkpoint
                        )
                        
                        detailed_products.append(detailed)
                        checkpoint.mark_processed(f"detail:{pid}")
                        
                        audit_log.append(generate_audit_record(
                            pid, "scrape_complete", "SUCCESS",
                            {"images": len(detailed.get("image_urls", []))}
                        ))
                        
                        if prod_idx % 10 == 0:
                            logger.info(
                                f"  → Progreso: {prod_idx}/{len(products)} "
                                f"productos en {cat_name}"
                            )
                        
                    except Exception as e:
                        logger.error(f"[ERROR] Producto {pid}: {e}")
                        checkpoint.mark_failed(f"detail:{pid}", str(e))
                        audit_log.append(generate_audit_record(
                            pid, "scrape_complete", "FAILED",
                            {"error": str(e)}
                        ))
                
                # Guardar productos de esta categoría
                save_json(
                    detailed_products,
                    PRODUCTS_JSON_DIR / f"{sanitize_filename(cat_name)}.json"
                )
                all_products.extend(detailed_products)
                checkpoint.mark_processed(cat_key)
                
            except Exception as e:
                logger.error(f"[ERROR] Categoría {cat_name}: {e}")
                checkpoint.mark_failed(cat_key, str(e))
        
        await context.close()
    
    # Guardar dataset completo
    save_json(all_products, PRODUCTS_JSON_DIR / "all_products.json")
    save_json(audit_log, PRODUCTS_JSON_DIR / "scrape_audit_log.json")
    
    stats = checkpoint.get_stats()
    logger.info("=" * 70)
    logger.info(f"[COMPLETADO] Total productos: {len(all_products)}")
    logger.info(f"[STATS] Procesados: {stats['total_processed']}")
    logger.info(f"[STATS] Fallidos: {stats['total_failed']}")
    logger.info("=" * 70)
    
    return all_products


# ============================================================================
# 7. ENTRY POINT
# ============================================================================

if __name__ == "__main__":
    asyncio.run(run_full_scrape())
