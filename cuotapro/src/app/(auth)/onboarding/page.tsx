'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { Store, User, ArrowRight, Loader2 } from 'lucide-react';

const onboardingSchema = z.object({
  fullName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
  businessName: z.string().min(2, 'El nombre del negocio debe tener al menos 2 caracteres'),
});

type OnboardingForm = z.infer<typeof onboardingSchema>;

interface CreateTenantResult {
  tenant_id: string;
  slug: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
  } = useForm<OnboardingForm>({
    resolver: zodResolver(onboardingSchema),
  });

  useEffect(() => {
    const checkUser = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      setUserEmail(user.email || null);

      const { data: existingTenant } = await supabase
        .from('tenant_users')
        .select('tenant_id')
        .eq('user_id', user.id)
        .single();

      if (existingTenant) {
        router.push('/dashboard');
        return;
      }

      if (user.user_metadata?.full_name) {
        setValue('fullName', user.user_metadata.full_name);
      }

      setIsChecking(false);
    };

    checkUser();
  }, [router, setValue]);

  const onSubmit = async (data: OnboardingForm) => {
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        toast.error('Sesión expirada. Volvé a iniciar sesión.');
        router.push('/login');
        return;
      }

      const { data: result, error } = await supabase.rpc('create_tenant_with_owner', {
        p_name: data.businessName,
        p_full_name: data.fullName,
      }) as { data: CreateTenantResult | null; error: { code?: string; message?: string } | null };

      if (error) {
        console.error('Error creating tenant:', error);
        
        if (error.code === '23505') {
          toast.error('Ya tenés un negocio registrado. Redirigiendo al panel...');
          router.push('/dashboard');
          return;
        }
        
        if (error.code === 'P0001') {
          toast.error('Error de autenticación. Volvé a iniciar sesión.');
          router.push('/login');
          return;
        }
        
        toast.error('No se pudo crear el negocio. Intentá de nuevo.');
        return;
      }

      if (!result) {
        toast.error('Error inesperado al crear el negocio.');
        return;
      }

      toast.success('¡Bienvenido a CuotaPro!');
      router.push('/dashboard');
    } catch (error) {
      console.error('Onboarding error:', error);
      toast.error('Error al completar el registro. Intentá de nuevo.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isChecking) {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Completá tu perfil</CardTitle>
        <CardDescription>
          Solo necesitamos unos datos más para configurar tu cuenta
          {userEmail && (
            <span className="mt-1 block text-xs text-gray-400">
              {userEmail}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="fullName" required className="flex items-center gap-2">
              <User className="h-4 w-4" />
              Tu nombre
            </Label>
            <Input
              id="fullName"
              placeholder="Juan Pérez"
              autoComplete="name"
              error={!!errors.fullName}
              {...register('fullName')}
            />
            {errors.fullName && (
              <p className="text-sm text-red-600">{errors.fullName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="businessName" required className="flex items-center gap-2">
              <Store className="h-4 w-4" />
              Nombre de tu negocio
            </Label>
            <Input
              id="businessName"
              placeholder="Mi Tienda"
              error={!!errors.businessName}
              {...register('businessName')}
            />
            {errors.businessName && (
              <p className="text-sm text-red-600">{errors.businessName.message}</p>
            )}
            <p className="text-xs text-gray-500">
              Este nombre aparecerá en los comprobantes y comunicaciones con tus clientes
            </p>
          </div>

          <Button type="submit" className="w-full" loading={isLoading}>
            Comenzar
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
