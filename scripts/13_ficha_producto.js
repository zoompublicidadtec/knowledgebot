// Diagnóstico ETAPA 2: inspeccionar la ficha DETALLADA de un producto.
// Producto muestra: Llavero con Nivelador Magnet -> /p/.../11129/19

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://www.catalogospromocionales.com/p/Llavero-con-Nivelador-Magnet/11129/19';
const DATA_DIR = path.resolve('D:/KNOWLEDGE ZOOM PUBLICIDAD/data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA, locale: 'es-MX' });
  const page = await context.newPage();
  console.log('▶ Ficha de producto:', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  fs.writeFileSync(path.join(DATA_DIR, 'ficha_producto_muestra.html'), await page.content(), 'utf8');
  await page.screenshot({ path: path.join(DATA_DIR, 'ficha_producto_muestra.png'), fullPage: true });

  // Extraer toda la información visible estructurada
  const data = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    // Título / nombre
    const h1 = document.querySelector('h1, h2.detalle, .tituloProducto');
    // Referencia
    const ref = document.querySelector('.ref, .referencia, [class*="ref"]');
    // Descripción
    const desc = document.querySelector('.descripcion, .detalle, [class*="descripcion"]');
    // Tabla de especificaciones
    const specs = {};
    document.querySelectorAll('table tr, .especificaciones tr, .ficha tr').forEach((tr) => {
      const celdas = tr.querySelectorAll('td, th');
      if (celdas.length >= 2) {
        specs[limpiar(celdas[0].textContent)] = limpiar(celdas[1].textContent);
      }
    });
    // Listas de specs (dt/dd o li)
    const dts = document.querySelectorAll('dt'); const dds = document.querySelectorAll('dd');
    const listaSpecs = {};
    dts.forEach((dt, i) => { if (dds[i]) listaSpecs[limpiar(dt.textContent)] = limpiar(dds[i].textContent); });
    // Imágenes (galería)
    const imgs = [...new Set(Array.from(document.querySelectorAll('img[src*="productos"], img[src*="imagen"], .galeria img, .thumbs img')).map((i) => i.src))];
    // Colores disponibles
    const colores = Array.from(document.querySelectorAll('.btnColor, [class*="color"]')).map((c) => ({ clase: c.className, texto: limpiar(c.textContent), title: c.title }));
    // Área de impresión / medidas
    const impresion = document.querySelector('[class*="impresion"], [class*="grabado"], [class*="area"]');
    // Precios (si visibles)
    const precios = Array.from(document.querySelectorAll('[class*="precio"], .price')).map((p) => limpiar(p.textContent));

    // Capturar TODO el texto del cuerpo para análisis
    const bodyText = limpiar(document.body.innerText).slice(0, 2000);

    return {
      titulo: limpiar(h1 ? h1.textContent : ''),
      referencia: limpiar(ref ? ref.textContent : ''),
      descripcion: limpiar(desc ? desc.textContent : '').slice(0, 800),
      specsTabla: specs,
      specsLista: listaSpecs,
      imagenes: imgs,
      colores: colores.slice(0, 20),
      precios: precios.slice(0, 6),
      bodyText,
    };
  });

  console.log('\n========== FICHA DE PRODUCTO ==========');
  console.log('Título     :', data.titulo);
  console.log('Referencia :', data.referencia);
  console.log('Descripción:', data.descripcion);
  console.log('Specs (tabla):', JSON.stringify(data.specsTabla, null, 2));
  console.log('Specs (lista):', JSON.stringify(data.specsLista, null, 2));
  console.log('Imágenes   :', data.imagenes.length);
  data.imagenes.forEach((i) => console.log('   -', i));
  console.log('Colores    :', data.colores.length);
  data.colores.slice(0, 8).forEach((c) => console.log('   -', c.clase, '|', c.title, '|', c.texto.slice(0, 30)));
  console.log('Precios    :', data.precios);

  console.log('\n--- TEXTO COMPLETO (primeros 2000 chars) ---');
  console.log(data.bodyText);

  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
