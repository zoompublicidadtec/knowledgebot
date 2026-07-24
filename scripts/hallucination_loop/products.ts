/**
 * ============================================================================
 * PRODUCTS.TS — Seed de categorías y variantes de pregunta
 * ============================================================================
 * Define las 5 categorías representativas que cubren los 4 tipos de lógica de
 * precio del catálogo (las más propensas a disparar falsos positivos del
 * guardrail). Cada categoría lleva términos de búsqueda reales del catálogo
 * y 4 variantes de pregunta (formal, jerga colombiana, con cantidad, ambigua).
 *
 * El loop usará los `searchTerms` para extraer productos REALES de Supabase,
 * y generará una pregunta por cada variante. Ningún término aquí es inventado:
 * provienen del Excel "PRECIOS Y PRODUCTOS JUNIO 11 2026".
 * ============================================================================
 */

export interface QuestionVariant {
  /** Etiqueta para el reporte (qué tipo de presión ejerce la pregunta). */
  label: 'formal' | 'jerga_col' | 'con_cantidad' | 'ambigua';
  /** Texto exacto que se inyecta por runAgentForMessage. */
  text: string;
}

export interface CategorySeed {
  /** Nombre comercial de la categoría para el reporte. */
  name: string;
  /** Por qué lógica de precio es propensa a disparar el guardrail. */
  pricingLogic: 'compuesto' | 'millares' | 'area' | 'volumen' | 'diversidad';
  /**
   * Términos de búsqueda reales que catalog_probe usará contra Supabase
   * (nombre ILIKE / search_text). El primero es el principal.
   */
  searchTerms: string[];
  /** Cantidad típica que un cliente real pediría (para la variante con_cantidad). */
  typicalQuantity: number;
  /** Las 4 variantes de pregunta. */
  variants: QuestionVariant[];
}

export const CATEGORY_SEEDS: CategorySeed[] = [
  // --------------------------------------------------------------------------
  // 1. CUADERNOS — precio compuesto (base + insertos × cantidad)
  //    Causa A de falsos positivos: los totales calculados no existen en price_tiers.
  // --------------------------------------------------------------------------
  {
    name: 'Cuadernos',
    pricingLogic: 'compuesto',
    searchTerms: ['cuaderno', 'cuadernos', 'libreta argollada'],
    typicalQuantity: 50,
    variants: [
      { label: 'formal', text: 'Hola, necesito cotizar cuadernos personalizados para mi empresa' },
      { label: 'jerga_col', text: 'Buenas, ando buscando unas libreticas para regalar en un evento' },
      { label: 'con_cantidad', text: 'Cotízame 50 cuadernos de 100 hojas tamaño 1/2 carta argollados' },
      { label: 'ambigua', text: 'Cuánto valen los cuadernos?' },
    ],
  },

  // --------------------------------------------------------------------------
  // 2. TARJETAS — venta por millares con mínimos especiales (1/4 carta = 2 millares)
  //    Matemática de normalización: qty/1000 → millares.
  // --------------------------------------------------------------------------
  {
    name: 'Tarjetas de Presentación',
    pricingLogic: 'millares',
    searchTerms: ['tarjeta', 'tarjetas', 'tarjetas de presentacion'],
    typicalQuantity: 1000,
    variants: [
      { label: 'formal', text: 'Requiero cotizar tarjetas de presentación para la compañía' },
      { label: 'jerga_col', text: 'Hola, necesito unas tarjetitas para el negocio' },
      { label: 'con_cantidad', text: 'Precio de 1000 tarjetas de presentación brillantes' },
      { label: 'ambigua', text: 'Cuánto cuestan las tarjetas?' },
    ],
  },

  // --------------------------------------------------------------------------
  // 3. DTF — área computada (orientación de rollo, totales atípicos)
  //    Requiere ancho x alto en cm. Totales como $45.000 no están en price_tiers.
  // --------------------------------------------------------------------------
  {
    name: 'DTF',
    pricingLogic: 'area',
    searchTerms: ['dtf', 'dtf textil', 'dtf uv'],
    typicalQuantity: 100,
    variants: [
      { label: 'formal', text: 'Necesito cotizar DTF para estampar camisetas con mi logo' },
      { label: 'jerga_col', text: 'Hola, quiero unas estampas para unas camisetas' },
      { label: 'con_cantidad', text: 'Cotiza 100 DTF textiles de 10x10 cm para mi marca' },
      { label: 'ambigua', text: 'Cuánto vale el DTF?' },
    ],
  },

  // --------------------------------------------------------------------------
  // 4. MUGS / POCILLOS — escalas de volumen estándar (baseline de funcionamiento)
  //    Debería ser la categoría que MENOS dispara el guardrail. Sirve de control.
  // --------------------------------------------------------------------------
  {
    name: 'Mugs / Pocillos',
    pricingLogic: 'volumen',
    searchTerms: ['mug', 'mugs', 'pocillo'],
    typicalQuantity: 50,
    variants: [
      { label: 'formal', text: 'Hola, deseo cotizar mugs personalizados para un evento corporativo' },
      { label: 'jerga_col', text: 'Buenas, necesito unos pocillos pal tinto con el logo de la empresa' },
      { label: 'con_cantidad', text: 'Cotiza 50 mugs de cerámica blanca de 11 onzas' },
      { label: 'ambigua', text: 'Cuánto valen los pocillos?' },
    ],
  },

  // --------------------------------------------------------------------------
  // 5. LLAVEROS — materiales múltiples (plastisol / pines / acrílico)
  //    Diversidad de variantes: el guardrail puede no resolver el product_id.
  // --------------------------------------------------------------------------
  {
    name: 'Llaveros',
    pricingLogic: 'diversidad',
    searchTerms: ['llavero', 'llaveros', 'llavero plastisol'],
    typicalQuantity: 100,
    variants: [
      { label: 'formal', text: 'Necesito cotizar llaveros promocionales para una campaña' },
      { label: 'jerga_col', text: 'Hola, ando buscando unos llaveritos para regalar' },
      { label: 'con_cantidad', text: 'Cotiza 100 llaveros plastisol de forma redonda' },
      { label: 'ambigua', text: 'Cuánto cuestan los llaveros?' },
    ],
  },
];
