'use client';

import { useState, useTransition } from 'react';
import {
  CheckCircle,
  Circle,
  X,
  Trash,
  ArrowUp,
  ArrowDown,
  Percent,
  SpinnerGap,
  WarningCircle,
  FolderOpen,
} from '@phosphor-icons/react';
import { bulkUpdateProducts, bulkHardDelete, bulkAdjustPrices } from '../actions';

interface Category {
  id: string;
  name: string;
}

interface BulkActionsBarProps {
  selectedIds: Set<string>;
  onClear: () => void;
  onDone: () => void; // refresh list after mutation
  categories: Category[];
}

export function BulkActionsBar({ selectedIds, onClear, onDone, categories }: BulkActionsBarProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const [showPriceModal, setShowPriceModal] = useState(false);
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const count = selectedIds.size;
  const ids = Array.from(selectedIds);

  function run(fn: () => Promise<{ success: boolean; error?: string; count?: number; updatedTiers?: number }>, okMsg: string) {
    setFeedback(null);
    startTransition(async () => {
      const res = await fn();
      if (res.success) {
        setFeedback({ type: 'ok', msg: okMsg.replace('{n}', String(res.count ?? res.updatedTiers ?? count)) });
        onClear();
        onDone();
        setShowPriceModal(false);
        setShowMoveModal(false);
        setShowDeleteModal(false);
      } else {
        setFeedback({ type: 'err', msg: res.error || 'Error desconocido.' });
      }
    });
  }

  return (
    <>
      <div className="glass rounded-2xl border border-primary-500/30 p-4 flex flex-col gap-3 animate-fade-in">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle size={18} className="text-primary-400" weight="fill" />
            <span className="text-white font-semibold">{count}</span>
            <span className="text-slate-400">producto(s) seleccionado(s)</span>
            <button onClick={onClear} className="ml-1 text-xs text-slate-500 hover:text-white flex items-center gap-1">
              <X size={12} /> Limpiar
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => run(() => bulkUpdateProducts(ids, { active: true }), '{n} producto(s) activados.')}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 text-xs font-medium transition-all"
            >
              <CheckCircle size={14} /> Activar
            </button>
            <button
              onClick={() => run(() => bulkUpdateProducts(ids, { active: false }), '{n} producto(s) desactivados.')}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/20 text-xs font-medium transition-all"
            >
              <Circle size={14} /> Desactivar
            </button>
            <button
              onClick={() => setShowPriceModal(true)}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-slate-200 hover:bg-white/10 border border-white/10 text-xs font-medium transition-all"
            >
              <Percent size={14} /> Ajustar precios
            </button>
            <button
              onClick={() => setShowMoveModal(true)}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-slate-200 hover:bg-white/10 border border-white/10 text-xs font-medium transition-all"
            >
              <FolderOpen size={14} /> Mover a categoría
            </button>
            <button
              onClick={() => setShowDeleteModal(true)}
              disabled={isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 border border-rose-500/20 text-xs font-medium transition-all"
            >
              <Trash size={14} /> Eliminar
            </button>
          </div>
        </div>

        {isPending && (
          <div className="flex items-center gap-2 text-xs text-primary-300">
            <SpinnerGap size={14} className="animate-spin" /> Procesando... (esto puede tardar si hay muchos productos)
          </div>
        )}
        {feedback && (
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
            feedback.type === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
              : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
          }`}>
            {feedback.type === 'ok' ? <CheckCircle size={14} /> : <WarningCircle size={14} />}
            {feedback.msg}
          </div>
        )}
      </div>

      {/* Price adjust modal */}
      {showPriceModal && (
        <PercentModal
          title={`Ajustar precios de ${count} producto(s)`}
          onCancel={() => setShowPriceModal(false)}
          onConfirm={(delta) => run(() => bulkAdjustPrices(ids, delta), '{n} rango(s) de precio actualizados.')}
        />
      )}

      {/* Move to category modal */}
      {showMoveModal && (
        <MoveModal
          categories={categories}
          count={count}
          onCancel={() => setShowMoveModal(false)}
          onConfirm={(catId) => run(() => bulkUpdateProducts(ids, { category_id: catId }), '{n} producto(s) movidos de categoría.')}
        />
      )}

      {/* Hard delete confirm */}
      {showDeleteModal && (
        <ConfirmModal
          title="Eliminar productos definitivamente"
          message={`Se eliminarán ${count} producto(s) y TODOS sus rangos de precio de forma permanente. Esta acción NO se puede deshacer. ¿Continuar?`}
          confirmLabel="Sí, eliminar definitivamente"
          danger
          onCancel={() => setShowDeleteModal(false)}
          onConfirm={() => run(() => bulkHardDelete(ids), '{n} producto(s) eliminados permanentemente.')}
        />
      )}
    </>
  );
}

function PercentModal({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: (deltaPercent: number) => void;
}) {
  const [val, setVal] = useState('');
  const num = Number(val);
  const valid = Number.isFinite(num) && val.trim() !== '';
  return (
    <ModalShell title={title} icon={<Percent size={18} className="text-primary-400" />} onCancel={onCancel}>
      <p className="text-xs text-slate-400 mb-3">
        Aplica un porcentaje a todos los rangos de precio de los productos seleccionados. Usa negativo para rebajar (ej. <code className="bg-slate-800 px-1 rounded">-10</code>) o positivo para subir (ej. <code className="bg-slate-800 px-1 rounded">5</code>). Precios corruptos o vacíos se ignoran.
      </p>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-1">
          <span className="text-slate-500 text-sm">
            {num < 0 ? <ArrowDown size={16} className="text-rose-400" /> : <ArrowUp size={16} className="text-emerald-400" />}
          </span>
          <input
            autoFocus
            type="number"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="ej: 10 o -15"
            className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500"
          />
          <span className="text-slate-400 text-sm">%</span>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-5 border-t border-white/5 mt-5">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 text-sm">Cancelar</button>
        <button
          disabled={!valid}
          onClick={() => onConfirm(num)}
          className="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white text-sm font-semibold"
        >
          Aplicar ajuste
        </button>
      </div>
    </ModalShell>
  );
}

function MoveModal({
  categories,
  count,
  onCancel,
  onConfirm,
}: {
  categories: Category[];
  count: number;
  onCancel: () => void;
  onConfirm: (catId: string) => void;
}) {
  const [catId, setCatId] = useState('');
  return (
    <ModalShell title={`Mover ${count} producto(s) a otra categoría`} icon={<FolderOpen size={18} className="text-primary-400" />} onCancel={onCancel}>
      <p className="text-xs text-slate-400 mb-3">
        Los productos cambiarán de categoría. Se regenerará su texto de búsqueda (search_text) y embedding para que el bot los siga encontrando correctamente.
      </p>
      <select
        value={catId}
        onChange={(e) => setCatId(e.target.value)}
        className="w-full px-3.5 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500"
      >
        <option value="">Seleccionar categoría destino...</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <div className="flex justify-end gap-2 pt-5 border-t border-white/5 mt-5">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 text-sm">Cancelar</button>
        <button
          disabled={!catId}
          onClick={() => onConfirm(catId)}
          className="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white text-sm font-semibold"
        >
          Mover productos
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={title} icon={<WarningCircle size={18} className={danger ? 'text-rose-400' : 'text-amber-400'} />} onCancel={onCancel}>
      <div className={`p-4 rounded-xl text-xs flex items-start gap-2 ${danger ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20' : 'bg-amber-500/10 text-amber-300 border border-amber-500/20'}`}>
        <WarningCircle size={18} className="shrink-0 mt-0.5" weight="fill" />
        <span>{message}</span>
      </div>
      <div className="flex justify-end gap-2 pt-5 border-t border-white/5 mt-5">
        <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 text-sm">Cancelar</button>
        <button
          onClick={onConfirm}
          className={`px-5 py-2 rounded-xl text-white text-sm font-semibold ${danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-primary-600 hover:bg-primary-500'}`}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  icon,
  onCancel,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4">
      <div onClick={onCancel} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-slate-950 border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden z-10 animate-fade-in">
        <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">{icon}{title}</h3>
          <button onClick={onCancel} className="p-1 rounded-lg text-slate-400 hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
