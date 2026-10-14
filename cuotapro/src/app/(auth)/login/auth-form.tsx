'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { createClient } from '@/lib/supabase/client';
import { 
  Fingerprint, 
  AlertTriangle, 
  ShieldCheck,
  Check,
  X,
} from 'lucide-react';
import type { Provider } from '@supabase/supabase-js';

const enabledProviders = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS || '')
  .split(',')
  .map(p => p.trim().toLowerCase())
  .filter(Boolean);

const loginSchema = z.object({
  email: z.string().email('Ingresá un email válido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
});

const signupSchema = z.object({
  email: z.string().email('Ingresá un email válido'),
  password: z
    .string()
    .min(8, 'Al menos 8 caracteres')
    .regex(/[A-Z]/, 'Una mayúscula')
    .regex(/[a-z]/, 'Una minúscula')
    .regex(/[0-9]/, 'Un número'),
  acceptTerms: z.boolean().refine(val => val, 'Debés aceptar los términos'),
});

const mfaSchema = z.object({
  code: z.string().min(6, 'Ingresá el código de 6 dígitos').max(6),
});

type LoginFormData = z.infer<typeof loginSchema>;
type SignupFormData = z.infer<typeof signupSchema>;
type MfaFormData = z.infer<typeof mfaSchema>;

const passwordRequirements = [
  { label: 'Al menos 8 caracteres', test: (p: string) => p.length >= 8 },
  { label: 'Una letra mayúscula', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Una letra minúscula', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Un número', test: (p: string) => /[0-9]/.test(p) },
];

interface OAuthProviderConfig {
  id: Provider;
  name: string;
  icon: React.ReactNode;
  bgColor: string;
  textColor: string;
}

const oauthProviders: OAuthProviderConfig[] = [
  {
    id: 'google',
    name: 'Google',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
    ),
    bgColor: 'bg-white hover:bg-gray-50 border border-gray-300',
    textColor: 'text-gray-700',
  },
  {
    id: 'apple',
    name: 'Apple',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
      </svg>
    ),
    bgColor: 'bg-black hover:bg-gray-900',
    textColor: 'text-white',
  },
  {
    id: 'azure',
    name: 'Microsoft',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 23 23">
        <path fill="#f35325" d="M1 1h10v10H1z"/>
        <path fill="#81bc06" d="M12 1h10v10H12z"/>
        <path fill="#05a6f0" d="M1 12h10v10H1z"/>
        <path fill="#ffba08" d="M12 12h10v10H12z"/>
      </svg>
    ),
    bgColor: 'bg-white hover:bg-gray-50 border border-gray-300',
    textColor: 'text-gray-700',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
      </svg>
    ),
    bgColor: 'bg-gray-900 hover:bg-gray-800',
    textColor: 'text-white',
  },
];

const availableProviders = oauthProviders.filter(p => enabledProviders.includes(p.id));

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboard';
  const errorParam = searchParams.get('error');
  const registeredParam = searchParams.get('registered');

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [isLoading, setIsLoading] = useState(false);
  const [isOAuthLoading, setIsOAuthLoading] = useState<string | null>(null);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);

  useEffect(() => {
    if (errorParam === 'auth_error') {
      toast.error('Error de autenticación. Intentá de nuevo.');
    }
    if (registeredParam === 'true') {
      toast.success('¡Cuenta creada! Revisá tu email para confirmarla.');
    }
  }, [errorParam, registeredParam]);

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const signupForm = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: { acceptTerms: false },
  });

  const mfaForm = useForm<MfaFormData>({
    resolver: zodResolver(mfaSchema),
  });

  const password = signupForm.watch('password', '');
  const acceptTerms = signupForm.watch('acceptTerms');

  const handleOAuthLogin = async (provider: Provider) => {
    setIsOAuthLoading(provider);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirect)}`,
        },
      });

      if (error) {
        toast.error(`Error al iniciar sesión con ${provider}`);
        setIsOAuthLoading(null);
      }
    } catch {
      toast.error('Error al conectar con el proveedor');
      setIsOAuthLoading(null);
    }
  };

  const onLoginSubmit = async (data: LoginFormData) => {
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
          loginForm.setError('email', { message: result.error });
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

  const onSignupSubmit = async (data: SignupFormData) => {
    setIsLoading(true);

    try {
      const supabase = createClient();

      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          toast.error('Este email ya está registrado. Iniciá sesión.');
          setMode('login');
          loginForm.setValue('email', data.email);
        } else {
          toast.error(signUpError.message);
        }
        return;
      }

      if (!authData.user) {
        toast.error('Error al crear la cuenta');
        return;
      }

      // Try to create profile, but don't fail if it doesn't work
      // (profile will be created during onboarding via create_tenant_with_owner)
      try {
        await supabase.from('user_profiles').insert({
          id: authData.user.id,
          email: data.email,
        });
      } catch {
        // Profile will be created during onboarding
      }

      toast.success('¡Cuenta creada! Revisá tu email para confirmarla.');
      router.push('/login?registered=true');
    } catch {
      toast.error('Error al registrar la cuenta');
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
    const email = loginForm.getValues('email');
    if (!email) {
      toast.error('Ingresá tu email primero');
      return;
    }

    setIsPasskeyLoading(true);

    try {
      const response = await fetch('/api/auth/passkey/authenticate/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const error = await response.json();
        toast.error(error.message || 'No se encontraron passkeys para este email');
        return;
      }

      const options = await response.json();

      const { startAuthentication } = await import('@simplewebauthn/browser');
      const credential = await startAuthentication({ optionsJSON: options });

      const verifyResponse = await fetch('/api/auth/passkey/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential, email }),
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
      <CardHeader className="text-center pb-2">
        <CardTitle>{mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}</CardTitle>
        <CardDescription>
          {mode === 'login'
            ? 'Ingresá a tu cuenta de CuotaPro'
            : 'Registrate para gestionar tus cobros en cuotas'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {availableProviders.length > 0 && (
          <>
            <div className="space-y-2">
              {availableProviders.map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  variant="outline"
                  className={`w-full ${provider.bgColor} ${provider.textColor}`}
                  onClick={() => handleOAuthLogin(provider.id)}
                  disabled={isOAuthLoading !== null}
                  loading={isOAuthLoading === provider.id}
                >
                  {provider.icon}
                  <span className="ml-3">Continuar con {provider.name}</span>
                </Button>
              ))}
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">o</span>
              </div>
            </div>
          </>
        )}

        {mode === 'login' ? (
          <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" required>
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                autoComplete="email"
                error={!!loginForm.formState.errors.email}
                {...loginForm.register('email')}
              />
              {loginForm.formState.errors.email && (
                <p className="text-sm text-red-600">{loginForm.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" required>
                Contraseña
              </Label>
              <PasswordInput
                id="password"
                placeholder="••••••••"
                autoComplete="current-password"
                error={!!loginForm.formState.errors.password}
                {...loginForm.register('password')}
              />
              {loginForm.formState.errors.password && (
                <p className="text-sm text-red-600">{loginForm.formState.errors.password.message}</p>
              )}
              {remainingAttempts !== null && remainingAttempts <= 3 && (
                <p className="text-sm text-amber-600">
                  Te quedan {remainingAttempts} intentos antes del bloqueo
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-sm text-blue-600 hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </Link>
            </div>

            <Button type="submit" className="w-full" loading={isLoading}>
              Iniciar sesión
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">o</span>
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
              Ingresar con passkey
            </Button>
          </form>
        ) : (
          <form onSubmit={signupForm.handleSubmit(onSignupSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-email" required>
                Email
              </Label>
              <Input
                id="signup-email"
                type="email"
                placeholder="tu@email.com"
                autoComplete="email"
                error={!!signupForm.formState.errors.email}
                {...signupForm.register('email')}
              />
              {signupForm.formState.errors.email && (
                <p className="text-sm text-red-600">{signupForm.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-password" required>
                Contraseña
              </Label>
              <PasswordInput
                id="signup-password"
                placeholder="••••••••"
                autoComplete="new-password"
                error={!!signupForm.formState.errors.password}
                {...signupForm.register('password')}
              />
              <div className="grid grid-cols-2 gap-1">
                {passwordRequirements.map((req) => (
                  <div
                    key={req.label}
                    className="flex items-center gap-1 text-xs"
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

            <div className="flex items-start gap-2">
              <Checkbox
                id="acceptTerms"
                checked={acceptTerms}
                onCheckedChange={(checked) =>
                  signupForm.setValue('acceptTerms', checked as boolean)
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
            {signupForm.formState.errors.acceptTerms && (
              <p className="text-sm text-red-600">{signupForm.formState.errors.acceptTerms.message}</p>
            )}

            <Button type="submit" className="w-full" loading={isLoading}>
              Crear cuenta
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-gray-500">
          {mode === 'login' ? (
            <>
              ¿No tenés cuenta?{' '}
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="text-blue-600 hover:underline font-medium"
              >
                Registrate
              </button>
            </>
          ) : (
            <>
              ¿Ya tenés cuenta?{' '}
              <button
                type="button"
                onClick={() => setMode('login')}
                className="text-blue-600 hover:underline font-medium"
              >
                Iniciá sesión
              </button>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
