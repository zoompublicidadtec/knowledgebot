// Validación rápida: extraer TODOS los productos de "llaveros" (id=19, 84 prod, 7 pág)
// para confirmar que la paginación y extracción funcionan antes del barrido completo.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ID = '19';
const PAGS = 7;
const DATA_DIR = path.resolve('D:/KNOWLEDGE ZOOM PUBLICIDAD/data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-MX' });
  const page = await context.newPage();

  const todos = [];
  for (let p = 1; p <= PAGS; p++) {
    const url = `https://www.catalogospromocionales.com/Catalogo/Default.aspx?id=${ID}&Page=${p}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(1200);

    const prods = await page.evaluate(() => {
      const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('div.itemProducto-, .itemProducto')).map((card) => {
        const enlace = card.querySelector('a.img-producto, a[href*="/p/"]');
        const img = card.querySelector('img');
        const h3 = card.querySelector('h3');
        const ref = card.querySelector('.ref, p.ref');
        const bloques = card.querySelectorAll('.wrapInventario p');
        let existencias = '', proximas = '';
        bloques.forEach((pp) => {
          const lbl = limpiar(pp.querySelector('strong')?.textContent || '');
          const val = limpiar(pp.querySelector('span')?.textContent || '');
          if (/existencia/i.test(lbl)) existencias = val;
          if (/pr[oó]xima/i.test(lbl)) proximas = val;
        });
        return {
          nombre: limpiar(h3 ? h3.textContent.replace(/\[Más\]/g, '') : img ? img.alt : ''),
          referencia: limpiar(ref ? ref.textContent : ''),
          enlace: enlace ? enlace.href : '',
          imagen: img ? img.src : '',
          existencias, proximasLlegadas: proximas,
        };
      });
    });
    console.log(`Página ${p}: ${prods.length} productos`);
    todos.push(...prods);
  }

  // Desduplicar por enlace
  const unicos = new Map();
  todos.forEach((p) => { if (p.enlace) unicos.set(p.enlace, p); });
  console.log(`\nTotal bruto: ${todos.length} | Únicos por enlace: ${unicos.size}`);
  console.log('\nMuestra de productos:');
  Array.from(unicos.values()).slice(0, 12).forEach((p, i) =>
    console.log(`  ${i + 1}. [${p.referencia}] ${p.nombre} | exist:${p.existencias} | ${p.imagen}`)
  );

  fs.writeFileSync(path.join(DATA_DIR, 'validacion_llaveros.json'), JSON.stringify(Array.from(unicos.values()), null, 2), 'utf8');
  console.log('\n💾 validacion_llaveros.json');

  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
