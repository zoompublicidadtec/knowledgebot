'use client';

import { useState, useTransition } from 'react';
import {
  CaretDown,
  CaretRight,
  Tag,
  FolderPlus,
  PencilSimple,
  Trash,
  X,
  Check,
  DotsThreeVertical,
} from '@phosphor-icons/react';
import {
  createCategory,
  createSubcategory,
  renameCategory,
  deleteCategory,
  renameSubcategory,
  deleteSubcategory,
} from '../actions';

export interface Subcategory {
  id: string;
  name: string;
  synonyms?: string | null;
}
export interface TreeCategory {
  id: string;
  name: string;
  group_name: string | null;
  synonyms?: string | null;
  subcategories?: Subcategory[];
  requiresMigration?: boolean;
}

interface CategoryTreeProps {
  categories: TreeCategory[];
  selectedCategoryId: string;
  totalCount: number;
  onSelect: (id: string) => void;
  onCategoriesChanged: () => void;
  onManageSynonyms?: (cat: TreeCategory) => void; // open existing synonyms modal in parent
}

export function CategoryTree({
  categories,
  selectedCategoryId,
  totalCount,
  onSelect,
  onCategoriesChanged,
  onManageSynonyms,
}: CategoryTreeProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAddCat, setShowAddCat] = useState(false);
  const [menuOpenCat, setMenuOpenCat] = useState<string | null>(null);
  const [menuOpenSub, setMenuOpenSub] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ type: 'cat' | 'sub'; id: string; value: string } | null>(null);
  const [showAddSub, setShowAddSub] = useState<string | null>(null); // category id
  const [newSubName, setNewSubName] = useState('');
  const [showDeleteCat, setShowDeleteCat] = useState<TreeCategory | null>(null);
  const [deleteReassign, setDeleteReassign] = useState('');
  const [isPending, startTransition] = useTransition();

  function toggle(id: string) { setExpanded((p) => ({ ...p, [id]: !p[id] })); }

  function startEdit(type: 'cat' | 'sub', id: string, value: string) {
    setEditing({ type, id, value });
    setMenuOpenCat(null);
    setMenuOpenSub(null);
  }

  async function commitRename() {
    if (!editing) return;
    const name = editing.value.trim();
    if (!name) { setEditing(null); return; }
    startTransition(async () => {
      if (editing.type === 'cat') await renameCategory(editing.id, name);
      else await renameSubcategory(editing.id, name);
      setEditing(null);
      onCategoriesChanged();
    });
  }

  async function handleCreateCategory(name: string, group: string) {
    startTransition(async () => {
      const res = await createCategory(name.trim(), group.trim() || undefined);
      if (res.success) { setShowAddCat(false); onCategoriesChanged(); }
    });
  }

  async function handleCreateSub() {
    if (!showAddSub || !newSubName.trim()) return;
    startTransition(async () => {
      const res = await createSubcategory(showAddSub, newSubName.trim());
      if (res.success) {
        setShowAddSub(null); setNewSubName(''); onCategoriesChanged();
        setExpanded((p) => ({ ...p, [showAddSub]: true }));
      }
    });
  }

  async function handleDeleteSub(subId: string) {
    if (!confirm('¿Eliminar esta subcategoría? Los productos quedarán en su categoría padre.')) return;
    startTransition(async () => {
      await deleteSubcategory(subId);
      setMenuOpenSub(null);
      onCategoriesChanged();
    });
  }

  async function handleDeleteCat() {
    if (!showDeleteCat) return;
    startTransition(async () => {
      const res = await deleteCategory(showDeleteCat.id, deleteReassign || undefined);
      if (res.success) {
        setShowDeleteCat(null); setDeleteReassign(''); onCategoriesChanged();
        onSelect('all');
      } else {
        alert('Error: ' + res.error);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pl-2">
        <h3 className="text-xs font-semibold text-slate-400 tracking-wider uppercase">Categorías</h3>
        <button
          onClick={() => setShowAddCat(true)}
          className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 pr-2"
          title="Crear categoría"
        >
          <FolderPlus size={14} /> Nueva
        </button>
      </div>

      <div className="glass rounded-xl border border-white/5 p-2 space-y-1">
        <button
          onClick={() => onSelect('all')}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
            selectedCategoryId === 'all'
              ? 'bg-primary-500/10 text-primary-400 font-medium'
              : 'text-slate-400 hover:bg-white/5 hover:text-white'
          }`}
        >
          Todos los Productos ({totalCount.toLocaleString('es-CO')})
        </button>
        <div className="h-px bg-white/5 my-2" />
        <div className="max-h-[500px] overflow-y-auto space-y-0.5 pr-1">
          {categories.map((cat) => {
            const isExp = expanded[cat.id];
            const hasSubs = cat.subcategories && cat.subcategories.length > 0;
            const isSel = selectedCategoryId === `cat-${cat.id}` || selectedCategoryId === cat.id;
            return (
              <div key={cat.id} className="space-y-0.5">
                <div className="group flex items-center justify-between rounded-lg hover:bg-white/5 transition-all relative">
                  <div className="flex flex-1 items-center overflow-hidden">
                    {hasSubs ? (
                      <button onClick={() => toggle(cat.id)} className="p-1.5 text-slate-500 hover:text-white transition-colors">
                        {isExp ? <CaretDown size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
                      </button>
                    ) : <div className="w-[26px]"></div>}

                    {editing?.type === 'cat' && editing.id === cat.id ? (
                      <input
                        autoFocus
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null); }}
                        onBlur={commitRename}
                        className="flex-1 bg-slate-950 border border-primary-500 rounded px-2 py-1 text-sm text-white focus:outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => onSelect(`cat-${cat.id}`)}
                        className={`flex-1 text-left py-2 pr-2 text-sm transition-all truncate block ${
                          isSel ? 'text-primary-400 font-medium' : 'text-slate-400 hover:text-white'
                        }`}
                        title={`${cat.name} ${cat.synonyms ? `(${cat.synonyms})` : ''}`}
                      >
                        {cat.name}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center">
                    <button
                      onClick={() => setMenuOpenCat(menuOpenCat === cat.id ? null : cat.id)}
                      className="p-1.5 rounded text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                      title="Más acciones"
                    >
                      <DotsThreeVertical size={16} weight="bold" />
                    </button>
                  </div>

                  {menuOpenCat === cat.id && (
                    <div className="absolute right-0 top-9 z-20 w-52 bg-slate-900 border border-white/10 rounded-xl shadow-2xl py-1 text-xs">
                      <button onClick={() => startEdit('cat', cat.id, cat.name)} className="w-full text-left px-3 py-2 hover:bg-white/5 text-slate-200 flex items-center gap-2">
                        <PencilSimple size={13} /> Renombrar
                      </button>
                      <button onClick={() => { setShowAddSub(cat.id); setMenuOpenCat(null); }} className="w-full text-left px-3 py-2 hover:bg-white/5 text-slate-200 flex items-center gap-2">
                        <FolderPlus size={13} /> Agregar subcategoría
                      </button>
                      {onManageSynonyms && (
                        <button onClick={() => { onManageSynonyms(cat); setMenuOpenCat(null); }} className="w-full text-left px-3 py-2 hover:bg-white/5 text-slate-200 flex items-center gap-2">
                          <Tag size={13} /> Sinónimos
                        </button>
                      )}
                      <div className="h-px bg-white/5 my-1" />
                      <button onClick={() => { setShowDeleteCat(cat); setMenuOpenCat(null); }} className="w-full text-left px-3 py-2 hover:bg-rose-950/30 text-rose-400 flex items-center gap-2">
                        <Trash size={13} /> Eliminar categoría
                      </button>
                    </div>
                  )}
                </div>

                {/* Add subcategory inline */}
                {showAddSub === cat.id && (
                  <div className="pl-8 pr-2 py-1 flex items-center gap-1">
                    <input
                      autoFocus
                      value={newSubName}
                      onChange={(e) => setNewSubName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateSub(); if (e.key === 'Escape') { setShowAddSub(null); setNewSubName(''); } }}
                      placeholder="Nombre subcategoría..."
                      className="flex-1 bg-slate-950 border border-white/10 rounded px-2 py-1 text-[13px] text-white focus:outline-none focus:border-primary-500"
                    />
                    <button onClick={handleCreateSub} className="p-1 text-emerald-400 hover:bg-emerald-950/30 rounded"><Check size={14} /></button>
                    <button onClick={() => { setShowAddSub(null); setNewSubName(''); }} className="p-1 text-slate-400 hover:bg-white/5 rounded"><X size={14} /></button>
                  </div>
                )}

                {/* Subcategories */}
                {isExp && hasSubs && (
                  <div className="pl-8 pr-1 space-y-0.5 pb-1">
                    {cat.subcategories!.map((sub) => (
                      <div key={sub.id} className="group flex items-center justify-between rounded-md hover:bg-white/5 transition-all relative">
                        {editing?.type === 'sub' && editing.id === sub.id ? (
                          <input
                            autoFocus
                            value={editing.value}
                            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null); }}
                            onBlur={commitRename}
                            className="flex-1 bg-slate-950 border border-primary-500 rounded px-2 py-1 text-[13px] text-white focus:outline-none"
                          />
                        ) : (
                          <button
                            onClick={() => onSelect(`sub-${sub.id}`)}
                            className={`flex-1 text-left px-2 py-1.5 text-[13px] transition-all truncate ${
                              selectedCategoryId === `sub-${sub.id}`
                                ? 'text-primary-400 font-medium bg-primary-500/10 rounded-md'
                                : 'text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            {sub.name}
                          </button>
                        )}
                        <button
                          onClick={() => setMenuOpenSub(menuOpenSub === sub.id ? null : sub.id)}
                          className="p-1 rounded text-slate-500 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <DotsThreeVertical size={14} weight="bold" />
                        </button>
                        {menuOpenSub === sub.id && (
                          <div className="absolute right-0 top-7 z-20 w-44 bg-slate-900 border border-white/10 rounded-xl shadow-2xl py-1 text-xs">
                            <button onClick={() => startEdit('sub', sub.id, sub.name)} className="w-full text-left px-3 py-2 hover:bg-white/5 text-slate-200 flex items-center gap-2">
                              <PencilSimple size={13} /> Renombrar
                            </button>
                            <button onClick={() => handleDeleteSub(sub.id)} className="w-full text-left px-3 py-2 hover:bg-rose-950/30 text-rose-400 flex items-center gap-2">
                              <Trash size={13} /> Eliminar
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {categories.length === 0 && (
            <p className="text-center text-xs text-slate-500 py-6">Sin categorías. Crea la primera.</p>
          )}
        </div>
      </div>

      {/* Add category modal */}
      {showAddCat && (
        <AddCategoryModal
          onCancel={() => setShowAddCat(false)}
          onCreate={handleCreateCategory}
          pending={isPending}
        />
      )}

      {/* Delete category modal */}
      {showDeleteCat && (
        <DeleteCategoryModal
          category={showDeleteCat}
          categories={categories.filter((c) => c.id !== showDeleteCat.id)}
          reassign={deleteReassign}
          setReassign={setDeleteReassign}
          onCancel={() => { setShowDeleteCat(null); setDeleteReassign(''); }}
          onConfirm={handleDeleteCat}
          pending={isPending}
        />
      )}
    </div>
  );
}

function AddCategoryModal({
  onCancel,
  onCreate,
  pending,
}: {
  onCancel: () => void;
  onCreate: (name: string, group: string) => void;
  pending: boolean;
}) {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onCancel} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-md bg-slate-950 border border-white/10 rounded-2xl shadow-2xl p-6 z-10 animate-fade-in">
        <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <FolderPlus size={18} className="text-primary-400" /> Crear Nueva Categoría
          </h3>
          <button onClick={onCancel} className="p-1 rounded-lg text-slate-400 hover:text-white"><X size={18} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-300">Nombre *</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name, group); }}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-300">Agrupador (opcional)</label>
            <input value={group} onChange={(e) => setGroup(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-5 border-t border-white/5 mt-5">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 text-sm">Cancelar</button>
          <button disabled={!name.trim() || pending} onClick={() => onCreate(name, group)}
            className="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white text-sm font-semibold">
            Crear
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteCategoryModal({
  category,
  categories,
  reassign,
  setReassign,
  onCancel,
  onConfirm,
  pending,
}: {
  category: TreeCategory;
  categories: TreeCategory[];
  reassign: string;
  setReassign: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div onClick={onCancel} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-md bg-slate-950 border border-white/10 rounded-2xl shadow-2xl p-6 z-10 animate-fade-in">
        <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Trash size={18} className="text-rose-400" /> Eliminar "{category.name}"
          </h3>
          <button onClick={onCancel} className="p-1 rounded-lg text-slate-400 hover:text-white"><X size={18} /></button>
        </div>
        <div className="p-3 rounded-xl text-xs bg-amber-500/10 text-amber-300 border border-amber-500/20 mb-3">
          ¿Qué hacer con los productos de esta categoría?
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="radio" name="reassign" value="" checked={reassign === ''} onChange={() => setReassign('')} />
            Dejar sin categoría (se conservan los productos)
          </label>
          {categories.length > 0 && (
            <>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="radio" name="reassign" value={categories[0].id} checked={reassign !== ''} onChange={() => setReassign(categories[0].id)} />
                Reasignar a otra categoría:
              </label>
              {reassign !== '' && (
                <select value={reassign} onChange={(e) => setReassign(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-white/10 text-white text-sm focus:outline-none focus:border-primary-500">
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-5 border-t border-white/5 mt-5">
          <button onClick={onCancel} className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 text-sm">Cancelar</button>
          <button disabled={pending} onClick={onConfirm}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white text-sm font-semibold">
            Eliminar categoría
          </button>
        </div>
      </div>
    </div>
  );
}
