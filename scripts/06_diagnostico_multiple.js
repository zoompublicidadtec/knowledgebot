// Diagnóstico 4: Probar MÚLTIPLES subcategorías y comparar.
// ¿Algún producto se renderiza en alguna? ¿Diferencia headless vs visible?

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGETS = [
  'https://www.catalogospromocionales.com/promocionales/boligrafo-con-resaltador.html',
  'https://www.catalogospromocionales.com/promocionales/llaveros.html',
  'https://www.catalogospromocionales.com/promocionales/gorras.html',
  'https://www.catalogospromocionales.com/promocionales/botilitos-plasticos.html',
];
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

  for (const url of TARGETS) {
    const page = await context.newPage();
    console.log('\n========================================');
    console.log('▶', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
      const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const totalEl = document.getElementById('ctl00_ContentPlaceHolder1_lblDesTotal');
      const pagEl = document.getElementById('ctl00_ContentPlaceHolder1_lblDesDe');
      const dl = document.getElementById('ctl00_ContentPlaceHolder1_pnlDatalist');
      const links = [...new Set(Array.from(document.querySelectorAll('a[href*="/catalogo/producto/"]')).map((a) => a.href))];
      // Buscar cualquier contenedor con imágenes de producto del catálogo
      const imgProd = [...new Set(Array.from(document.querySelectorAll('img[src*="productos-s/"], img[src*="productos/"]')).map((i) => i.src))];
      // ¿Hay DataList renderizado (tabla con filas de producto)?
      const dlTables = document.querySelectorAll('#ctl00_ContentPlaceHolder1_pnlDatalist table, #ctl00_ContentPlaceHolder1_dlProductos table');
      return {
        totalDeclarado: totalEl ? limpiar(totalEl.textContent) : '?',
        paginasDeclaradas: pagEl ? limpiar(pagEl.textContent) : '?',
        datalistBytes: dl ? dl.innerHTML.length : 0,
        linksProducto: links.length,
        muestraLinks: links.slice(0, 5),
        imagenesProducto: imgProd.length,
        muestraImgs: imgProd.slice(0, 5),
        tablasEnDatalist: dlTables.length,
        // ¿El dlProductos existe como control separado?
        dlProductosExiste: !!document.getElementById('ctl00_ContentPlaceHolder1_dlProductos'),
      };
    });
    console.log('  Total declarado   :', info.totalDeclarado);
    console.log('  Páginas declaradas:', info.paginasDeclaradas);
    console.log('  Bytes datalist    :', info.datalistBytes);
    console.log('  Links producto    :', info.linksProducto);
    console.log('  Imágenes producto :', info.imagenesProducto);
    console.log('  Tablas en datalist:', info.tablasEnDatalist);
    console.log('  dlProductos existe:', info.dlProductosExiste);

    // Guardar primer target para inspección
    if (url === TARGETS[0]) {
      fs.writeFileSync(path.join(DATA_DIR, 'diag4_llaveros.html'), await page.content(), 'utf8');
    }
    await page.close();
  }

  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
