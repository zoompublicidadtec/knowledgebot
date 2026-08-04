'use client';

import React, { useState, useEffect, useTransition } from 'react';
import {
  BookBookmark,
  Plus,
  Trash,
  Pencil,
  Copy,
  MagnifyingGlass,
  X,
  FolderPlus,
  Tag,
  Check,
  Info,
  Sliders,
  WarningCircle,
  CurrencyDollar,
} from '@phosphor-icons/react';
import {
  getCatalog,
  getCategories,
  createCategory,
  getProductDetails,
  saveProduct,
  getGlosario,
  saveGlosarioItem,
  deleteGlosarioItem,
  saveCategorySynonyms,
  hardDeleteProduct,
  updateTierPrice,
  getServiciosYMarcaciones,
  getHojas,
  saveHojas,
  contarProductosPorCategoria,
} from './actions';
import { CatalogTable, type CatalogProduct, type SortField, type SortDir } from './components/CatalogTable';
import { BulkActionsBar } from './components/BulkActionsBar';
import { ImportExportPanel } from './components/ImportExportPanel';
import { CategoryTree, type TreeCategory } from './components/CategoryTree';

interface Subcategory {
  id: string;
  name: string;
  synonyms?: string | null;
}

interface Category {
  id: string;
  name: string;
  group_name: string | null;
  synonyms?: string | null;
  subcategories?: Subcategory[];
  requiresMigration?: boolean;
}

interface Product {
  id: string;
  category_id: string;
  subcategory_id?: string;
  name: string;
  reference: string | null;
  description: string | null;
  unit: string;
  price_includes_iva: boolean;
  min_order_qty: number | null;
  notes: string | null;
  active: boolean;
  search_text: string | null;
  image_url?: string | null;
}

interface PriceTier {
  id?: string;
  variant: string;
  min_qty: number;
  max_qty: number | null;
  price: number;
  price_basis: string;
}

interface GlosarioItem {
  id: string;
  content: string;
  metadata: {
    termino: string;
    significado: string;
  };
}

interface KnowledgeBaseClientProps {
  initialCategories: Category[];
}

/**
 * EL FORMULARIO DE PRECIOS TIENE QUE HABLAR EL IDIOMA DE LA UNIDAD ELEGIDA.
 *
 * Síntoma (02-ago-2026): «Intento crear un aviso exterior y no lo puedo
 * guardar, porque el panel solo guarda rangos de precio por volumen. Un aviso
 * no se compra por volumen sino por tamaño».
 *
 * La base de datos NO tenía el problema. `products.unit` ya acepta m2, metro y
 * millar; hay 19 productos guardados con m2; y el bot los cotiza bien: el
 * Banner Laminado (ZM-GEN-279) está a $30.000 el m² y para uno de 200x100 cm
 * responde $60.000. El modelo de datos se queda como está.
 *
 * Lo que fallaba eran las PALABRAS. Se elegía arriba «Unidad de medida: Metro
 * Cuadrado (m²)» y abajo seguía diciendo «Rangos de Precios por Volumen»,
 * «Cantidad Mínima» y «Cantidad Máxima». No había forma de adivinar que para
 * decir «$300.000 el metro cuadrado» hay que escribir: desde 1, hasta vacío,
 * precio 300000, unitario. El formulario solo sabía hablar de cantidades.
 */
interface IdiomaDePrecio {
  titulo: string;
  ayuda: string;
  boton: string;
  /** Frase visible que explica el caso de precio único. null = no hace falta. */
  pista: string | null;
  ejemploVariante: string;
  varianteInicial: string;
  desdeCorto: string;
  hastaCorto: string;
  desdeLargo: string;
  hastaLargo: string;
  /** Cómo se lee el precio en la ficha guardada: «$300.000 por m²». */
  seCobra: string;
}

/** El idioma de siempre: cantidades. Vale para unidad, servicio y paquete. */
const IDIOMA_POR_VOLUMEN: IdiomaDePrecio = {
  titulo: 'Rangos de Precios por Volumen',
  ayuda: 'Define cuánto cuesta el producto según la cantidad del pedido y técnica.',
  boton: 'Agregar Rango',
  pista: null,
  ejemploVariante: 'Variante (ej: Sin marca, Láser)',
  varianteInicial: 'Estándar',
  desdeCorto: 'Mín',
  hastaCorto: 'Máx (vacio = ∞)',
  desdeLargo: 'Cantidad mínima del rango',
  hastaLargo: 'Cantidad máxima (dejar vacío si no tiene límite)',
  seCobra: 'por unidad',
};

/** Las unidades que se cobran por medida, no por cantidad. */
const IDIOMA_POR_UNIDAD: Record<string, IdiomaDePrecio> = {
  m2: {
    titulo: 'Precio por metro cuadrado',
    ayuda: 'Define cuánto cuesta cada m² según el material o el acabado.',
    boton: 'Agregar tramo',
    pista: 'Para un precio único por m²: escribe 1 en «desde», deja «hasta» vacío, y pon el valor del metro cuadrado en la casilla con el signo $. Agrega más tramos solo si el m² cambia de precio según el tamaño.',
    ejemploVariante: 'Material o acabado (ej: Sin iluminación, Con LED interior, Backlight, Acrílico 5 mm)',
    varianteInicial: 'Precio por m²',
    desdeCorto: 'Desde',
    hastaCorto: 'Hasta',
    desdeLargo: 'Metros cuadrados desde',
    hastaLargo: 'Metros cuadrados hasta (dejar vacío si no tiene límite)',
    seCobra: 'por m²',
  },
  metro: {
    titulo: 'Precio por metro lineal',
    ayuda: 'Define cuánto cuesta cada metro según el material o el acabado.',
    boton: 'Agregar tramo',
    pista: 'Para un precio único por metro: escribe 1 en «desde», deja «hasta» vacío, y pon el valor del metro en la casilla con el signo $. Agrega más tramos solo si el metro cambia de precio según el largo.',
    ejemploVariante: 'Material o acabado (ej: Vinilo blanco, Reflectivo, Con instalación)',
    varianteInicial: 'Precio por metro',
    desdeCorto: 'Desde',
    hastaCorto: 'Hasta',
    desdeLargo: 'Metros lineales desde',
    hastaLargo: 'Metros lineales hasta (dejar vacío si no tiene límite)',
    seCobra: 'por metro',
  },
  millar: {
    titulo: 'Precio por millar',
    ayuda: 'Define cuánto cuesta cada millar (1.000 unidades) según la técnica.',
    boton: 'Agregar tramo',
    pista: 'Para un precio único por millar: escribe 1 en «desde», deja «hasta» vacío, y pon el valor del millar en la casilla con el signo $. Los tramos van en millares, no en unidades.',
    ejemploVariante: 'Variante (ej: Tiro, Tiro y retiro, Full color)',
    varianteInicial: 'Precio por millar',
    desdeCorto: 'Desde',
    hastaCorto: 'Hasta',
    desdeLargo: 'Millares desde',
    hastaLargo: 'Millares hasta (dejar vacío si no tiene límite)',
    seCobra: 'por millar',
  },
};

function idiomaDePrecio(unit: string): IdiomaDePrecio {
  return IDIOMA_POR_UNIDAD[unit] || IDIOMA_POR_VOLUMEN;
}

export default function KnowledgeBaseClient({ initialCategories }: KnowledgeBaseClientProps) {
  // Tabs State
  const [activeTab, setActiveTab] = useState<'catalog' | 'glossary' | 'marking' | 'hojas'>('catalog');
  const [services, setServices] = useState<any[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);

  // Hojas de categoria: la chuleta del asesor. Viven en
  // agent_configs.metadata.hojas, el mismo sitio que las cuentas de pago.
  const [hojas, setHojas] = useState<any[]>([]);
  const [loadingHojas, setLoadingHojas] = useState(false);
  const [guardandoHojas, setGuardandoHojas] = useState(false);
  const [msgHojas, setMsgHojas] = useState<string>('');
  // Cuantos productos activos tiene cada categoria: sirve para avisar que
  // una hoja no esta llegando a ningun producto.
  const [conteoPorCategoria, setConteoPorCategoria] = useState<Record<string, number>>({});

  // Categories State
  const [categories, setCategories] = useState<Category[]>(initialCategories);
  const [newCatName, setNewCatName] = useState('');
  const [newCatGroup, setNewCatGroup] = useState('');
  const [showAddCatModal, setShowAddCatModal] = useState(false);

  // Category Synonyms Modal State
  const [showCatSynonymsModal, setShowCatSynonymsModal] = useState(false);
  const [selectedCatForSynonyms, setSelectedCatForSynonyms] = useState<Category | null>(null);
  const [categorySynonymsValue, setCategorySynonymsValue] = useState('');
  const [savingCatSynonyms, setSavingCatSynonyms] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Catalog Filters / Paging
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // New: sorting, page size, selection (hitos 1 & 2)
  const [sort, setSort] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [pageSize, setPageSize] = useState<number>(50);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Product Form (Drawer)
  const [showDrawer, setShowDrawer] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, startSavingTransition] = useTransition();
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Form Fields
  const [productId, setProductId] = useState('');
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('unidad');
  const [priceIncludesIva, setPriceIncludesIva] = useState(false);
  const [minOrderQty, setMinOrderQty] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [synonyms, setSynonyms] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [priceTiers, setPriceTiers] = useState<PriceTier[]>([]);

  // Glossary State
  const [glosario, setGlosario] = useState<GlosarioItem[]>([]);
  const [loadingGlosario, setLoadingGlosario] = useState(false);
  const [showGlosarioModal, setShowGlosarioModal] = useState(false);
  const [editingGlosarioId, setEditingGlosarioId] = useState('');
  const [glosarioTermino, setGlosarioTermino] = useState('');
  const [glosarioSignificado, setGlosarioSignificado] = useState('');
  const [savingGlosario, setSavingGlosario] = useState(false);

  // Check if any category has requiresMigration flag active
  const dbNeedsMigration = categories.some(cat => cat.requiresMigration);

  // Search Debounce Effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load Products
  const loadProductsList = async () => {
    setLoadingProducts(true);
    try {
      const res = await getCatalog({
        page,
        limit: pageSize,
        search: debouncedSearch,
        categoryId: selectedCategoryId,
        sort,
        sortDir,
      });
      setProducts(res.products as Product[]);
      setTotalPages(res.totalPages);
      setTotalCount(res.totalCount);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'catalog') {
      loadProductsList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, selectedCategoryId, activeTab, sort, sortDir, pageSize]);

  // Load Glossary
  const loadGlossaryList = async () => {
    setLoadingGlosario(true);
    try {
      const items = await getGlosario();
      setGlosario(items as GlosarioItem[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingGlosario(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'glossary') {
      loadGlossaryList();
    }
  }, [activeTab]);

  const loadHojas = async () => {
    setLoadingHojas(true);
    try {
      setHojas((await getHojas()) as any[]);
      setConteoPorCategoria(await contarProductosPorCategoria());
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHojas(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'hojas' && hojas.length === 0) {
      loadHojas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Servicios y marcaciones (tarifas reales de la base, no escritas en el código)
  const loadServices = async () => {
    setLoadingServices(true);
    try {
      setServices(await getServiciosYMarcaciones());
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingServices(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'marking' && services.length === 0) {
      loadServices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Handle Edit Product
  /**
   * Abre el editor EN BLANCO para dar de alta un servicio nuevo.
   *
   * `saveProduct` siempre supo crear (su `id` es opcional), pero no habia
   * ningun boton que abriera el editor vacio: desde el panel solo se podian
   * editar los que ya existian. El dueno lo reporto el 01-ago-2026: "no tengo
   * ni idea de como editar estos servicios y mucho menos crear nuevos".
   */
  const handleCrearServicio = () => {
    setFormError('');
    setFormSuccess('');
    setProductId('');
    setName('');
    setReference('');
    setCategoryId('');
    setSubcategoryId('');
    setDescription('');
    setUnit('unidad');
    setPriceIncludesIva(false);
    setMinOrderQty(1);
    setNotes('');
    setActive(true);
    setImageUrl('');
    setSynonyms('');
    setPriceTiers([]);
    setIsEditing(false);
    setShowDrawer(true);
  };

  const handleEditProduct = async (prod: Product) => {
    setFormError('');
    setFormSuccess('');
    setLoadingProducts(true);
    try {
      const details = await getProductDetails(prod.id);
      
      setProductId(details.product.id);
      setName(details.product.name);
      setReference(details.product.reference || '');
      setCategoryId(details.product.category_id || '');
      setSubcategoryId(details.product.subcategory_id || '');
      setDescription(details.product.description || '');
      setUnit(details.product.unit);
      setPriceIncludesIva(details.product.price_includes_iva || false);
      setMinOrderQty(details.product.min_order_qty || 1);
      setNotes(details.product.notes || '');
      setActive(details.product.active);
      setImageUrl(details.product.image_url || '');
      
      // Extract specific product synonyms from search_text
      let extractedSynonyms = '';
      if (details.product.search_text && details.product.search_text.includes('Sinónimos Producto:')) {
        const match = details.product.search_text.match(/Sinónimos Producto:\s*([^.]+)\./);
        if (match && match[1]) {
          extractedSynonyms = match[1];
        }
      } else if (details.product.search_text && details.product.search_text.includes('Sinónimos:')) {
        const match = details.product.search_text.match(/Sinónimos:\s*([^.]+)\./);
        if (match && match[1]) {
          extractedSynonyms = match[1];
        }
      }
      setSynonyms(extractedSynonyms);

      // Cast price tiers
      setPriceTiers(details.priceTiers.map((t: any) => ({
        id: t.id,
        variant: t.variant,
        min_qty: Number(t.min_qty),
        max_qty: t.max_qty ? Number(t.max_qty) : null,
        price: Number(t.price),
        price_basis: t.price_basis,
      })));

      setIsEditing(true);
      setShowDrawer(true);
    } catch (err: any) {
      alert('Error cargando detalles del producto: ' + err.message);
    } finally {
      setLoadingProducts(false);
    }
  };

  // Subir imagen de producto desde el PC. Delega en /api/products/upload-image,
  // que la asocia de forma atomica (disco + BD + re-embed multimodal del RAG).
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permitir re-subir el mismo archivo
    if (!file) return;
    if (!productId || !reference) {
      setUploadError('Guarda primero el producto (necesita ID y referencia) para subirle una foto.');
      return;
    }
    setUploadingImage(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('productId', productId);
      fd.append('reference', reference);
      fd.append('name', name);
      const res = await fetch('/api/products/upload-image', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${res.status}`);
      }
      setImageUrl(data.imageUrl);
    } catch (err: any) {
      setUploadError(err.message || 'No se pudo subir la imagen.');
    } finally {
      setUploadingImage(false);
    }
  };

  // Reset Product Form
  const resetForm = () => {
    setProductId('');
    setName('');
    setReference('');
    setCategoryId(categories[0]?.id || '');
    setSubcategoryId('');
    setDescription('');
    setUnit('unidad');
    setPriceIncludesIva(false);
    setMinOrderQty(1);
    setNotes('');
    setActive(true);
    setSynonyms('');
    setImageUrl('');
    setPriceTiers([
      { variant: 'Estándar', min_qty: 1, max_qty: null, price: 0, price_basis: 'unitario' }
    ]);
    setIsEditing(false);
    setFormError('');
    setFormSuccess('');
  };

  // Handle Add Product
  const handleAddProductClick = () => {
    resetForm();
    setShowDrawer(true);
  };

  // Handle Duplicate Product
  const handleDuplicateProduct = () => {
    setProductId('');
    setName(prev => `${prev} (Copia)`);
    setIsEditing(false);
    setFormSuccess('Producto duplicado como borrador. Ajusta los precios y presiona Guardar.');
  };

  /** Las palabras que le tocan a la unidad elegida ahora mismo. */
  const idiomaPrecio = idiomaDePrecio(unit);

  /**
   * Al cambiar la unidad, deja la fila de precios preparada para esa unidad.
   *
   * Solo si la fila está EN BLANCO: una sola fila, sin precio escrito y con la
   * variante que puso el propio formulario. Nunca se pisa algo que el dueño ya
   * escribió, porque perder un precio tecleado es peor que un rótulo mal puesto.
   */
  const cambiarUnidad = (nuevaUnidad: string) => {
    setUnit(nuevaUnidad);
    const idioma = idiomaDePrecio(nuevaUnidad);
    setPriceTiers(prev => {
      if (prev.length !== 1) return prev;
      const fila = prev[0];
      const sinPrecio = !fila.price || Number(fila.price) === 0;
      const variantesQuePoneElPanel = [
        IDIOMA_POR_VOLUMEN.varianteInicial,
        ...Object.values(IDIOMA_POR_UNIDAD).map(i => i.varianteInicial),
        '',
      ];
      if (!sinPrecio || !variantesQuePoneElPanel.includes(fila.variant)) return prev;
      return [{ ...fila, variant: idioma.varianteInicial, min_qty: 1, max_qty: null }];
    });
  };

  // Price Tiers Row Handlers
  const addPriceTierRow = () => {
    setPriceTiers(prev => [
      ...prev,
      { variant: idiomaPrecio.varianteInicial, min_qty: 1, max_qty: null, price: 0, price_basis: 'unitario' }
    ]);
  };

  const removePriceTierRow = (index: number) => {
    setPriceTiers(prev => prev.filter((_, i) => i !== index));
  };

  const updatePriceTierRow = (index: number, field: keyof PriceTier, value: any) => {
    setPriceTiers(prev => prev.map((item, i) => {
      if (i === index) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  // Handle Save Product
  const handleSaveProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (!name.trim()) return setFormError('El nombre del producto es requerido.');
    if (!categoryId) return setFormError('La categoría es requerida.');
    
    // Validate price tiers
    for (const tier of priceTiers) {
      if (!tier.variant.trim()) return setFormError('La variante de precio es requerida.');
      if (tier.min_qty < 1) return setFormError('La cantidad mínima debe ser al menos 1.');
      /**
       * SIN PRECIO NO SE GUARDA.
       *
       * Antes solo se rechazaba un precio negativo, asi que un producto se
       * podia guardar con precio 0 y el bot lo habria cotizado en $0. Se
       * comprobo el 03-ago-2026: no hay NI UNA tarifa en 0 en todo el catalogo,
       * asi que exigirlo no deja fuera nada de lo que ya existe.
       */
      if (!tier.price || tier.price <= 0) {
        return setFormError(
          `Falta el precio de «${tier.variant || 'la primera fila'}». Va en la casilla con el signo $, no en «hasta».`
        );
      }
      if (tier.price < 0) return setFormError('El precio no puede ser negativo.');
    }

    startSavingTransition(async () => {
      const res = await saveProduct({
        id: productId || undefined,
        category_id: categoryId,
        subcategory_id: subcategoryId || undefined,
        name,
        reference,
        description,
        unit,
        price_includes_iva: priceIncludesIva,
        min_order_qty: minOrderQty,
        notes,
        active,
        synonyms,
        image_url: imageUrl || undefined
      }, priceTiers);

      if (res.success) {
        setFormSuccess('Producto guardado correctamente en Supabase.');
        if (!productId) {
          setProductId(res.productId!);
          setIsEditing(true);
        }
        loadProductsList();
      } else {
        setFormError(res.error || 'Error al guardar el producto.');
      }
    });
  };

  // ─── HARD DELETE (permanente) ───
  const handleHardDeleteProductClick = async (prod: Product) => {
    const label = prod.name + (prod.reference ? ` (${prod.reference})` : '');
    if (!confirm(`¿ELIMINAR DEFINITIVAMENTE "${label}"?\n\nSe borrará el producto y TODOS sus rangos de precio de forma permanente. Esta acción NO se puede deshacer.`)) return;
    const res = await hardDeleteProduct(prod.id);
    if (res.success) {
      setSelectedIds(prev => { const n = new Set(prev); n.delete(prod.id); return n; });
      loadProductsList();
    } else {
      alert('Error al eliminar: ' + res.error);
    }
  };

  // ─── SELECTION HANDLERS ───
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleSelectAll = (ids: string[]) => {
    setSelectedIds(prev => {
      const allSelected = ids.length > 0 && ids.every(i => prev.has(i));
      const n = new Set(prev);
      if (allSelected) ids.forEach(i => n.delete(i));
      else ids.forEach(i => n.add(i));
      return n;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  // ─── SORT HANDLER ───
  const handleSortChange = (field: SortField) => {
    if (field === sort) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field);
      setSortDir(field === 'active' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  // ─── INLINE PRICE SAVE ───
  const handleInlinePriceSave = async (tierId: string, newPrice: number): Promise<boolean> => {
    const res = await updateTierPrice(tierId, newPrice);
    if (res.success) {
      loadProductsList();
      return true;
    }
    alert('Error al guardar precio: ' + res.error);
    return false;
  };

  // ─── REFRESH CATEGORIES (used by CategoryTree mutations) ───
  const refreshCategories = async () => {
    const cats = await getCategories();
    setCategories(cats);
  };

  // ─── CATEGORY SYNONYMS HANDLERS ───
  const handleEditCategorySynonymsClick = (cat: Category) => {
    setSelectedCatForSynonyms(cat);
    setCategorySynonymsValue(cat.synonyms || '');
    setShowCatSynonymsModal(true);
  };

  const handleSaveCategorySynonymsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCatForSynonyms) return;

    setSavingCatSynonyms(true);
    try {
      const res = await saveCategorySynonyms(selectedCatForSynonyms.id, categorySynonymsValue.trim());
      if (res.success) {
        // Refresh categories
        const cats = await getCategories();
        setCategories(cats);
        setShowCatSynonymsModal(false);
        loadProductsList(); // Reload product search texts
      } else {
        alert('Error al guardar sinónimos de categoría: ' + res.error);
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setSavingCatSynonyms(false);
    }
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText("ALTER TABLE categories ADD COLUMN IF NOT EXISTS synonyms text;");
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  // ─── GLOSSARY HANDLERS ───
  const handleAddGlossaryClick = () => {
    setEditingGlosarioId('');
    setGlosarioTermino('');
    setGlosarioSignificado('');
    setShowGlosarioModal(true);
  };

  const handleEditGlossaryClick = (item: GlosarioItem) => {
    setEditingGlosarioId(item.id);
    setGlosarioTermino(item.metadata.termino);
    setGlosarioSignificado(item.metadata.significado);
    setShowGlosarioModal(true);
  };

  const handleSaveGlossarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!glosarioTermino.trim() || !glosarioSignificado.trim()) return;

    setSavingGlosario(true);
    try {
      const res = await saveGlosarioItem(
        glosarioTermino.trim(),
        glosarioSignificado.trim(),
        editingGlosarioId || undefined
      );

      if (res.success) {
        setShowGlosarioModal(false);
        loadGlossaryList();
      } else {
        alert('Error al guardar el término: ' + res.error);
      }
    } catch (err: any) {
      alert('Error inesperado: ' + err.message);
    } finally {
      setSavingGlosario(false);
    }
  };

  const handleDeleteGlossaryClick = async (id: string, termino: string) => {
    if (confirm(`¿Estás seguro de que deseas eliminar "${termino}" del glosario comercial? La IA ya no recordará esta regla.`)) {
      const res = await deleteGlosarioItem(id);
      if (res.success) {
        loadGlossaryList();
      } else {
        alert('Error al eliminar: ' + res.error);
      }
    }
  };

  // Category Creation Form inside modal
  const handleCreateCategorySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    const res = await createCategory(newCatName.trim(), newCatGroup.trim() || undefined);
    if (res.success) {
      const cats = await getCategories();
      setCategories(cats);
      setCategoryId(res.data!.id);
      setNewCatName('');
      setNewCatGroup('');
      setShowAddCatModal(false);
    } else {
      alert('Error al crear categoría: ' + res.error);
    }
  };

  return (
    <div className="space-y-6">
      {/* ⚠️ Migration Warning Banner */}
      {dbNeedsMigration && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-pulse-soft">
          <div className="flex items-start gap-2.5">
            <WarningCircle size={20} className="shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Acción pendiente en Supabase:</span>
              <span>Falta la columna 'synonyms' en la tabla de categorías. Por favor, ejecútala en tu editor SQL de Supabase para activar los Sinónimos por Categoría.</span>
            </div>
          </div>
          <button
            onClick={handleCopySql}
            className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition-all font-medium text-[11px] shrink-0 whitespace-nowrap"
          >
            {copiedSql ? '¡Copiado!' : 'Copiar Sentencia SQL'}
          </button>
        </div>
      )}

      {/* Tab Selectors */}
      <div className="flex border-b border-white/5 pb-px gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'catalog'
              ? 'border-primary-400 text-primary-400 bg-primary-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-white/10'
          }`}
        >
          <BookBookmark size={18} />
          Catálogo de Productos
        </button>
        <button
          onClick={() => setActiveTab('glossary')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'glossary'
              ? 'border-primary-400 text-primary-400 bg-primary-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-white/10'
          }`}
        >
          <Tag size={18} />
          Glosario Comercial y Sinónimos
        </button>
        <button
          onClick={() => setActiveTab('marking')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'marking'
              ? 'border-primary-400 text-primary-400 bg-primary-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-white/10'
          }`}
        >
          <Sliders size={18} />
          Precios de Marcación
        </button>
        <button
          onClick={() => setActiveTab('hojas')}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'hojas'
              ? 'border-primary-400 text-primary-400 bg-primary-950/20'
              : 'border-transparent text-slate-400 hover:text-white hover:border-white/10'
          }`}
        >
          <BookBookmark size={18} />
          Hojas de categoría
        </button>
      </div>

      {/* ─── TAB 1: CATALOG ─── */}
      {activeTab === 'catalog' && (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-fade-in">
          {/* LEFT: Category Sidebar (Desktop Only) — now full management tree */}
          <div className="hidden lg:block">
            <CategoryTree
              categories={categories as unknown as TreeCategory[]}
              selectedCategoryId={selectedCategoryId}
              totalCount={totalCount}
              onSelect={(id) => { setSelectedCategoryId(id); setPage(1); }}
              onCategoriesChanged={refreshCategories}
              onManageSynonyms={!dbNeedsMigration ? (cat) => handleEditCategorySynonymsClick(cat as unknown as Category) : undefined}
            />
          </div>

          {/* RIGHT: Search, Actions, Table */}
          <div className="lg:col-span-3 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              {/* Search Bar */}
              <div className="relative flex-1">
                <MagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                <input
                  type="text"
                  placeholder="Buscar por nombre, ref, descripción o sinónimo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-primary-500 transition-all"
                />
              </div>

              {/* Mobile Category Dropdown Filter */}
              <div className="flex gap-2 lg:hidden">
                <select
                  value={selectedCategoryId}
                  onChange={(e) => { setSelectedCategoryId(e.target.value); setPage(1); }}
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500"
                >
                  <option value="all">Todas las Categorías</option>
                  {categories.map(cat => (
                    <optgroup key={cat.id} label={cat.name}>
                      <option value={`cat-${cat.id}`}>General ({cat.name})</option>
                      {cat.subcategories?.map(sub => (
                        <option key={sub.id} value={`sub-${sub.id}`}>↳ {sub.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {selectedCategoryId !== 'all' && !dbNeedsMigration && (
                  <button
                    onClick={() => {
                      const cat = categories.find(c => c.id === selectedCategoryId);
                      if (cat) handleEditCategorySynonymsClick(cat);
                    }}
                    className="p-2 bg-slate-900 border border-white/10 rounded-xl text-slate-300 hover:text-white"
                    title="Sinónimos de categoría"
                  >
                    <Tag size={18} />
                  </button>
                )}
              </div>

              <button
                onClick={handleAddProductClick}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-medium text-sm transition-all"
              >
                <Plus size={16} />
                Agregar Producto
              </button>
            </div>

            {/* Page size selector + results summary */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Mostrar:</span>
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); setSelectedIds(new Set()); }}
                  className="px-2 py-1 rounded-lg bg-slate-900 border border-white/10 text-slate-200 text-xs focus:outline-none focus:border-primary-500"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span>por página</span>
              </div>
              {totalCount > 0 && (
                <span className="text-[11px]" style={{ color: 'rgba(148,163,184,0.5)' }}>
                  {totalCount.toLocaleString('es-CO')} producto(s) en total
                </span>
              )}
            </div>

            {/* Bulk actions bar — appears when rows are selected */}
            {selectedIds.size > 0 && (
              <BulkActionsBar
                selectedIds={selectedIds}
                onClear={clearSelection}
                onDone={loadProductsList}
                categories={categories.map(c => ({ id: c.id, name: c.name }))}
              />
            )}

            {/* Unified catalog table (desktop table + mobile cards) */}
            <CatalogTable
              products={products as unknown as CatalogProduct[]}
              totalCount={totalCount}
              page={page}
              totalPages={totalPages}
              loading={loadingProducts}
              sort={sort}
              sortDir={sortDir}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              onSortChange={handleSortChange}
              onPageChange={(p) => { setPage(p); setSelectedIds(new Set()); }}
              onEdit={(prod) => handleEditProduct(prod as unknown as Product)}
              onHardDelete={(prod) => handleHardDeleteProductClick(prod as unknown as Product)}
              onInlinePriceSave={handleInlinePriceSave}
            />
          </div>
        </div>

        {/* Import / Export Excel (full-width, below the grid) */}
        <ImportExportPanel
          categoryId={selectedCategoryId}
          onDone={loadProductsList}
        />
      </>
      )}
      {activeTab === 'glossary' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">Glosario de Términos y Jerga de Clientes</h3>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
                Enseña a la IA vocabulario o jerga de clientes (ej. "mil de presentación" = 1000 tarjetas de presentación) para que entienda el contexto comercial.
              </p>
            </div>
            <button
              onClick={handleAddGlossaryClick}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-medium text-sm transition-all whitespace-nowrap"
            >
              <Plus size={16} />
              Agregar Término
            </button>
          </div>

          {loadingGlosario ? (
            <div className="p-12 text-center text-slate-400 glass rounded-2xl">
              <div className="animate-spin inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full mb-3"></div>
              <p className="text-sm">Cargando glosario comercial...</p>
            </div>
          ) : glosario.length === 0 ? (
            <div className="p-12 text-center text-slate-400 glass rounded-2xl border border-white/5">
              <Tag size={40} className="mx-auto text-slate-500 mb-3" />
              <h4 className="text-sm font-medium text-white mb-1">Glosario vacío</h4>
              <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
                Agrega términos específicos de tu negocio para ayudar a la IA a comprender mejor las consultas de WhatsApp.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {glosario.map((item) => (
                <div key={item.id} className="glass p-4 rounded-xl border border-white/5 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-primary-400">
                      <Tag size={16} weight="fill" />
                      <span className="font-semibold text-sm">Término: "{item.metadata.termino}"</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      <strong className="text-white">Significado:</strong> {item.metadata.significado}
                    </p>
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                    <button
                      onClick={() => handleEditGlossaryClick(item)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 text-xs transition-all"
                    >
                      <Pencil size={12} />
                      Editar
                    </button>
                    <button
                      onClick={() => handleDeleteGlossaryClick(item.id, item.metadata.termino)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 text-xs transition-all"
                    >
                      <Trash size={12} />
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 3: MARKING PRICES ─── */}
      {activeTab === 'marking' && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-2xl">
              <h3 className="text-base font-semibold text-white">Servicios y Marcaciones</h3>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
                Lo que se cobra aparte del producto o combinado con él: marcaciones, impresión por
                área y componentes de cuaderno. Son las mismas tarifas que usa el bot para cotizar.
              </p>
              <p className="text-[11px] mt-2 text-slate-500">
                <strong className="text-slate-400">Para cambiar un precio:</strong> pulse
                «Editar tarifas» en el servicio y modifique la tabla de rangos.{' '}
                <strong className="text-slate-400">Para agregar uno nuevo:</strong> pulse
                «+ Nuevo servicio». Si un servicio queda sin tarifas, el bot no lo puede cotizar y
                aparece marcado en ámbar.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleCrearServicio}
                className="btn-primary py-1.5 px-3 text-xs rounded-lg"
              >
                + Nuevo servicio
              </button>
              <button
                onClick={loadServices}
                disabled={loadingServices}
                className="btn-ghost py-1.5 px-3 text-xs rounded-lg disabled:opacity-50"
              >
                {loadingServices ? 'Cargando...' : 'Recargar'}
              </button>
            </div>
          </div>

          {loadingServices && services.length === 0 && (
            <div className="text-center py-12 text-slate-500 text-sm">Leyendo las tarifas...</div>
          )}

          {!loadingServices && services.length === 0 && (
            <div className="glass p-6 rounded-2xl text-center text-sm text-slate-400">
              No hay servicios cargados todavía. Pulse «+ Nuevo servicio» para crear el primero.
            </div>
          )}

          {services.map((grp) => (
            <div key={grp.group} className="glass p-5 rounded-2xl border border-white/5 space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-2">
                <h4 className="font-semibold text-white flex items-center gap-2 text-sm">
                  <Sliders className="text-primary-400" size={18} />
                  {grp.group}
                </h4>
                <span className="text-[10px] text-slate-500 font-semibold uppercase">
                  {grp.items.length} servicio{grp.items.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="space-y-3">
                {grp.items.map((it: any) => {
                  const sinTarifa = !it.tiers || it.tiers.length === 0;
                  return (
                    <div
                      key={it.id}
                      className={`p-4 rounded-xl bg-white/2 border ${
                        sinTarifa ? 'border-amber-500/30' : 'border-white/5'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-semibold text-white truncate">{it.name}</span>
                          {it.reference && (
                            <span className="text-[10px] font-mono text-slate-500 shrink-0">
                              {it.reference}
                            </span>
                          )}
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-bold uppercase shrink-0">
                            {it.unit}
                          </span>
                        </div>
                        <button
                          onClick={() => handleEditProduct({ id: it.id } as any)}
                          className="btn-ghost py-1 px-2.5 text-[11px] rounded-lg shrink-0"
                        >
                          Editar tarifas
                        </button>
                      </div>

                      {it.description && (
                        <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2">{it.description}</p>
                      )}

                      {sinTarifa ? (
                        <p className="text-[11px] text-amber-400 mt-2">
                          Sin tarifas cargadas: el bot no puede cotizar este servicio.
                        </p>
                      ) : (
                        <div className="overflow-x-auto mt-3">
                          <table className="w-full text-left text-[11px]">
                            <thead>
                              <tr className="text-slate-500 border-b border-white/5">
                                <th className="pb-1.5 pr-3 font-semibold">Variante</th>
                                <th className="pb-1.5 pr-3 font-semibold">Desde</th>
                                <th className="pb-1.5 pr-3 font-semibold">Hasta</th>
                                <th className="pb-1.5 pr-3 font-semibold text-right">Precio</th>
                                <th className="pb-1.5 font-semibold">Se cobra</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 text-slate-300">
                              {it.tiers.slice(0, 8).map((t: any) => (
                                <tr key={t.id}>
                                  <td className="py-1.5 pr-3">{t.variant || 'Estándar'}</td>
                                  <td className="py-1.5 pr-3">{t.min_qty}</td>
                                  <td className="py-1.5 pr-3">{t.max_qty ?? 'en adelante'}</td>
                                  <td className="py-1.5 pr-3 text-right font-semibold text-white">
                                    ${Number(t.price).toLocaleString('es-CO')}
                                  </td>
                                  <td className="py-1.5 text-slate-400">
                                    {/* «Unitario» no significa lo mismo en un
                                        esfero que en un aviso: aquí se lee con
                                        la unidad del producto, «por m²». */}
                                    {t.price_basis === 'unitario' ? idiomaDePrecio(it.unit).seCobra
                                      : t.price_basis === 'lote_total' ? 'por el lote completo'
                                      : t.price_basis === 'cm2' ? 'por cm²'
                                      : t.price_basis}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {it.tiers.length > 8 && (
                            <p className="text-[10px] text-slate-500 mt-1.5">
                              y {it.tiers.length - 8} rango(s) más — ábrelo con "Editar tarifas".
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="p-3 bg-white/2 rounded-xl text-[11px] text-slate-400 flex items-start gap-2">
            <Info size={14} className="text-primary-400 shrink-0 mt-0.5" />
            <p>
              Los servicios que se cobran por área (DTF, vinilos) se calculan por medidas: el bot pide
              ancho y alto y aplica la tarifa. Los que se cobran por unidad usan los rangos de cantidad.
              Si un servicio aparece en ámbar es porque no tiene tarifas y el bot no podrá ofrecerlo.
            </p>
          </div>
        </div>
      )}

      {/* ─── TAB 4: HOJAS DE CATEGORÍA ───
          Los rótulos están escritos para alguien que entra por primera vez y no
          sabe dónde está parado. El dueño lo pidió el 04-ago-2026: «alguien que
          no tenga ni idea de dónde está parado lee "con qué palabras se busca en
          el catálogo" y no va a tener ni idea de qué catálogo le hablan». Tenía
          razón: esa tabla la armó él, no es un estándar de nada, y en Colombia
          la mayoría de las empresas siguen con hoja y esfero.

          Regla de redacción de esta pantalla: cada rótulo es una PREGUNTA que
          alguien puede contestar sin saber cómo funciona el sistema, y la ayuda
          de abajo trae un ejemplo real. Nada de «chuleta», «catálogo» ni
          «variante»: palabras de quien vende, no de quien programa. */}
      {activeTab === 'hojas' && (
        <div className="space-y-4 animate-fade-in">
          <div className="card space-y-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="max-w-2xl">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <BookBookmark size={20} className="text-primary-400" />
                  Hojas de categoría
                </h2>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  Imagine que mañana entra alguien nuevo a atender clientes por WhatsApp.
                  <strong className="text-slate-200"> ¿Qué le explicaría el primer día</strong> para que
                  pueda dar un precio sin venir a preguntarle a usted? Eso es una hoja.
                  <br />
                  Haga una por cada grupo de productos que se venda parecido. Un mug y un termo se
                  preguntan igual: van en la misma hoja.
                  <br />
                  <strong className="text-amber-300/90">Lo que deje vacío no se inventa:</strong>{' '}
                  el bot no dirá nada de eso y ofrecerá consultarlo con el equipo.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    // La hoja nueva va PRIMERA, no al final. Antes se agregaba abajo del
                    // todo y, con una hoja larga ya en pantalla, el dueño hacia clic y no
                    // veia nada: creyo que el boton no funcionaba.
                    setHojas([
                      {
                        id: 'hoja_' + Date.now(),
                        nombre: '',
                        categorias: [],
                        general: false,
                        preguntar: '',
                        no_preguntar: '',
                        como_preguntar: '',
                        buscar_como: '',
                        nunca_buscar: '',
                        adicionales: '',
                        marcacion: '',
                        marcacion_nota: '',
                        notas: '',
                      },
                      ...hojas,
                    ])
                  }
                  className="btn-secondary text-xs"
                >
                  <Plus size={14} /> Agregar hoja
                </button>
                <button
                  type="button"
                  disabled={guardandoHojas}
                  onClick={async () => {
                    setGuardandoHojas(true);
                    setMsgHojas('');
                    const r: any = await saveHojas(hojas);
                    setMsgHojas(
                      r?.success
                        ? `Guardado. ${r.guardadas} hoja(s).`
                        : `No se pudo guardar: ${r?.error || 'error desconocido'}`
                    );
                    setGuardandoHojas(false);
                  }}
                  className="btn-primary text-xs"
                >
                  {guardandoHojas ? 'Guardando…' : 'Guardar hojas'}
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              Nada se guarda hasta que le dé a <strong>Guardar hojas</strong>. Si se equivoca,
              recargue la página y vuelve todo como estaba.
            </p>
            {msgHojas && (
              <p className="text-xs text-primary-300 bg-primary-950/30 border border-primary-500/30 rounded-lg px-3 py-2">
                {msgHojas}
              </p>
            )}
          </div>

          {loadingHojas && <p className="text-sm text-slate-400">Cargando hojas…</p>}

          {!loadingHojas && hojas.length === 0 && (
            <div className="card">
              <p className="text-sm text-slate-400">
                Todavía no hay ninguna hoja. Con «Agregar hoja» crea la primera.
              </p>
            </div>
          )}

          {hojas.map((h: any, i: number) => {
            const set = (campo: string, valor: any) => {
              const copia = [...hojas];
              copia[i] = { ...copia[i], [campo]: valor };
              setHojas(copia);
            };
            const catsElegidas: string[] = Array.isArray(h.categorias) ? h.categorias : [];
            const alternarCategoria = (id: string) =>
              set(
                'categorias',
                catsElegidas.includes(id)
                  ? catsElegidas.filter(x => x !== id)
                  : [...catsElegidas, id]
              );

            // ── Los tres avisos ──────────────────────────────────────────────
            // Nada se bloquea: a veces se quieren dos hojas parecidas. Solo se
            // muestran, porque hoy una hoja pisada se ve igual que una viva.
            const nombreLimpio = String(h.nombre || '').trim().toLowerCase();
            const nombreRepetido =
              nombreLimpio &&
              hojas.some((o: any, j: number) =>
                j !== i && String(o.nombre || '').trim().toLowerCase() === nombreLimpio
              );

            // El aviso que de verdad importa: dos hojas sobre la misma categoría.
            // El bot usa UNA sola y descarta la otra sin decir nada.
            const chocan: string[] = [];
            for (const idCat of catsElegidas) {
              const otra = hojas.find(
                (o: any, j: number) =>
                  j !== i && Array.isArray(o.categorias) && o.categorias.includes(idCat)
              );
              if (otra) {
                const nom = categories.find((c: any) => c.id === idCat)?.name || idCat;
                chocan.push(`${nom} (también en «${otra.nombre || 'sin nombre'}»)`);
              }
            }

            const productosCubiertos = h.general
              ? null
              : catsElegidas.reduce((n: number, id: string) => n + (conteoPorCategoria[id] || 0), 0);

            return (
              <div key={h.id || i} className="card space-y-4">
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      ¿Cómo quiere llamar a esta hoja?
                    </label>
                    <input
                      type="text"
                      value={h.nombre || ''}
                      onChange={e => set('nombre', e.target.value)}
                      className="input text-sm"
                      placeholder="Cuadernos · Llaveros · Mugs y termos…"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Es solo una etiqueta suya, para reconocerla en la lista. El bot no la lee.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-300 shrink-0 pb-6">
                    <input
                      type="checkbox"
                      checked={h.general === true}
                      onChange={e => set('general', e.target.checked)}
                    />
                    Vale para todo lo demás
                  </label>
                  <button
                    type="button"
                    onClick={() => setHojas(hojas.filter((_: any, j: number) => j !== i))}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-2 shrink-0 mb-6"
                  >
                    Eliminar
                  </button>
                </div>

                {nombreRepetido && (
                  <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-lg px-3 py-2">
                    ⚠️ Ya hay otra hoja que se llama igual. No es un error, pero después cuesta
                    distinguirlas.
                  </p>
                )}

                {chocan.length > 0 && (
                  <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-500/30 rounded-lg px-3 py-2">
                    ⚠️ <strong>Dos hojas para los mismos productos.</strong> El bot va a usar una
                    sola y va a ignorar la otra: {chocan.slice(0, 3).join(' · ')}
                    {chocan.length > 3 ? ` y ${chocan.length - 3} más` : ''}.
                    <br />
                    Manda la que esté más arriba en esta lista.
                  </p>
                )}

                {h.general ? (
                  <p className="text-[11px] text-emerald-300/90 bg-emerald-950/20 border border-emerald-500/25 rounded-lg px-3 py-2">
                    Esta hoja se usa para <strong>todos los productos que no tengan hoja propia</strong>.
                    Es su red de seguridad para los miles de productos que nunca va a configurar uno
                    por uno. Solo puede haber una.
                  </p>
                ) : (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      ¿Para qué productos sirve esta hoja?
                    </label>
                    <p className="text-[11px] text-slate-500 mb-2">
                      Marque los grupos que se venden preguntando lo mismo. Si a un mug y a un termo
                      les pregunta las mismas cosas, márquelos juntos.
                    </p>
                    <div className="max-h-44 overflow-y-auto rounded-lg border border-white/10 bg-slate-950/50 p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {categories.map((c: any) => {
                        const n = conteoPorCategoria[c.id] || 0;
                        return (
                          <label
                            key={c.id}
                            className="flex items-center gap-2 text-xs text-slate-300 hover:text-white cursor-pointer px-1 py-0.5 rounded hover:bg-white/5"
                          >
                            <input
                              type="checkbox"
                              checked={catsElegidas.includes(c.id)}
                              onChange={() => alternarCategoria(c.id)}
                            />
                            <span className="truncate flex-1">{c.name}</span>
                            <span className={`text-[10px] shrink-0 ${n === 0 ? 'text-slate-600' : 'text-slate-500'}`}>
                              {n}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <p
                      className={`text-[11px] mt-2 ${
                        productosCubiertos === 0 ? 'text-amber-300' : 'text-slate-400'
                      }`}
                    >
                      {productosCubiertos === 0 ? (
                        <>
                          ⚠️ <strong>Esta hoja no llega a ningún producto.</strong> No marcó ningún
                          grupo, o los que marcó están vacíos. Así, el bot nunca la va a usar.
                        </>
                      ) : (
                        <>
                          Esta hoja le habla a <strong>{productosCubiertos} producto(s)</strong> de su
                          lista.
                        </>
                      )}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      ¿Qué necesita saber usted para poder dar un precio?
                    </label>
                    <textarea
                      rows={3}
                      value={h.preguntar || ''}
                      onChange={e => set('preguntar', e.target.value)}
                      className="input text-sm"
                      placeholder="cuántos · de qué tamaño · cuántas hojas"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Piense en la última vez que cotizó algo de estos productos: ¿qué le tuvo que
                      preguntar al cliente antes de poder darle una cifra?
                    </p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      ¿Y cómo se lo pregunta a un cliente?
                    </label>
                    <textarea
                      rows={3}
                      value={h.como_preguntar || ''}
                      onChange={e => set('como_preguntar', e.target.value)}
                      className="input text-sm"
                      placeholder="¿El diseño que querés poner es de un solo color o tiene varios? Si podés, pasámelo y lo miro yo."
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Escríbalo tal como se lo diría por WhatsApp. El cliente no sabe qué es una
                      tinta ni un troquel. Si no se le ocurre, déjelo vacío.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    ¿Hay algo que NO haga falta preguntar?
                  </label>
                  <input
                    type="text"
                    value={h.no_preguntar || ''}
                    onChange={e => set('no_preguntar', e.target.value)}
                    className="input text-sm"
                    placeholder="Si no piden cosido, es argollado y no se cobra aparte"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Cosas que usted ya da por hechas y el cliente no tiene por qué aclarar.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      ¿Con qué nombre lo tiene guardado usted?
                    </label>
                    <input
                      type="text"
                      value={h.buscar_como || ''}
                      onChange={e => set('buscar_como', e.target.value)}
                      className="input text-sm"
                      placeholder="cuaderno"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      El nombre con el que aparece en la pestaña «Catálogo de Productos», acá arriba.
                      El bot busca ahí; si no coincide, no lo encuentra.
                    </p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Palabras que el cliente usa y usted NO tiene guardadas
                    </label>
                    <input
                      type="text"
                      value={h.nunca_buscar || ''}
                      onChange={e => set('nunca_buscar', e.target.value)}
                      className="input text-sm"
                      placeholder="agenda · libreta"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Si un cliente pide una «agenda» y en su lista no existe esa palabra, póngala
                      acá para que el bot no la busque en vano.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    ¿Qué extras se le pueden agregar?
                  </label>
                  <input
                    type="text"
                    value={h.adicionales || ''}
                    onChange={e => set('adicionales', e.target.value)}
                    className="input text-sm"
                    placeholder="insertos · filtro uv · guardas · diseño"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Cosas que se suman al precio y que usted ya tiene cargadas con su valor.
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Lo que se imprime en el producto, ¿ya va en el precio?
                    </label>
                    <select
                      value={h.marcacion || ''}
                      onChange={e => set('marcacion', e.target.value)}
                      className="input text-sm"
                    >
                      <option value="">No sé / depende — el bot lo consulta</option>
                      <option value="incluida">Sí, ya está incluido</option>
                      <option value="aparte">No, se cobra aparte</option>
                      <option value="no_aplica">A estos productos no se les imprime nada</option>
                    </select>
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      ¿Algo más sobre lo que se imprime?
                    </label>
                    <input
                      type="text"
                      value={h.marcacion_nota || ''}
                      onChange={e => set('marcacion_nota', e.target.value)}
                      className="input text-sm"
                      placeholder="El diseño ya está en la lista de extras: no hay que preguntar técnica ni tintas"
                    />
                  </div>
                </div>

                {h.marcacion === 'incluida' && (
                  <p className="text-[11px] text-emerald-300/80">
                    Con esto, si el cliente pregunta si le pueden poner su diseño, el bot{' '}
                    <strong>le responde que sí y sigue</strong>, sin ponerse a preguntar.
                  </p>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                    ¿Algo más que deba saber quien atienda?
                  </label>
                  <textarea
                    rows={3}
                    value={h.notas || ''}
                    onChange={e => set('notas', e.target.value)}
                    className="input text-sm"
                    placeholder="Mínimo 20 unidades. Medida estándar hasta 6 x 4 cm; más grande tiene un costo adicional que se confirma con producción."
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Mínimos, medidas, cosas que cuestan aparte. Escríbalo con sus palabras, como se
                    lo diría a un empleado nuevo. Si tiene una nota en un archivo, péguela tal cual.
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── DRAWER: ADD / EDIT PRODUCT ─── */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 overflow-hidden flex justify-end">
          {/* Overlay background */}
          <div 
            onClick={() => setShowDrawer(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
          />

          {/* Drawer Panel */}
          <div className="relative w-full lg:max-w-3xl bg-slate-950 border-l border-white/10 h-full flex flex-col shadow-2xl animate-slide-left z-10">
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex items-center justify-between bg-slate-900/50">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  {isEditing ? <Pencil size={20} className="text-primary-400" /> : <Plus size={20} className="text-primary-400" />}
                  {isEditing ? 'Editar Producto y Precios' : 'Crear Nuevo Producto'}
                </h2>
                <p className="text-xs text-slate-400 mt-1">Configura la ficha técnica y los rangos de precios de venta.</p>
              </div>
              <button
                onClick={() => setShowDrawer(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content Form */}
            <form onSubmit={handleSaveProductSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {formError && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs flex items-center gap-2">
                  <WarningCircle size={18} />
                  <span>{formError}</span>
                </div>
              )}
              {formSuccess && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-xs flex items-center gap-2">
                  <Check size={18} />
                  <span>{formSuccess}</span>
                </div>
              )}

              {/* Grid 1: Basic Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Nombre comercial *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ej: Bolígrafo Metálico Stylus"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Referencia comercial</label>
                  <input
                    type="text"
                    placeholder="Ej: E-3 o S-841"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white font-mono text-sm focus:outline-none focus:border-primary-500 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-300">Categoría *</label>
                    <button
                      type="button"
                      onClick={() => setShowAddCatModal(true)}
                      className="text-[11px] text-primary-400 hover:text-primary-300 flex items-center gap-1"
                    >
                      <FolderPlus size={12} />
                      Nueva
                    </button>
                  </div>
                  <select
                    value={categoryId}
                    onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                  >
                    <option value="">Seleccionar categoría...</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                {categoryId && categories.find(c => c.id === categoryId)?.subcategories && categories.find(c => c.id === categoryId)!.subcategories!.length > 0 && (
                  <div className="space-y-1 animate-fade-in">
                    <label className="text-xs font-semibold text-slate-300">Subcategoría</label>
                    <select
                      value={subcategoryId}
                      onChange={(e) => setSubcategoryId(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                    >
                      <option value="">Ninguna / General</option>
                      {categories.find(c => c.id === categoryId)?.subcategories?.map((sub) => (
                        <option key={sub.id} value={sub.id}>{sub.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Unidad de medida</label>
                  <select
                    value={unit}
                    onChange={(e) => cambiarUnidad(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                  >
                    <option value="unidad">Unidad (ud)</option>
                    <option value="millar">Millar (1.000 uds)</option>
                    <option value="m2">Metro Cuadrado (m²)</option>
                    <option value="metro">Metro lineal</option>
                    <option value="servicio">Servicio / Adicional</option>
                  </select>
                </div>
              </div>

              {/* Textarea: Description & Synonyms */}
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Ficha técnica / Descripción (Materiales, Medidas, etc.)</label>
                  <textarea
                    rows={3}
                    placeholder="Ej: Fabricado en aluminio con clip metálico y puntero touch. Tinta negra."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <Tag size={14} className="text-primary-400" />
                    Sinónimos Específicos del Producto
                  </label>
                  <p className="text-[10px] text-slate-400">
                    Escribe términos alternativos que apliquen *solo* a este producto (ej: termo, camping). Nota: Heredará automáticamente los sinónimos globales de su categoría.
                  </p>
                  <input
                    type="text"
                    placeholder="ej: termo, camping"
                    value={synonyms}
                    onChange={(e) => setSynonyms(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">URL de la Imagen del Producto (Opcional - Auto-mapeado activado)</label>
                  <div className="flex gap-4 items-center">
                    <input
                      type="url"
                      placeholder="Dejar vacío para usar imagen local automática de la referencia"
                      value={imageUrl}
                      onChange={(e) => setImageUrl(e.target.value)}
                      className="flex-1 px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                    />
                    {imageUrl ? (
                      <div className="w-10 h-10 rounded border border-white/10 overflow-hidden bg-slate-950 flex items-center justify-center shrink-0">
                        <img src={imageUrl} alt="Vista previa" className="w-full h-full object-cover" />
                      </div>
                    ) : reference ? (
                      <div className="w-10 h-10 rounded border border-white/10 overflow-hidden bg-slate-950 flex items-center justify-center shrink-0" title="Imagen cargada automáticamente desde el VPS">
                        <img 
                          src={`/api/catalog-images/${encodeURIComponent(reference)}`} 
                          alt="Vista previa automática" 
                          className="w-full h-full object-cover" 
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                            const parent = (e.target as HTMLElement).parentElement;
                            if (parent) {
                              parent.innerHTML = '<span class="text-[8px] text-slate-600">Sin foto</span>';
                            }
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  {/* Subir imagen desde el PC (cualquier formato → se convierte a
                      JPEG y se re-embeda automáticamente para mantener el RAG coherente). */}
                  <div className="flex items-center gap-3 pt-1">
                    <label className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all shrink-0 ${uploadingImage ? 'bg-slate-700 text-slate-400 cursor-wait' : 'bg-primary-600/20 text-primary-300 border border-primary-500/40 hover:bg-primary-600/30'}`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      {uploadingImage ? 'Subiendo y re-embedando…' : 'Subir imagen desde tu PC'}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        disabled={uploadingImage}
                        className="hidden"
                      />
                    </label>
                    {!productId && (
                      <span className="text-[10px] text-slate-500">Guarda el producto primero para habilitar la subida.</span>
                    )}
                  </div>
                  {uploadError && (
                    <p className="text-[11px] text-red-400">{uploadError}</p>
                  )}
                </div>
              </div>

              {/* Grid 2: Conditions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Cantidad mínima de pedido</label>
                  <input
                    type="number"
                    min={1}
                    value={minOrderQty || 1}
                    onChange={(e) => setMinOrderQty(Number(e.target.value))}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                  />
                </div>

                <div className="flex items-center gap-3 h-full pt-6">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                      className="sr-only peer" 
                    />
                    <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500 peer-checked:after:bg-white"></div>
                    <span className="ml-2 text-xs font-semibold text-slate-300">Producto Activo para WhatsApp</span>
                  </label>
                </div>

                <div className="flex items-center gap-3 h-full">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={priceIncludesIva}
                      onChange={(e) => setPriceIncludesIva(e.target.checked)}
                      className="sr-only peer" 
                    />
                    <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary-500 peer-checked:after:bg-white"></div>
                    <span className="ml-2 text-xs font-semibold text-slate-300">El precio incluye IVA (19%)</span>
                  </label>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Notas internas / Condiciones adicionales</label>
                <textarea
                  rows={2}
                  placeholder="Ej: Consultar stock disponible de colores antes de prometer entrega en 3 días."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                />
              </div>

              {/* Price Tiers Editor */}
              <div className="space-y-3 pt-4 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-1.5">
                      <CurrencyDollar size={16} className="text-primary-400" />
                      {idiomaPrecio.titulo}
                    </h3>
                    <p className="text-[10px] text-slate-400">{idiomaPrecio.ayuda}</p>
                  </div>
                  <button
                    type="button"
                    onClick={addPriceTierRow}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-medium text-white transition-all"
                  >
                    <Plus size={12} />
                    {idiomaPrecio.boton}
                  </button>
                </div>

                {/* La instrucción que faltaba: sin ella no había forma de saber
                    que un precio único por m² se escribe desde 1 / hasta vacío. */}
                {idiomaPrecio.pista && (
                  <p className="text-[11px] text-primary-300 bg-primary-500/5 border border-primary-500/20 rounded-lg px-3 py-2">
                    {idiomaPrecio.pista}
                  </p>
                )}

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                  {priceTiers.map((tier, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center bg-white/2 p-3 rounded-xl border border-white/5">
                      {/* Variant Input */}
                      <div className="flex-1 w-full space-y-1">
                        <input
                          type="text"
                          required
                          placeholder={idiomaPrecio.ejemploVariante}
                          value={tier.variant}
                          onChange={(e) => updatePriceTierRow(idx, 'variant', e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white text-xs focus:outline-none focus:border-primary-500"
                        />
                      </div>

                      {/* Qty Ranges */}
                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        <input
                          type="number"
                          required
                          min={1}
                          placeholder={idiomaPrecio.desdeCorto}
                          value={tier.min_qty}
                          onChange={(e) => updatePriceTierRow(idx, 'min_qty', Number(e.target.value))}
                          className="w-16 px-2 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white text-xs focus:outline-none focus:border-primary-500 text-center"
                          title={idiomaPrecio.desdeLargo}
                        />
                        <span className="text-slate-500 text-xs">-</span>
                        <input
                          type="number"
                          placeholder={idiomaPrecio.hastaCorto}
                          value={tier.max_qty || ''}
                          onChange={(e) => updatePriceTierRow(idx, 'max_qty', e.target.value ? Number(e.target.value) : null)}
                          className="w-20 px-2 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white text-xs focus:outline-none focus:border-primary-500 text-center"
                          title={idiomaPrecio.hastaLargo}
                        />
                      </div>

                      {/* Price Input */}
                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        <span className="text-slate-500 text-xs font-semibold">$</span>
                        {/*
                          EL CERO QUE ESCONDIA LA CASILLA.

                          Aqui iba `value={tier.price}` con el precio en 0, asi
                          que la casilla mostraba «0» —parecia llena— mientras
                          «hasta» estaba vacia y parecia la que faltaba. El 03-
                          ago-2026 el dueño escribio los $95.000 del metro
                          cuadrado en «hasta» y el precio quedo en 0. No fue
                          distraccion suya: fue este cero.

                          Con `|| ''` la casilla se ve vacia y muestra su
                          etiqueta «Precio», igual que ya hacia «hasta».
                        */}
                        <input
                          type="number"
                          required
                          min={1}
                          placeholder="Precio"
                          value={tier.price || ''}
                          onChange={(e) => updatePriceTierRow(idx, 'price', Number(e.target.value))}
                          className="w-24 px-2 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white text-xs focus:outline-none focus:border-primary-500 font-mono text-right"
                        />
                      </div>

                      {/* Basis Selector */}
                      <div className="w-full sm:w-auto">
                        <select
                          value={tier.price_basis}
                          onChange={(e) => updatePriceTierRow(idx, 'price_basis', e.target.value)}
                          className="w-full sm:w-auto px-2.5 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white text-xs focus:outline-none focus:border-primary-500"
                        >
                          <option value="unitario">Unitario</option>
                          <option value="lote_total">Lote Total</option>
                        </select>
                      </div>

                      {/* Actions */}
                      <button
                        type="button"
                        onClick={() => removePriceTierRow(idx)}
                        disabled={priceTiers.length === 1}
                        className="p-2 rounded-lg text-rose-400 hover:bg-rose-950/20 disabled:opacity-30 transition-all shrink-0 self-end sm:self-center"
                      >
                        <Trash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </form>

            {/* Footer buttons */}
            <div className="p-6 border-t border-white/5 bg-slate-900/50 flex flex-col sm:flex-row gap-3 justify-between">
              <div>
                {isEditing && (
                  <button
                    type="button"
                    onClick={handleDuplicateProduct}
                    className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm transition-all border border-white/10 font-medium"
                  >
                    <Copy size={16} />
                    Duplicar ficha
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => setShowDrawer(false)}
                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-slate-900 border border-white/10 hover:bg-white/5 text-slate-300 text-sm font-medium transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveProductSubmit}
                  disabled={isSaving}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:bg-primary-800 disabled:opacity-50 text-white text-sm font-semibold transition-all shadow-lg shadow-primary-950/25"
                >
                  {isSaving ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <span>Guardar Producto</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: EDIT CATEGORY SYNONYMS ─── */}
      {showCatSynonymsModal && selectedCatForSynonyms && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4">
          <div onClick={() => setShowCatSynonymsModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg bg-slate-950 border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden z-10 animate-fade-in">
            <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Tag className="text-primary-400" size={18} />
                Sinónimos Globales: {selectedCatForSynonyms.name}
              </h3>
              <button onClick={() => setShowCatSynonymsModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveCategorySynonymsSubmit} className="space-y-4">
              <div className="p-3 bg-white/2 rounded-xl text-[11px] text-slate-400 flex items-start gap-2">
                <Info size={14} className="text-primary-400 shrink-0 mt-0.5" />
                <p>
                  Las palabras que escribas aquí serán heredadas por **todos** los productos de esta categoría en sus búsquedas de WhatsApp. Sepáralas por comas.
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Lista de Sinónimos *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: botilito, mug, vasos, posillos, pocillos, tazas"
                  value={categorySynonymsValue}
                  onChange={(e) => setCategorySynonymsValue(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowCatSynonymsModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingCatSynonyms}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-semibold"
                >
                  {savingCatSynonyms ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                      <span>Actualizando Catálogo...</span>
                    </>
                  ) : (
                    <span>Guardar y Aplicar</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: ADD / EDIT GLOSSARY ITEM ─── */}
      {showGlosarioModal && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4">
          <div onClick={() => setShowGlosarioModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg bg-slate-950 border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden z-10 animate-fade-in">
            <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Tag className="text-primary-400" size={18} />
                {editingGlosarioId ? 'Editar Regla de Jerga' : 'Agregar Regla de Jerga Comercial'}
              </h3>
              <button onClick={() => setShowGlosarioModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveGlossarySubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Término / Jerga del cliente *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: mil de presentacion o millar de presentacion"
                  value={glosarioTermino}
                  onChange={(e) => setGlosarioTermino(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Significado / Cómo debe actuar la IA *</label>
                <textarea
                  rows={4}
                  required
                  placeholder="Ej: Se refiere a 1.000 unidades de Tarjetas de Presentación, impresas por millar en brillo o mate UV."
                  value={glosarioSignificado}
                  onChange={(e) => setGlosarioSignificado(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowGlosarioModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingGlosario}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-semibold"
                >
                  {savingGlosario ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                      <span>Generando Embeddings...</span>
                    </>
                  ) : (
                    <span>Guardar Regla</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── MODAL: CREATE CATEGORY ─── */}
      {showAddCatModal && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4">
          <div onClick={() => setShowAddCatModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-md bg-slate-950 border border-white/10 rounded-2xl shadow-2xl p-6 z-10 animate-fade-in">
            <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FolderPlus className="text-primary-400" size={18} />
                Crear Nueva Categoría
              </h3>
              <button onClick={() => setShowAddCatModal(false)} className="p-1 rounded-lg text-slate-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateCategorySubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Nombre de la Categoría *</label>
                <input
                  type="text"
                  required
                  placeholder="Ej: Agendas y Cuadernos"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-300">Agrupador superior (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ej: Escritura o Papelería"
                  value={newCatGroup}
                  onChange={(e) => setNewCatGroup(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-white/5">
                <button
                  type="button"
                  onClick={() => setShowAddCatModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-sm font-semibold"
                >
                  Crear Categoría
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
