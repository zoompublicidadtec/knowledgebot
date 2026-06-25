// ETAPA 1 - Reconocimiento de la página 1
// Objetivo: barrer categorías, subcategorías y contar productos del catálogo.
// Salida: data/01_reconocimiento.json + reporte en consola.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://www.catalogospromocionales.com/seccion/subcategorias.html';
const OUT_DIR = path.resolve(__dirname, '..', 'data');
const OUT_FILE = path.join(OUT_DIR, '01_reconocimiento.json');

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

  console.log('▶ Cargando:', TARGET_URL);
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Dar tiempo a que el menú/listado se construya
  await page.waitForLoadState('networkidle').catch(() => {});

  // Screenshot de diagnóstico
  await page.screenshot({
    path: path.join(OUT_DIR, '01_subcategorias_full.png'),
    fullPage: true,
  });
  console.log('📸 Screenshot guardado: data/01_subcategorias_full.png');

  // Guardar HTML completo para inspección offline
  const html = await page.content();
  fs.writeFileSync(path.join(OUT_DIR, '01_subcategorias.html'), html, 'utf8');
  console.log('📄 HTML guardado: data/01_subcategorias.html (', (html.length / 1024).toFixed(1), 'KB )');

  // ------------------------------------------------------------------
  // Extracción de la estructura desde el DOM.
  // Probamos varios selectores porque el sitio puede usar distintas marcas.
  // ------------------------------------------------------------------
  const estructura = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();

    // Capturar TODOS los enlaces internos relevantes para análisis posterior
    const todosLosLinks = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => ({
        texto: limpiar(a.textContent),
        href: a.href,
        title: a.getAttribute('title') || '',
      }))
      .filter((l) => l.href && !l.href.startsWith('javascript:'));

    // Buscar bloques que parezcan categoría con subcategorías.
    // Estrategia A: encabezados h2/h3/h4 seguidos de listas de enlaces.
    const categoriasA = [];
    const headings = document.querySelectorAll('h2, h3, h4, .titulo, .categoria');
    headings.forEach((h) => {
      const nombreCat = limpiar(h.textContent);
      if (!nombreCat) return;
      // subcategorías: enlaces dentro del contenedor hermano
      let contenedor = h.parentElement;
      const subs = new Set();
      if (contenedor) {
        contenedor
          .querySelectorAll('a[href]')
          .forEach((a) => {
            const t = limpiar(a.textContent);
            if (t && t !== nombreCat) subs.add(JSON.stringify({ texto: t, href: a.href }));
          });
      }
      if (subs.size > 0) {
        categoriasA.push({ nombre: nombreCat, subcategorias: Array.from(subs).map((s) => JSON.parse(s)) });
      }
    });

    // Estrategia B: contar imágenes de producto (thumbnails típicos)
    const imagenesProducto = document.querySelectorAll(
      'img[src*="producto"], img[src*="thumb"], img.producto, .producto img'
    ).length;

    // Estrategia C: links hacia fichas de producto
    const linksProducto = todosLosLinks.filter((l) =>
      /producto|detalle|ficha|item/i.test(l.href + ' ' + l.texto)
    );

    return {
      tituloPagina: document.title,
      url: location.href,
      totalLinks: todosLosLinks.length,
      muestraLinks: todosLosLinks.slice(0, 40),
      categoriasEstrategiaA: categoriasA,
      linksHaciaProductos: linksProducto.length,
      muestraLinksProductos: linksProducto.slice(0, 30),
      imagenesProductoDetectadas: imagenesProducto,
    };
  });

  // ------------------------------------------------------------------
  // Guardar resultado
  // ------------------------------------------------------------------
  fs.writeFileSync(OUT_FILE, JSON.stringify(estructura, null, 2), 'utf8');

  console.log('\n========== REPORTE DE RECONOCIMIENTO ==========');
  console.log('Título página:', estructura.tituloPagina);
  console.log('URL final     :', estructura.url);
  console.log('Total de enlaces en la página:', estructura.totalLinks);
  console.log('Categorías detectadas (estrategia A):', estructura.categoriasEstrategiaA.length);
  console.log('Links hacia productos:', estructura.linksHaciaProductos);
  console.log('Imágenes de producto detectadas:', estructura.imagenesProductoDetectadas);

  console.log('\n--- Primeras categorías (estrategia A) ---');
  estructura.categoriasEstrategiaA.slice(0, 12).forEach((c, i) => {
    console.log(`${i + 1}. ${c.nombre}  -> ${c.subcategorias.length} subcategorías`);
  });

  console.log('\n✅ Datos completos en:', OUT_FILE);
  await browser.close();
})().catch((e) => {
  console.error('❌ Error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
