// ETAPA 1 - Barrido de estructura del catálogo (PÁGINA 1)
// Selectores exactos basados en el DOM real:
//   div.fil-categorias > div.categoria > a[href] (link + imagen de cat.)
//   div.categoria > div.conte > span (nombre de categoría)
//   div.categoria > div.conte > ul > li > a (subcategorías)
//
// Para cada subcategoría abrimos su URL y contamos los productos
// ( thumbnails /catalogo/producto/<id>/<cat> ).
//
// Salida: data/02_estructura_catalogo.json + resumen en consola.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://www.catalogospromocionales.com/seccion/subcategorias.html';
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, '02_estructura_catalogo.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  console.log('▶ Cargando índice de subcategorías:', TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});

  // ---------------------------------------------------------------
  // 1) Extraer categorías + subcategorías con selectores exactos
  // ---------------------------------------------------------------
  const categorias = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const out = [];
    document.querySelectorAll('div.fil-categorias div.categoria').forEach((cat) => {
      const linkEl = cat.querySelector('a[href]');
      const imgEl = cat.querySelector('img');
      const spanEl = cat.querySelector('div.conte > span');
      const nombre = limpiar(spanEl ? spanEl.textContent : imgEl ? imgEl.alt : '');
      const categoriaUrl = linkEl ? linkEl.href : '';
      const icono = imgEl ? imgEl.src : '';

      const subcategorias = [];
      cat.querySelectorAll('div.conte ul li a').forEach((a) => {
        const texto = limpiar(a.textContent);
        subcategorias.push({
          nombre: texto,
          url: a.href,
          esTodos: /todos/i.test(texto),
        });
      });

      out.push({
        categoria: nombre,
        categoriaUrl,
        icono,
        subcategorias,
      });
    });
    return out;
  });

  console.log(`✓ Categorías detectadas: ${categorias.length}`);

  // ---------------------------------------------------------------
  // 2) Contar productos por subcategoría.
  //    Estrategia: abrir la página de la subcategoría y contar los
  //    enlaces hacia /catalogo/producto/. Muchas páginas usan
  //    paginación; también leemos el contador si existe.
  // ---------------------------------------------------------------
  let totalProductosEstimado = 0;
  let progreso = 0;
  const totalSubs = categorias.reduce((a, c) => a + c.subcategorias.length, 0);

  for (const cat of categorias) {
    for (const sub of cat.subcategorias) {
      progreso++;
      try {
        await page.goto(sub.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await sleep(300);

        // Contar enlaces únicos a ficha de producto
        const productos = await page.evaluate(() => {
          const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
          const vistos = new Set();
          const items = [];
          document.querySelectorAll('a[href*="/catalogo/producto/"]').forEach((a) => {
            const href = a.href;
            if (vistos.has(href)) return;
            vistos.add(href);
            // Nombre: texto o alt de imagen
            let nombre = limpiar(a.textContent);
            if (!nombre) {
              const img = a.querySelector('img');
              if (img) nombre = limpiar(img.alt);
            }
            const img = a.querySelector('img');
            items.push({
              url: href,
              nombre: nombre,
              imagen: img ? img.src : '',
            });
          });
          // Buscar texto tipo "Mostrando X - Y de Z" o total
          const bodyText = document.body.innerText || '';
          const m = bodyText.match(/(\d+)\s+productos?/i);
          return { productos: items, totalTexto: m ? m[0] : '' };
        });

        sub.productosEnPagina = productos.productos.length;
        sub.totalTexto = productos.totalTexto;
        sub.muestra = productos.productos.slice(0, 3);
        totalProductosEstimado += sub.productosEnPagina;

        console.log(
          `[${progreso}/${totalSubs}] ${cat.categoria} › ${sub.nombre}: ${sub.productosEnPagina} productos` +
            (sub.totalTexto ? ` (${sub.totalTexto})` : '')
        );
      } catch (e) {
        sub.error = e.message.split('\n')[0];
        console.log(`[${progreso}/${totalSubs}] ✗ ${cat.categoria} › ${sub.nombre}: ${sub.error}`);
      }
    }
  }

  // ---------------------------------------------------------------
  // 3) Guardar estructura completa
  // ---------------------------------------------------------------
  const resultado = {
    pagina: TARGET_URL,
    fechaExtraccion: new Date().toISOString(),
    totalCategorias: categorias.length,
    totalSubcategorias: categorias.reduce((a, c) => a + c.subcategorias.length, 0),
    totalProductosEstimado,
    categorias,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(resultado, null, 2), 'utf8');

  console.log('\n========== RESUMEN BARRIDO PÁGINA 1 ==========');
  console.log('Categorías            :', resultado.totalCategorias);
  console.log('Subcategorías         :', resultado.totalSubcategorias);
  console.log('Productos (1ª página) :', resultado.totalProductosEstimado);
  console.log('➜ NOTA: el conteo de productos contempla solo la 1ª página de');
  console.log('  cada subcategoría. La ETAPA 2 recorrerá la paginación completa.');
  console.log('💾 Estructura guardada en:', OUT_FILE);

  await browser.close();
})().catch((e) => {
  console.error('❌ Error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
