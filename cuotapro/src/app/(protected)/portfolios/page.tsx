'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Briefcase, FileText, Users, Pencil, Trash2 } from 'lucide-react';
import type { Portfolio } from '@/types/database';

const portfolioSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  description: z.string().optional(),
  is_active: z.boolean(),
});

type PortfolioForm = z.infer<typeof portfolioSchema>;

interface PortfolioWithCounts extends Portfolio {
  clients_count: number;
  plans_count: number;
}

export default function PortfoliosPage() {
  const [portfolios, setPortfolios] = useState<PortfolioWithCounts[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPortfolio, setEditingPortfolio] = useState<Portfolio | null>(null);
  const [deletingPortfolio, setDeletingPortfolio] = useState<Portfolio | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PortfolioForm>({
    resolver: zodResolver(portfolioSchema),
    defaultValues: {
      is_active: true,
    },
  });

  const isActive = watch('is_active');

  const fetchPortfolios = useCallback(async () => {
    const supabase = createClient();

    const { data: tenantUser } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .single() as { data: { tenant_id: string } | null };

    if (!tenantUser) return;

    setTenantId(tenantUser.tenant_id);

    const { data: portfoliosData } = await supabase
      .from('portfolios')
      .select('*')
      .eq('tenant_id', tenantUser.tenant_id)
      .order('created_at', { ascending: false }) as { data: Portfolio[] | null };

    if (portfoliosData) {
      const withCounts = await Promise.all(
        portfoliosData.map(async (portfolio) => {
          const [clientsRes, plansRes] = await Promise.all([
            supabase
              .from('clients')
              .select('id', { count: 'exact' })
              .eq('portfolio_id', portfolio.id),
            supabase
              .from('plans')
              .select('id', { count: 'exact' })
              .eq('portfolio_id', portfolio.id),
          ]);

          return {
            ...portfolio,
            clients_count: clientsRes.count || 0,
            plans_count: plansRes.count || 0,
          };
        })
      );

      setPortfolios(withCounts);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchPortfolios();
  }, [fetchPortfolios]);

  const openCreateDialog = () => {
    setEditingPortfolio(null);
    reset({
      name: '',
      description: '',
      is_active: true,
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (portfolio: Portfolio) => {
    setEditingPortfolio(portfolio);
    reset({
      name: portfolio.name,
      description: portfolio.description || '',
      is_active: portfolio.is_active,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: PortfolioForm) => {
    if (!tenantId) return;

    const supabase = createClient();

    const portfolioData = {
      ...data,
      description: data.description || null,
      tenant_id: tenantId,
    };

    if (editingPortfolio) {
      const { error } = await supabase
        .from('portfolios')
        .update(portfolioData as Record<string, unknown>)
        .eq('id', editingPortfolio.id);

      if (error) {
        toast.error('Error al actualizar la cartera');
        return;
      }

      await supabase.from('audit_log').insert({
        tenant_id: tenantId,
        action: 'portfolio_created',
        entity_type: 'portfolio',
        entity_id: editingPortfolio.id,
        old_data: editingPortfolio,
        new_data: portfolioData,
      } as Record<string, unknown>);

      toast.success('Cartera actualizada');
    } else {
      const { data: newPortfolio, error } = await supabase
        .from('portfolios')
        .insert(portfolioData as Record<string, unknown>)
        .select()
        .single() as { data: { id: string } | null; error: unknown };

      if (error || !newPortfolio) {
        toast.error('Error al crear la cartera');
        return;
      }

      await supabase.from('audit_log').insert({
        tenant_id: tenantId,
        action: 'portfolio_created',
        entity_type: 'portfolio',
        entity_id: newPortfolio.id,
        new_data: newPortfolio,
      } as Record<string, unknown>);

      toast.success('Cartera creada');
    }

    setIsDialogOpen(false);
    fetchPortfolios();
  };

  const handleDelete = async () => {
    if (!deletingPortfolio) return;

    const supabase = createClient();

    const { error } = await supabase
      .from('portfolios')
      .delete()
      .eq('id', deletingPortfolio.id);

    if (error) {
      toast.error('Error al eliminar la cartera. Puede tener clientes o planes asociados.');
    } else {
      toast.success('Cartera eliminada');
      fetchPortfolios();
    }

    setDeletingPortfolio(null);
  };

  if (isLoading) {
    return (
      <>
        <PageHeader title="Carteras" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Carteras"
        description="Organizá tus clientes y planes por cartera o proyecto"
        actions={
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Nueva Cartera
          </Button>
        }
      />

      {portfolios.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title="No hay carteras"
          description="Las carteras te permiten organizar clientes y planes por proyecto o negocio"
          action={{
            label: 'Crear Cartera',
            onClick: openCreateDialog,
          }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {portfolios.map((portfolio) => (
            <Card
              key={portfolio.id}
              className={portfolio.is_active ? '' : 'opacity-60'}
            >
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {portfolio.name}
                    {!portfolio.is_active && (
                      <Badge variant="secondary">Inactiva</Badge>
                    )}
                  </CardTitle>
                  {portfolio.description && (
                    <p className="mt-1 text-sm text-gray-500">
                      {portfolio.description}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => openEditDialog(portfolio)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeletingPortfolio(portfolio)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-6 text-sm">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-gray-400" />
                    <span>{portfolio.clients_count} clientes</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-gray-400" />
                    <span>{portfolio.plans_count} planes</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingPortfolio ? 'Editar Cartera' : 'Nueva Cartera'}
            </DialogTitle>
            <DialogDescription>
              {editingPortfolio
                ? 'Modificá los datos de la cartera'
                : 'Creá una nueva cartera para organizar tus clientes y planes'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" required>
                Nombre
              </Label>
              <Input
                id="name"
                placeholder="Ej: Ventas de Productos"
                error={!!errors.name}
                {...register('name')}
              />
              {errors.name && (
                <p className="text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Descripción</Label>
              <Input
                id="description"
                placeholder="Descripción opcional..."
                {...register('description')}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
              <div>
                <Label htmlFor="is_active">Cartera activa</Label>
                <p className="text-sm text-gray-500">
                  Las carteras inactivas no aparecen en los selectores
                </p>
              </div>
              <Switch
                id="is_active"
                checked={isActive}
                onCheckedChange={(checked) => setValue('is_active', checked)}
              />
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {editingPortfolio ? 'Guardar Cambios' : 'Crear Cartera'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingPortfolio}
        onOpenChange={() => setDeletingPortfolio(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar cartera?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Los clientes y planes asociados
              quedarán sin cartera asignada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
