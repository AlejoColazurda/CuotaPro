import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: 'Email es requerido' },
        { status: 400 }
      );
    }

    const identifier = email.toLowerCase();

    const rateLimitCheck = checkRateLimit(identifier, 'passwordRecovery');
    if (!rateLimitCheck.success) {
      return NextResponse.json(
        { 
          error: rateLimitCheck.message,
          blockedUntil: rateLimitCheck.blockedUntil,
        },
        { status: 429 }
      );
    }

    const supabase = await createClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'}/reset-password`,
    });

    recordAttempt(identifier, 'passwordRecovery', !error);

    return NextResponse.json({
      message: 'Si el email existe, recibirás un link para restablecer tu contraseña.',
    });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
