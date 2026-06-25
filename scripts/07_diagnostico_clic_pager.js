// Diagnóstico 5: Forzar la carga de productos con clic REAL en el pager.
// Probamos llaveros (84 productos, 7 páginas) con navegador VISIBLE.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://www.catalogospromocionales.com/promocionales/llaveros.html';
const DATA_DIR = path.resolve('D:/KNOWLEDGE ZOOM PUBLICIDAD/data');

const medir = (page) =>
  page.evaluate(() => ({
    linksProd: [...new Set(Array.from(document.querySelectorAll('a[href*="/catalogo/producto/"]')).map((a) => a.href))].length,
    imgs: document.querySelectorAll('img[src*="productos-s/"]').length,
    dlBytes: (document.getElementById('ctl00_ContentPlaceHolder1_pnlDatalist') || {}).innerHTML?.length || 0,
  }));

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    locale: 'es-MX',
  });
  const page = await context.newPage();

  console.log('▶ Abriendo (visible):', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log('Inicial:', JSON.stringify(await medir(page)));

  // El pager: botones imagen con nextpage.gif / prevpage.gif / números
  // Examinar qué controles clicables hay en el área de paginación
  const pagerInfo = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const ctrl = document.getElementById('ctl00_ContentPlaceHolder1_pnlPagingControl');
    const items = ctrl ? Array.from(ctrl.querySelectorAll('a, input, button, span')).map((el) => ({
      tag: el.tagName,
      type: el.type || '',
      id: el.id,
      name: el.name || '',
      texto: limpiar(el.textContent),
      href: el.href || '',
      onclick: el.getAttribute('onclick') || '',
      src: el.src || '',
    })) : [];
    // también botones next/prev/todos fuera del control
    const extras = Array.from(document.querySelectorAll('input[type="image"]')).map((el) => ({
      tag: el.tagName, id: el.id, name: el.name, src: el.src, onclick: el.getAttribute('onclick') || '',
    }));
    return { items, extras };
  });
  console.log('\n=== Pager control items ===');
  pagerInfo.items.forEach((it) => console.log('  ', JSON.stringify(it)));
  console.log('\n=== Image buttons (next/prev/todos) ===');
  pagerInfo.extras.forEach((it) => console.log('  ', JSON.stringify(it)));

  // Hacer clic real en el botón "siguiente página" si existe
  // Los botones típicos: ctl00$ContentPlaceHolder1$Siguiente (nextpage.gif)
  const nextBtn = await page.$('input[name="ctl00$ContentPlaceHolder1$Siguiente"], input[src*="nextpage"], input[src*="next"]');
  if (nextBtn) {
    console.log('\n▶ Clic en botón SIGUIENTE...');
    await nextBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    console.log('Tras clic siguiente:', JSON.stringify(await medir(page)));
  } else {
    console.log('\n  (no se encontró botón siguiente)');
  }

  // Clic en el botón "Todos" (ir a última página / mostrar todos)
  const todosBtn = await page.$('#ctl00_ContentPlaceHolder1_Todos');
  if (todosBtn) {
    console.log('\n▶ Clic en botón TODOS (lastpage)...');
    await todosBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
    console.log('Tras clic todos:', JSON.stringify(await medir(page)));
  }

  // Intentar clic en el número de página "2" si existe como LinkButton
  const pag2 = await page.$('a[href*="Pagina"], a:has-text("2")');
  console.log('\n  ¿existe enlace página 2?:', !!pag2);

  // Guardar estado final
  fs.writeFileSync(path.join(DATA_DIR, 'diag5_llaveros_final.html'), await page.content(), 'utf8');
  const finalProds = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return [...new Set(Array.from(document.querySelectorAll('a[href*="/catalogo/producto/"]')).map((a) => a.href))].slice(0, 20);
  });
  console.log('\nProductos únicos finales:', finalProds.length);
  finalProds.forEach((p) => console.log('  -', p));

  await page.waitForTimeout(2000);
  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
