'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Search, Users, Phone, Mail, Download } from 'lucide-react';
import type { Client } from '@/types/database';

const clientSchema = z.object({
  dni_cuit: z.string().min(7, 'Ingresá un DNI o CUIT válido').max(13),
  full_name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  email: z.string().email('Email inválido').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  whatsapp_opt_in: z.boolean(),
});

type ClientForm = z.infer<typeof clientSchema>;

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ClientForm>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      whatsapp_opt_in: false,
    },
  });

  const whatsappOptIn = watch('whatsapp_opt_in');

  const fetchClients = useCallback(async () => {
    const supabase = createClient();

    const { data: tenantUser } = await supabase
      .from('tenant_users')
      .select('tenant_id')
      .single() as { data: { tenant_id: string } | null };

    if (!tenantUser) return;

    setTenantId(tenantUser.tenant_id);

    let query = supabase
      .from('clients')
      .select('*')
      .eq('tenant_id', tenantUser.tenant_id)
      .order('created_at', { ascending: false });

    if (searchQuery) {
      query = query.or(
        `full_name.ilike.%${searchQuery}%,dni_cuit.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`
      );
    }

    const { data } = await query;
    setClients(data || []);
    setIsLoading(false);
  }, [searchQuery]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const openCreateDialog = () => {
    setEditingClient(null);
    reset({
      dni_cuit: '',
      full_name: '',
      email: '',
      phone: '',
      address: '',
      notes: '',
      whatsapp_opt_in: false,
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (client: Client) => {
    setEditingClient(client);
    reset({
      dni_cuit: client.dni_cuit,
      full_name: client.full_name,
      email: client.email || '',
      phone: client.phone || '',
      address: client.address || '',
      notes: client.notes || '',
      whatsapp_opt_in: client.whatsapp_opt_in,
    });
    setIsDialogOpen(true);
  };

  const onSubmit = async (data: ClientForm) => {
    if (!tenantId) return;

    const supabase = createClient();

    const clientData = {
      ...data,
      email: data.email || null,
      phone: data.phone || null,
      address: data.address || null,
      notes: data.notes || null,
      tenant_id: tenantId,
    };

    if (editingClient) {
      const { error } = await supabase
        .from('clients')
        .update(clientData as never)
        .eq('id', editingClient.id);

      if (error) {
        toast.error('Error al actualizar el cliente');
        return;
      }

      await supabase.from('audit_log').insert({
        tenant_id: tenantId,
        action: 'client_updated',
        entity_type: 'client',
        entity_id: editingClient.id,
        old_data: editingClient as unknown,
        new_data: clientData as unknown,
      } as never);

      toast.success('Cliente actualizado');
    } else {
      const { data: newClient, error } = await supabase
        .from('clients')
        .insert(clientData as never)
        .select()
        .single() as { data: { id: string } | null; error: Error | null };

      if (error) {
        if ((error as { code?: string }).code === '23505') {
          toast.error('Ya existe un cliente con ese DNI/CUIT');
        } else {
          toast.error('Error al crear el cliente');
        }
        return;
      }

      await supabase.from('audit_log').insert({
        tenant_id: tenantId,
        action: 'client_created',
        entity_type: 'client',
        entity_id: newClient?.id,
        new_data: newClient as unknown,
      } as never);

      toast.success('Cliente creado');
    }

    setIsDialogOpen(false);
    fetchClients();
  };

  const exportCSV = () => {
    const headers = ['DNI/CUIT', 'Nombre', 'Email', 'Teléfono', 'Dirección', 'WhatsApp Opt-in'];
    const rows = clients.map((c) => [
      c.dni_cuit,
      c.full_name,
      c.email || '',
      c.phone || '',
      c.address || '',
      c.whatsapp_opt_in ? 'Sí' : 'No',
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `clientes_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  const columns = [
    {
      key: 'full_name',
      header: 'Nombre',
      cell: (client: Client) => (
        <div>
          <p className="font-medium">{client.full_name}</p>
          <p className="text-sm text-gray-500">{client.dni_cuit}</p>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contacto',
      cell: (client: Client) => (
        <div className="space-y-1">
          {client.email && (
            <p className="flex items-center gap-1 text-sm">
              <Mail className="h-3 w-3 text-gray-400" />
              {client.email}
            </p>
          )}
          {client.phone && (
            <p className="flex items-center gap-1 text-sm">
              <Phone className="h-3 w-3 text-gray-400" />
              {client.phone}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'whatsapp',
      header: 'WhatsApp',
      cell: (client: Client) => (
        <span
          className={`text-sm ${client.whatsapp_opt_in ? 'text-green-600' : 'text-gray-400'}`}
        >
          {client.whatsapp_opt_in ? 'Habilitado' : 'No'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Gestioná tus clientes y deudores"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportCSV} disabled={clients.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
            <Button onClick={openCreateDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo Cliente
            </Button>
          </div>
        }
      />

      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por nombre, DNI o email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {!isLoading && clients.length === 0 && !searchQuery ? (
        <EmptyState
          icon={Users}
          title="No hay clientes"
          description="Agregá tu primer cliente para comenzar a crear planes de financiación"
          action={{
            label: 'Agregar Cliente',
            onClick: openCreateDialog,
          }}
        />
      ) : (
        <DataTable
          data={clients}
          columns={columns}
          keyExtractor={(client) => client.id}
          isLoading={isLoading}
          emptyMessage={searchQuery ? 'No se encontraron clientes' : 'No hay clientes'}
          onRowClick={(client) => openEditDialog(client)}
        />
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingClient ? 'Editar Cliente' : 'Nuevo Cliente'}
            </DialogTitle>
            <DialogDescription>
              {editingClient
                ? 'Modificá los datos del cliente'
                : 'Completá los datos para agregar un nuevo cliente'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dni_cuit" required>
                  DNI / CUIT
                </Label>
                <Input
                  id="dni_cuit"
                  placeholder="12345678"
                  error={!!errors.dni_cuit}
                  {...register('dni_cuit')}
                />
                {errors.dni_cuit && (
                  <p className="text-sm text-red-600">{errors.dni_cuit.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="full_name" required>
                  Nombre Completo
                </Label>
                <Input
                  id="full_name"
                  placeholder="Juan Pérez"
                  error={!!errors.full_name}
                  {...register('full_name')}
                />
                {errors.full_name && (
                  <p className="text-sm text-red-600">{errors.full_name.message}</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="cliente@email.com"
                  error={!!errors.email}
                  {...register('email')}
                />
                {errors.email && (
                  <p className="text-sm text-red-600">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  placeholder="+54 11 1234-5678"
                  {...register('phone')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Dirección</Label>
              <Input
                id="address"
                placeholder="Av. Corrientes 1234, CABA"
                {...register('address')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <Input
                id="notes"
                placeholder="Notas adicionales..."
                {...register('notes')}
              />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="whatsapp_opt_in"
                checked={whatsappOptIn}
                onCheckedChange={(checked) =>
                  setValue('whatsapp_opt_in', checked as boolean)
                }
              />
              <div>
                <Label htmlFor="whatsapp_opt_in">
                  Acepta recibir recordatorios por WhatsApp
                </Label>
                <p className="text-xs text-gray-500">
                  Conforme a la Ley 25.326 de Protección de Datos Personales
                </p>
              </div>
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
                {editingClient ? 'Guardar Cambios' : 'Crear Cliente'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
