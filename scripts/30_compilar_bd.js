// COMPILACIÓN FINAL - Genera el archivo plano estructurado (catalogo_productos.csv)
// y un README con el resumen, a partir de productos_detalle.json.
// Cada fila = un producto con TODOS sus campos aplanados.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve('D:/KNOWLEDGE ZOOM PUBLICIDAD/data');
const DETALLE = path.join(DATA_DIR, 'productos_detalle.json');
const OUT_CSV = path.join(DATA_DIR, 'catalogo_productos.csv');
const OUT_TSV = path.join(DATA_DIR, 'catalogo_productos.tsv');
const README = path.join(DATA_DIR, 'README_BASE_DE_DATOS.md');

const escCsv = (v) => {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\n\r;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
};

const detalle = JSON.parse(fs.readFileSync(DETALLE, 'utf8'));
const items = Object.values(detalle);

// Aplanar inventario y embalaje a strings
const aplanar = (p) => {
  const inv = p.inventario && p.inventario.filas
    ? p.inventario.filas.map((f) => f.join(':')).join(' | ')
    : '';
  const emb = p.embalaje ? Object.entries(p.embalaje).map(([k, v]) => `${k}: ${v}`).join(' | ') : '';
  return {
    referencia: p.referencia || '',
    nombre: p.nombre || '',
    categoria: p.categoria || '',
    subcategoria: p.subcategoria || '',
    descripcion: p.descripcionCompleta || '',
    medidas: p.medidas || '',
    marca_tecnica: p.marca || '',
    ficha_pdf: p.fichaPdf || '',
    embalaje: emb,
    inventario: inv,
    imagen_principal: p.imagenPrincipal || '',
    imagenes_galeria: (p.imagenesGaleria || []).join(' | '),
    vista360: p.vista360 || '',
    enlace: p.enlace || '',
    existencias_lista: p.existenciasLista || '',
    aplicador_logo: p.aplicadorLogo || '',
  };
};

const columnas = [
  'referencia', 'nombre', 'categoria', 'subcategoria', 'descripcion', 'medidas',
  'marca_tecnica', 'embalaje', 'inventario', 'ficha_pdf', 'imagen_principal',
  'imagenes_galeria', 'vista360', 'existencias_lista', 'aplicador_logo', 'enlace',
];

const filas = items.map(aplanar);

// CSV
const csv = [columnas.join(','), ...filas.map((f) => columnas.map((c) => escCsv(f[c])).join(','))].join('\n');
fs.writeFileSync(OUT_CSV, '\ufeff' + csv, 'utf8'); // BOM para Excel

// TSV (tab-separated, más robusto para texto largo)
const tsv = [columnas.join('\t'), ...filas.map((f) => columnas.map((c) => escCsv(f[c])).join('\t'))].join('\n');
fs.writeFileSync(OUT_TSV, '\ufeff' + tsv, 'utf8');

// README / resumen
const conNombre = filas.filter((f) => f.nombre).length;
const conMedidas = filas.filter((f) => f.medidas).length;
const conImg = filas.filter((f) => f.imagen_principal).length;
const cats = new Set(filas.map((f) => f.categoria).filter(Boolean));
const subs = new Set(filas.map((f) => f.subcategoria).filter(Boolean));

const md = `# Base de datos de productos — catalogospromocionales.com

Generado: ${new Date().toISOString()}

## Resumen

| Métrica | Valor |
|---|---|
| Productos extraídos | ${filas.length} |
| Con nombre | ${conNombre} |
| Con medidas | ${conMedidas} |
| Con imagen | ${conImg} |
| Categorías | ${cats.size} |
| Subcategorías | ${subs.size} |

## Archivos

- **catalogo_productos.csv** — archivo principal (Excel). Campos separados por coma.
- **catalogo_productos.tsv** — mismo contenido separado por tabulador (más seguro para textos largos).
- **productos_detalle.json** — datos crudos en JSON (estructura completa por producto).
- **imagenes_productos.json** — mapa producto → imágenes.
- **estructura_catalogo.json** — árbol categorías → subcategorías → productos.

## Campos (columnas)

${columnas.map((c) => `- **${c}**`).join('\n')}

## Notas

- Cada fila representa un producto único (desduplicado por enlace).
- \`imagenes_galeria\` puede contener varias URLs separadas por \` | \`.
- \`inventario\` contiene filas "color:bodegaLocal:bodegaZF:total:..." separadas por \` | \`.
- \`ficha_pdf\` es el enlace al PDF de ficha técnica oficial del producto.
- \`vista360\` es el enlace a la vista 360° interactiva cuando existe.
`;
fs.writeFileSync(README, md, 'utf8');

console.log(`✅ Compilación completa:
  ${filas.length} productos
  ${OUT_CSV}
  ${OUT_TSV}
  ${README}`);
