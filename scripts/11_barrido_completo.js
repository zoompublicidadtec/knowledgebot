// ETAPA 1 - Barrido completo CONTINUABLE (reanuda desde progreso guardado).
// Versión robusta: carga el catálogo parcial existente y solo procesa lo faltante.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDICE = 'https://www.catalogospromocionales.com/seccion/subcategorias.html';
const DATA_DIR = path.resolve('D:/KNOWLEDGE ZOOM PUBLICIDAD/data');
const OUT_FILE = path.join(DATA_DIR, 'estructura_catalogo.json');
const PROG_FILE = path.join(DATA_DIR, 'estructura_progreso.json');
const PRODUCTOS_FILE = path.join(DATA_DIR, 'productos_catalogo.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function extraerInfoSubcategoria(page, sub) {
  await page.goto(sub.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(1200);
  return page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const totalEl = document.getElementById('ctl00_ContentPlaceHolder1_lblDesTotal');
    const pagDeEl = document.getElementById('ctl00_ContentPlaceHolder1_lblDesDe');
    const pagerLink = document.querySelector('#ctl00_ContentPlaceHolder1_pnlPagingControl a[href*="Default.aspx"]')
      || document.querySelector('a[href*="Default.aspx?id="]');
    let idCat = null;
    if (pagerLink) { const m = pagerLink.href.match(/id=(\d+)/i); if (m) idCat = m[1]; }
    return {
      totalDeclarado: totalEl ? parseInt(limpiar(totalEl.textContent)) || 0 : 0,
      paginasDeclaradas: pagDeEl ? parseInt(limpiar(pagDeEl.textContent)) || 1 : 1,
      idCategoria: idCat,
    };
  });
}

async function extraerProductosPagina(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(1000);
  return page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('div.itemProducto-, .itemProducto')).map((card) => {
      const enlace = card.querySelector('a.img-producto, a[href*="/p/"]');
      const img = card.querySelector('img');
      const h3 = card.querySelector('h3');
      const ref = card.querySelector('.ref, p.ref');
      let existencias = '', proximas = '';
      card.querySelectorAll('.wrapInventario p').forEach((pp) => {
        const lbl = limpiar(pp.querySelector('strong')?.textContent || '');
        const val = limpiar(pp.querySelector('span')?.textContent || '');
        if (/existencia/i.test(lbl)) existencias = val;
        if (/pr[oó]xima/i.test(lbl)) proximas = val;
      });
      const v360 = card.querySelector('.url360');
      return {
        slug: card.getAttribute('rel') || '',
        nombre: limpiar(h3 ? h3.textContent.replace(/\[Más\]/g, '') : img ? img.alt : ''),
        referencia: limpiar(ref ? ref.textContent : ''),
        enlace: enlace ? enlace.href : '',
        imagen: img ? img.src : '',
        existencias, proximasLlegadas: proximas,
        vista360: v360 ? v360.getAttribute('href') || '' : '',
      };
    });
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-MX' });
  const page = await context.newPage();

  // 1) Índice
  console.log('▶ Cargando índice...');
  await page.goto(INDICE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const categorias = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const out = [];
    document.querySelectorAll('div.fil-categorias div.categoria').forEach((cat) => {
      const spanEl = cat.querySelector('div.conte > span');
      const imgEl = cat.querySelector('img');
      const linkEl = cat.querySelector('a[href]');
      const subcategorias = [];
      cat.querySelectorAll('div.conte ul li a').forEach((a) =>
        subcategorias.push({ nombre: limpiar(a.textContent), url: a.href })
      );
      out.push({
        categoria: limpiar(spanEl ? spanEl.textContent : imgEl ? imgEl.alt : ''),
        icono: imgEl ? imgEl.src : '', categoriaUrl: linkEl ? linkEl.href : '', subcategorias,
      });
    });
    return out;
  });

  // 2) Cargar catálogo parcial existente (si lo hay) para MERGE
  let catPrevio = null;
  if (fs.existsSync(OUT_FILE)) {
    try { catPrevio = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); console.log('↻ Cargando catálogo parcial previo'); } catch (e) {}
  }
  // Mergear productos ya extraídos en catPrevio hacia categorias
  if (catPrevio) {
    catPrevio.categorias.forEach((cp) => {
      const dest = categorias.find((c) => c.categoria === cp.categoria);
      if (dest) {
        cp.subcategorias.forEach((sp) => {
          const sdest = dest.subcategorias.find((s) => s.nombre === sp.nombre);
          if (sdest && sp.productos && sp.productos.length) {
            Object.assign(sdest, sp); // conserva productos, id, total, etc.
          }
        });
      }
    });
  }
  let progreso = { ultimaCategoriaCompleta: -1 };
  if (fs.existsSync(PROG_FILE)) {
    try { progreso = JSON.parse(fs.readFileSync(PROG_FILE, 'utf8')); } catch (e) {}
  }

  // 3) Mapa global de productos únicos (cargar existentes)
  const todosProductos = new Map();
  if (fs.existsSync(PRODUCTOS_FILE)) {
    try { JSON.parse(fs.readFileSync(PRODUCTOS_FILE, 'utf8')).forEach((p) => { if (p.enlace) todosProductos.set(p.enlace, p); }); } catch (e) {}
    console.log(`  ${todosProductos.size} productos únicos ya en archivo`);
  }

  const totalSubs = categorias.reduce((a, c) => a + c.subcategorias.length, 0);
  let idx = 0;
  const guardar = () => {
    fs.writeFileSync(PROG_FILE, JSON.stringify(progreso), 'utf8');
    const resultado = {
      pagina: INDICE, fechaExtraccion: new Date().toISOString(),
      totalCategorias: categorias.length, totalSubcategorias: totalSubs,
      totalProductosUnicos: todosProductos.size, categorias,
    };
    fs.writeFileSync(OUT_FILE, JSON.stringify(resultado, null, 2), 'utf8');
    fs.writeFileSync(PRODUCTOS_FILE, JSON.stringify(Array.from(todosProductos.values()), null, 2), 'utf8');
  };

  for (let ci = 0; ci < categorias.length; ci++) {
    const cat = categorias[ci];
    // Saltar categorías ya completas
    const yaCompleta = cat.subcategorias.every((s) => s.productos && s.totalDeclarado !== undefined);
    if (yaCompleta && ci <= (progreso.ultimaCategoriaCompleta ?? 999)) {
      idx += cat.subcategorias.length;
      continue;
    }
    console.log(`\n=== [${ci + 1}/${categorias.length}] ${cat.categoria} ===`);

    for (const sub of cat.subcategorias) {
      idx++;
      // Saltar subcategoría ya procesada
      if (sub.productos && sub.totalDeclarado !== undefined) {
        (sub.productos || []).forEach((pr) => { if (pr.enlace) todosProductos.set(pr.enlace, { ...pr, categoria: cat.categoria, subcategoria: sub.nombre }); });
        continue;
      }
      try {
        const info = await extraerInfoSubcategoria(page, sub);
        sub.idCategoria = info.idCategoria;
        sub.totalDeclarado = info.totalDeclarado;
        sub.paginas = info.paginasDeclaradas;
        sub.productos = [];
        const maxPag = Math.max(1, info.paginasDeclaradas || 1);
        for (let p = 1; p <= maxPag; p++) {
          const urlPag = info.idCategoria
            ? `https://www.catalogospromocionales.com/Catalogo/Default.aspx?id=${info.idCategoria}&Page=${p}`
            : sub.url;
          const prods = await extraerProductosPagina(page, urlPag);
          if (prods.length === 0 && p > 1) break;
          prods.forEach((pr) => {
            sub.productos.push(pr);
            if (pr.enlace) todosProductos.set(pr.enlace, { ...pr, categoria: cat.categoria, subcategoria: sub.nombre });
          });
          if (prods.length === 0) break;
        }
        console.log(`  [${idx}/${totalSubs}] ${sub.nombre}: ${info.totalDeclarado} decl. | ${sub.productos.length} extr.`);
      } catch (e) {
        sub.error = e.message.split('\n')[0];
        console.log(`  [${idx}/${totalSubs}] ✗ ${sub.nombre}: ${sub.error}`);
      }
      if (idx % 3 === 0) { progreso.ultimaCategoriaCompleta = ci - 1; guardar(); }
    }
    progreso.ultimaCategoriaCompleta = ci;
    guardar();
  }

  guardar();
  console.log('\n========== BARRIDO COMPLETADO ==========');
  console.log('Categorías       :', categorias.length);
  console.log('Subcategorías    :', totalSubs);
  console.log('Productos únicos :', todosProductos.size);
  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
