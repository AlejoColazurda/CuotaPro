'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { Check, X } from 'lucide-react';

const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, 'La contraseña debe tener al menos 8 caracteres')
      .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
      .regex(/[a-z]/, 'Debe contener al menos una minúscula')
      .regex(/[0-9]/, 'Debe contener al menos un número'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

const passwordRequirements = [
  { label: 'Al menos 8 caracteres', test: (p: string) => p.length >= 8 },
  { label: 'Una letra mayúscula', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'Una letra minúscula', test: (p: string) => /[a-z]/.test(p) },
  { label: 'Un número', test: (p: string) => /[0-9]/.test(p) },
];

export default function ResetPasswordPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
  });

  const password = watch('password', '');

  const onSubmit = async (data: ResetPasswordForm) => {
    setIsLoading(true);

    try {
      const supabase = createClient();

      const { error } = await supabase.auth.updateUser({
        password: data.password,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success('Contraseña actualizada correctamente');
      router.push('/dashboard');
    } catch {
      toast.error('Error al actualizar la contraseña');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle>Restablecer contraseña</CardTitle>
        <CardDescription>Ingresá tu nueva contraseña</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password" required>
              Nueva contraseña
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

          <Button type="submit" className="w-full" loading={isLoading}>
            Actualizar contraseña
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
