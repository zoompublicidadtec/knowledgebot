// Diagnóstico 7: Interceptar RESPUESTAS de red buscando el JSON/HTML de productos.
// Registrar todo lo que contenga datos de producto, y esperar mucho más tiempo.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://www.catalogospromocionales.com/Catalogo/Default.aspx?id=19&Page=1';
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

  const respuestas = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    // Capturar documentos y JSON que puedan contener productos
    if (ct.includes('json') || ct.includes('html') || ct.includes('text')) {
      try {
        const body = await resp.text();
        if (body && (body.includes('/catalogo/producto/') || body.includes('productos-s/') || body.includes('dlProductos'))) {
          respuestas.push({ url, status: resp.status(), ct, len: body.length, muestra: body.slice(0, 200) });
        }
      } catch (e) {}
    }
  });

  console.log('▶ Cargando:', URL);
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  // Espera extra larga por si hay carga diferida
  await page.waitForTimeout(8000);

  console.log('\n=== Respuestas que contienen datos de producto ===');
  console.log('Total capturadas:', respuestas.length);
  respuestas.forEach((r, i) => {
    console.log(`\n[${i + 1}] ${r.status} ${r.ct} (${r.len} bytes)`);
    console.log('    URL:', r.url);
    console.log('    Muestra:', r.muestra.replace(/\s+/g, ' '));
  });

  // Revisar estado final del DOM tras la larga espera
  const fin = await page.evaluate(() => ({
    linksProd: [...new Set(Array.from(document.querySelectorAll('a[href*="/catalogo/producto/"]')).map((a) => a.href))].length,
    imgs: document.querySelectorAll('img[src*="productos-s/"]').length,
    dlBytes: (document.getElementById('ctl00_ContentPlaceHolder1_pnlDatalist') || {}).innerHTML?.length || 0,
    // buscar si hay algún DataList renderizado con tabla
    tablas: document.querySelectorAll('table').length,
    spansProd: document.querySelectorAll('[class*="prod"]').length,
  }));
  console.log('\n=== Estado DOM final ===');
  console.log(JSON.stringify(fin, null, 2));

  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
