// Diagnóstico 3: ¿cuándo y cómo se puebla el datalist de productos?
// Monitoriza pnlDatalist segundo a segundo y prueba disparar el postback.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const TARGET_URL = 'https://www.catalogospromocionales.com/promocionales/boligrafo-con-resaltador.html';
const DATA_DIR = path.resolve('D:/KNOWLEDGE ZOOM PUBLICIDAD/data');

const medir = async (page) =>
  page.evaluate(() => {
    const dl = document.getElementById('ctl00_ContentPlaceHolder1_pnlDatalist');
    const totalLinks = document.querySelectorAll('a[href*="/catalogo/producto/"]').length;
    return {
      datalistExiste: !!dl,
      datalistHTML_len: dl ? dl.innerHTML.length : 0,
      totalLinksProducto: totalLinks,
    };
  });

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

  console.log('▶ Cargando página (domcontentloaded)...');
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Monitor durante 12s
  console.log('\n--- Monitoreo cada 1s durante 12s ---');
  for (let i = 1; i <= 12; i++) {
    await page.waitForTimeout(1000);
    const m = await medir(page);
    console.log(`  t=${i}s | datalist=${m.datalistHTML_len} bytes | linksProd=${m.totalLinksProducto}`);
    if (m.datalistHTML_len > 600) {
      console.log('  ⚑ datalist se pobló!');
      break;
    }
  }

  // Capturar HTML del datalist tal cual
  const dlHtml = await page.evaluate(() => {
    const dl = document.getElementById('ctl00_ContentPlaceHolder1_pnlDatalist');
    return dl ? dl.outerHTML : 'NO EXISTE';
  });
  fs.writeFileSync(path.join(DATA_DIR, 'diag3_datalist.html'), dlHtml, 'utf8');
  console.log('\n💾 datalist outerHTML guardado en diag3_datalist.html (', dlHtml.length, 'bytes )');

  // Disparar el postback del botón "Todos" de forma nativa (WebForms)
  console.log('\n▶ Disparando __doPostBack del pager...');
  const antesPostback = await medir(page);
  await page.evaluate(() => {
    if (typeof theForm !== 'undefined' && typeof __doPostBack === 'function') {
      __doPostBack('ctl00$ContentPlaceHolder1$Todos', '');
    }
  });
  // Esperar a que el UpdatePanel recargue
  try {
    await page.waitForLoadState('networkidle', { timeout: 15000 });
  } catch (e) {}
  await page.waitForTimeout(3000);

  for (let i = 1; i <= 6; i++) {
    const m = await medir(page);
    console.log(`  postback t=${i}s | datalist=${m.datalistHTML_len} bytes | linksProd=${m.totalLinksProducto}`);
    if (m.datalistHTML_len > 600) break;
    await page.waitForTimeout(1000);
  }

  const despuesPostback = await medir(page);
  console.log('\nAntes postback :', JSON.stringify(antesPostback));
  console.log('Después postback:', JSON.stringify(despuesPostback));

  // Guardar HTML completo final
  fs.writeFileSync(path.join(DATA_DIR, 'diag3_final.html'), await page.content(), 'utf8');

  // Extraer TODOS los links de producto visibles y sus nombres
  const prods = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const vistos = new Set();
    const out = [];
    document.querySelectorAll('a[href*="/catalogo/producto/"]').forEach((a) => {
      if (vistos.has(a.href)) return;
      vistos.add(a.href);
      const img = a.querySelector('img');
      out.push({ href: a.href, texto: limpiar(a.textContent), imgAlt: img ? img.alt : '', imgSrc: img ? img.src : '' });
    });
    return out;
  });
  console.log('\nProductos únicos detectados:', prods.length);
  prods.forEach((p) => console.log('  -', p.href, '|', p.texto || p.imgAlt));

  await browser.close();
})().catch((e) => { console.error('❌', e.message); console.error(e.stack); process.exit(1); });
