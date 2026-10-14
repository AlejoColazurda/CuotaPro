'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { StatsCard } from '@/components/ui/stats-card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/amortization/engine';
import {
  CreditCard,
  Clock,
  AlertTriangle,
  CheckCircle,
  Download,
  Calendar,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Installment, Plan, Client } from '@/types/database';

interface InstallmentWithPlan extends Installment {
  plans: Pick<Plan, 'id' | 'description' | 'tenant_id'> & {
    clients: Pick<Client, 'full_name' | 'dni_cuit' | 'phone' | 'whatsapp_opt_in'>;
  };
}

interface InstallmentForStats {
  id: string;
  status: string;
  total_cents: number;
  paid_cents: number;
  due_date: string;
  updated_at: string;
  plans: { tenant_id: string; status: string };
}

const statusLabels: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }
> = {
  pending: { label: 'Pendiente', variant: 'secondary' },
  partial: { label: 'Parcial', variant: 'warning' },
  paid: { label: 'Pagado', variant: 'success' },
  overdue: { label: 'Vencido', variant: 'destructive' },
};

export default function PaymentsPage() {
  const [installments, setInstallments] = useState<InstallmentWithPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'paid'>('pending');

  const [stats, setStats] = useState({
    pendingCount: 0,
    pendingAmount: 0,
    overdueCount: 0,
    overdueAmount: 0,
    thisMonthCollected: 0,
  });

  const fetchInstallments = useCallback(async () => {
    const supabase = createClient();

    const { data: tenantUser } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .single() as { data: { tenant_id: string } | null };

    if (!tenantUser) return;

    let query = supabase
      .from('installments')
      .select(`
        *,
        plans!inner(
          id, description, tenant_id, status,
          clients(full_name, dni_cuit, phone, whatsapp_opt_in)
        )
      `)
      .eq('plans.tenant_id', tenantUser.tenant_id)
      .eq('plans.status', 'active')
      .order('due_date', { ascending: true });

    if (filter === 'pending') {
      query = query.in('status', ['pending', 'partial']);
    } else if (filter === 'overdue') {
      query = query.in('status', ['pending', 'partial']).lt('due_date', new Date().toISOString());
    } else if (filter === 'paid') {
      query = query.eq('status', 'paid');
    }

    const { data } = await query;

    const installmentsData = (data as InstallmentWithPlan[]) || [];
    setInstallments(installmentsData);

    const today = new Date();
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonth(today);

    const allInstallments = await supabase
      .from('installments')
      .select(`
        *,
        plans!inner(tenant_id, status)
      `)
      .eq('plans.tenant_id', tenantUser.tenant_id)
      .eq('plans.status', 'active');

    const all = (allInstallments.data || []) as InstallmentForStats[];

    const pending = all.filter((i) => i.status === 'pending' || i.status === 'partial');
    const overdue = pending.filter((i) => new Date(i.due_date) < today);
    const paidThisMonth = all.filter(
      (i) =>
        i.status === 'paid' &&
        i.updated_at &&
        isWithinInterval(new Date(i.updated_at), { start: monthStart, end: monthEnd })
    );

    setStats({
      pendingCount: pending.length,
      pendingAmount: pending.reduce((sum, i) => sum + (i.total_cents - i.paid_cents), 0),
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((sum, i) => sum + (i.total_cents - i.paid_cents), 0),
      thisMonthCollected: paidThisMonth.reduce((sum, i) => sum + i.paid_cents, 0),
    });

    setIsLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchInstallments();
  }, [fetchInstallments]);

  const exportCSV = () => {
    const headers = [
      'Cliente',
      'DNI/CUIT',
      'Plan',
      'Cuota',
      'Vencimiento',
      'Monto',
      'Pagado',
      'Pendiente',
      'Estado',
    ];

    const rows = installments.map((i) => {
      const isOverdue = ['pending', 'partial'].includes(i.status) && new Date(i.due_date) < new Date();
      return [
        i.plans.clients.full_name,
        i.plans.clients.dni_cuit,
        i.plans.description,
        i.number,
        format(new Date(i.due_date), 'dd/MM/yyyy'),
        (i.total_cents / 100).toFixed(2),
        (i.paid_cents / 100).toFixed(2),
        ((i.total_cents - i.paid_cents) / 100).toFixed(2),
        isOverdue ? 'Vencido' : statusLabels[i.status]?.label || i.status,
      ];
    });

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cuotas_${filter}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const columns = [
    {
      key: 'client',
      header: 'Cliente',
      cell: (inst: InstallmentWithPlan) => (
        <div>
          <p className="font-medium">{inst.plans.clients.full_name}</p>
          <p className="text-sm text-gray-500">{inst.plans.description}</p>
        </div>
      ),
    },
    {
      key: 'installment',
      header: 'Cuota',
      cell: (inst: InstallmentWithPlan) => (
        <span className="font-medium">N° {inst.number}</span>
      ),
    },
    {
      key: 'due_date',
      header: 'Vencimiento',
      cell: (inst: InstallmentWithPlan) => {
        const dueDate = new Date(inst.due_date);
        const isOverdue = ['pending', 'partial'].includes(inst.status) && dueDate < new Date();
        return (
          <span className={isOverdue ? 'font-medium text-red-600' : ''}>
            {format(dueDate, 'dd/MM/yyyy', { locale: es })}
          </span>
        );
      },
    },
    {
      key: 'amount',
      header: 'Monto',
      cell: (inst: InstallmentWithPlan) => (
        <div className="text-right">
          <p className="font-medium">{formatCurrency(inst.total_cents)}</p>
          {inst.paid_cents > 0 && inst.paid_cents < inst.total_cents && (
            <p className="text-sm text-green-600">
              Pagado: {formatCurrency(inst.paid_cents)}
            </p>
          )}
        </div>
      ),
      className: 'text-right',
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (inst: InstallmentWithPlan) => {
        const isOverdue =
          ['pending', 'partial'].includes(inst.status) &&
          new Date(inst.due_date) < new Date();
        return (
          <Badge variant={isOverdue ? 'destructive' : statusLabels[inst.status]?.variant}>
            {isOverdue ? 'Vencido' : statusLabels[inst.status]?.label}
          </Badge>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Pagos"
        description="Gestión de cuotas y cobranzas"
        actions={
          <Button variant="outline" onClick={exportCSV} disabled={installments.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Cuotas Pendientes"
              value={stats.pendingCount.toString()}
              description={formatCurrency(stats.pendingAmount)}
              icon={Clock}
            />
            <StatsCard
              title="Cuotas Vencidas"
              value={stats.overdueCount.toString()}
              description={formatCurrency(stats.overdueAmount)}
              icon={AlertTriangle}
              className={stats.overdueCount > 0 ? 'border-red-200 bg-red-50' : ''}
            />
            <StatsCard
              title="Cobrado este Mes"
              value={formatCurrency(stats.thisMonthCollected)}
              icon={CheckCircle}
            />
            <StatsCard
              title="Total por Cobrar"
              value={formatCurrency(stats.pendingAmount + stats.overdueAmount)}
              icon={CreditCard}
            />
          </div>

          <div className="mb-6 flex gap-2">
            {(['pending', 'overdue', 'paid', 'all'] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(f)}
              >
                {f === 'pending' && 'Pendientes'}
                {f === 'overdue' && 'Vencidas'}
                {f === 'paid' && 'Pagadas'}
                {f === 'all' && 'Todas'}
              </Button>
            ))}
          </div>

          {installments.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title={
                filter === 'pending'
                  ? 'No hay cuotas pendientes'
                  : filter === 'overdue'
                  ? 'No hay cuotas vencidas'
                  : 'No hay cuotas'
              }
              description="Las cuotas aparecerán aquí cuando actives planes de financiación"
            />
          ) : (
            <DataTable
              data={installments}
              columns={columns}
              keyExtractor={(inst) => inst.id}
              onRowClick={(inst) => (window.location.href = `/plans/${inst.plans.id}`)}
            />
          )}
        </>
      )}
    </>
  );
}
