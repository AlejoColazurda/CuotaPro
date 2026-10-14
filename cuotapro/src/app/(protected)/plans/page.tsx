'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatCurrency, formatPercentage } from '@/lib/amortization/engine';
import { Plus, Search, FileText, Download } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Plan, Client } from '@/types/database';

interface PlanWithClient extends Plan {
  clients: Pick<Client, 'full_name' | 'dni_cuit'>;
}

const statusLabels: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }
> = {
  draft: { label: 'Borrador', variant: 'secondary' },
  active: { label: 'Activo', variant: 'success' },
  completed: { label: 'Completado', variant: 'default' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
};

const interestTypeLabels: Record<string, string> = {
  fixed_surcharge: 'Recargo Fijo',
  direct_rate: 'Tasa Directa',
  french: 'Sistema Francés',
  zero_interest: 'Sin Interés',
};

export default function PlansPage() {
  const [plans, setPlans] = useState<PlanWithClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchPlans = useCallback(async () => {
    const supabase = createClient();

    const { data: tenantUser } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .maybeSingle() as { data: { tenant_id: string } | null };

    if (!tenantUser) {
      setIsLoading(false);
      return;
    }

    let query = supabase
      .from('plans')
      .select(`
        *,
        clients(full_name, dni_cuit)
      `)
      .eq('tenant_id', tenantUser.tenant_id)
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data } = await query;

    let filteredData = data as PlanWithClient[] || [];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filteredData = filteredData.filter(
        (p) =>
          p.description.toLowerCase().includes(query) ||
          p.clients?.full_name.toLowerCase().includes(query) ||
          p.clients?.dni_cuit.includes(query)
      );
    }

    setPlans(filteredData);
    setIsLoading(false);
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const exportCSV = () => {
    const headers = [
      'Descripción',
      'Cliente',
      'DNI/CUIT',
      'Estado',
      'Tipo Interés',
      'Precio Contado',
      'Total',
      'TNA',
      'TEA',
      'CFT',
      'Cuotas',
      'Fecha Creación',
    ];

    const rows = plans.map((p) => [
      p.description,
      p.clients?.full_name || '',
      p.clients?.dni_cuit || '',
      statusLabels[p.status]?.label || p.status,
      interestTypeLabels[p.interest_type] || p.interest_type,
      (p.cash_price_cents / 100).toFixed(2),
      (p.total_amount_cents / 100).toFixed(2),
      p.tna.toFixed(2),
      p.tea.toFixed(2),
      p.cft.toFixed(2),
      p.num_installments,
      format(new Date(p.created_at), 'dd/MM/yyyy'),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `planes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const columns = [
    {
      key: 'description',
      header: 'Plan',
      cell: (plan: PlanWithClient) => (
        <div>
          <p className="font-medium">{plan.description}</p>
          <p className="text-sm text-gray-500">
            {plan.clients?.full_name} - {plan.clients?.dni_cuit}
          </p>
        </div>
      ),
    },
    {
      key: 'amounts',
      header: 'Monto',
      cell: (plan: PlanWithClient) => (
        <div>
          <p className="font-medium">{formatCurrency(plan.total_amount_cents)}</p>
          <p className="text-sm text-gray-500">
            {plan.num_installments} cuotas
          </p>
        </div>
      ),
    },
    {
      key: 'rates',
      header: 'CFT',
      cell: (plan: PlanWithClient) => (
        <div className="text-sm">
          <p className="font-medium">{formatPercentage(plan.cft)}</p>
          <p className="text-gray-500">TEA: {formatPercentage(plan.tea)}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (plan: PlanWithClient) => (
        <Badge variant={statusLabels[plan.status]?.variant}>
          {statusLabels[plan.status]?.label}
        </Badge>
      ),
    },
    {
      key: 'date',
      header: 'Fecha',
      cell: (plan: PlanWithClient) => (
        <span className="text-sm text-gray-500">
          {format(new Date(plan.created_at), 'dd/MM/yyyy', { locale: es })}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Planes"
        description="Gestioná los planes de financiación de tus clientes"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCSV} disabled={plans.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Link href="/plans/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Nuevo Plan
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-6 flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por descripción o cliente..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="draft">Borrador</SelectItem>
            <SelectItem value="active">Activo</SelectItem>
            <SelectItem value="completed">Completado</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!isLoading && plans.length === 0 && !searchQuery && statusFilter === 'all' ? (
        <EmptyState
          icon={FileText}
          title="No hay planes"
          description="Creá tu primer plan de financiación para comenzar a gestionar cobros"
          action={{
            label: 'Crear Plan',
            onClick: () => (window.location.href = '/plans/new'),
          }}
        />
      ) : (
        <DataTable
          data={plans}
          columns={columns}
          keyExtractor={(plan) => plan.id}
          isLoading={isLoading}
          emptyMessage={
            searchQuery || statusFilter !== 'all'
              ? 'No se encontraron planes'
              : 'No hay planes'
          }
          onRowClick={(plan) => (window.location.href = `/plans/${plan.id}`)}
        />
      )}
    </>
  );
}
