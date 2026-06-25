// ETAPA 2 + 3 - Extracción DETALLADA de cada ficha de producto.
// Lee productos_catalogo.json (de ETAPA 1) y para cada producto visita su ficha /p/SLUG/ID/CAT
// extrayendo: nombre, referencia, descripción, medidas, técnica de marca, ficha PDF,
//             empaque, inventario por color/bodega, TODAS las imágenes de la galería, vista 360.
//
// Salida: data/productos_detalle.json (incremental, reanudable)
//         data/imagenes_productos.json (mapa producto -> imágenes)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve('D:/KNOWLEDGE ZOOM PUBLICIDAD/data');
const ENTRADA = path.join(DATA_DIR, 'productos_catalogo.json');
const SALIDA = path.join(DATA_DIR, 'productos_detalle.json');
const PROG = path.join(DATA_DIR, 'detalle_progreso.json');
const IMGS = path.join(DATA_DIR, 'imagenes_productos.json');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extraerFicha(page) {
  return page.evaluate(() => {
    const norm = (t) => (t || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

    const h2 = document.querySelector('.hola h2, h2.detalle');
    const ref = document.querySelector('.prodRef, p.prodRef');
    const descr = document.querySelector('.prodDescr, p.prodDescr');

    // Medidas y marca: extraer línea por línea (separadas por <br>)
    let medidas = '', marca = '', fichaPdf = '';
    if (descr) {
      const partes = descr.innerHTML.split(/<br\s*\/?>/i).map((s) => norm(s));
      for (const p of partes) {
        const mMed = p.match(/Medidas:\s*(.+)/i);
        if (mMed && !medidas) medidas = norm(mMed[1]);
        const mMar = p.match(/Marca:\s*(.+)/i);
        if (mMar && !marca) marca = norm(mMar[1]);
      }
      const pdfA = descr.querySelector('a[href*=".pdf"], a[href*="FICHAS"], a[href*="ficha"]');
      if (pdfA) fichaPdf = pdfA.href;
    }

    // Embalaje
    const embalaje = {};
    document.querySelectorAll('.tableEmbalaje table tr, .table-list tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 2) {
        const k = norm(tds[0].textContent).replace(/:$/, '');
        const v = norm(tds[1].textContent);
        if (k && v) embalaje[k] = v;
      }
    });

    // Inventario por color/bodega
    const tablaInv = document.querySelector('.tableInfoProd');
    let inventario = [];
    if (tablaInv) {
      let headers = [];
      const ths = tablaInv.querySelectorAll('tr:first-child th, thead th');
      // En este sitio los headers están en una fila con ths
      tablaInv.querySelectorAll('tr').forEach((tr, idx) => {
        const thsRow = tr.querySelectorAll('th');
        if (thsRow.length > 0 && headers.length === 0) {
          headers = Array.from(thsRow).map((th) => norm(th.textContent));
          return;
        }
        const tds = Array.from(tr.querySelectorAll('td')).map((td) => norm(td.textContent));
        if (tds.length > 1) inventario.push(tds);
      });
      inventario = { headers, filas: inventario };
    }

    // Galería de imágenes: #gal1 a con data-image
    const imagenesGaleria = [];
    document.querySelectorAll('#gal1 a[data-image]').forEach((a) => {
      const src = a.getAttribute('data-image');
      if (src) imagenesGaleria.push(src.startsWith('//') ? 'https:' + src : src);
    });
    // imagen principal
    const imgPrinc = document.querySelector('#img_01');
    const imagenPrincipal = imgPrinc ? (imgPrinc.getAttribute('data-zoom-image') || imgPrinc.src) : '';
    // vista 360
    const v360 = document.querySelector('a.url360');
    const vista360 = v360 ? v360.getAttribute('href') || '' : '';
    const vista360Url = vista360.startsWith('//') ? 'https:' + vista360 : vista360;
    // aplicador de logo (herramienta de diseño)
    const aplicador = document.querySelector('#btnAplicadorLogo');
    const aplicadorLogo = aplicador ? aplicador.href : '';

    return {
      nombre: norm(h2 ? h2.textContent : ''),
      referencia: norm(ref ? ref.textContent : ''),
      descripcionCompleta: norm(descr ? descr.textContent : ''),
      medidas, marca, fichaPdf,
      embalaje,
      inventario,
      imagenPrincipal: imagenPrincipal.startsWith('//') ? 'https:' + imagenPrincipal : imagenPrincipal,
      imagenesGaleria,
      vista360: vista360Url,
      aplicadorLogo,
    };
  });
}

(async () => {
  if (!fs.existsSync(ENTRADA)) {
    console.error('❌ No existe productos_catalogo.json. Ejecuta primero el barrido (ETAPA 1).');
    process.exit(1);
  }
  const productos = JSON.parse(fs.readFileSync(ENTRADA, 'utf8'));
  console.log(`▶ ${productos.length} productos a procesar`);

  // Cargar detalle previo (reanudable)
  let detalle = {};
  if (fs.existsSync(SALIDA)) {
    try { detalle = JSON.parse(fs.readFileSync(SALIDA, 'utf8')); } catch (e) {}
  }
  let contador = 0;
  let procesados = new Set(Object.keys(detalle));
  if (fs.existsSync(PROG)) { try { procesados = new Set(JSON.parse(fs.readFileSync(PROG, 'utf8')).procesados || []); } catch (e) {} }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-MX' });
  const page = await context.newPage();

  let fallos = 0;
  for (let i = 0; i < productos.length; i++) {
    const prod = productos[i];
    if (!prod.enlace) { contador++; continue; }
    if (procesados.has(prod.enlace)) { contador++; continue; }

    try {
      await page.goto(prod.enlace, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await sleep(900);

      const ficha = await extraerFicha(page);
      // Combinar datos del barrido (categoria/subcategoria/slug) con la ficha detallada
      detalle[prod.enlace] = {
        enlace: prod.enlace,
        categoria: prod.categoria,
        subcategoria: prod.subcategoria,
        slug: prod.slug,
        existenciasLista: prod.existencias,
        ...ficha,
      };
      procesados.add(prod.enlace);
      contador++;

      if (contador % 25 === 0) {
        console.log(`  [${contador}/${productos.length}] ${ficha.referencia || ''} ${ficha.nombre}`);
        fs.writeFileSync(SALIDA, JSON.stringify(detalle, null, 2), 'utf8');
        fs.writeFileSync(PROG, JSON.stringify({ procesados: Array.from(procesados), total: contador }), 'utf8');
      }
    } catch (e) {
      fallos++;
      detalle[prod.enlace] = { ...prod, error: e.message.split('\n')[0] };
      if (fallos % 10 === 0) console.log(`  ⚠ fallo #${fallos}: ${prod.enlace} -> ${e.message.split('\n')[0]}`);
      await sleep(1000);
    }
  }

  // Guardar final + mapa de imágenes
  fs.writeFileSync(SALIDA, JSON.stringify(detalle, null, 2), 'utf8');
  const mapaImgs = Object.values(detalle).map((d) => ({
    referencia: d.referencia,
    nombre: d.nombre,
    enlace: d.enlace,
    categoria: d.categoria,
    subcategoria: d.subcategoria,
    imagenPrincipal: d.imagenPrincipal,
    imagenesGaleria: d.imagenesGaleria || [],
    vista360: d.vista360 || '',
  }));
  fs.writeFileSync(IMGS, JSON.stringify(mapaImgs, null, 2), 'utf8');

  console.log(`\n========== ETAPA 2/3 COMPLETADA ==========`);
  console.log(`Productos procesados: ${contador}`);
  console.log(`Fallos: ${fallos}`);
  console.log(`💾 productos_detalle.json`);
  console.log(`💾 imagenes_productos.json`);
  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
