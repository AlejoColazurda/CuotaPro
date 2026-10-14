'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { StatsCard } from '@/components/ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/amortization/engine';
import {
  Users,
  FileText,
  CreditCard,
  AlertTriangle,
  Plus,
  ChevronRight,
  Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface DashboardStats {
  totalClients: number;
  activePlans: number;
  pendingInstallments: number;
  overdueInstallments: number;
  totalPendingAmount: number;
  totalOverdueAmount: number;
}

interface RecentPlan {
  id: string;
  description: string;
  status: string;
  client_name: string;
  total_amount_cents: number;
  created_at: string;
}

interface UpcomingInstallment {
  id: string;
  number: number;
  due_date: string;
  total_cents: number;
  plan_description: string;
  client_name: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentPlans, setRecentPlans] = useState<RecentPlan[]>([]);
  const [upcomingInstallments, setUpcomingInstallments] = useState<UpcomingInstallment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('tenant_id')
        .single() as { data: { tenant_id: string } | null };

      if (!tenantUser) return;

      const tenantId = tenantUser.tenant_id;

      const [clientsRes, plansRes, installmentsRes] = await Promise.all([
        supabase
          .from('clients')
          .select('id', { count: 'exact' })
          .eq('tenant_id', tenantId),
        supabase
          .from('plans')
          .select('id, status', { count: 'exact' })
          .eq('tenant_id', tenantId)
          .eq('status', 'active'),
        supabase
          .from('installments')
          .select(`
            id, status, total_cents, paid_cents, due_date,
            plans!inner(tenant_id)
          `)
          .eq('plans.tenant_id', tenantId)
          .in('status', ['pending', 'partial', 'overdue']),
      ]);

      const pendingInstallments = installmentsRes.data?.filter(
        (i) => i.status === 'pending' || i.status === 'partial'
      ) || [];
      const overdueInstallments = installmentsRes.data?.filter(
        (i) => i.status === 'overdue' || (new Date(i.due_date) < new Date() && i.status !== 'paid')
      ) || [];

      const totalPending = pendingInstallments.reduce(
        (sum, i) => sum + (i.total_cents - i.paid_cents),
        0
      );
      const totalOverdue = overdueInstallments.reduce(
        (sum, i) => sum + (i.total_cents - i.paid_cents),
        0
      );

      setStats({
        totalClients: clientsRes.count || 0,
        activePlans: plansRes.count || 0,
        pendingInstallments: pendingInstallments.length,
        overdueInstallments: overdueInstallments.length,
        totalPendingAmount: totalPending,
        totalOverdueAmount: totalOverdue,
      });

      const { data: recent } = await supabase
        .from('plans')
        .select(`
          id, description, status, total_amount_cents, created_at,
          clients(full_name)
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(5);

      setRecentPlans(
        recent?.map((p) => ({
          id: p.id,
          description: p.description,
          status: p.status,
          client_name: (p.clients as { full_name: string })?.full_name || 'Sin cliente',
          total_amount_cents: p.total_amount_cents,
          created_at: p.created_at,
        })) || []
      );

      const { data: upcoming } = await supabase
        .from('installments')
        .select(`
          id, number, due_date, total_cents,
          plans!inner(description, tenant_id, clients(full_name))
        `)
        .eq('plans.tenant_id', tenantId)
        .in('status', ['pending', 'partial'])
        .gte('due_date', new Date().toISOString().split('T')[0])
        .order('due_date', { ascending: true })
        .limit(5);

      setUpcomingInstallments(
        upcoming?.map((i) => ({
          id: i.id,
          number: i.number,
          due_date: i.due_date,
          total_cents: i.total_cents,
          plan_description: (i.plans as { description: string }).description,
          client_name: ((i.plans as { clients: { full_name: string } }).clients)?.full_name || 'Sin cliente',
        })) || []
      );

      setIsLoading(false);
    };

    fetchData();
  }, []);

  const statusLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
    draft: { label: 'Borrador', variant: 'secondary' },
    active: { label: 'Activo', variant: 'success' },
    completed: { label: 'Completado', variant: 'default' },
    cancelled: { label: 'Cancelado', variant: 'destructive' },
  };

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Resumen de tu actividad"
        actions={
          <Link href="/plans/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Plan
            </Button>
          </Link>
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatsCard
              title="Clientes"
              value={stats?.totalClients.toString() || '0'}
              icon={Users}
            />
            <StatsCard
              title="Planes Activos"
              value={stats?.activePlans.toString() || '0'}
              icon={FileText}
            />
            <StatsCard
              title="Por Cobrar"
              value={formatCurrency(stats?.totalPendingAmount || 0)}
              description={`${stats?.pendingInstallments || 0} cuotas pendientes`}
              icon={CreditCard}
            />
            <StatsCard
              title="En Mora"
              value={formatCurrency(stats?.totalOverdueAmount || 0)}
              description={`${stats?.overdueInstallments || 0} cuotas vencidas`}
              icon={AlertTriangle}
              className={stats?.overdueInstallments ? 'border-red-200 bg-red-50' : ''}
            />
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Planes Recientes</CardTitle>
                <Link href="/plans">
                  <Button variant="ghost" size="sm">
                    Ver todos
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {recentPlans.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-500">
                    No hay planes todavía.{' '}
                    <Link href="/plans/new" className="text-blue-600 hover:underline">
                      Crear uno
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentPlans.map((plan) => (
                      <Link
                        key={plan.id}
                        href={`/plans/${plan.id}`}
                        className="flex items-center justify-between rounded-lg border border-gray-100 p-3 transition-colors hover:bg-gray-50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">
                            {plan.description}
                          </p>
                          <p className="text-sm text-gray-500">{plan.client_name}</p>
                        </div>
                        <div className="ml-4 flex items-center gap-3">
                          <span className="text-sm font-medium text-gray-900">
                            {formatCurrency(plan.total_amount_cents)}
                          </span>
                          <Badge variant={statusLabels[plan.status]?.variant}>
                            {statusLabels[plan.status]?.label}
                          </Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">Próximos Vencimientos</CardTitle>
                <Link href="/payments">
                  <Button variant="ghost" size="sm">
                    Ver todos
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent>
                {upcomingInstallments.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-500">
                    No hay cuotas próximas a vencer
                  </div>
                ) : (
                  <div className="space-y-4">
                    {upcomingInstallments.map((inst) => (
                      <div
                        key={inst.id}
                        className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-gray-900">
                            {inst.client_name}
                          </p>
                          <p className="text-sm text-gray-500">
                            Cuota {inst.number} - {inst.plan_description}
                          </p>
                        </div>
                        <div className="ml-4 text-right">
                          <p className="font-medium text-gray-900">
                            {formatCurrency(inst.total_cents)}
                          </p>
                          <p className="flex items-center justify-end gap-1 text-sm text-gray-500">
                            <Clock className="h-3 w-3" />
                            {format(new Date(inst.due_date), 'dd MMM', { locale: es })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
