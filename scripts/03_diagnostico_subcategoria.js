// Diagnóstico: ¿qué hay realmente en una página de subcategoría?
// Inspecciono /promocionales/boligrafo-con-resaltador.html en detalle.

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

  console.log('▶ Abriendo subcategoría:', TARGET_URL);
  const resp = await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('  Status HTTP:', resp.status());
  console.log('  URL final   :', page.url());
  await page.waitForLoadState('networkidle').catch(() => {});

  // Guardar HTML
  fs.writeFileSync(path.join(DATA_DIR, 'diag_subcategoria.html'), await page.content(), 'utf8');
  await page.screenshot({ path: path.join(DATA_DIR, 'diag_subcategoria.png'), fullPage: true });

  // ¿Cuántos enlaces a /catalogo/producto/ hay?
  const info = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const linksProd = Array.from(document.querySelectorAll('a[href*="/catalogo/producto/"]')).map((a) => ({
      href: a.href,
      texto: limpiar(a.textContent),
    }));
    // buscar contenedores típicos de grilla de productos
    const posiblesSelectores = [
      '.producto', '.wrapProd', '.wrapProdWhite', '.item', '.cajaProducto',
      '.producto-item', '[class*="producto"]', '.col-lg-3', '.col-md-3',
      '.pagination', '.paginacion', '.pager',
    ];
    const conteo = {};
    posiblesSelectores.forEach((s) => {
      try { conteo[s] = document.querySelectorAll(s).length; } catch (e) {}
    });
    // textos con la palabra productos / total
    const bodyText = document.body.innerText || '';
    const lineas = bodyText.split('\n').filter((l) => /producto|total|mostrando|resultados/i.test(l)).slice(0, 10);
    return {
      titulo: document.title,
      totalLinksProd: linksProd.length,
      muestraLinksProd: linksProd.slice(0, 8),
      conteoSelectores: conteo,
      lineasRelevantes: lineas,
    };
  });

  console.log('\n========== DIAGNÓSTICO SUBCATEGORÍA ==========');
  console.log('Título             :', info.titulo);
  console.log('Links a producto   :', info.totalLinksProd);
  console.log('Conteo de selectores:', JSON.stringify(info.conteoSelectores, null, 2));
  console.log('Líneas relevantes  :', info.lineasRelevantes);
  console.log('Muestra links prod :');
  info.muestraLinksProd.forEach((l) => console.log('   -', l.href, '|', l.texto));

  // Probar si hay scroll infinito o "cargar más"
  console.log('\n▶ Probando scroll para detectar carga dinámica...');
  let antes = info.totalLinksProd;
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(3000);
  const despues = await page.evaluate(() => document.querySelectorAll('a[href*="/catalogo/producto/"]').length);
  console.log(`   Links antes scroll: ${antes} | después: ${despues}`);

  // Buscar botones "cargar más" o paginación
  const pag = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const btns = Array.from(document.querySelectorAll('a, button')).filter((b) => {
      const t = limpiar(b.textContent);
      return /siguiente|cargar más|ver más|more|next|página|página [0-9]/i.test(t);
    }).map((b) => ({ texto: limpiar(b.textContent), href: b.href || '', tag: b.tagName }));
    return btns.slice(0, 15);
  });
  console.log('   Botones de paginación/cargar más:', JSON.stringify(pag, null, 2));

  await browser.close();
})().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
