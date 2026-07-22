'use client';

import { useState, useTransition, useRef } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {
  DownloadSimple,
  UploadSimple,
  SpinnerGap,
  CheckCircle,
  WarningCircle,
  X,
  ArrowsLeftRight,
} from '@phosphor-icons/react';
import { exportCatalogRows, importCatalogRows } from '../actions';

interface ImportExportPanelProps {
  categoryId?: string;
  onDone: () => void;
}

export function ImportExportPanel({ categoryId, onDone }: ImportExportPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [parseError, setParseError] = useState('');
  const [fileName, setFileName] = useState('');

  function handleExport() {
    setFeedback(null);
    startTransition(async () => {
      const res = await exportCatalogRows(categoryId);
      if (!res.success || !res.rows || res.rows.length === 0) {
        setFeedback({ type: 'err', msg: res.error || 'No hay productos para exportar.' });
        return;
      }
      const ws = XLSX.utils.json_to_sheet(res.rows);
      // Set sensible column widths
      ws['!cols'] = [
        { wch: 24 }, { wch: 36 }, { wch: 14 }, { wch: 40 }, { wch: 10 },
        { wch: 14 }, { wch: 12 }, { wch: 30 }, { wch: 8 }, { wch: 22 },
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Catálogo');
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `catalogo_knowledgebot_${stamp}.xlsx`);
      setFeedback({ type: 'ok', msg: `${res.rows.length} fila(s) exportada(s).` });
    });
  }

  function handleFilePick(file: File) {
    setFeedback(null);
    setParseError('');
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let rows: Record<string, unknown>[] = [];
        if (file.name.toLowerCase().endsWith('.csv')) {
          const text = String(e.target?.result || '');
          const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
          rows = parsed.data || [];
        } else {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws);
        }
        // Normalize header keys (trim, lowercase)
        const normalized = rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(r)) {
            out[k.toString().trim().toLowerCase()] = v;
          }
          return out;
        });
        // Basic validation
        const valid = normalized.filter((r) => r['nombre'] || r['name']);
        if (valid.length === 0) {
          setParseError('No se encontraron filas válidas. Asegúrate de tener una columna "nombre".');
          return;
        }
        setParsedRows(normalized);
        setShowImportPreview(true);
      } catch (err: any) {
        setParseError('No se pudo leer el archivo: ' + err.message);
      }
    };
    if (file.name.toLowerCase().endsWith('.csv')) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  }

  function confirmImport() {
    setFeedback(null);
    startTransition(async () => {
      const report = await importCatalogRows(parsedRows);
      setShowImportPreview(false);
      const ok = report.inserted + report.updated;
      setFeedback({
        type: report.errors.length > 0 && ok === 0 ? 'err' : 'ok',
        msg: `Importación: ${report.inserted} nuevos, ${report.updated} actualizados${report.errors.length ? `, ${report.errors.length} error(es)` : ''}.`,
      });
      onDone();
    });
  }

  function downloadTemplate() {
    const sample = [
      {
        categoria: 'Vasos y Tazas',
        nombre: 'Mug Cerámico 11oz',
        referencia: 'MU-001',
        descripcion: 'Cerámica blanca, sublimable a 1 cara',
        unidad: 'unidad',
        precio_incluye_iva: 'NO',
        cantidad_minima: 50,
        notas: '',
        activo: 'SI',
        variante: 'Estándar',
        cantidad_min: 50,
        cantidad_max: 99,
        precio: 8500,
        base_precio: 'unitario',
        moneda: 'COP',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    ws['!cols'] = Array(15).fill({ wch: 16 });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Plantilla');
    XLSX.writeFile(wb, 'plantilla_importacion_knowledgebot.xlsx');
  }

  return (
    <div className="glass rounded-2xl border border-white/5 p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 text-sm">
          <ArrowsLeftRight size={18} className="text-primary-400" weight="fill" />
          <span className="text-white font-semibold">Importar / Exportar catálogo</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-slate-200 hover:bg-white/10 border border-white/10 text-xs font-medium transition-all"
          >
            <DownloadSimple size={14} /> Plantilla
          </button>
          <button
            onClick={handleExport}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 text-xs font-medium transition-all"
          >
            {isPending ? <SpinnerGap size={14} className="animate-spin" /> : <DownloadSimple size={14} />} Exportar Excel
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-500 text-white text-xs font-medium transition-all"
          >
            <UploadSimple size={14} /> Importar Excel/CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); e.target.value = ''; }}
          />
        </div>
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        La importación identifica productos existentes por su <strong>referencia</strong> (o nombre + categoría) y los actualiza; los nuevos se crean. Cada fila con precio genera o reemplaza un rango de precio. El texto de búsqueda y embedding se regeneran automáticamente para mantener el bot funcionando.
      </p>

      {parseError && (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/20">
          <WarningCircle size={14} /> {parseError}
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

      {/* Import preview modal */}
      {showImportPreview && (
        <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center p-4">
          <div onClick={() => setShowImportPreview(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl bg-slate-950 border border-white/10 rounded-2xl shadow-2xl p-6 overflow-hidden z-10 animate-fade-in max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <UploadSimple size={18} className="text-primary-400" /> Revisar importación
              </h3>
              <button onClick={() => setShowImportPreview(false)} className="p-1 rounded-lg text-slate-400 hover:text-white"><X size={18} /></button>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Archivo: <strong className="text-slate-200">{fileName}</strong> · {parsedRows.length} fila(s) detectada(s).
              Se procesarán productos con columna <code className="bg-slate-800 px-1 rounded">nombre</code>.
            </p>
            <div className="flex-1 overflow-auto rounded-xl border border-white/5">
              <table className="w-full text-xs text-left">
                <thead className="bg-white/5 text-slate-400 sticky top-0">
                  <tr>
                    <th className="p-2">Categoría</th>
                    <th className="p-2">Nombre</th>
                    <th className="p-2">Referencia</th>
                    <th className="p-2">Precio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {parsedRows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="text-slate-300">
                      <td className="p-2 truncate max-w-[120px]">{String(r['categoria'] || '')}</td>
                      <td className="p-2 truncate max-w-[180px]">{String(r['nombre'] || r['name'] || '')}</td>
                      <td className="p-2 font-mono text-slate-400">{String(r['referencia'] || r['reference'] || '')}</td>
                      <td className="p-2 font-mono">{String(r['precio'] ?? r['price'] ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsedRows.length > 50 && (
                <p className="text-center text-[10px] text-slate-500 py-2">... y {parsedRows.length - 50} fila(s) más</p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-4 border-t border-white/5 mt-4">
              <button onClick={() => setShowImportPreview(false)} className="px-4 py-2 rounded-xl bg-slate-900 border border-white/10 text-slate-300 text-sm">Cancelar</button>
              <button
                onClick={confirmImport}
                disabled={isPending}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-semibold"
              >
                {isPending ? <SpinnerGap size={14} className="animate-spin" /> : <UploadSimple size={14} />}
                Importar {parsedRows.length} fila(s)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
