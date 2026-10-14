'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { Fingerprint } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Ingresá un email válido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
  totpCode: z.string().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboard';
  
  const [isLoading, setIsLoading] = useState(false);
  const [needsTOTP, setNeedsTOTP] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    getValues,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);

    try {
      const supabase = createClient();

      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setError('email', { message: 'Email o contraseña incorrectos' });
        } else if (error.message.includes('locked')) {
          toast.error('Cuenta bloqueada. Intentá de nuevo en unos minutos.');
        } else {
          toast.error(error.message);
        }
        return;
      }

      if (authData.user) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('totp_enabled')
          .eq('id', authData.user.id)
          .single() as { data: { totp_enabled: boolean } | null };

        if (profile?.totp_enabled && !data.totpCode) {
          setNeedsTOTP(true);
          setIsLoading(false);
          return;
        }

        toast.success('Bienvenido');
        router.push(redirect);
        router.refresh();
      }
    } catch {
      toast.error('Error al iniciar sesión');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setIsPasskeyLoading(true);

    try {
      const response = await fetch('/api/auth/passkey/authenticate/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: getValues('email') }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(error.message || 'Error al iniciar autenticación con passkey');
        return;
      }

      const options = await response.json();

      const { startAuthentication } = await import('@simplewebauthn/browser');
      const credential = await startAuthentication({ optionsJSON: options });

      const verifyResponse = await fetch('/api/auth/passkey/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential,
          email: getValues('email'),
        }),
      });

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json();
        toast.error(error.message || 'Error al verificar passkey');
        return;
      }

      toast.success('Autenticación exitosa');
      router.push(redirect);
      router.refresh();
    } catch (error) {
      if (error instanceof Error && error.name === 'NotAllowedError') {
        toast.error('Autenticación cancelada');
      } else {
        toast.error('Error al autenticar con passkey');
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>
          Ingresá tus credenciales para acceder a tu cuenta
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
            <div className="flex items-center justify-between">
              <Label htmlFor="password" required>
                Contraseña
              </Label>
              <Link
                href="/forgot-password"
                className="text-sm text-blue-600 hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>
            <PasswordInput
              id="password"
              placeholder="••••••••"
              autoComplete="current-password"
              error={!!errors.password}
              {...register('password')}
            />
            {errors.password && (
              <p className="text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>

          {needsTOTP && (
            <div className="space-y-2">
              <Label htmlFor="totpCode" required>
                Código de verificación (2FA)
              </Label>
              <Input
                id="totpCode"
                type="text"
                inputMode="numeric"
                placeholder="123456"
                autoComplete="one-time-code"
                maxLength={6}
                {...register('totpCode')}
              />
              <p className="text-xs text-gray-500">
                Ingresá el código de 6 dígitos de tu app de autenticación
              </p>
            </div>
          )}

          <Button type="submit" className="w-full" loading={isLoading}>
            Iniciar sesión
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-500">O continuar con</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handlePasskeyLogin}
            loading={isPasskeyLoading}
          >
            <Fingerprint className="mr-2 h-4 w-4" />
            Passkey / Biométrico
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          ¿No tenés cuenta?{' '}
          <Link href="/signup" className="text-blue-600 hover:underline">
            Registrate
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
