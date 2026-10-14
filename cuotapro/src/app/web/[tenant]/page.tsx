interface TenantPageProps {
  params: Promise<{ tenant: string }>;
}

export default async function TenantPage({ params }: TenantPageProps) {
  const { tenant } = await params;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-white px-4">
      <div className="text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 text-white text-2xl font-bold shadow-lg">
          C
        </div>
        <h1 className="mb-2 text-3xl font-bold text-gray-900">
          Portal de Pagos
        </h1>
        <p className="mb-8 text-gray-500">
          {tenant.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
        </p>
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <p className="text-gray-600">
            Portal del cliente en construcción.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Próximamente podrás consultar tus cuotas y realizar pagos aquí.
          </p>
        </div>
      </div>
    </div>
  );
}

export async function generateMetadata({ params }: TenantPageProps) {
  const { tenant } = await params;
  const tenantName = tenant.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  
  return {
    title: `${tenantName} - Portal de Pagos`,
    description: `Portal de pagos de ${tenantName}`,
  };
}
