'use client';

import { useState, useEffect, useRef } from 'react';
import { updateContactStageAction } from '@/lib/conversations/actions';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ChatCircleDots, Robot, User, Clock, Info, X, ArrowsLeftRight, DotsSixVertical } from '@phosphor-icons/react';

const LINE_COLORS = [
  'bg-pink-500', 'bg-violet-500', 'bg-indigo-500', 
  'bg-cyan-500', 'bg-teal-500', 'bg-lime-500', 
  'bg-yellow-500', 'bg-orange-500'
];

interface WhatsAppLine {
  line_key: string;
  display_name: string;
}

const STAGES = [
  { 
    id: 'inbox', 
    label: 'Entrada', 
    color: 'bg-indigo-500', 
    border: 'border-indigo-500/30', 
    bg: 'bg-indigo-950/20', 
    desc: 'Clientes nuevos. La IA les da la bienvenida, responde dudas y realiza cotizaciones autónomamente.' 
  },
  { 
    id: 'unhandled', 
    label: 'Sin Atender', 
    color: 'bg-orange-500', 
    border: 'border-orange-500/30', 
    bg: 'bg-orange-950/20', 
    desc: 'Casos pausados automáticamente por la IA para que intervenga un humano, o asignados manualmente.' 
  },
  { 
    id: 'sales', 
    label: 'Ventas', 
    color: 'bg-blue-500', 
    border: 'border-blue-500/30', 
    bg: 'bg-blue-950/20', 
    desc: 'Clientes en negociación o seguimiento. La IA continúa activa para facilitar el cierre.' 
  },
  { 
    id: 'sold', 
    label: 'Listo para pagar', 
    color: 'bg-emerald-500', 
    border: 'border-emerald-500/30', 
    bg: 'bg-emerald-950/20', 
    // Antes se llamaba "Vendido", y era falso: el bot mueve aquí al cliente
    // cuando DICE que lo toma, no cuando paga. Un bot no puede saber si entró
    // la plata, y quien sí lo sabe (quien concilia o despacha) no entra al
    // panel a arrastrar tarjetas. La etiqueta prometía una venta cerrada que
    // nadie había confirmado.
    desc: 'El cliente aceptó y va a pagar. Falta que una persona confirme el pago y despache. Si vuelve a pedir algo nuevo, sale solo de aquí.' 
  },
  {
    /**
     * COLUMNA DE PRÓXIMA ENTREGA — deliberadamente inactiva.
     *
     * Confirmar que una venta se pagó y se despachó es un acto humano: un bot
     * no puede verificarlo (un comprobante se falsifica, y el peor caso es dar
     * por despachado algo que nadie despachó). Por eso 'sold' se llama ahora
     * "Listo para pagar" y el flujo se detiene ahí.
     *
     * Esta columna queda a la vista, pero bloqueada y rotulada como módulo por
     * llegar. Una columna vacía y sin explicación se lee como algo roto, o peor:
     * alguien empieza a arrastrar tarjetas y el CRM acaba con ventas cerradas
     * que nadie verificó. Rotulada, cumple su función sin ensuciar los datos.
     */
    id: 'closed',
    label: 'Vendido',
    proximamente: true,
    color: 'bg-slate-500',
    border: 'border-slate-500/20 border-dashed',
    bg: 'bg-slate-900/30',
    desc: 'Ventas con pago confirmado y despacho. Requiere confirmación humana y seguimiento de posventa: módulo por activar.'
  },
  { 
    id: 'angry', 
    label: 'Molesto', 
    color: 'bg-rose-500', 
    border: 'border-rose-500/30', 
    bg: 'bg-rose-950/20', 
    desc: 'Clientes insatisfechos. El bot se apaga al 100% de inmediato para control puramente humano.' 
  },
  { 
    id: 'ignore', 
    label: 'Ignorar', 
    color: 'bg-purple-500', 
    border: 'border-purple-500/30', 
    bg: 'bg-purple-950/20', 
    desc: 'Spam, números equivocados o bloqueados. El bot se apaga y no envía ninguna respuesta.' 
  },
];

// Card Move Modal — for mobile touch interaction
function MoveModal({ conv, lines, currentStage, onMove, onClose }: { 
  conv: any; 
  lines: WhatsAppLine[];
  currentStage: string; 
  onMove: (stage: string) => void; 
  onClose: () => void; 
}) {
  return (
    <div 
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div 
        className="w-full max-w-sm rounded-2xl p-5 animate-fade-in"
        style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-slate-400">Mover contacto</p>
            <h3 className="text-sm font-bold text-white truncate">
              {conv.contacts?.full_name || conv.contacts?.wa_phone}
            </h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {STAGES.map(stage => (
            <button
              key={stage.id}
              onClick={() => { onMove(stage.id); onClose(); }}
              disabled={stage.id === currentStage}
              className={`flex items-center gap-2 p-3 rounded-xl text-xs font-semibold text-left transition-all border ${
                stage.id === currentStage
                  ? 'opacity-40 cursor-not-allowed border-white/5 bg-white/5'
                  : `${stage.bg} ${stage.border} hover:brightness-125 text-white`
              }`}
            >
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${stage.color}`} />
              <span className="truncate">{stage.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function KanbanBoard({ initialConversations, orgId }: { initialConversations: any[], orgId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [conversations, setConversations] = useState(initialConversations);
  const [lines, setLines] = useState<WhatsAppLine[]>([]);
  const [selectedLine, setSelectedLine] = useState<string>('Todas');
  const [showGuide, setShowGuide] = useState(false);
  const [scrollDirection, setScrollDirection] = useState<'left' | 'right' | null>(null);
  const [moveTarget, setMoveTarget] = useState<any | null>(null);

  // Desktop drag state
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeftVal, setScrollLeftVal] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  const filteredConversations = selectedLine === 'Todas' 
    ? conversations 
    : conversations.filter(c => c.line_key === selectedLine);

  const columns = STAGES.map(stage => ({
    ...stage,
    items: filteredConversations.filter(c => {
      const cStage = c.contacts?.metadata?.stage || 'inbox';
      return cStage === stage.id;
    })
  }));

  // Real-time updates
  useEffect(() => {
    const channel = supabase.channel('kanban_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contacts' }, () => router.refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => router.refresh())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, router]);

  useEffect(() => {
    const fetchLines = async () => {
      const { data } = await (supabase as any).from('whatsapp_lines').select('line_key, display_name').order('created_at');
      if (data) setLines(data);
    };
    fetchLines();
    const saved = localStorage.getItem('kb_selected_line');
    if (saved) setSelectedLine(saved);
  }, [supabase]);

  useEffect(() => {
    setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0);
    setIsMounted(true);
  }, []);

  useEffect(() => { setConversations(initialConversations); }, [initialConversations]);

  // Auto-scroll edge detection when drag-drop
  useEffect(() => {
    if (!scrollDirection) return;
    const interval = setInterval(() => {
      const container = document.getElementById('kanban-board-container');
      if (container) container.scrollLeft += scrollDirection === 'right' ? 15 : -15;
    }, 25);
    return () => clearInterval(interval);
  }, [scrollDirection]);

  async function moveCard(contactId: string, targetStage: string) {
    setConversations(prev => prev.map(c => {
      if (c.contact_id === contactId) {
        return {
          ...c,
          bot_active: ['inbox', 'sales', 'sold'].includes(targetStage),
          contacts: {
            ...c.contacts,
            metadata: { ...(c.contacts.metadata || {}), stage: targetStage }
          }
        };
      }
      return c;
    }));
    await updateContactStageAction(contactId, targetStage);
    router.refresh();
  }

  // Desktop drag handlers
  const handleDragStart = (e: React.DragEvent, contactId: string) => {
    e.stopPropagation();
    e.dataTransfer.setData('contactId', contactId);
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = async (e: React.DragEvent, targetStage: string) => {
    e.preventDefault();
    setScrollDirection(null);
    const contactId = e.dataTransfer.getData('contactId');
    if (!contactId) return;
    await moveCard(contactId, targetStage);
  };
  const handleBoardDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX;
    if (mouseX > rect.right - 100) setScrollDirection('right');
    else if (mouseX < rect.left + 100) setScrollDirection('left');
    else setScrollDirection(null);
  };

  // Desktop mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[draggable="true"]')) return;
    setIsDragging(true);
    setStartX(e.pageX - e.currentTarget.offsetLeft);
    setScrollLeftVal(e.currentTarget.scrollLeft);
  };
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.preventDefault();
    const x = e.pageX - e.currentTarget.offsetLeft;
    e.currentTarget.scrollLeft = scrollLeftVal - (x - startX) * 2;
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        .kanban-scroll { -webkit-overflow-scrolling: touch; scroll-snap-type: x proximity; scrollbar-width: thin; scrollbar-color: rgba(99,102,241,0.65) rgba(15,23,42,0.6); }
        .kanban-scroll::-webkit-scrollbar { height: 12px; }
        .kanban-scroll::-webkit-scrollbar-track { background: rgba(15,23,42,0.6); border-radius: 8px; border: 1px solid rgba(148,163,184,0.08); }
        .kanban-scroll::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(129,140,248,0.85), rgba(99,102,241,0.65)); border-radius: 8px; border: 2px solid rgba(10,14,26,0.5); }
        .kanban-scroll::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(165,180,252,1), rgba(129,140,248,0.85)); }
        .kanban-scroll::-webkit-scrollbar-thumb:active { background: rgba(99,102,241,0.95); }
        .kanban-scroll { overscroll-behavior-x: contain; }
        .kanban-col { scroll-snap-align: start; }
      `}} />

      {/* Move Modal for mobile */}
      {moveTarget && (
        <MoveModal 
          conv={moveTarget}
          lines={lines}
          currentStage={moveTarget.contacts?.metadata?.stage || 'inbox'}
          onMove={(stage) => moveCard(moveTarget.contact_id, stage)}
          onClose={() => setMoveTarget(null)}
        />
      )}

      {/* Line Tabs + Guide toggle */}
      <div className="flex flex-col gap-3 mb-4">
        {lines.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            <button
              onClick={() => { setSelectedLine('Todas'); localStorage.setItem('kb_selected_line', 'Todas'); }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                selectedLine === 'Todas'
                  ? 'bg-primary-500/20 text-primary-300 border border-primary-500/40'
                  : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10 hover:text-white'
              }`}
            >
              Todas
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10">{conversations.length}</span>
            </button>
            {lines.map((line, idx) => (
              <button
                key={line.line_key}
                onClick={() => { setSelectedLine(line.line_key); localStorage.setItem('kb_selected_line', line.line_key); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                  selectedLine === line.line_key
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'bg-white/5 text-slate-400 border border-white/5 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${LINE_COLORS[idx % LINE_COLORS.length]}`} />
                {line.display_name}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10">
                  {conversations.filter(c => c.line_key === line.line_key).length}
                </span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => setShowGuide(!showGuide)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 hover:text-white transition-all w-max"
        >
          <Info size={13} weight="fill" className="text-primary-400" />
          {showGuide ? 'Ocultar guía' : 'Guía IA vs Humano'}
        </button>
      </div>

      {/* Guide Banner */}
      {showGuide && (
        <div className="glass p-4 rounded-2xl border border-white/10 mb-5 bg-slate-900/60 shadow-xl relative animate-fade-in">
          <button onClick={() => setShowGuide(false)} className="absolute top-3 right-3 p-1 rounded-full hover:bg-white/10 text-slate-400">
            <X size={15} />
          </button>
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Robot size={16} className="text-primary-400" /> Guía: IA vs. Control Humano
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {STAGES.map(s => {
              const porVenir = (s as any).proximamente;
              const isBotActive = ['inbox', 'sales', 'sold'].includes(s.id);
              return (
                <div key={s.id} className="p-3 rounded-xl bg-slate-950/40 border border-white/5">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full ${s.color}`} />
                    <span className="text-xs font-bold text-white">{s.label}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ml-auto ${porVenir ? 'bg-primary-500/10 text-primary-300 border border-primary-500/30' : isBotActive ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'}`}>
                      {porVenir ? 'Próximamente' : isBotActive ? '🤖 IA' : '👤 Humano'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scrollable Kanban Container — touch-friendly */}
      <div 
        id="kanban-board-container"
        className={`flex gap-3 overflow-x-auto pb-6 h-full min-h-[500px] items-start kanban-scroll w-full ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
        onMouseDown={handleMouseDown}
        onMouseLeave={() => setIsDragging(false)}
        onMouseUp={() => setIsDragging(false)}
        onMouseMove={handleMouseMove}
        onDragOver={handleBoardDragOver}
        onDragLeave={() => setScrollDirection(null)}
        onDragEnd={() => setScrollDirection(null)}
        onDrop={() => setScrollDirection(null)}
      >
        {columns.map(col => (
          <div 
            key={col.id}
            className={`kanban-col flex-shrink-0 rounded-2xl border ${col.border} ${col.bg} p-3 flex flex-col`}
            style={{ width: 'min(288px, 82vw)' }}
            onDragOver={(col as any).proximamente ? undefined : handleDragOver}
            onDrop={(col as any).proximamente ? undefined : (e) => handleDrop(e, col.id)}
          >
            {/* Column header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                  <h3 className="font-bold text-white text-sm">{col.label}</h3>
                </div>
                {(col as any).proximamente ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-300 border border-primary-500/30 flex items-center gap-1 w-max">
                    Próximamente
                  </span>
                ) : ['inbox', 'sales', 'sold'].includes(col.id) ? (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1 w-max">
                    <Robot size={10} weight="fill" /> IA Activa
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1 w-max">
                    <User size={10} weight="fill" /> Solo Humano
                  </span>
                )}
              </div>
              <span className="text-xs bg-slate-800/60 text-slate-400 px-2 py-1 rounded-full font-medium">
                {col.items.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2.5 min-h-[80px]">
              {/* Columna por activar: explica qué haría, para que no se lea
                  como una función rota ni invite a arrastrar tarjetas. */}
              {(col as any).proximamente && (
                <div className="p-3 rounded-xl border border-dashed border-slate-600/40 bg-slate-950/30 space-y-2">
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Aquí irían las ventas con <strong className="text-slate-300">pago confirmado
                    y despacho</strong>, para hacerles seguimiento de posventa.
                  </p>
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    Confirmar un pago es una decisión humana: el bot no puede verificarlo, y darlo
                    por hecho sería peor que no tenerlo. Por eso el flujo termina en «Listo para
                    pagar».
                  </p>
                  <p className="text-[10px] text-primary-300/80 font-medium">
                    Módulo de posventa · por activar
                  </p>
                </div>
              )}
              {col.items.map(conv => (
                /*
                 * La tarjeta NO es arrastrable: se arrastra desde el asa de la
                 * izquierda. Cuando la tarjeta entera lo era, el navegador
                 * convertia el clic en arrastre en cuanto el raton se movia un
                 * pixel, y abrir el chat fallaba de forma intermitente.
                 */
                <div
                  key={conv.id}
                  onClick={() => router.push(`/conversaciones/${conv.id}`)}
                  className="bg-slate-900 border border-slate-700/50 p-3 rounded-xl hover:border-primary-500/40 transition-all shadow-md group relative flex flex-col gap-2 cursor-pointer"
                >
                  {/* Name + line dot */}
                  <div className="flex items-start justify-between gap-1">
                    {!isMobile && (
                      <span
                        draggable
                        onDragStart={(e) => handleDragStart(e, conv.contact_id)}
                        onDragEnd={() => setScrollDirection(null)}
                        onClick={(e) => e.stopPropagation()}
                        title="Arrastre desde aqui para mover la tarjeta de columna"
                        className="shrink-0 -ml-1 p-0.5 rounded text-slate-600 hover:text-primary-300 hover:bg-white/5 cursor-grab active:cursor-grabbing transition-colors"
                      >
                        <DotsSixVertical size={16} weight="bold" />
                      </span>
                    )}
                    <h4 className="font-semibold text-white text-sm truncate flex-1 hover:text-primary-450">
                      {conv.contacts?.full_name || conv.contacts?.wa_phone}
                    </h4>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {conv.line_key && lines.length > 0 && (
                        <div 
                          className={`w-2.5 h-2.5 rounded-full ${LINE_COLORS[lines.findIndex(l => l.line_key === conv.line_key) % LINE_COLORS.length]}`}
                          title={`Línea: ${lines.find(l => l.line_key === conv.line_key)?.display_name}`}
                        />
                      )}
                      {/* Mobile move button */}
                      <button
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white transition-all"
                        onClick={(e) => { e.stopPropagation(); setMoveTarget(conv); }}
                        title="Mover a otra columna"
                      >
                        <ArrowsLeftRight size={14} />
                      </button>
                    </div>
                  </div>
                  
                  {/* Phone + date */}
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="truncate max-w-[110px] font-mono opacity-70">{conv.contacts?.wa_phone}</span>
                    <div className="flex items-center gap-1 opacity-70">
                      <Clock size={11} />
                      <span>{isMounted ? new Date(conv.last_message_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</span>
                    </div>
                  </div>

                  {/* Bot badge */}
                  <div className="pt-1.5 border-t border-white/5 flex items-center justify-between">
                    {conv.bot_active ? (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                        <Robot size={9} weight="fill" /> IA Activa
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-1">
                        <User size={9} weight="fill" /> Control Humano
                      </span>
                    )}
                    <span className="text-[9px] text-slate-500 group-hover:text-primary-400 transition-colors">
                      Ver chat →
                    </span>
                  </div>
                </div>
              ))}
              
              {col.items.length === 0 && (
                <div className="text-center py-5 text-xs text-slate-600 border border-dashed border-slate-700/40 rounded-xl">
                  <ChatCircleDots size={20} className="mx-auto mb-1.5 opacity-40" />
                  Arrastra aquí
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
