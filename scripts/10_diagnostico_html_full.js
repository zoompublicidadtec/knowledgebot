// Diagnóstico 8: Guardar y analizar el HTML completo de la página de categoría.
// Buscar mensajes de "sesión", scripts anti-bot, y dónde están las 13 clases *prod*.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL = 'https://www.catalogospromocionales.com/Catalogo/Default.aspx?id=19&Page=1';
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
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(3000);

  // Guardar HTML completo
  const html = await page.content();
  fs.writeFileSync(path.join(DATA_DIR, 'diag8_categoria_full.html'), html, 'utf8');
  console.log('HTML completo:', html.length, 'bytes');

  // Buscar elementos con clase que contenga "prod"
  const prods = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    return Array.from(document.querySelectorAll('[class*="prod"]')).map((el) => ({
      tag: el.tagName,
      clase: el.className,
      id: el.id,
      texto: limpiar(el.textContent).slice(0, 80),
      hijos: el.children.length,
    }));
  });
  console.log('\n=== Elementos [class*="prod"] (', prods.length, ') ===');
  prods.forEach((p, i) => console.log(`  ${i + 1}. <${p.tag} class="${p.clase}" id="${p.id}"> hijos=${p.hijos} | ${p.texto}`));

  // Buscar mensajes de sesión/login
  const loginHints = await page.evaluate(() => {
    const txt = document.body.innerText || '';
    const lineas = txt.split('\n').map((l) => l.trim()).filter((l) =>
      /sesi[oó]n|registr|logue|distribuidor|acceso|permiso|iniciar|denegad|login|sign in|verificar/i.test(l)
    );
    return lineas.slice(0, 10);
  });
  console.log('\n=== Pistas de login/sesión ===');
  loginHints.forEach((l) => console.log('  -', l));

  // Buscar el contenido del div principal de contenido
  const mainContent = await page.evaluate(() => {
    const limpiar = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const main = document.getElementById('ctl00_divMainTable') || document.querySelector('.backTable') || document.querySelector('.bg_content');
    return main ? { len: main.innerHTML.length, texto: limpiar(main.textContent).slice(0, 500) } : null;
  });
  console.log('\n=== Contenido principal ===');
  console.log(JSON.stringify(mainContent, null, 2));

  await browser.close();
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
