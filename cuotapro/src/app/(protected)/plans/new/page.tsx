'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  calculateAmortization,
  formatCurrency,
  formatPercentage,
  parseLocalDate,
  type AmortizationInput,
  type AmortizationResult,
} from '@/lib/amortization/engine';
import { Calculator, FileText, AlertTriangle } from 'lucide-react';
import { format, addMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Client, Portfolio, InterestType } from '@/types/database';

const planSchema = z.object({
  client_id: z.string().min(1, 'Seleccioná un cliente'),
  portfolio_id: z.string().optional(),
  description: z.string().min(1, 'Ingresá una descripción'),
  cash_price: z.number().positive('El precio debe ser mayor a 0'),
  admin_fee: z.number().min(0, 'El cargo no puede ser negativo'),
  num_installments: z.number().int().min(1).max(120, 'Máximo 120 cuotas'),
  interest_type: z.enum(['fixed_surcharge', 'direct_rate', 'french', 'zero_interest']),
  interest_rate: z.number().min(0, 'La tasa no puede ser negativa'),
  first_due_date: z.string().min(1, 'Seleccioná la fecha de primer vencimiento'),
  payment_day: z.number().int().min(1).max(28).optional(),
  grace_days: z.number().int().min(0),
  penalty_rate: z.number().min(0, 'Punitorios no pueden ser negativos').max(100, 'Máximo 100%'),
  penalty_cap: z.number().min(0, 'Tope no puede ser negativo').max(100, 'Máximo 100%'),
});

type PlanForm = z.infer<typeof planSchema>;

export default function NewPlanPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<AmortizationResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PlanForm>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      cash_price: 0,
      admin_fee: 0,
      num_installments: 3,
      interest_type: 'fixed_surcharge',
      interest_rate: 15,
      first_due_date: format(addMonths(new Date(), 1), 'yyyy-MM-dd'),
      grace_days: 0,
      penalty_rate: 0.1,
      penalty_cap: 30,
    },
  });

  const watchedFields = watch([
    'cash_price',
    'admin_fee',
    'num_installments',
    'interest_type',
    'interest_rate',
    'first_due_date',
    'payment_day',
  ]);

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      const { data: tenantUser } = await supabase
        .from('tenant_users')
        .select('tenant_id')
        .maybeSingle() as { data: { tenant_id: string } | null };

      if (!tenantUser) return;

      setTenantId(tenantUser.tenant_id);

      const [tenantRes, clientsRes, portfoliosRes] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', tenantUser.tenant_id).single(),
        supabase
          .from('clients')
          .select('*')
          .eq('tenant_id', tenantUser.tenant_id)
          .order('full_name'),
        supabase
          .from('portfolios')
          .select('*')
          .eq('tenant_id', tenantUser.tenant_id)
          .eq('is_active', true)
          .order('name'),
      ]) as [
        { data: { default_grace_days: number; default_penalty_rate: number; max_penalty_cap: number } | null },
        { data: Client[] | null },
        { data: Portfolio[] | null }
      ];

      if (tenantRes.data) {
        setValue('grace_days', tenantRes.data.default_grace_days);
        setValue('penalty_rate', tenantRes.data.default_penalty_rate * 100);
        setValue('penalty_cap', tenantRes.data.max_penalty_cap * 100);
      }

      setClients(clientsRes.data || []);
      setPortfolios(portfoliosRes.data || []);
    };

    fetchData();
  }, [setValue]);

  useEffect(() => {
    const [cashPrice, adminFee, numInstallments, interestType, interestRate, firstDueDate] =
      watchedFields;

    if (cashPrice > 0 && numInstallments > 0) {
      try {
        const input: AmortizationInput = {
          cashPriceCents: Math.round(cashPrice * 100),
          adminFeeCents: Math.round((adminFee || 0) * 100),
          numInstallments,
          interestType: interestType as InterestType,
          interestRate: interestType === 'zero_interest' ? 0 : (interestRate || 0) / 100,
          startDate: firstDueDate ? parseLocalDate(firstDueDate) : new Date(),
        };

        const result = calculateAmortization(input);
        setSimulation(result);
      } catch (error) {
        console.error('Simulation error:', error);
        setSimulation(null);
      }
    } else {
      setSimulation(null);
    }
  }, [watchedFields]);

  const interestType = watch('interest_type');

  const onSubmit = async (data: PlanForm) => {
    if (!tenantId || !simulation) return;

    setIsSaving(true);

    try {
      const supabase = createClient();

      const planData = {
        tenant_id: tenantId,
        client_id: data.client_id,
        portfolio_id: data.portfolio_id || null,
        description: data.description,
        status: 'draft' as const,
        cash_price_cents: Math.round(data.cash_price * 100),
        admin_fee_cents: Math.round(data.admin_fee * 100),
        financed_amount_cents: simulation.financedAmountCents,
        total_amount_cents: simulation.totalAmountCents,
        num_installments: data.num_installments,
        interest_type: data.interest_type as InterestType,
        interest_rate: data.interest_type === 'zero_interest' ? 0 : data.interest_rate / 100,
        tna: simulation.tna,
        tea: simulation.tea,
        cft: simulation.cft,
        grace_days: data.grace_days,
        penalty_rate: data.penalty_rate / 100,
        penalty_cap: data.penalty_cap / 100,
      };

      const { data: plan, error: planError } = await supabase
        .from('plans')
        .insert(planData as Record<string, unknown>)
        .select()
        .single() as { data: { id: string } | null; error: unknown };

      if (planError || !plan) throw planError;

      const installmentsData = simulation.installments.map((inst) => ({
        plan_id: plan.id,
        number: inst.number,
        due_date: format(inst.dueDate, 'yyyy-MM-dd'),
        principal_cents: inst.principalCents,
        interest_cents: inst.interestCents,
        admin_fee_cents: inst.adminFeeCents,
        total_cents: inst.totalCents,
        paid_cents: 0,
        penalty_cents: 0,
        status: 'pending' as const,
      }));

      const { error: installmentsError } = await supabase
        .from('installments')
        .insert(installmentsData as Record<string, unknown>[]);

      if (installmentsError) throw installmentsError;

      toast.success('Plan creado como borrador');
      router.push(`/plans/${plan.id}`);
    } catch (error) {
      console.error('Error creating plan:', error);
      toast.error('Error al crear el plan');
    } finally {
      setIsSaving(false);
    }
  };

  const interestTypeLabels: Record<string, { label: string; description: string }> = {
    fixed_surcharge: {
      label: 'Recargo Fijo Total',
      description: 'Porcentaje fijo sobre el precio de contado (ej: 15% en 3 cuotas)',
    },
    direct_rate: {
      label: 'Tasa Mensual Directa',
      description: 'Tasa mensual multiplicada por cantidad de cuotas',
    },
    french: {
      label: 'Sistema Francés',
      description: 'Cuota fija con amortización sobre saldo',
    },
    zero_interest: {
      label: 'Sin Interés',
      description: 'Financiación al mismo precio de contado',
    },
  };

  return (
    <>
      <PageHeader
        title="Nuevo Plan de Financiación"
        description="Configurá las condiciones del plan y simulá las cuotas"
        breadcrumbs={[
          { label: 'Planes', href: '/plans' },
          { label: 'Nuevo Plan' },
        ]}
      />

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Datos del Plan</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="client_id" required>
                    Cliente
                  </Label>
                  <Controller
                    name="client_id"
                    control={control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger error={!!errors.client_id}>
                          <SelectValue placeholder="Seleccioná un cliente" />
                        </SelectTrigger>
                        <SelectContent>
                          {clients.map((client) => (
                            <SelectItem key={client.id} value={client.id}>
                              {client.full_name} - {client.dni_cuit}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.client_id && (
                    <p className="text-sm text-red-600">{errors.client_id.message}</p>
                  )}
                </div>

                {portfolios.length > 0 && (
                  <div className="space-y-2">
                    <Label htmlFor="portfolio_id">Cartera (opcional)</Label>
                    <Controller
                      name="portfolio_id"
                      control={control}
                      render={({ field }) => (
                        <Select onValueChange={field.onChange} value={field.value || ''}>
                          <SelectTrigger>
                            <SelectValue placeholder="Sin cartera asignada" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Sin cartera</SelectItem>
                            {portfolios.map((portfolio) => (
                              <SelectItem key={portfolio.id} value={portfolio.id}>
                                {portfolio.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="description" required>
                    Descripción
                  </Label>
                  <Input
                    id="description"
                    placeholder="Ej: Televisor LG 55 pulgadas"
                    error={!!errors.description}
                    {...register('description')}
                  />
                  {errors.description && (
                    <p className="text-sm text-red-600">{errors.description.message}</p>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="cash_price" required>
                      Precio de Contado (ARS)
                    </Label>
                    <Input
                      id="cash_price"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="100000"
                      error={!!errors.cash_price}
                      {...register('cash_price', { valueAsNumber: true })}
                    />
                    {errors.cash_price && (
                      <p className="text-sm text-red-600">{errors.cash_price.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="admin_fee">Cargo Administrativo (ARS)</Label>
                    <Input
                      id="admin_fee"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0"
                      {...register('admin_fee', { valueAsNumber: true })}
                    />
                    <p className="text-xs text-gray-500">Se incluye en el CFT</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Condiciones de Financiación</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label required>Tipo de Interés</Label>
                  <Controller
                    name="interest_type"
                    control={control}
                    render={({ field }) => (
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(interestTypeLabels).map(([key, { label }]) => (
                            <SelectItem key={key} value={key}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <p className="text-xs text-gray-500">
                    {interestTypeLabels[interestType]?.description}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="num_installments" required>
                      Cantidad de Cuotas
                    </Label>
                    <Input
                      id="num_installments"
                      type="number"
                      min="1"
                      max="120"
                      {...register('num_installments', { valueAsNumber: true })}
                    />
                  </div>

                  {interestType !== 'zero_interest' && (
                    <div className="space-y-2">
                      <Label htmlFor="interest_rate" required>
                        {interestType === 'fixed_surcharge' ? 'Recargo Total (%)' : 'Tasa Mensual (%)'}
                      </Label>
                      <Input
                        id="interest_rate"
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder={interestType === 'fixed_surcharge' ? '15' : '5'}
                        {...register('interest_rate', { valueAsNumber: true })}
                      />
                    </div>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="first_due_date" required>
                      Primer Vencimiento
                    </Label>
                    <Input
                      id="first_due_date"
                      type="date"
                      {...register('first_due_date')}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="grace_days">Días de Gracia</Label>
                    <Input
                      id="grace_days"
                      type="number"
                      min="0"
                      {...register('grace_days', { valueAsNumber: true })}
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="penalty_rate">Punitorios Diarios (%)</Label>
                    <Input
                      id="penalty_rate"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      placeholder="0.1"
                      {...register('penalty_rate', { valueAsNumber: true })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="penalty_cap">Tope de Punitorios (%)</Label>
                    <Input
                      id="penalty_cap"
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      placeholder="30"
                      {...register('penalty_cap', { valueAsNumber: true })}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Simulación
                </CardTitle>
                <CardDescription>
                  Vista previa del plan con indicadores Ley 24.240 art. 36
                </CardDescription>
              </CardHeader>
              <CardContent>
                {simulation ? (
                  <div className="space-y-6">
                    <div className="rounded-lg bg-blue-50 p-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="text-sm text-gray-600">Precio de Contado</p>
                          <p className="text-lg font-bold">
                            {formatCurrency(simulation.financedAmountCents)}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Total Financiado</p>
                          <p className="text-lg font-bold">
                            {formatCurrency(simulation.totalAmountCents)}
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-gray-600">Total Intereses</p>
                          <p className="text-lg font-semibold">
                            {formatCurrency(simulation.totalInterestCents)}
                          </p>
                        </div>
                        {simulation.totalAdminFeeCents > 0 && (
                          <div>
                            <p className="text-sm text-gray-600">Cargo Administrativo</p>
                            <p className="text-lg font-semibold">
                              {formatCurrency(simulation.totalAdminFeeCents)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <p className="text-sm font-medium text-amber-800">
                          Información según Ley 24.240 art. 36
                        </p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div>
                          <p className="text-xs text-gray-600">TNA</p>
                          <p className="font-bold">{formatPercentage(simulation.tna)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">TEA</p>
                          <p className="font-bold">{formatPercentage(simulation.tea)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-600">CFT</p>
                          <p className="font-bold text-red-600">{formatPercentage(simulation.cft)}</p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <h4 className="mb-2 font-medium">Cronograma de Cuotas</h4>
                      <div className="max-h-64 overflow-y-auto rounded-lg border">
                        <table className="w-full text-sm">
                          <thead className="sticky top-0 bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-left">#</th>
                              <th className="px-3 py-2 text-left">Vencimiento</th>
                              <th className="px-3 py-2 text-right">Cuota</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {simulation.installments.map((inst) => (
                              <tr key={inst.number}>
                                <td className="px-3 py-2">{inst.number}</td>
                                <td className="px-3 py-2">
                                  {format(inst.dueDate, 'dd/MM/yyyy', { locale: es })}
                                </td>
                                <td className="px-3 py-2 text-right font-medium">
                                  {formatCurrency(inst.totalCents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[200px] items-center justify-center text-gray-500">
                    Completá los datos para ver la simulación
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => router.back()}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={!simulation}
                loading={isSaving}
              >
                <FileText className="mr-2 h-4 w-4" />
                Crear Plan (Borrador)
              </Button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
