// Diagnóstico 6: Probar el endpoint REAL de productos /Catalogo/Default.aspx?id=X&Page=N
// Llaveros = id 19 (84 productos, 7 páginas). Probamos página 1 y 2.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URLS = [
  'https://www.catalogospromocionales.com/Catalogo/Default.aspx?id=19&Page=1',
  'https://www.catalogospromocionales.com/Catalogo/Default.aspx?id=19&Page=2',
  'https://www.catalogospromocionales.com/Catalogo/Default.aspx?id=71&Page=1', // probar id de producto
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

  for (const url of URLS) {
    const page = await context.newPage();
    console.log('\n========================================');
    console.log('▶', url);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('  HTTP', resp.status(), '| URL final:', page.url());
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2500);

    const info = await page.evaluate(() => {
      const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
      const links = [...new Set(Array.from(document.querySelectorAll('a[href*="/catalogo/producto/"]')).map((a) => a.href))];
      const imgs = [...new Set(Array.from(document.querySelectorAll('img[src*="productos-s/"]')).map((i) => i.src))];
      const totalEl = document.getElementById('ctl00_ContentPlaceHolder1_lblDesTotal');
      const dl = document.getElementById('ctl00_ContentPlaceHolder1_pnlDatalist');
      // Capturar estructura de cada tarjeta de producto
      const tarjetas = Array.from(document.querySelectorAll('a[href*="/catalogo/producto/"]')).map((a) => {
        const img = a.querySelector('img');
        // Buscar nombre/ref en el contenedor padre
        const cont = a.closest('div') || a.parentElement;
        const h4 = cont ? cont.querySelector('h4') : null;
        const p = cont ? cont.querySelector('p') : null;
        return {
          href: a.href,
          imgAlt: img ? limpiar(img.alt) : '',
          ref: h4 ? limpiar(h4.textContent) : '',
          nombre: p ? limpiar(p.textContent) : '',
        };
      });
      return {
        totalDeclarado: totalEl ? limpiar(totalEl.textContent) : '?',
        dlBytes: dl ? dl.innerHTML.length : 0,
        linksUnicos: links.length,
        imgsUnicas: imgs.length,
        muestraImgs: imgs.slice(0, 6),
        tarjetas: tarjetas.slice(0, 15),
      };
    });
    console.log('  Total declarado:', info.totalDeclarado, '| dlBytes:', info.datalistBytes);
    console.log('  Links únicos   :', info.linksUnicos, '| Imgs únicas:', info.imgsUnicas);
    console.log('  Tarjetas de producto:', info.tarjetas.length);
    info.tarjetas.forEach((t, i) =>
      console.log(`   ${i + 1}. ${t.nombre || t.imgAlt} [${t.ref}] -> ${t.href}`)
    );

    await page.close();
  }

  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
