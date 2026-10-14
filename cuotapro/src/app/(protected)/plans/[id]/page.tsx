'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { LoadingPage } from '@/components/ui/spinner';
import { ErrorState } from '@/components/ui/error-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { formatCurrency, formatPercentage, calculatePenalty } from '@/lib/amortization/engine';
import {
  CheckCircle,
  XCircle,
  Play,
  MessageSquare,
  DollarSign,
  AlertTriangle,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Plan, Installment, Client, Payment, Tenant } from '@/types/database';

interface PlanDetail extends Plan {
  clients: Client;
  installments: Installment[];
  payments: Payment[];
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

const paymentStatusLabels: Record<
  string,
  { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }
> = {
  pending: { label: 'Pendiente', variant: 'secondary' },
  partial: { label: 'Parcial', variant: 'warning' },
  paid: { label: 'Pagado', variant: 'success' },
  overdue: { label: 'Vencido', variant: 'destructive' },
};

export default function PlanDetailPage() {
  const params = useParams();
  const planId = params.id as string;

  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isActivateDialogOpen, setIsActivateDialogOpen] = useState(false);
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [selectedInstallment, setSelectedInstallment] = useState<Installment | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchPlan = useCallback(async () => {
    const supabase = createClient();

    const { data: tenantUser } = await supabase
      .from('tenant_users')
      .select('tenant_id, tenants(*)')
      .single() as { data: { tenant_id: string; tenants: unknown } | null };

    if (!tenantUser) {
      setError('No se encontró el tenant');
      setIsLoading(false);
      return;
    }

    setTenant(tenantUser.tenants as Tenant);

    const { data, error: fetchError } = await supabase
      .from('plans')
      .select(`
        *,
        clients(*),
        installments(*),
        payments(*)
      `)
      .eq('id', planId)
      .eq('tenant_id', tenantUser.tenant_id)
      .single();

    if (fetchError || !data) {
      setError('No se encontró el plan');
      setIsLoading(false);
      return;
    }

    const installments = (data.installments as Installment[]).sort(
      (a, b) => a.number - b.number
    );

    setPlan({
      ...data,
      installments,
    } as PlanDetail);
    setIsLoading(false);
  }, [planId]);

  useEffect(() => {
    fetchPlan();
  }, [fetchPlan]);

  const handleActivate = async () => {
    if (!plan) return;
    setIsProcessing(true);

    const supabase = createClient();

    const { error } = await supabase
      .from('plans')
      .update({
        status: 'active',
        activated_at: new Date().toISOString(),
      })
      .eq('id', plan.id);

    if (error) {
      toast.error('Error al activar el plan');
    } else {
      await supabase.from('audit_log').insert({
        tenant_id: plan.tenant_id,
        action: 'plan_activated',
        entity_type: 'plan',
        entity_id: plan.id,
      });

      toast.success('Plan activado. Las cuotas ya no pueden editarse.');
      fetchPlan();
    }

    setIsActivateDialogOpen(false);
    setIsProcessing(false);
  };

  const handleCancel = async () => {
    if (!plan) return;
    setIsProcessing(true);

    const supabase = createClient();

    const { error } = await supabase
      .from('plans')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', plan.id);

    if (error) {
      toast.error('Error al cancelar el plan');
    } else {
      await supabase.from('audit_log').insert({
        tenant_id: plan.tenant_id,
        action: 'plan_cancelled',
        entity_type: 'plan',
        entity_id: plan.id,
      });

      toast.success('Plan cancelado');
      fetchPlan();
    }

    setIsCancelDialogOpen(false);
    setIsProcessing(false);
  };

  const openPaymentDialog = (installment: Installment) => {
    setSelectedInstallment(installment);
    const outstanding = installment.total_cents - installment.paid_cents;
    const penalty = calculatePenalty(
      outstanding,
      new Date(installment.due_date),
      new Date(),
      plan?.grace_days || 0,
      plan?.penalty_rate || 0,
      plan?.penalty_cap || 0
    );
    setPaymentAmount(((outstanding + penalty) / 100).toFixed(2));
    setIsPaymentDialogOpen(true);
  };

  const handlePayment = async () => {
    if (!plan || !selectedInstallment) return;
    setIsProcessing(true);

    const amountCents = Math.round(parseFloat(paymentAmount) * 100);
    if (amountCents <= 0) {
      toast.error('Ingresá un monto válido');
      setIsProcessing(false);
      return;
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      toast.error('No autenticado');
      setIsProcessing(false);
      return;
    }

    const outstanding = selectedInstallment.total_cents - selectedInstallment.paid_cents;
    const penalty = calculatePenalty(
      outstanding,
      new Date(selectedInstallment.due_date),
      new Date(),
      plan.grace_days,
      plan.penalty_rate,
      plan.penalty_cap
    );

    const penaltyPaid = Math.min(penalty, amountCents);
    const principalPaid = Math.min(Math.max(0, amountCents - penaltyPaid), outstanding);

    const newPaidCents = selectedInstallment.paid_cents + principalPaid;
    const isPaid = newPaidCents >= selectedInstallment.total_cents;

    const { error: paymentError } = await supabase.from('payments').insert({
      tenant_id: plan.tenant_id,
      plan_id: plan.id,
      installment_id: selectedInstallment.id,
      amount_cents: principalPaid,
      penalty_paid_cents: penaltyPaid,
      recorded_by: user.id,
    });

    if (paymentError) {
      toast.error('Error al registrar el pago');
      setIsProcessing(false);
      return;
    }

    const { error: installmentError } = await supabase
      .from('installments')
      .update({
        paid_cents: newPaidCents,
        penalty_cents: selectedInstallment.penalty_cents + penaltyPaid,
        status: isPaid ? 'paid' : 'partial',
      })
      .eq('id', selectedInstallment.id);

    if (installmentError) {
      toast.error('Error al actualizar la cuota');
      setIsProcessing(false);
      return;
    }

    await supabase.from('audit_log').insert({
      tenant_id: plan.tenant_id,
      action: 'payment_recorded',
      entity_type: 'payment',
      new_data: {
        installment_number: selectedInstallment.number,
        amount: amountCents,
      },
    });

    const updatedInstallments = await supabase
      .from('installments')
      .select('*')
      .eq('plan_id', plan.id);

    const allPaid = updatedInstallments.data?.every((i) => i.status === 'paid');

    if (allPaid) {
      await supabase.from('plans').update({ status: 'completed' }).eq('id', plan.id);
    }

    toast.success('Pago registrado');
    setIsPaymentDialogOpen(false);
    fetchPlan();
    setIsProcessing(false);
  };

  const sendWhatsAppReminder = (installment: Installment) => {
    if (!plan || !tenant) return;

    const client = plan.clients;
    if (!client.phone || !client.whatsapp_opt_in) {
      toast.error('El cliente no tiene WhatsApp habilitado');
      return;
    }

    const phone = client.phone.replace(/\D/g, '');
    const amount = formatCurrency(installment.total_cents - installment.paid_cents);
    const dueDate = format(new Date(installment.due_date), 'dd/MM/yyyy');

    let message = `Hola ${client.full_name}, te recordamos que la cuota N°${installment.number} de ${plan.description} por ${amount} vence el ${dueDate}.`;

    if (tenant.cbu_alias) {
      message += `\n\nPodés transferir a: ${tenant.cbu_alias}`;
    }
    if (tenant.cbu) {
      message += `\nCBU: ${tenant.cbu}`;
    }

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  if (isLoading) {
    return <LoadingPage message="Cargando plan..." />;
  }

  if (error || !plan) {
    return <ErrorState message={error || 'Plan no encontrado'} />;
  }

  const totalPaid = plan.installments.reduce((sum, i) => sum + i.paid_cents, 0);
  const totalPending = plan.total_amount_cents - totalPaid;
  const overdueInstallments = plan.installments.filter(
    (i) => i.status !== 'paid' && new Date(i.due_date) < new Date()
  );

  return (
    <>
      <PageHeader
        title={plan.description}
        breadcrumbs={[
          { label: 'Planes', href: '/plans' },
          { label: plan.description },
        ]}
        actions={
          <div className="flex gap-2">
            {plan.status === 'draft' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setIsCancelDialogOpen(true)}
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancelar
                </Button>
                <Button onClick={() => setIsActivateDialogOpen(true)}>
                  <Play className="mr-2 h-4 w-4" />
                  Activar Plan
                </Button>
              </>
            )}
            {plan.status === 'active' && (
              <Button
                variant="outline"
                onClick={() => setIsCancelDialogOpen(true)}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Cancelar Plan
              </Button>
            )}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Cliente</CardTitle>
                <CardDescription>{plan.clients.full_name}</CardDescription>
              </div>
              <Badge variant={statusLabels[plan.status]?.variant}>
                {statusLabels[plan.status]?.label}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-gray-500">DNI/CUIT</p>
                  <p className="font-medium">{plan.clients.dni_cuit}</p>
                </div>
                {plan.clients.email && (
                  <div>
                    <p className="text-sm text-gray-500">Email</p>
                    <p className="font-medium">{plan.clients.email}</p>
                  </div>
                )}
                {plan.clients.phone && (
                  <div>
                    <p className="text-sm text-gray-500">Teléfono</p>
                    <p className="font-medium">{plan.clients.phone}</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cuotas</CardTitle>
              {overdueInstallments.length > 0 && (
                <div className="flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm">
                    {overdueInstallments.length} cuota(s) vencida(s)
                  </span>
                </div>
              )}
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b text-left text-sm text-gray-500">
                      <th className="pb-3 pr-4">#</th>
                      <th className="pb-3 pr-4">Vencimiento</th>
                      <th className="pb-3 pr-4 text-right">Monto</th>
                      <th className="pb-3 pr-4 text-right">Pagado</th>
                      <th className="pb-3 pr-4">Estado</th>
                      <th className="pb-3">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {plan.installments.map((inst) => {
                      const isOverdue =
                        inst.status !== 'paid' &&
                        new Date(inst.due_date) < new Date();

                      return (
                        <tr key={inst.id} className={isOverdue ? 'bg-red-50' : ''}>
                          <td className="py-3 pr-4 font-medium">{inst.number}</td>
                          <td className="py-3 pr-4">
                            {format(new Date(inst.due_date), 'dd/MM/yyyy', { locale: es })}
                          </td>
                          <td className="py-3 pr-4 text-right">
                            {formatCurrency(inst.total_cents)}
                          </td>
                          <td className="py-3 pr-4 text-right">
                            {formatCurrency(inst.paid_cents)}
                          </td>
                          <td className="py-3 pr-4">
                            <Badge
                              variant={
                                isOverdue
                                  ? 'destructive'
                                  : paymentStatusLabels[inst.status]?.variant
                              }
                            >
                              {isOverdue
                                ? 'Vencido'
                                : paymentStatusLabels[inst.status]?.label}
                            </Badge>
                          </td>
                          <td className="py-3">
                            {inst.status !== 'paid' && plan.status === 'active' && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openPaymentDialog(inst)}
                                >
                                  <DollarSign className="h-4 w-4" />
                                </Button>
                                {plan.clients.whatsapp_opt_in && plan.clients.phone && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => sendWhatsAppReminder(inst)}
                                    title="Enviar recordatorio por WhatsApp"
                                  >
                                    <MessageSquare className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            )}
                            {inst.status === 'paid' && (
                              <CheckCircle className="h-5 w-5 text-green-600" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-500">Precio de Contado</span>
                <span className="font-medium">
                  {formatCurrency(plan.cash_price_cents)}
                </span>
              </div>
              {plan.admin_fee_cents > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Cargo Administrativo</span>
                  <span className="font-medium">
                    {formatCurrency(plan.admin_fee_cents)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Total Financiado</span>
                <span className="font-bold">
                  {formatCurrency(plan.total_amount_cents)}
                </span>
              </div>
              <div className="border-t pt-4">
                <div className="flex justify-between text-green-600">
                  <span>Total Cobrado</span>
                  <span className="font-bold">{formatCurrency(totalPaid)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Pendiente</span>
                  <span className="font-bold">{formatCurrency(totalPending)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                Ley 24.240 art. 36
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-500">TNA</span>
                <span className="font-medium">{formatPercentage(plan.tna)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">TEA</span>
                <span className="font-medium">{formatPercentage(plan.tea)}</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span className="font-medium">CFT</span>
                <span className="font-bold">{formatPercentage(plan.cft)}</span>
              </div>
              <div className="border-t pt-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Días de Gracia</span>
                  <span>{plan.grace_days}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Punitorios Diarios</span>
                  <span>{formatPercentage(plan.penalty_rate * 100)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tope Punitorios</span>
                  <span>{formatPercentage(plan.penalty_cap * 100)}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Activate Dialog */}
      <AlertDialog open={isActivateDialogOpen} onOpenChange={setIsActivateDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Activar este plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Una vez activado, las cuotas no podrán editarse. El cliente deberá
              aceptar las condiciones según la Ley 24.240 art. 36.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleActivate} disabled={isProcessing}>
              {isProcessing ? 'Activando...' : 'Activar Plan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel Dialog */}
      <AlertDialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar este plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción marcará el plan como cancelado. Los pagos realizados
              no se verán afectados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={isProcessing}
              className="bg-red-600 hover:bg-red-700"
            >
              {isProcessing ? 'Cancelando...' : 'Cancelar Plan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Payment Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Pago</DialogTitle>
            <DialogDescription>
              Cuota N°{selectedInstallment?.number} - Vencimiento:{' '}
              {selectedInstallment &&
                format(new Date(selectedInstallment.due_date), 'dd/MM/yyyy')}
            </DialogDescription>
          </DialogHeader>

          {selectedInstallment && (
            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Monto de la cuota</span>
                  <span>{formatCurrency(selectedInstallment.total_cents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Ya pagado</span>
                  <span>{formatCurrency(selectedInstallment.paid_cents)}</span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Saldo pendiente</span>
                  <span>
                    {formatCurrency(
                      selectedInstallment.total_cents - selectedInstallment.paid_cents
                    )}
                  </span>
                </div>
                {new Date(selectedInstallment.due_date) < new Date() && plan && (
                  <div className="flex justify-between text-red-600">
                    <span>Punitorios</span>
                    <span>
                      {formatCurrency(
                        calculatePenalty(
                          selectedInstallment.total_cents - selectedInstallment.paid_cents,
                          new Date(selectedInstallment.due_date),
                          new Date(),
                          plan.grace_days,
                          plan.penalty_rate,
                          plan.penalty_cap
                        )
                      )}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment_amount">Monto a registrar (ARS)</Label>
                <Input
                  id="payment_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Podés registrar pagos parciales
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsPaymentDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button onClick={handlePayment} loading={isProcessing}>
              Registrar Pago
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
