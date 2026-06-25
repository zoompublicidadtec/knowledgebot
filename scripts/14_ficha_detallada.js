// Diagnóstico ETAPA 2 (parte 2): inspeccionar la GALERÍA de imágenes y tabla de inventario.
// El objetivo es capturar TODAS las imágenes de cada producto y su inventario detallado.

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
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);

  const data = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const norm = (t) => limpiar(t).replace(/\u00a0/g, ' ');

    // ---- Nombre, referencia, descripción ----
    const h2 = document.querySelector('.hola h2, h2.detalle');
    const ref = document.querySelector('.prodRef, p.prodRef');
    const descr = document.querySelector('.prodDescr, p.prodDescr');
    // Parsear medidas y marca desde la descripción
    let medidas = '', marca = '', fichaPdf = '';
    if (descr) {
      const txt = descr.innerHTML;
      const mMed = descr.textContent.match(/Medidas:\s*([^.]+)/i);
      if (mMed) medidas = limpiar(mMed[1]);
      const mMar = descr.textContent.match(/Marca:\s*([^.]+)/i);
      if (mMar) marca = limpiar(mMar[1]);
      const pdfA = descr.querySelector('a[href*=".pdf"], a[href*="FICHAS"]');
      if (pdfA) fichaPdf = pdfA.href;
    }

    // ---- Tabla de empaque ----
    const embalaje = {};
    document.querySelectorAll('.tableEmbalaje table tr, .table-list tr').forEach((tr) => {
      const tds = tr.querySelectorAll('td');
      if (tds.length >= 2) embalaje[norm(tds[0].textContent).replace(/:$/, '')] = norm(tds[1].textContent);
    });

    // ---- Inventario por color/bodega (tablaInfoProd) ----
    const inventario = [];
    const tablaInv = document.querySelector('.tableInfoProd');
    if (tablaInv) {
      const headers = Array.from(tablaInv.querySelectorAll('thead th, tr:first-child th')).map((th) => norm(th.textContent));
      tablaInv.querySelectorAll('tbody tr').forEach((tr) => {
        const tds = Array.from(tr.querySelectorAll('td')).map((td) => norm(td.textContent));
        if (tds.length > 1) inventario.push(tds);
      });
      dataInv = { headers, filas: inventario };
    }

    // ---- Galería de imágenes ----
    // Buscar contenedor de galería (suele haber thumbnails + imagen principal)
    const galeria = [];
    document.querySelectorAll('img[src*="/images/productos"]').forEach((img) => {
      galeria.push({ src: img.src, alt: norm(img.alt) });
    });
    // imagen principal grande
    const imgPrincipal = document.querySelector('.imgPrincipal img, .imagenPrincipal img, #zoom img, a.fancybox img');

    return {
      nombre: norm(h2 ? h2.textContent : ''),
      referencia: norm(ref ? ref.textContent : ''),
      descripcion: norm(descr ? descr.textContent : ''),
      medidas, marca, fichaPdf,
      embalaje,
      inventarioHeaders: tablaInv ? Array.from(tablaInv.querySelectorAll('th')).map((th) => norm(th.textContent)) : [],
      inventarioFilas: inventario,
      imagenes: galeria,
    };
  });

  console.log('========== FICHA DETALLADA ==========');
  console.log('Nombre      :', data.nombre);
  console.log('Referencia  :', data.referencia);
  console.log('Descripción :', data.descripcion);
  console.log('Medidas     :', data.medidas);
  console.log('Marca/técn  :', data.marca);
  console.log('Ficha PDF   :', data.fichaPdf);
  console.log('Embalaje    :', JSON.stringify(data.embalaje, null, 2));
  console.log('Inv headers :', data.inventarioHeaders);
  console.log('Inv filas   :', JSON.stringify(data.inventarioFilas, null, 2));
  console.log('Imágenes    :', data.imagenes.length);
  data.imagenes.forEach((i) => console.log('   -', i.src, '|', i.alt));

  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
