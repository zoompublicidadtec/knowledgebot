import Link from 'next/link';
import { WhatsappLogo, Robot, CalendarCheck, Lightning, ChatsCircle, Gear, Database } from '@phosphor-icons/react/dist/ssr';

export default function LandingPage() {
  return (
    <div className="min-h-screen" style={{ background: 'radial-gradient(ellipse at top, #1e1b4b 0%, #0a0e1a 50%, #060911 100%)' }}>
      <nav className="glass sticky top-0 z-50 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
              <WhatsappLogo size={20} weight="fill" className="text-white" />
            </div>
            <span className="font-bold text-white">KnowledgeBot</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="btn-ghost text-sm">Ingresar</Link>
            <Link href="/signup" className="btn-primary text-sm">Empezar gratis</Link>
          </div>
        </div>
      </nav>

      <section className="max-w-6xl mx-auto px-6 pt-24 pb-16 text-center">
        <div className="animate-fade-in">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium mb-6" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
            <Lightning size={14} weight="fill" />
            IA por OpenRouter + memoria RAG en Supabase
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-white leading-tight">
            KnowledgeBot
            <br />
            <span style={{ background: 'linear-gradient(135deg, #818cf8, #6366f1, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              para bases de conocimiento grandes
            </span>
          </h1>
          <p className="text-lg mt-6 max-w-2xl mx-auto" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>
            Atiende clientes por WhatsApp con respuestas basadas en tu documentacion,
            politicas, catalogos y procesos internos. Menos improvisacion, mas precision.
          </p>
          <div className="flex items-center justify-center gap-4 mt-8">
            <Link href="/signup" className="btn-primary text-base px-8 py-3">
              Comenzar ahora
            </Link>
            <Link href="#features" className="btn-ghost text-base px-6 py-3">
              Ver caracteristicas
            </Link>
          </div>
        </div>
      </section>

      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-white text-center mb-4">
          Todo lo que necesitas
        </h2>
        <p className="text-center max-w-xl mx-auto mb-12" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
          Una plataforma para automatizar atencion, consulta documental y seguimiento comercial desde WhatsApp.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: Robot, title: 'Agente IA inteligente', desc: 'Responde preguntas, recopila datos y agenda citas automaticamente con IA avanzada.' },
            { icon: Database, title: 'Memoria vectorial RAG', desc: 'Consulta fragmentos confiables desde Supabase antes de responder informacion critica del negocio.' },
            { icon: CalendarCheck, title: 'Agendamiento automatico', desc: 'Sincronizacion con Google Calendar. El bot sugiere horarios y confirma citas al instante.' },
            { icon: ChatsCircle, title: 'Chat en tiempo real', desc: 'Monitorea conversaciones en vivo. Toma el control cuando sea necesario.' },
            { icon: Gear, title: 'Personalizacion total', desc: 'Edita prompt, tono, servicios y horarios para adaptar el bot a cada operacion.' },
            { icon: WhatsappLogo, title: 'WhatsApp integrado', desc: 'Conexion directa con WhatsApp para recibir y enviar mensajes desde el panel.' },
          ].map((feature, i) => (
            <div key={i} className="card hover:border-primary-500/30 transition-all animate-slide-up" style={{ animationDelay: `${i * 0.1}s` }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4" style={{ background: 'rgba(99, 102, 241, 0.15)' }}>
                <feature.icon size={22} className="text-primary-400" />
              </div>
              <h3 className="text-white font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="card text-center py-16" style={{ background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.15), rgba(124, 58, 237, 0.1))', border: '1px solid rgba(99, 102, 241, 0.2)' }}>
          <h2 className="text-3xl font-bold text-white mb-4">Listo para responder con tu propio conocimiento</h2>
          <p className="mb-8" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>
            Crea tu cuenta, conecta WhatsApp y carga tu base documental en Supabase.
          </p>
          <Link href="/signup" className="btn-primary text-base px-8 py-3">
            Empezar gratis
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/5 py-8">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.4)' }}>
            (c) {new Date().getFullYear()} KnowledgeBot. Todos los derechos reservados.
          </p>
          <div className="flex items-center gap-2">
            <WhatsappLogo size={16} style={{ color: 'rgba(148, 163, 184, 0.4)' }} />
            <span className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.4)' }}>Potenciado por IA</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
