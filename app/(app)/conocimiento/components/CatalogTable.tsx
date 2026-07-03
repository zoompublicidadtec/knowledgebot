'use client';

import { useMemo, useState } from 'react';
import {
  CaretLeft,
  CaretRight,
  CaretDown,
  CaretUp,
  Pencil,
  Trash,
  WarningCircle,
  Check,
  X,
  ArrowsDownUp,
} from '@phosphor-icons/react';
import { computeDisplayPrice } from '@/lib/catalog-utils';

export interface CatalogProduct {
  id: string;
  category_id: string;
  subcategory_id?: string | null;
  name: string;
  reference: string | null;
  description: string | null;
  unit: string;
  price_includes_iva: boolean;
  min_order_qty: number | null;
  notes: string | null;
  active: boolean;
  search_text: string | null;
  categories?: { name: string } | null;
  price_tiers?: Array<{
    id?: string;
    variant: string;
    min_qty: number | string;
    max_qty: number | string | null;
    price: number | string | null;
    price_basis: string | null;
  }>;
}

export type SortField = 'name' | 'reference' | 'price' | 'active';
export type SortDir = 'asc' | 'desc';

interface CatalogTableProps {
  products: CatalogProduct[];
  totalCount: number;
  page: number;
  totalPages: number;
  loading: boolean;
  sort: SortField;
  sortDir: SortDir;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onSortChange: (field: SortField) => void;
  onPageChange: (page: number) => void;
  onEdit: (prod: CatalogProduct) => void;
  onHardDelete: (prod: CatalogProduct) => void;
  onInlinePriceSave?: (tierId: string, newPrice: number) => Promise<boolean>;
}

function formatCOP(n: number): string {
  return '$' + n.toLocaleString('es-CO');
}

export function CatalogTable(props: CatalogTableProps) {
  const {
    products,
    totalCount,
    page,
    totalPages,
    loading,
    sort,
    sortDir,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,
    onSortChange,
    onPageChange,
    onEdit,
    onHardDelete,
    onInlinePriceSave,
  } = props;

  // Price sorting happens client-side on the visible page (price is derived, not a column).
  const visibleProducts = useMemo(() => {
    if (sort !== 'price') return products;
    const withPrice = products.map((p) => ({ p, dp: computeDisplayPrice(p.price_tiers) }));
    withPrice.sort((a, b) => {
      const pa = a.dp?.price ?? -1;
      const pb = b.dp?.price ?? -1;
      return sortDir === 'asc' ? pa - pb : pb - pa;
    });
    return withPrice.map((x) => x.p);
  }, [products, sort, sortDir]);

  const allOnPageSelected = visibleProducts.length > 0 && visibleProducts.every((p) => selectedIds.has(p.id));

  if (loading) {
    return (
      <div className="hidden sm:flex glass rounded-2xl border border-white/5 p-12 text-center text-slate-400 items-center justify-center">
        <div className="animate-spin inline-block w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full mb-3 mr-3"></div>
        <p className="text-sm">Buscando en el catálogo...</p>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="glass rounded-2xl border border-white/5 p-12 text-center text-slate-400">
        <WarningCircle size={40} className="mx-auto text-slate-500 mb-3" />
        <p className="text-sm">No se encontraron productos. Crea uno nuevo o cambia los filtros.</p>
      </div>
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden sm:block glass rounded-2xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-250px)] custom-scrollbar">
          <table className="w-full text-left text-sm min-w-[1000px]">
            <thead>
              <tr className="border-b border-white/5 bg-white/2" style={{ color: 'rgba(148,163,184,0.6)' }}>
                <th className="p-4 w-10">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={() => onToggleSelectAll(visibleProducts.map((p) => p.id))}
                    className="w-4 h-4 rounded accent-primary-500 cursor-pointer"
                    title="Seleccionar todos en esta página"
                  />
                </th>
                <SortHeader field="name" label="Producto" sort={sort} sortDir={sortDir} onSortChange={onSortChange} />
                <SortHeader field="reference" label="Referencia" sort={sort} sortDir={sortDir} onSortChange={onSortChange} />
                <th className="p-4 font-semibold">Categoría</th>
                <SortHeader field="price" label="Precio vigente" sort={sort} sortDir={sortDir} onSortChange={onSortChange} />
                <th className="p-4 font-semibold">Unidad</th>
                <SortHeader field="active" label="Estado" sort={sort} sortDir={sortDir} onSortChange={onSortChange} />
                <th className="p-4 font-semibold text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleProducts.map((prod) => (
                <ProductRow
                  key={prod.id}
                  prod={prod}
                  selected={selectedIds.has(prod.id)}
                  onToggleSelect={() => onToggleSelect(prod.id)}
                  onEdit={() => onEdit(prod)}
                  onHardDelete={() => onHardDelete(prod)}
                  onInlinePriceSave={onInlinePriceSave}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="block sm:hidden space-y-3">
        {visibleProducts.map((prod) => (
          <MobileProductCard
            key={prod.id}
            prod={prod}
            selected={selectedIds.has(prod.id)}
            onToggleSelect={() => onToggleSelect(prod.id)}
            onEdit={() => onEdit(prod)}
            onHardDelete={() => onHardDelete(prod)}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs" style={{ color: 'rgba(148,163,184,0.4)' }}>
            Página {page} de {totalPages} ({totalCount.toLocaleString('es-CO')} ítems)
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => onPageChange(Math.max(page - 1, 1))}
              disabled={page === 1}
              className="p-2 rounded-lg bg-slate-900 border border-white/10 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-all"
            >
              <CaretLeft size={16} />
            </button>
            <button
              onClick={() => onPageChange(Math.min(page + 1, totalPages))}
              disabled={page === totalPages}
              className="p-2 rounded-lg bg-slate-900 border border-white/10 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-all"
            >
              <CaretRight size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Top-level subcomponents (defined OUTSIDE the parent to comply with React rules) ───

function SortHeader({
  field,
  label,
  sort,
  sortDir,
  onSortChange,
  className,
}: {
  field: SortField;
  label: string;
  sort: SortField;
  sortDir: SortDir;
  onSortChange: (field: SortField) => void;
  className?: string;
}) {
  const active = sort === field;
  return (
    <th className={`p-4 font-semibold ${className || ''}`}>
      <button
        onClick={() => onSortChange(field)}
        className={`inline-flex items-center gap-1 transition-colors ${active ? 'text-primary-400' : 'hover:text-white'}`}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />
        ) : (
          <ArrowsDownUp size={11} className="opacity-40" />
        )}
      </button>
    </th>
  );
}

function ProductRow({
  prod,
  selected,
  onToggleSelect,
  onEdit,
  onHardDelete,
  onInlinePriceSave,
}: {
  prod: CatalogProduct;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onHardDelete: () => void;
  onInlinePriceSave?: (tierId: string, newPrice: number) => Promise<boolean>;
}) {
  const display = computeDisplayPrice(prod.price_tiers);
  // Entry-level tier id (smallest min_qty among Estándar/any) for inline editing
  const entryTier = useMemo(() => {
    const tiers = (prod.price_tiers || [])
      .filter((t) => t.id && Number(t.price) > 0 && Number(t.price) < 1e9)
      .map((t) => ({ id: t.id as string, variant: (t.variant || '').toLowerCase(), min_qty: Number(t.min_qty || 1), price: Number(t.price) }));
    if (tiers.length === 0) return null;
    const estandar = tiers.filter((t) => t.variant === 'estándar' || t.variant === 'estandar');
    const pool = estandar.length > 0 ? estandar : tiers;
    return pool.reduce((best, cur) => (cur.min_qty < best.min_qty ? cur : best), pool[0]);
  }, [prod.price_tiers]);

  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState('');
  const [savingPrice, setSavingPrice] = useState(false);
  const [priceError, setPriceError] = useState('');

  async function savePrice() {
    if (!entryTier) return;
    const np = Number(priceDraft);
    if (!Number.isFinite(np) || np < 0) { setPriceError('Inválido'); return; }
    setSavingPrice(true);
    setPriceError('');
    const ok = onInlinePriceSave ? await onInlinePriceSave(entryTier.id, np) : false;
    setSavingPrice(false);
    if (ok) { setEditingPrice(false); }
    else { setPriceError('Error'); }
  }

  return (
    <tr className={`hover:bg-white/2 transition-colors ${!prod.active ? 'opacity-50' : ''} ${selected ? 'bg-primary-500/5' : ''}`}>
      <td className="p-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="w-4 h-4 rounded accent-primary-500 cursor-pointer"
        />
      </td>
      <td className="p-4">
        <div>
          <div className="font-semibold text-white">{prod.name}</div>
          <div className="text-xs text-slate-400 mt-0.5 line-clamp-1 max-w-[300px]" title={prod.description || ''}>
            {prod.description || 'Sin descripción técnica'}
          </div>
        </div>
      </td>
      <td className="p-4 text-slate-300 font-mono text-xs">{prod.reference || '-'}</td>
      <td className="p-4 text-slate-400">{prod.categories?.name || 'Sin Categoría'}</td>
      <td className="p-4">
        {display ? (
          editingPrice && entryTier ? (
            <div className="flex items-center gap-1">
              <span className="text-slate-500 text-xs">$</span>
              <input
                autoFocus
                type="number"
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') savePrice(); if (e.key === 'Escape') { setEditingPrice(false); setPriceError(''); } }}
                className="w-24 px-2 py-1 rounded bg-slate-950 border border-primary-500 text-white text-xs font-mono text-right focus:outline-none"
              />
              <button onClick={savePrice} disabled={savingPrice} className="p-1 text-emerald-400 hover:bg-emerald-950/30 rounded">
                {savingPrice ? <div className="animate-spin w-3 h-3 border-2 border-emerald-400 border-t-transparent rounded-full" /> : <Check size={14} weight="bold" />}
              </button>
              <button onClick={() => { setEditingPrice(false); setPriceError(''); }} className="p-1 text-slate-400 hover:bg-white/5 rounded">
                <X size={14} />
              </button>
              {priceError && <span className="text-[10px] text-rose-400 ml-1">{priceError}</span>}
            </div>
          ) : (
            <button
              onClick={() => { if (entryTier) { setPriceDraft(String(entryTier.price)); setEditingPrice(true); } }}
              className="font-mono text-emerald-300 hover:bg-emerald-950/20 px-2 py-0.5 rounded text-xs"
              title={entryTier ? 'Clic para editar el precio de entrada' : 'Sin tier editable'}
            >
              {formatCOP(display.price)}
              <span className="text-[9px] text-slate-500 ml-1">
                {display.basis === 'lote_total' ? '/lote' : `/ud`}
              </span>
            </button>
          )
        ) : (
          <span className="text-xs text-slate-600" title="Este producto no tiene precios configurados">—</span>
        )}
      </td>
      <td className="p-4 text-slate-400 capitalize">{prod.unit}</td>
      <td className="p-4">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          prod.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
        }`}>
          {prod.active ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td className="p-4 text-right space-x-1 whitespace-nowrap">
        <button
          onClick={onEdit}
          className="inline-flex items-center p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
          title="Editar ficha y precios"
        >
          <Pencil size={16} />
        </button>
        <button
          onClick={onHardDelete}
          className="inline-flex items-center p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/20 transition-all"
          title="Eliminar definitivamente"
        >
          <Trash size={16} />
        </button>
      </td>
    </tr>
  );
}

function MobileProductCard({
  prod,
  selected,
  onToggleSelect,
  onEdit,
  onHardDelete,
}: {
  prod: CatalogProduct;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onHardDelete: () => void;
}) {
  const display = computeDisplayPrice(prod.price_tiers);
  return (
    <div className={`glass p-4 rounded-xl border border-white/5 space-y-3 transition-opacity ${!prod.active ? 'opacity-50' : ''} ${selected ? 'ring-1 ring-primary-500/40' : ''}`}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="w-4 h-4 mt-1 rounded accent-primary-500 cursor-pointer shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-semibold text-sm text-white">{prod.name}</h4>
            <span className="text-[10px] bg-slate-800 text-slate-300 font-mono px-1.5 py-0.5 rounded shrink-0">
              {prod.reference || 'Sin Ref'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 line-clamp-2">{prod.description || 'Sin descripción'}</p>
          {display && (
            <p className="text-sm text-emerald-300 font-mono mt-1">
              {formatCOP(display.price)}
              <span className="text-[10px] text-slate-500 ml-1">{display.basis === 'lote_total' ? '/lote' : '/ud'}</span>
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-400 pl-6">
        <span>Cat: {prod.categories?.name || '-'}</span>
        <span>Unidad: {prod.unit}</span>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-white/5 pl-6">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
          prod.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
        }`}>
          {prod.active ? 'Activo' : 'Inactivo'}
        </span>
        <div className="flex gap-2">
          <button onClick={onEdit} className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 text-xs text-slate-300 hover:text-white">
            <Pencil size={12} /> Editar
          </button>
          <button onClick={onHardDelete} className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-950/20 text-xs text-rose-400 hover:text-rose-300">
            <Trash size={12} /> Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}
