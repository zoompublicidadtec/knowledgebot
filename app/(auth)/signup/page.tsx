'use client';

import { useState } from 'react';
import { signupAction } from '@/lib/auth/actions';
import Link from 'next/link';
import { WhatsappLogo, EnvelopeSimple, Lock, Buildings, SpinnerGap, Eye, EyeSlash } from '@phosphor-icons/react';

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    const result = await signupAction(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'radial-gradient(ellipse at top, #1e1b4b 0%, #0a0e1a 50%, #060911 100%)' }}>
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
            <WhatsappLogo size={32} weight="fill" className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">KnowledgeBot</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>Crea tu cuenta y empieza hoy</p>
        </div>

        {/* Form */}
        <div className="glass rounded-2xl p-8">
          <h2 className="text-lg font-semibold text-white mb-6">Crear cuenta</h2>

          {error && (
            <div className="mb-4 p-3 rounded-xl text-sm" style={{ background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.2)', color: '#fb7185' }}>
              {error}
            </div>
          )}

          <form action={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'rgba(148, 163, 184, 0.8)' }}>
                Nombre del negocio
              </label>
              <div className="relative">
                <Buildings size={18} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(148, 163, 184, 0.5)' }} />
                <input
                  name="businessName"
                  type="text"
                  required
                  className="input pl-10"
                  placeholder="Mi Empresa"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'rgba(148, 163, 184, 0.8)' }}>
                Correo electrónico
              </label>
              <div className="relative">
                <EnvelopeSimple size={18} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(148, 163, 184, 0.5)' }} />
                <input
                  name="email"
                  type="email"
                  required
                  className="input pl-10"
                  placeholder="tu@email.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'rgba(148, 163, 184, 0.8)' }}>
                Contraseña
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgba(148, 163, 184, 0.5)' }} />
                <input
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="input pl-10 pr-10"
                  placeholder="Mínimo 6 caracteres"
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 hover:text-white transition-colors"
                  style={{ color: 'rgba(148, 163, 184, 0.5)' }}
                >
                  {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full mt-2"
            >
              {loading ? <SpinnerGap size={18} className="animate-spin" /> : null}
              {loading ? 'Creando cuenta...' : 'Crear cuenta'}
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
            ¿Ya tienes cuenta?{' '}
            <Link href="/login" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
