'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { History } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { AuditLogEntry } from '@/types/database';

interface AuditLogWithUser extends AuditLogEntry {
  user_profiles?: { full_name: string | null; email: string } | null;
}

const actionLabels: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
  plan_created: { label: 'Plan Creado', variant: 'success' },
  plan_activated: { label: 'Plan Activado', variant: 'success' },
  plan_cancelled: { label: 'Plan Cancelado', variant: 'destructive' },
  payment_recorded: { label: 'Pago Registrado', variant: 'success' },
  payment_deleted: { label: 'Pago Eliminado', variant: 'destructive' },
  installment_edited: { label: 'Cuota Editada', variant: 'warning' },
  client_created: { label: 'Cliente Creado', variant: 'success' },
  client_updated: { label: 'Cliente Actualizado', variant: 'secondary' },
  portfolio_created: { label: 'Cartera Creada', variant: 'success' },
  settings_updated: { label: 'Configuración', variant: 'secondary' },
  user_login: { label: 'Inicio de Sesión', variant: 'secondary' },
  user_logout: { label: 'Cierre de Sesión', variant: 'secondary' },
  two_factor_enabled: { label: '2FA Habilitado', variant: 'success' },
  two_factor_disabled: { label: '2FA Deshabilitado', variant: 'warning' },
  passkey_registered: { label: 'Passkey Registrada', variant: 'success' },
};

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogWithUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const fetchLogs = useCallback(async () => {
    const supabase = createClient();

    const { data: tenantUser } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .maybeSingle() as { data: { tenant_id: string } | null };

    if (!tenantUser) {
      setIsLoading(false);
      return;
    }

    const { count } = await supabase
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantUser.tenant_id);

    setTotal(count || 0);

    const { data } = await supabase
      .from('audit_log')
      .select(`
        *,
        user_profiles(full_name, email)
      `)
      .eq('tenant_id', tenantUser.tenant_id)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    setLogs((data as AuditLogWithUser[]) || []);
    setIsLoading(false);
  }, [page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const columns = [
    {
      key: 'created_at',
      header: 'Fecha',
      cell: (log: AuditLogWithUser) => (
        <div>
          <p className="font-medium">
            {format(new Date(log.created_at), 'dd/MM/yyyy', { locale: es })}
          </p>
          <p className="text-sm text-gray-500">
            {format(new Date(log.created_at), 'HH:mm', { locale: es })}
          </p>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Acción',
      cell: (log: AuditLogWithUser) => (
        <Badge variant={actionLabels[log.action]?.variant || 'secondary'}>
          {actionLabels[log.action]?.label || log.action}
        </Badge>
      ),
    },
    {
      key: 'user',
      header: 'Usuario',
      cell: (log: AuditLogWithUser) => (
        <span className="text-sm">
          {log.user_profiles?.full_name || log.user_profiles?.email || 'Sistema'}
        </span>
      ),
    },
    {
      key: 'entity',
      header: 'Entidad',
      cell: (log: AuditLogWithUser) => (
        <span className="text-sm text-gray-500">
          {log.entity_type ? `${log.entity_type}` : '-'}
        </span>
      ),
    },
    {
      key: 'details',
      header: 'Detalles',
      cell: (log: AuditLogWithUser) => {
        if (log.new_data) {
          const data = log.new_data as Record<string, unknown>;
          const summary = Object.entries(data)
            .slice(0, 2)
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          return (
            <span className="max-w-xs truncate text-sm text-gray-500">{summary}</span>
          );
        }
        return <span className="text-gray-400">-</span>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Registro de Auditoría"
        description="Historial de todas las acciones realizadas en el sistema"
      />

      {!isLoading && logs.length === 0 ? (
        <EmptyState
          icon={History}
          title="No hay registros"
          description="Las acciones realizadas aparecerán aquí"
        />
      ) : (
        <DataTable
          data={logs}
          columns={columns}
          keyExtractor={(log) => log.id}
          isLoading={isLoading}
          emptyMessage="No hay registros de auditoría"
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: setPage,
          }}
        />
      )}
    </>
  );
}
