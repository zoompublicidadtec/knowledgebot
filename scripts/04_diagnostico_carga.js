// Diagnóstico 2: ¿cómo se cargan los 8 productos?
// Esperar más, escuchar peticiones de red, y revisar si la grilla se puebla.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://www.catalogospromocionales.com/promocionales/boligrafo-con-resaltador.html';
const DATA_DIR = path.resolve('D:/KNOWLEDGE ZOOM PUBLICIDAD/data');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'es-MX',
  });
  const page = await context.newPage();

  // Escuchar TODAS las peticiones de red para entender cómo cargan productos
  const peticiones = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/producto|catalogo|async|ajax|\.ashx|handler|datos|list/i.test(u)) {
      peticiones.push({ url: u, tipo: req.resourceType(), metodo: req.method() });
    }
  });

  console.log('▶ Cargando con espera larga...');
  await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
  console.log('  Espera networkidle OK');

  // Esperar selectores comunes de producto
  for (const sel of ['.wrapProdWhite', '.wrapProd', '.prod', 'a[href*="/catalogo/producto/"]', '#ctl00_ContentPlaceHolder1_dlProductos']) {
    try {
      await page.waitForSelector(sel, { timeout: 5000 });
      console.log(`  ✓ Selector presente: ${sel}`);
    } catch (e) {
      console.log(`  ✗ Selector ausente: ${sel}`);
    }
  }

  // Inspeccionar el datalist por ID de ASP.NET
  const datalistInfo = await page.evaluate(() => {
    const ids = ['ctl00_ContentPlaceHolder1_dlProductos', 'ctl00_ContentPlaceHolder1_dl', 'ContentPlaceHolder1'];
    const out = {};
    ids.forEach((id) => {
      const el = document.getElementById(id);
      out[id] = el ? { tag: el.tagName, hijos: el.children.length, innerHTML_len: el.innerHTML.length } : null;
    });
    // Buscar cualquier datalist/repeater por patrones
    out.__todos_ids_con_datalist = Array.from(document.querySelectorAll('[id*="atalist"],[id*="oductos"]')).map((e) => e.id);
    return out;
  });
  console.log('\nInfo datalist:', JSON.stringify(datalistInfo, null, 2));

  // ¿Aparecieron más productos tras la espera?
  const n = await page.evaluate(() => document.querySelectorAll('a[href*="/catalogo/producto/"]').length);
  console.log('Links a producto ahora:', n);

  // Guardar HTML post-espera
  fs.writeFileSync(path.join(DATA_DIR, 'diag2_subcategoria.html'), await page.content(), 'utf8');

  console.log('\n--- Peticiones de red relevantes ---');
  peticiones.slice(0, 30).forEach((p) => console.log(`  [${p.metodo} ${p.tipo}] ${p.url}`));

  // Probar hacer clic en el botón de paginación "Todos" (lastpage)
  console.log('\n▶ Probando botón "Todos"/última página...');
  const todosBtn = await page.$('#ctl00_ContentPlaceHolder1_Todos');
  if (todosBtn) {
    await todosBtn.click().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    const n2 = await page.evaluate(() => document.querySelectorAll('a[href*="/catalogo/producto/"]').length);
    const total = await page.evaluate(() => {
      const el = document.getElementById('ctl00_ContentPlaceHolder1_lblDesTotal');
      return el ? el.textContent.trim() : '?';
    });
    console.log(`  Tras clic: ${n2} links | total declarado: ${total}`);
  }

  await browser.close();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
