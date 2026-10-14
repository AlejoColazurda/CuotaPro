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
import { Fingerprint, AlertTriangle, ShieldCheck } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Ingresá un email válido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
});

const mfaSchema = z.object({
  code: z.string().min(6, 'Ingresá el código de 6 dígitos').max(6),
});

type LoginFormData = z.infer<typeof loginSchema>;
type MfaFormData = z.infer<typeof mfaSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboard';
  
  const [isLoading, setIsLoading] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    getValues,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const mfaForm = useForm<MfaFormData>({
    resolver: zodResolver(mfaSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setRemainingAttempts(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 429) {
          setBlockedUntil(result.blockedUntil);
          toast.error(result.error);
        } else {
          setRemainingAttempts(result.remaining);
          setError('email', { message: result.error });
        }
        return;
      }

      if (result.requiresMfa) {
        setMfaRequired(true);
        setFactorId(result.factorId);
        return;
      }

      toast.success('Bienvenido');
      router.push(redirect);
      router.refresh();
    } catch {
      toast.error('Error al iniciar sesión');
    } finally {
      setIsLoading(false);
    }
  };

  const onMfaSubmit = async (data: MfaFormData) => {
    if (!factorId) return;
    setIsLoading(true);

    try {
      if (useRecoveryCode) {
        const response = await fetch('/api/auth/mfa/recovery-codes', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: data.code }),
        });

        const result = await response.json();

        if (!response.ok) {
          mfaForm.setError('code', { message: result.error });
          return;
        }

        if (result.remainingCodes <= 2) {
          toast.warning(`Solo te quedan ${result.remainingCodes} códigos de recuperación`);
        }

        toast.success('Código verificado');
        router.push(redirect);
        router.refresh();
      } else {
        const response = await fetch('/api/auth/mfa/challenge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ factorId, code: data.code }),
        });

        const result = await response.json();

        if (!response.ok) {
          mfaForm.setError('code', { message: result.error });
          if (result.remaining !== undefined) {
            setRemainingAttempts(result.remaining);
          }
          return;
        }

        toast.success('Bienvenido');
        router.push(redirect);
        router.refresh();
      }
    } catch {
      toast.error('Error al verificar código');
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

  if (blockedUntil && Date.now() < blockedUntil) {
    const minutesLeft = Math.ceil((blockedUntil - Date.now()) / 60000);
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <CardTitle>Cuenta Bloqueada</CardTitle>
          <CardDescription>
            Demasiados intentos fallidos. Tu cuenta está bloqueada temporalmente.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <p className="text-lg font-medium text-gray-900">
            Intentá de nuevo en {minutesLeft} minuto{minutesLeft !== 1 ? 's' : ''}
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Si olvidaste tu contraseña, podés{' '}
            <Link href="/forgot-password" className="text-blue-600 hover:underline">
              restablecerla aquí
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  if (mfaRequired) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <ShieldCheck className="h-6 w-6 text-blue-600" />
          </div>
          <CardTitle>Verificación en dos pasos</CardTitle>
          <CardDescription>
            {useRecoveryCode
              ? 'Ingresá uno de tus códigos de recuperación'
              : 'Ingresá el código de tu aplicación de autenticación'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={mfaForm.handleSubmit(onMfaSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code" required>
                {useRecoveryCode ? 'Código de Recuperación' : 'Código de Verificación'}
              </Label>
              <Input
                id="code"
                type="text"
                inputMode={useRecoveryCode ? 'text' : 'numeric'}
                placeholder={useRecoveryCode ? 'XXXX-XXXX' : '123456'}
                autoComplete="one-time-code"
                maxLength={useRecoveryCode ? 9 : 6}
                error={!!mfaForm.formState.errors.code}
                {...mfaForm.register('code')}
              />
              {mfaForm.formState.errors.code && (
                <p className="text-sm text-red-600">{mfaForm.formState.errors.code.message}</p>
              )}
              {remainingAttempts !== null && remainingAttempts <= 3 && (
                <p className="text-sm text-amber-600">
                  Te quedan {remainingAttempts} intentos
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" loading={isLoading}>
              Verificar
            </Button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setUseRecoveryCode(!useRecoveryCode);
                  mfaForm.reset();
                }}
                className="text-sm text-blue-600 hover:underline"
              >
                {useRecoveryCode
                  ? 'Usar código de la app'
                  : '¿No tenés acceso? Usar código de recuperación'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setMfaRequired(false);
                setFactorId(null);
                setUseRecoveryCode(false);
              }}
              className="w-full text-center text-sm text-gray-500 hover:underline"
            >
              Volver al login
            </button>
          </form>
        </CardContent>
      </Card>
    );
  }

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
            {remainingAttempts !== null && remainingAttempts <= 3 && (
              <p className="text-sm text-amber-600">
                Te quedan {remainingAttempts} intentos antes del bloqueo
              </p>
            )}
          </div>

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
