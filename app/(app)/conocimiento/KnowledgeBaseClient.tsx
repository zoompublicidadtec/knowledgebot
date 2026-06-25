'use client';

import React, { useState, useEffect, useTransition } from 'react';
import { 
  BookBookmark, 
  Plus, 
  Trash, 
  Pencil, 
  Copy, 
  MagnifyingGlass, 
  CaretLeft, 
  CaretRight, 
  X, 
  FolderPlus, 
  Tag, 
  Check, 
  Info,
  Sliders,
  WarningCircle,
  CurrencyDollar,
  Sparkle
} from '@phosphor-icons/react';
import { 
  getCatalog, 
  getCategories, 
  createCategory, 
  getProductDetails, 
  saveProduct, 
  deleteProduct,
  getGlosario,
  saveGlosarioItem,
  deleteGlosarioItem,
  saveCategorySynonyms
} from './actions';

interface Category {
  id: string;
  name: string;
  group_name: string | null;
  synonyms?: string | null;
  requiresMigration?: boolean;
}

interface Product {
  id: string;
  category_id: string;
  name: string;
  reference: string | null;
  description: string | null;
  unit: string;
  price_includes_iva: boolean;
  min_order_qty: number | null;
  notes: string | null;
  active: boolean;
  search_text: string | null;
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

export default function KnowledgeBaseClient({ initialCategories }: KnowledgeBaseClientProps) {
  // Tabs State
  const [activeTab, setActiveTab] = useState<'catalog' | 'glossary' | 'marking'>('catalog');

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
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('unidad');
  const [priceIncludesIva, setPriceIncludesIva] = useState(false);
  const [minOrderQty, setMinOrderQty] = useState<number>(1);
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [synonyms, setSynonyms] = useState('');
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
        limit: 10,
        search: debouncedSearch,
        categoryId: selectedCategoryId,
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
  }, [page, debouncedSearch, selectedCategoryId, activeTab]);

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

  // Handle Edit Product
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
      setDescription(details.product.description || '');
      setUnit(details.product.unit);
      setPriceIncludesIva(details.product.price_includes_iva || false);
      setMinOrderQty(details.product.min_order_qty || 1);
      setNotes(details.product.notes || '');
      setActive(details.product.active);
      
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

  // Reset Product Form
  const resetForm = () => {
    setProductId('');
    setName('');
    setReference('');
    setCategoryId(categories[0]?.id || '');
    setDescription('');
    setUnit('unidad');
    setPriceIncludesIva(false);
    setMinOrderQty(1);
    setNotes('');
    setActive(true);
    setSynonyms('');
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

  // Price Tiers Row Handlers
  const addPriceTierRow = () => {
    setPriceTiers(prev => [
      ...prev,
      { variant: 'Estándar', min_qty: 1, max_qty: null, price: 0, price_basis: 'unitario' }
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
      if (tier.price < 0) return setFormError('El precio no puede ser negativo.');
    }

    startSavingTransition(async () => {
      const res = await saveProduct({
        id: productId || undefined,
        category_id: categoryId,
        name,
        reference,
        description,
        unit,
        price_includes_iva: priceIncludesIva,
        min_order_qty: minOrderQty,
        notes,
        active,
        synonyms
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

  // Handle Soft Delete Product
  const handleDeleteProductClick = async (id: string, name: string) => {
    if (confirm(`¿Estás seguro de que deseas desactivar el producto "${name}"? Dejará de cotizarse automáticamente en WhatsApp.`)) {
      const res = await deleteProduct(id);
      if (res.success) {
        loadProductsList();
      } else {
        alert('Error al desactivar el producto: ' + res.error);
      }
    }
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
      </div>

      {/* ─── TAB 1: CATALOG ─── */}
      {activeTab === 'catalog' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 animate-fade-in">
          {/* LEFT: Category Sidebar (Desktop Only) */}
          <div className="hidden lg:block space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase pl-2">Categorías</h3>
            <div className="glass rounded-xl border border-white/5 p-2 space-y-1">
              <button
                onClick={() => { setSelectedCategoryId('all'); setPage(1); }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                  selectedCategoryId === 'all'
                    ? 'bg-primary-500/10 text-primary-400 font-medium'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                Todos los Productos ({totalCount})
              </button>
              <div className="h-px bg-white/5 my-2" />
              <div className="max-h-[500px] overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {categories.map((cat) => (
                  <div key={cat.id} className="group flex items-center justify-between rounded-lg hover:bg-white/5 transition-all">
                    <button
                      onClick={() => { setSelectedCategoryId(cat.id); setPage(1); }}
                      className={`flex-1 text-left px-3 py-2 rounded-l-lg text-sm transition-all truncate block ${
                        selectedCategoryId === cat.id
                          ? 'bg-primary-500/10 text-primary-400 font-medium'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title={`${cat.name} ${cat.synonyms ? `(${cat.synonyms})` : ''}`}
                    >
                      {cat.name}
                    </button>
                    {!dbNeedsMigration && (
                      <button
                        onClick={() => handleEditCategorySynonymsClick(cat)}
                        className="px-2 py-2 rounded-r-lg text-slate-500 hover:text-primary-400 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                        title="Configurar sinónimos de categoría"
                      >
                        <Tag size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
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
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
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

            {/* Desktop Products Table */}
            <div className="hidden sm:block glass rounded-2xl border border-white/5 overflow-hidden">
              {loadingProducts ? (
                <div className="p-12 text-center text-slate-400">
                  <div className="animate-spin inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full mb-3"></div>
                  <p className="text-sm">Buscando en el catálogo...</p>
                </div>
              ) : products.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                  <WarningCircle size={40} className="mx-auto text-slate-500 mb-3" />
                  <p className="text-sm">No se encontraron productos. Crea uno nuevo o cambia los filtros.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/5 bg-white/2" style={{ color: 'rgba(148,163,184,0.6)' }}>
                        <th className="p-4 font-semibold">Producto</th>
                        <th className="p-4 font-semibold">Referencia</th>
                        <th className="p-4 font-semibold">Categoría</th>
                        <th className="p-4 font-semibold">Unidad</th>
                        <th className="p-4 font-semibold">Estado</th>
                        <th className="p-4 font-semibold text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {products.map((prod) => (
                        <tr key={prod.id} className={`hover:bg-white/2 transition-colors ${!prod.active ? 'opacity-50' : ''}`}>
                          <td className="p-4">
                            <div>
                              <div className="font-semibold text-white">{prod.name}</div>
                              <div className="text-xs text-slate-400 mt-0.5 line-clamp-1 max-w-[300px]" title={prod.description || ''}>
                                {prod.description || 'Sin descripción técnica'}
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-slate-300 font-mono text-xs">{prod.reference || '-'}</td>
                          <td className="p-4 text-slate-400">
                            {(prod as any).categories?.name || 'Sin Categoría'}
                          </td>
                          <td className="p-4 text-slate-400 capitalize">{prod.unit}</td>
                          <td className="p-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                              prod.active 
                                ? 'bg-emerald-500/10 text-emerald-400' 
                                : 'bg-rose-500/10 text-rose-400'
                            }`}>
                              {prod.active ? 'Activo' : 'Inactivo'}
                            </span>
                          </td>
                          <td className="p-4 text-right space-x-1 whitespace-nowrap">
                            <button
                              onClick={() => handleEditProduct(prod)}
                              className="inline-flex items-center p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                              title="Editar ficha y precios"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteProductClick(prod.id, prod.name)}
                              className="inline-flex items-center p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 transition-all"
                              title="Desactivar producto"
                            >
                              <Trash size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Mobile Responsive Cards */}
            <div className="block sm:hidden space-y-3">
              {loadingProducts ? (
                <div className="p-12 text-center text-slate-400 glass rounded-2xl">
                  <div className="animate-spin inline-block w-6 h-6 border-3 border-primary-500 border-t-transparent rounded-full mb-3"></div>
                  <p className="text-xs">Buscando productos...</p>
                </div>
              ) : products.length === 0 ? (
                <div className="p-12 text-center text-slate-400 glass rounded-2xl">
                  <WarningCircle size={32} className="mx-auto text-slate-500 mb-2" />
                  <p className="text-xs">No se encontraron productos.</p>
                </div>
              ) : (
                products.map((prod) => (
                  <div 
                    key={prod.id} 
                    className={`glass p-4 rounded-xl border border-white/5 space-y-3 transition-opacity ${!prod.active ? 'opacity-50' : ''}`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-semibold text-sm text-white">{prod.name}</h4>
                        <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.5 rounded">
                          {prod.reference || 'Sin Ref'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">{prod.description || 'Sin descripción'}</p>
                    </div>
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Cat: {(prod as any).categories?.name || '-'}</span>
                      <span>Unidad: {prod.unit}</span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        prod.active 
                          ? 'bg-emerald-500/10 text-emerald-400' 
                          : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {prod.active ? 'Activo' : 'Inactivo'}
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditProduct(prod)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 text-xs text-slate-300 hover:text-white"
                        >
                          <Pencil size={12} />
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteProductClick(prod.id, prod.name)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-950/20 text-xs text-rose-400 hover:text-rose-300"
                        >
                          <Trash size={12} />
                          Apagar
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs" style={{ color: 'rgba(148,163,184,0.4)' }}>
                  Página {page} de {totalPages} ({totalCount} ítems)
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(prev => Math.max(prev - 1, 1))}
                    disabled={page === 1}
                    className="p-2 rounded-lg bg-slate-900 border border-white/10 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-all"
                  >
                    <CaretLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage(prev => Math.min(prev + 1, totalPages))}
                    disabled={page === totalPages}
                    className="p-2 rounded-lg bg-slate-900 border border-white/10 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-all"
                  >
                    <CaretRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── TAB 2: GLOSSARY ─── */}
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
          <div>
            <h3 className="text-base font-semibold text-white">Tablas Globales de Precios de Marcación</h3>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
              Estas son las tarifas de servicios de personalización extraídas del archivo de precios B2B original.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* TAMPOGRAFÍA */}
            <div className="glass p-5 rounded-2xl border border-white/5 space-y-4">
              <h4 className="font-semibold text-white flex items-center gap-2 text-sm border-b border-white/5 pb-2">
                <Sliders className="text-primary-400" size={18} />
                Tampografía / Tampo Llaveros, Lapiceros, etc.
              </h4>
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/5">
                      <th className="pb-2">Rango Cantidad</th>
                      <th className="pb-2">1 Tinta (Cliché + Tiraje)</th>
                      <th className="pb-2">Tinta Adicional</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    <tr>
                      <td className="py-2">1 - 99 uds</td>
                      <td className="py-2">$45.000 (Mínimo lote)</td>
                      <td className="py-2">$20.000</td>
                    </tr>
                    <tr>
                      <td className="py-2">100 - 299 uds</td>
                      <td className="py-2">$350 / ud</td>
                      <td className="py-2">$180 / ud</td>
                    </tr>
                    <tr>
                      <td className="py-2">300 - 499 uds</td>
                      <td className="py-2">$300 / ud</td>
                      <td className="py-2">$150 / ud</td>
                    </tr>
                    <tr>
                      <td className="py-2">500+ uds</td>
                      <td className="py-2">$200 / ud</td>
                      <td className="py-2">$100 / ud</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="p-3 bg-white/2 rounded-xl text-[11px] text-slate-400 flex items-start gap-2">
                <Info size={14} className="text-primary-400 shrink-0 mt-0.5" />
                <p>Las tarifas de tampografía asumen que el cliente provee el logo en vector y se aplica en una sola cara del producto.</p>
              </div>
            </div>

            {/* SCREEN / BOLSAS Y AGENDAS */}
            <div className="glass p-5 rounded-2xl border border-white/5 space-y-4">
              <h4 className="font-semibold text-white flex items-center gap-2 text-sm border-b border-white/5 pb-2">
                <Sliders className="text-primary-400" size={18} />
                Screen (Bolsas Kraft, Agendas, Gorras)
              </h4>
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/5">
                      <th className="pb-2">Rango Cantidad</th>
                      <th className="pb-2">1 Tinta (Marco + Tiraje)</th>
                      <th className="pb-2">Tinta Adicional</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    <tr>
                      <td className="py-2">1 - 49 uds</td>
                      <td className="py-2">$40.000 (Mínimo lote)</td>
                      <td className="py-2">$25.000</td>
                    </tr>
                    <tr>
                      <td className="py-2">50 - 199 uds</td>
                      <td className="py-2">$900 / ud</td>
                      <td className="py-2">$450 / ud</td>
                    </tr>
                    <tr>
                      <td className="py-2">200 - 499 uds</td>
                      <td className="py-2">$700 / ud</td>
                      <td className="py-2">$350 / ud</td>
                    </tr>
                    <tr>
                      <td className="py-2">500+ uds</td>
                      <td className="py-2">$550 / ud</td>
                      <td className="py-2">$250 / ud</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="p-3 bg-white/2 rounded-xl text-[11px] text-slate-400 flex items-start gap-2">
                <Info size={14} className="text-primary-400 shrink-0 mt-0.5" />
                <p>El precio base no incluye el costo de la malla de screen si el diseño del cliente requiere alta densidad de color.</p>
              </div>
            </div>

            {/* GRABADO LÁSER */}
            <div className="glass p-5 rounded-2xl border border-white/5 space-y-4">
              <h4 className="font-semibold text-white flex items-center gap-2 text-sm border-b border-white/5 pb-2">
                <Sliders className="text-primary-400" size={18} />
                Grabado Láser (Metal, Madera, Cuero)
              </h4>
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/5">
                      <th className="pb-2">Cantidad</th>
                      <th className="pb-2">Costo Grabado 1 Cara</th>
                      <th className="pb-2">Configuración Láser</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    <tr>
                      <td className="py-2">1 - 29 uds</td>
                      <td className="py-2">$2.000 / ud</td>
                      <td className="py-2">$15.000 (Lote único)</td>
                    </tr>
                    <tr>
                      <td className="py-2">30 - 99 uds</td>
                      <td className="py-2">$1.200 / ud</td>
                      <td className="py-2">Sin costo</td>
                    </tr>
                    <tr>
                      <td className="py-2">100 - 499 uds</td>
                      <td className="py-2">$700 / ud</td>
                      <td className="py-2">Sin costo</td>
                    </tr>
                    <tr>
                      <td className="py-2">500+ uds</td>
                      <td className="py-2">$450 / ud</td>
                      <td className="py-2">Sin costo</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* DTF UV / TEXTIL */}
            <div className="glass p-5 rounded-2xl border border-white/5 space-y-4">
              <h4 className="font-semibold text-white flex items-center gap-2 text-sm border-b border-white/5 pb-2">
                <Sliders className="text-primary-400" size={18} />
                DTF UV & DTF Textil
              </h4>
              <div className="overflow-x-auto text-xs">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-slate-400 border-b border-white/5">
                      <th className="pb-2">Concepto</th>
                      <th className="pb-2">Medida Max</th>
                      <th className="pb-2">Precio Unitario</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-slate-300">
                    <tr>
                      <td className="py-2">DTF UV (Sticker 3D) Chico</td>
                      <td className="py-2">4x4 cm</td>
                      <td className="py-2">$1.500 / ud (mín. 50 uds)</td>
                    </tr>
                    <tr>
                      <td className="py-2">DTF UV Mediano</td>
                      <td className="py-2">8x8 cm</td>
                      <td className="py-2">$2.800 / ud (mín. 30 uds)</td>
                    </tr>
                    <tr>
                      <td className="py-2">DTF Textil (Gorra/Camiseta)</td>
                      <td className="py-2">10x10 cm</td>
                      <td className="py-2">$3.500 / ud</td>
                    </tr>
                    <tr>
                      <td className="py-2">Plancha DTF Completa</td>
                      <td className="py-2">58x100 cm</td>
                      <td className="py-2">$45.000 / metro</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
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
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500 transition-all"
                  >
                    <option value="">Seleccionar categoría...</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Unidad de medida</label>
                  <select
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
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
                      Rangos de Precios por Volumen
                    </h3>
                    <p className="text-[10px] text-slate-400">Define cuánto cuesta el producto según la cantidad del pedido y técnica.</p>
                  </div>
                  <button
                    type="button"
                    onClick={addPriceTierRow}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-medium text-white transition-all"
                  >
                    <Plus size={12} />
                    Agregar Rango
                  </button>
                </div>

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                  {priceTiers.map((tier, idx) => (
                    <div key={idx} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center bg-white/2 p-3 rounded-xl border border-white/5">
                      {/* Variant Input */}
                      <div className="flex-1 w-full space-y-1">
                        <input
                          type="text"
                          required
                          placeholder="Variante (ej: Sin marca, Láser)"
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
                          placeholder="Mín"
                          value={tier.min_qty}
                          onChange={(e) => updatePriceTierRow(idx, 'min_qty', Number(e.target.value))}
                          className="w-16 px-2 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white text-xs focus:outline-none focus:border-primary-500 text-center"
                          title="Cantidad Mínima"
                        />
                        <span className="text-slate-500 text-xs">-</span>
                        <input
                          type="number"
                          placeholder="Máx (vacio = ∞)"
                          value={tier.max_qty || ''}
                          onChange={(e) => updatePriceTierRow(idx, 'max_qty', e.target.value ? Number(e.target.value) : null)}
                          className="w-20 px-2 py-1.5 rounded-lg bg-slate-950 border border-white/10 text-white text-xs focus:outline-none focus:border-primary-500 text-center"
                          title="Cantidad Máxima (dejar vacío si no tiene límite)"
                        />
                      </div>

                      {/* Price Input */}
                      <div className="flex items-center gap-1.5 w-full sm:w-auto">
                        <span className="text-slate-500 text-xs font-semibold">$</span>
                        <input
                          type="number"
                          required
                          min={0}
                          placeholder="Precio"
                          value={tier.price}
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
