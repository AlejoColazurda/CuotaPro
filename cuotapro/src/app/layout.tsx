import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: {
    default: 'CuotaPro - Sistema de Cobro en Cuotas',
    template: '%s | CuotaPro',
  },
  description:
    'Plataforma de gestión de cobros en cuotas. Administrá tus clientes, planes de financiación y pagos de forma simple y eficiente.',
  keywords: ['cuotas', 'financiación', 'cobros', 'pagos', 'argentina', 'pymes'],
  authors: [{ name: 'POTENCIAPP' }],
  robots: 'noindex, nofollow',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#2563eb',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="min-h-screen font-sans">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'white',
              border: '1px solid #e5e7eb',
              padding: '16px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            },
          }}
          closeButton
          richColors
        />
      </body>
    </html>
  );
}
