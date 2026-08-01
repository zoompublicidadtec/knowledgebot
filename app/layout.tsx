import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KnowledgeBot SaaS",
  description: "Asistente IA para WhatsApp con memoria vectorial en Supabase",
};

/**
 * El viewport del telefono. Los dos ajustes de abajo son los que permiten que
 * el chat se comporte como una app y no como una pagina.
 *
 * Sin este export, Next pone `width=device-width, initial-scale=1` y nada mas.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // `cover` es lo que hace que `env(safe-area-inset-*)` deje de valer cero en
  // iPhone. La nav movil ya pedia `env(safe-area-inset-bottom)` desde hacia
  // tiempo, pero sin esta linea siempre le respondian 0px: por eso la barra de
  // escribir del chat quedaba pisada por la barra de gestos.
  viewportFit: "cover",
  // Al abrir el teclado, Chrome de Android por defecto solo encoge el viewport
  // *visual*: lo que esta anclado abajo — la barra de escribir — se queda
  // detras del teclado. `resizes-content` encoge tambien el de maquetado, asi
  // que `100dvh` y `position: fixed` reaccionan al teclado como en WhatsApp.
  interactiveWidget: "resizes-content",
  themeColor: "#0a0e1a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Inject supabase environment variables dynamically at runtime */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.__ENV = {
                NEXT_PUBLIC_SUPABASE_URL: ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_URL || "")},
                NEXT_PUBLIC_SUPABASE_ANON_KEY: ${JSON.stringify(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "")}
              };
            `
          }}
        />
        {children}
      </body>
    </html>
  );
}
