import type { Metadata } from "next";
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
