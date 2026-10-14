import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Autenticación',
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-white px-4 py-12">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white text-xl font-bold shadow-lg">
          C
        </div>
        <h1 className="text-2xl font-bold text-gray-900">CuotaPro</h1>
        <p className="mt-1 text-sm text-gray-500">Sistema de Cobro en Cuotas</p>
      </div>
      {children}
    </div>
  );
}
