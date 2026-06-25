// Genera el informe legible de conteo de ETAPA 1 (barrido).
// Salida: data/INFORME_CONTEO_ETAPA1.txt

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve('D:/KNOWLEDGE ZOOM PUBLICIDAD/data');
const datos = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'estructura_catalogo.json'), 'utf8'));

let lineas = [];
const sep = '═'.repeat(70);
const sep2 = '─'.repeat(70);

let totalSubs = 0;
let totalProdDeclarados = 0;
let totalProdExtraidos = 0;
let subsConProductos = 0;
let subsVacias = 0;

lineas.push(sep);
lineas.push('  INFORME DE CONTEO — ETAPA 1 (BARRIDO)');
lineas.push(`  Página: ${datos.pagina}`);
lineas.push(`  Fecha de extracción: ${datos.fechaExtraccion}`);
lineas.push(sep);
lineas.push('');
lineas.push(`  Total de categorías      : ${datos.totalCategorias}`);
lineas.push(`  Total de subcategorías   : ${datos.totalSubcategorias}`);
lineas.push(`  Productos únicos         : ${datos.totalProductosUnicos}`);
lineas.push('');
lineas.push(sep2);
lineas.push('  DESGLOSE POR CATEGORÍA Y SUBCATEGORÍA');
lineas.push('  (declarados = conteo oficial del sitio | extraídos = los que se obtuvieron)');
lineas.push(sep2);

datos.categorias.forEach((cat, i) => {
  let prodCat = 0;
  let subsCat = cat.subcategorias.length;
  cat.subcategorias.forEach((s) => { prodCat += (s.totalDeclarado || 0); });
  totalSubs += subsCat;

  lineas.push('');
  lineas.push(`  [${String(i + 1).padStart(2, '0')}] ${cat.categoria.toUpperCase()}`);
  lineas.push(`       ${subsCat} subcategoría(s) | ${prodCat} productos`);

  cat.subcategorias.forEach((s) => {
    const decl = s.totalDeclarado || 0;
    const extr = (s.productos || []).length;
    const id = s.idCategoria ? `id=${s.idCategoria}` : 'id=?';
    const pag = s.paginas ? `${s.paginas}p` : '?p';
    totalProdDeclarados += decl;
    totalProdExtraidos += extr;
    if (decl > 0) subsConProductos++; else subsVacias++;
    const marca = decl === extr ? '✓' : (decl > 0 ? '⚠' : ' ');
    lineas.push(`        ${marca} ${s.nombre.padEnd(42).slice(0, 42)} decl:${String(decl).padStart(4)} extr:${String(extr).padStart(4)}  ${id} ${pag}`);
  });
});

lineas.push('');
lineas.push(sep);
lineas.push('  RESUMEN GLOBAL');
lineas.push(sep);
lineas.push(`  Subcategorías con productos : ${subsConProductos}`);
lineas.push(`  Subcategorías vacías        : ${subsVacias}`);
lineas.push(`  Productos declarados (suma) : ${totalProdDeclarados.toLocaleString('es')}`);
lineas.push(`  Productos extraídos (suma)  : ${totalProdExtraidos.toLocaleString('es')}`);
lineas.push(`  Productos únicos (desdup)   : ${datos.totalProductosUnicos.toLocaleString('es')}`);
lineas.push('');
lineas.push('  NOTA: la suma de "declarados" pasa del total único porque algunos');
lineas.push('  productos aparecen en varias subcategorías (ej. "Todos" + subcategorías).');
lineas.push('  El conteo único (desduplicado por enlace) es el valor real del catálogo.');
lineas.push('');

const txt = lineas.join('\n');
fs.writeFileSync(path.join(DATA_DIR, 'INFORME_CONTEO_ETAPA1.txt'), txt, 'utf8');
console.log(txt);
