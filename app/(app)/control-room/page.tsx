'use client';

import React, { useState } from 'react';
import { 
  Cpu, 
  Coins, 
  PhoneCall, 
  ArrowUpRight, 
  ChatCircleDots, 
  Image as ImageIcon, 
  Microphone, 
  Tag, 
  Terminal,
  Clock,
  ArrowRight
} from '@phosphor-icons/react';
import { TokenDonut } from '@/components/dashboard/token-donut';

// Mock data structured per filter period
const FILTER_DATA = {
  hoy: {
    totalTokens: 1430530,
    inputTokens: 1245830,
    outputTokens: 184700,
    calls: 312,
    segments: [
      { name: 'Chat (Gemini)', tokens: 1102400, color: '#a855f7', percentage: 77.1 },
      { name: 'Imágenes (Gemini)', tokens: 143430, color: '#0ea5e9', percentage: 10.0 },
      { name: 'Audio (Whisper)', tokens: 89200, color: '#10b981', percentage: 6.2 },
      { name: 'Búsquedas (Embedding)', tokens: 95500, color: '#fbbf24', percentage: 6.7 },
    ],
    models: [
      { name: 'gemini-2.5-flash (Chat)', type: 'Chat', tokens: 1102400, in: 980200, out: 122200, calls: 245, color: '#a855f7', icon: ChatCircleDots },
      { name: 'gemini-2.5-flash (Imágenes)', type: 'Imágenes', tokens: 143430, in: 128000, out: 15430, calls: 18, color: '#0ea5e9', icon: ImageIcon },
      { name: 'whisper-large-v3 (Audio)', type: 'Audio', tokens: 89200, in: 89200, out: 0, calls: 47, color: '#10b981', icon: Microphone },
      { name: 'gemini-embedding (Búsquedas)', type: 'Embedding', tokens: 95500, in: 95500, out: 0, calls: 185, color: '#fbbf24', icon: Tag },
    ],
    logs: [
      { time: '16:18', type: 'Chat', model: 'gemini-2.5-flash', tokens: 4230, status: 'success' },
      { time: '16:14', type: 'Audio', model: 'whisper-large-v3', tokens: 1890, status: 'success' },
      { time: '16:09', type: 'Búsqueda', model: 'text-embedding-004', tokens: 280, status: 'success' },
      { time: '16:01', type: 'Imágenes', model: 'gemini-2.5-flash', tokens: 8500, status: 'success' },
      { time: '15:54', type: 'Chat', model: 'gemini-2.5-flash', tokens: 3100, status: 'success' },
    ]
  },
  semana: {
    totalTokens: 8760400,
    inputTokens: 7540100,
    outputTokens: 1220300,
    calls: 1845,
    segments: [
      { name: 'Chat (Gemini)', tokens: 6850200, color: '#a855f7', percentage: 78.2 },
      { name: 'Imágenes (Gemini)', tokens: 810200, color: '#0ea5e9', percentage: 9.2 },
      { name: 'Audio (Whisper)', tokens: 600000, color: '#10b981', percentage: 6.8 },
      { name: 'Búsquedas (Embedding)', tokens: 500000, color: '#fbbf24', percentage: 5.7 },
    ],
    models: [
      { name: 'gemini-2.5-flash (Chat)', type: 'Chat', tokens: 6850200, in: 5900200, out: 950000, calls: 1390, color: '#a855f7', icon: ChatCircleDots },
      { name: 'gemini-2.5-flash (Imágenes)', type: 'Imágenes', tokens: 810200, in: 710000, out: 100200, calls: 95, color: '#0ea5e9', icon: ImageIcon },
      { name: 'whisper-large-v3 (Audio)', type: 'Audio', tokens: 600000, in: 600000, out: 0, calls: 360, color: '#10b981', icon: Microphone },
      { name: 'gemini-embedding (Búsquedas)', type: 'Embedding', tokens: 500000, in: 500000, out: 0, calls: 980, color: '#fbbf24', icon: Tag },
    ],
    logs: [
      { time: 'Ayer 20:30', type: 'Chat', model: 'gemini-2.5-flash', tokens: 6120, status: 'success' },
      { time: 'Ayer 19:15', type: 'Imágenes', model: 'gemini-2.5-flash', tokens: 8500, status: 'success' },
      { time: '11 Jul 15:20', type: 'Audio', model: 'whisper-large-v3', tokens: 2310, status: 'success' },
      { time: '10 Jul 12:44', type: 'Búsqueda', model: 'text-embedding-004', tokens: 280, status: 'success' },
      { time: '09 Jul 09:12', type: 'Chat', model: 'gemini-2.5-flash', tokens: 12450, status: 'success' },
    ]
  },
  mes: {
    totalTokens: 34250900,
    inputTokens: 29480200,
    outputTokens: 4770700,
    calls: 7210,
    segments: [
      { name: 'Chat (Gemini)', tokens: 26800000, color: '#a855f7', percentage: 78.2 },
      { name: 'Imágenes (Gemini)', tokens: 3250900, color: '#0ea5e9', percentage: 9.5 },
      { name: 'Audio (Whisper)', tokens: 2400000, color: '#10b981', percentage: 7.0 },
      { name: 'Búsquedas (Embedding)', tokens: 1800000, color: '#fbbf24', percentage: 5.3 },
    ],
    models: [
      { name: 'gemini-2.5-flash (Chat)', type: 'Chat', tokens: 26800000, in: 23100000, out: 3700000, calls: 5310, color: '#a855f7', icon: ChatCircleDots },
      { name: 'gemini-2.5-flash (Imágenes)', type: 'Imágenes', tokens: 3250900, in: 2880200, out: 370700, calls: 410, color: '#0ea5e9', icon: ImageIcon },
      { name: 'whisper-large-v3 (Audio)', type: 'Audio', tokens: 2400000, in: 2400000, out: 0, calls: 1490, color: '#10b981', icon: Microphone },
      { name: 'gemini-embedding (Búsquedas)', type: 'Embedding', tokens: 1800000, in: 1800000, out: 0, calls: 4210, color: '#fbbf24', icon: Tag },
    ],
    logs: [
      { time: '05 Jul 14:15', type: 'Chat', model: 'gemini-2.5-flash', tokens: 5320, status: 'success' },
      { time: '02 Jul 18:22', type: 'Imágenes', model: 'gemini-2.5-flash', tokens: 8500, status: 'success' },
      { time: '28 Jun 11:05', type: 'Audio', model: 'whisper-large-v3', tokens: 1760, status: 'success' },
      { time: '25 Jun 16:30', type: 'Búsqueda', model: 'text-embedding-004', tokens: 280, status: 'success' },
      { time: '20 Jun 10:14', type: 'Chat', model: 'gemini-2.5-flash', tokens: 9450, status: 'success' },
    ]
  }
};

type PeriodKey = 'hoy' | 'semana' | 'mes';

export default function ControlRoomPage() {
  const [period, setPeriod] = useState<PeriodKey>('hoy');
  
  const currentData = FILTER_DATA[period];

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
              <Cpu size={20} weight="fill" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Centro de Control</h1>
          </div>
          <p className="text-xs text-slate-400">
            Monitoreo técnico de consumo de tokens y rendimiento del motor de IA.
          </p>
        </div>

        {/* Period Selector Pills */}
        <div className="flex items-center gap-1.5 p-1 bg-white/2 rounded-xl border border-white/5 w-fit">
          {(['hoy', 'semana', 'mes'] as PeriodKey[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                period === p 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/3'
              }`}
            >
              {p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Esta Semana' : 'Este Mes'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Input Card */}
        <div className="glass rounded-2xl p-5 flex items-center justify-between hover:border-indigo-500/30 transition-all group">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Tokens de Entrada
            </span>
            <h3 className="text-2xl font-black text-white group-hover:text-indigo-300 transition-colors">
              {currentData.inputTokens.toLocaleString('es-MX')}
            </h3>
            <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
              <ArrowUpRight size={12} />
              <span>Normal</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-white/2 border border-white/5 flex items-center justify-center text-slate-400 group-hover:bg-indigo-500/10 group-hover:text-indigo-400 transition-all">
            <Coins size={22} />
          </div>
        </div>

        {/* Output Card */}
        <div className="glass rounded-2xl p-5 flex items-center justify-between hover:border-indigo-500/30 transition-all group">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Tokens de Salida
            </span>
            <h3 className="text-2xl font-black text-white group-hover:text-indigo-300 transition-colors">
              {currentData.outputTokens.toLocaleString('es-MX')}
            </h3>
            <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
              <span>Ratio: {(currentData.inputTokens / Math.max(1, currentData.outputTokens)).toFixed(1)}:1 in/out</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-white/2 border border-white/5 flex items-center justify-center text-slate-400 group-hover:bg-indigo-500/10 group-hover:text-indigo-400 transition-all">
            <Coins size={22} weight="fill" />
          </div>
        </div>

        {/* Call Count Card */}
        <div className="glass rounded-2xl p-5 flex items-center justify-between hover:border-indigo-500/30 transition-all group">
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              Peticiones Totales
            </span>
            <h3 className="text-2xl font-black text-white group-hover:text-indigo-300 transition-colors">
              {currentData.calls.toLocaleString('es-MX')}
            </h3>
            <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
              <span>Promedio: {Math.round(currentData.totalTokens / currentData.calls)} tokens/llamada</span>
            </div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-white/2 border border-white/5 flex items-center justify-center text-slate-400 group-hover:bg-indigo-500/10 group-hover:text-indigo-400 transition-all">
            <PhoneCall size={22} />
          </div>
        </div>
      </div>

      {/* Main Charts & Breakdown Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Donut Chart */}
        <div className="lg:col-span-5 glass rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-bold text-white mb-1">Distribución del Consumo</h2>
            <p className="text-[11px] text-slate-400 mb-6">Proporción de tokens consumidos por funcionalidad.</p>
          </div>
          
          <TokenDonut 
            segments={currentData.segments} 
            totalTokens={currentData.totalTokens} 
          />
        </div>

        {/* Right Column: Model Breakdown bars */}
        <div className="lg:col-span-7 glass rounded-2xl p-6 space-y-5">
          <div>
            <h2 className="text-sm font-bold text-white mb-1">Desglose por Modelos</h2>
            <p className="text-[11px] text-slate-400">Consumo técnico detallado registrado localmente.</p>
          </div>

          <div className="space-y-4">
            {currentData.models.map((mod) => {
              const maxTokens = Math.max(...currentData.models.map(m => m.tokens));
              const widthPercentage = (mod.tokens / maxTokens) * 100;
              const ModelIcon = mod.icon;

              return (
                <div key={mod.name} className="space-y-2 p-3 rounded-xl bg-white/1 border border-white/2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
                        style={{ backgroundColor: `${mod.color}15`, color: mod.color }}
                      >
                        <ModelIcon size={15} />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white tracking-tight">{mod.name}</h4>
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-semibold uppercase">
                          {mod.type}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-black text-white">
                        {mod.tokens.toLocaleString('es-MX')}
                      </span>
                      <p className="text-[9px] text-slate-500 font-medium">tokens</p>
                    </div>
                  </div>

                  {/* Progress Bar Container */}
                  <div className="h-2 w-full bg-white/2 rounded-full overflow-hidden">
                    <div 
                      className="h-full rounded-full transition-all duration-500"
                      style={{ 
                        width: `${widthPercentage}%`,
                        background: `linear-gradient(90deg, ${mod.color}cc, ${mod.color})`
                      }}
                    />
                  </div>

                  {/* Internal stats */}
                  <div className="flex items-center justify-between text-[9px] text-slate-400 font-medium pt-1">
                    <div className="flex gap-3">
                      <span>Entrada: <strong className="text-slate-300">{mod.in.toLocaleString('es-MX')}</strong></span>
                      {mod.out > 0 && (
                        <span>Salida: <strong className="text-slate-300">{mod.out.toLocaleString('es-MX')}</strong></span>
                      )}
                    </div>
                    <span>{mod.calls} llamadas</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Row: Recent logs */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold text-white mb-1">Últimas Operaciones</h2>
            <p className="text-[11px] text-slate-400">Últimos eventos registrados y su impacto en tokens.</p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 font-semibold px-2.5 py-1 rounded-lg bg-indigo-500/10">
            <Clock size={12} />
            <span>Tiempo real activo</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/5 text-[10px] text-slate-400 uppercase tracking-wider">
                <th className="py-2.5 px-3">Hora / Evento</th>
                <th className="py-2.5 px-3">Tipo</th>
                <th className="py-2.5 px-3">Modelo Ejecutado</th>
                <th className="py-2.5 px-3 text-right">Consumo</th>
                <th className="py-2.5 px-3 text-center">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/2">
              {currentData.logs.map((log, i) => {
                const color = 
                  log.type === 'Chat' ? '#a855f7' :
                  log.type === 'Imágenes' ? '#0ea5e9' :
                  log.type === 'Audio' ? '#10b981' : '#fbbf24';

                return (
                  <tr key={i} className="hover:bg-white/1 text-xs transition-colors">
                    <td className="py-3 px-3 text-slate-300 font-medium">{log.time}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-[10px] font-semibold text-slate-400 uppercase">{log.type}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">{log.model}</td>
                    <td className="py-3 px-3 text-right font-semibold text-slate-200">
                      {log.tokens.toLocaleString('es-MX')} tkn
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse-soft" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
