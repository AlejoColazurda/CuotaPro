'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Building2, Shield, CreditCard, Key, Fingerprint, Smartphone, Trash2 } from 'lucide-react';
import type { Tenant, UserProfile, Passkey } from '@/types/database';

const businessSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  cbu_alias: z.string().optional(),
  cbu: z.string().optional(),
  cuit: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  default_grace_days: z.number().int().min(0),
  default_penalty_rate: z.number().min(0).max(1),
  max_penalty_cap: z.number().min(0).max(1),
});

type BusinessForm = z.infer<typeof businessSchema>;

export default function SettingsPage() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BusinessForm>({
    resolver: zodResolver(businessSchema),
  });

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient();

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const tenantRes = await supabase
        .from('tenant_users')
        .select('tenants(*)')
        .eq('user_id', user.id)
        .single();
      
      const profileRes = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      const passkeysRes = await supabase
        .from('passkeys')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if ((tenantRes.data as { tenants?: unknown })?.tenants) {
        const t = (tenantRes.data as { tenants: Tenant }).tenants;
        setTenant(t);
        reset({
          name: t.name,
          cbu_alias: t.cbu_alias || '',
          cbu: t.cbu || '',
          cuit: t.cuit || '',
          address: t.address || '',
          phone: t.phone || '',
          email: t.email || '',
          default_grace_days: t.default_grace_days,
          default_penalty_rate: t.default_penalty_rate,
          max_penalty_cap: t.max_penalty_cap,
        });
      }

      setProfile(profileRes.data);
      setPasskeys(passkeysRes.data || []);
      setIsLoading(false);
    };

    fetchData();
  }, [reset]);

  const onSubmitBusiness = async (data: BusinessForm) => {
    if (!tenant) return;
    setIsSaving(true);

    const supabase = createClient();

    const { error } = await supabase
      .from('tenants')
      .update({
        name: data.name,
        cbu_alias: data.cbu_alias || null,
        cbu: data.cbu || null,
        cuit: data.cuit || null,
        address: data.address || null,
        phone: data.phone || null,
        email: data.email || null,
        default_grace_days: data.default_grace_days,
        default_penalty_rate: data.default_penalty_rate,
        max_penalty_cap: data.max_penalty_cap,
      })
      .eq('id', tenant.id);

    if (error) {
      toast.error('Error al guardar');
    } else {
      await supabase.from('audit_log').insert({
        tenant_id: tenant.id,
        action: 'settings_updated',
        entity_type: 'tenant',
        entity_id: tenant.id,
      });

      toast.success('Configuración guardada');
    }

    setIsSaving(false);
  };

  const registerPasskey = async () => {
    try {
      const optionsRes = await fetch('/api/auth/passkey/register/options', {
        method: 'POST',
      });

      if (!optionsRes.ok) {
        toast.error('Error al iniciar registro de passkey');
        return;
      }

      const options = await optionsRes.json();

      const { startRegistration } = await import('@simplewebauthn/browser');
      const credential = await startRegistration({ optionsJSON: options });

      const name = prompt('Nombre para esta passkey (ej: "iPhone de Juan")') || 'Mi dispositivo';

      const verifyRes = await fetch('/api/auth/passkey/register/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, name }),
      });

      if (!verifyRes.ok) {
        toast.error('Error al verificar passkey');
        return;
      }

      toast.success('Passkey registrada');
      window.location.reload();
    } catch (error) {
      if (error instanceof Error && error.name === 'NotAllowedError') {
        toast.error('Registro cancelado');
      } else {
        toast.error('Error al registrar passkey');
      }
    }
  };

  const deletePasskey = async (passkeyId: string) => {
    const supabase = createClient();

    const { error } = await supabase
      .from('passkeys')
      .delete()
      .eq('id', passkeyId);

    if (error) {
      toast.error('Error al eliminar passkey');
    } else {
      toast.success('Passkey eliminada');
      setPasskeys(passkeys.filter((p) => p.id !== passkeyId));
    }
  };

  if (isLoading) {
    return (
      <>
        <PageHeader title="Configuración" />
        <div className="animate-pulse space-y-4">
          <div className="h-64 rounded-lg bg-gray-200" />
          <div className="h-64 rounded-lg bg-gray-200" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Configuración"
        description="Configurá tu negocio y preferencias de seguridad"
      />

      <Tabs defaultValue="business">
        <TabsList className="mb-6">
          <TabsTrigger value="business">
            <Building2 className="mr-2 h-4 w-4" />
            Negocio
          </TabsTrigger>
          <TabsTrigger value="security">
            <Shield className="mr-2 h-4 w-4" />
            Seguridad
          </TabsTrigger>
        </TabsList>

        <TabsContent value="business">
          <form onSubmit={handleSubmit(onSubmitBusiness)}>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Datos del Negocio</CardTitle>
                  <CardDescription>
                    Esta información aparecerá en los recibos y documentos
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name" required>
                        Nombre del Negocio
                      </Label>
                      <Input
                        id="name"
                        error={!!errors.name}
                        {...register('name')}
                      />
                      {errors.name && (
                        <p className="text-sm text-red-600">{errors.name.message}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cuit">CUIT</Label>
                      <Input
                        id="cuit"
                        placeholder="20-12345678-9"
                        {...register('cuit')}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        {...register('email')}
                      />
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Datos de Cobro
                  </CardTitle>
                  <CardDescription>
                    Tu Alias/CBU aparecerá en los recordatorios de WhatsApp
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="cbu_alias">Alias de CBU</Label>
                      <Input
                        id="cbu_alias"
                        placeholder="mi.negocio.mp"
                        {...register('cbu_alias')}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="cbu">CBU</Label>
                      <Input
                        id="cbu"
                        placeholder="0000000000000000000000"
                        maxLength={22}
                        {...register('cbu')}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Valores por Defecto para Nuevos Planes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="default_grace_days">Días de Gracia</Label>
                      <Input
                        id="default_grace_days"
                        type="number"
                        min="0"
                        {...register('default_grace_days', { valueAsNumber: true })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="default_penalty_rate">Punitorios Diarios (%)</Label>
                      <Input
                        id="default_penalty_rate"
                        type="number"
                        step="0.01"
                        min="0"
                        {...register('default_penalty_rate', {
                          valueAsNumber: true,
                          setValueAs: (v) => parseFloat(v) / 100,
                        })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="max_penalty_cap">Tope de Punitorios (%)</Label>
                      <Input
                        id="max_penalty_cap"
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        {...register('max_penalty_cap', {
                          valueAsNumber: true,
                          setValueAs: (v) => parseFloat(v) / 100,
                        })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end">
                <Button type="submit" loading={isSaving}>
                  Guardar Cambios
                </Button>
              </div>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="security">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Fingerprint className="h-5 w-5" />
                  Passkeys / Biométricos
                </CardTitle>
                <CardDescription>
                  Iniciá sesión con Face ID, Touch ID o huella digital
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {passkeys.length > 0 ? (
                    <div className="space-y-2">
                      {passkeys.map((passkey) => (
                        <div
                          key={passkey.id}
                          className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
                        >
                          <div className="flex items-center gap-3">
                            <Smartphone className="h-5 w-5 text-gray-400" />
                            <div>
                              <p className="font-medium">{passkey.name}</p>
                              <p className="text-sm text-gray-500">
                                {passkey.device_type || 'Dispositivo'}
                                {passkey.last_used_at &&
                                  ` · Último uso: ${new Date(passkey.last_used_at).toLocaleDateString()}`}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => deletePasskey(passkey.id)}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">
                      No hay passkeys registradas
                    </p>
                  )}

                  <Button variant="outline" onClick={registerPasskey}>
                    <Key className="mr-2 h-4 w-4" />
                    Registrar Nueva Passkey
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Autenticación de Dos Factores (2FA)</CardTitle>
                <CardDescription>
                  Agregá una capa extra de seguridad con una app de autenticación
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {profile?.totp_enabled ? 'Habilitado' : 'Deshabilitado'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {profile?.totp_enabled
                        ? 'Tu cuenta está protegida con 2FA'
                        : 'Recomendamos habilitar 2FA para mayor seguridad'}
                    </p>
                  </div>
                  <Button variant="outline" disabled>
                    {profile?.totp_enabled ? 'Configurar' : 'Habilitar'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
