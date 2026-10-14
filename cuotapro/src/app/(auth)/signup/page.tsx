'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { createClient } from '@/lib/supabase/client';
import { Check, X } from 'lucide-react';

const signupSchema = z
  .object({
    fullName: z.string().min(2, 'El nombre debe tener al menos 2 caracteres'),
    email: z.string().email('Ingresá un email válido'),
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
      .regex(/[a-z]/, 'Debe contener al menos una minúscula')
      .regex(/[0-9]/, 'Debe contener al menos un número'),
    confirmPassword: z.string(),
    tenantName: z.string().min(2, 'El nombre del negocio debe tener al menos 2 caracteres'),
    tenantSlug: z
      .string()
      .min(3, 'El identificador debe tener al menos 3 caracteres')
      .max(50, 'El identificador debe tener máximo 50 caracteres')
      .regex(/^[a-z0-9-]+$/, 'Solo letras minúsculas, números y guiones'),
    acceptTerms: z.boolean().refine((val) => val, 'Debés aceptar los términos'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });

type SignupForm = z.infer<typeof signupSchema>;

const passwordRequirements = [
  { label: 'Al menos 8 caracteres', test: (p: string) => p.length >= 8 },
  { label: 'Una letra mayúscula', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Una letra minúscula', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Un número', test: (p: string) => /[0-9]/.test(p) },
];

export default function SignupPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<SignupForm>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      acceptTerms: false,
    },
  });

  const password = watch('password', '');
  const acceptTerms = watch('acceptTerms');

  const onSubmit = async (data: SignupForm) => {
    setIsLoading(true);

    try {
      const supabase = createClient();

      const { data: existingSlug } = await supabase
        .from('tenants')
        .select('slug')
        .eq('slug', data.tenantSlug)
        .single();

      if (existingSlug) {
        toast.error('Este identificador ya está en uso. Elegí otro.');
        setIsLoading(false);
        return;
      }

      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            full_name: data.fullName,
          },
        },
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          toast.error('Este email ya está registrado');
        } else {
          toast.error(signUpError.message);
        }
        return;
      }

      if (!authData.user) {
        toast.error('Error al crear la cuenta');
        return;
      }

      const { error: profileError } = await supabase.from('user_profiles').insert({
        id: authData.user.id,
        email: data.email,
        full_name: data.fullName,
      } as never);

      if (profileError) {
        console.error('Error creating profile:', profileError);
      }

      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert({
          name: data.tenantName,
          slug: data.tenantSlug,
          email: data.email,
        } as never)
        .select()
        .single() as { data: { id: string } | null; error: Error | null };

      if (tenantError || !tenant) {
        toast.error('Error al crear el negocio');
        return;
      }

      const { error: tenantUserError } = await supabase.from('tenant_users').insert({
        tenant_id: tenant.id,
        user_id: authData.user.id,
        role: 'owner',
      } as never);

      if (tenantUserError) {
        console.error('Error linking user to tenant:', tenantUserError);
      }

      toast.success('¡Cuenta creada! Revisá tu email para confirmarla.');
      router.push('/login?registered=true');
    } catch {
      toast.error('Error al registrar la cuenta');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Crear cuenta</CardTitle>
        <CardDescription>
          Registrate para comenzar a gestionar tus cobros en cuotas
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName" required>
              Nombre completo
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
            <Label htmlFor="email" required>
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="tu@email.com"
              autoComplete="email"
              error={!!errors.email}
              {...register('email')}
            />
            {errors.email && (
              <p className="text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" required>
              Contraseña
            </Label>
            <PasswordInput
              id="password"
              placeholder="••••••••"
              autoComplete="new-password"
              error={!!errors.password}
              {...register('password')}
            />
            <div className="space-y-1">
              {passwordRequirements.map((req) => (
                <div
                  key={req.label}
                  className="flex items-center gap-2 text-xs"
                >
                  {req.test(password) ? (
                    <Check className="h-3 w-3 text-green-600" />
                  ) : (
                    <X className="h-3 w-3 text-gray-400" />
                  )}
                  <span
                    className={
                      req.test(password) ? 'text-green-600' : 'text-gray-500'
                    }
                  >
                    {req.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword" required>
              Confirmar contraseña
            </Label>
            <PasswordInput
              id="confirmPassword"
              placeholder="••••••••"
              autoComplete="new-password"
              error={!!errors.confirmPassword}
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-red-600">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tenantName" required>
              Nombre de tu negocio
            </Label>
            <Input
              id="tenantName"
              placeholder="Mi Negocio"
              error={!!errors.tenantName}
              {...register('tenantName')}
            />
            {errors.tenantName && (
              <p className="text-sm text-red-600">{errors.tenantName.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tenantSlug" required>
              Identificador único (URL)
            </Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">demo.potenciapp.com/web/</span>
              <Input
                id="tenantSlug"
                placeholder="mi-negocio"
                className="flex-1"
                error={!!errors.tenantSlug}
                {...register('tenantSlug')}
              />
            </div>
            {errors.tenantSlug && (
              <p className="text-sm text-red-600">{errors.tenantSlug.message}</p>
            )}
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="acceptTerms"
              checked={acceptTerms}
              onCheckedChange={(checked) =>
                setValue('acceptTerms', checked as boolean)
              }
            />
            <Label htmlFor="acceptTerms" className="text-sm leading-tight">
              Acepto los{' '}
              <Link href="/terms" className="text-blue-600 hover:underline">
                términos y condiciones
              </Link>{' '}
              y la{' '}
              <Link href="/privacy" className="text-blue-600 hover:underline">
                política de privacidad
              </Link>
            </Label>
          </div>
          {errors.acceptTerms && (
            <p className="text-sm text-red-600">{errors.acceptTerms.message}</p>
          )}

          <Button type="submit" className="w-full" loading={isLoading}>
            Crear cuenta
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="text-blue-600 hover:underline">
            Iniciá sesión
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
