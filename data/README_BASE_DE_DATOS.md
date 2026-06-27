# Base de datos de productos — catalogospromocionales.com

Generado: 2026-06-25T12:30:03.087Z
Fuente: https://www.catalogospromocionales.com/seccion/subcategorias.html
Acceso: sesión de distribuidor (para precios)

## Resumen

| Métrica | Valor |
|---|---|
| Productos extraídos | 6790 |
| Con nombre | 6787 |
| Con medidas | 5967 |
| Con precio | 6770 |
| Con imagen | 6787 |
| Categorías | 27 |
| Subcategorías | 115 |

## Archivos

- **catalogo_productos.csv** — archivo principal (Excel). Campos separados por coma, con BOM.
- **catalogo_productos.tsv** — mismo contenido separado por tabulador (más seguro para textos largos).
- **productos_detalle.json** — datos crudos en JSON (estructura completa por producto).
- **imagenes_productos.json** — mapa producto → imágenes.
- **indice_imagenes.csv** — índice de carpetas de imágenes descargadas.
- **estructura_catalogo.json** — árbol categorías → subcategorías → productos.
- **INFORME_CONTEO_ETAPA1.txt** — conteo detallado por categoría/subcategoría.
- **images/** — carpeta con las imágenes de cada producto (una subcarpeta por producto).

## Campos (columnas)

- **referencia**
- **nombre**
- **categoria**
- **subcategoria**
- **descripcion**
- **medidas**
- **marca_tecnica**
- **precio**
- **precio_fecha**
- **embalaje**
- **inventario**
- **ficha_pdf**
- **imagen_principal**
- **imagenes_galeria**
- **vista360**
- **existencias_lista**
- **aplicador_logo**
- **enlace**

## Notas

- Cada fila representa un producto único (desduplicado por enlace).
- **precio**: precio público; puede ser fijo (`$9.200`) o tabla escalonada por cantidad.
- `imagenes_galeria` puede contener varias URLs separadas por ` | `.
- `inventario` contiene filas "color:bodegaLocal:bodegaZF:total:..." separadas por ` | `.
- `ficha_pdf` es el enlace al PDF de ficha técnica oficial del producto.
- `vista360` es el enlace a la vista 360° interactiva cuando existe.
- En `images/<REF>__<nombre>/` está la imagen principal y la galería de ese producto.
