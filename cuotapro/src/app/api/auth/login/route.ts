import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email y contraseña son requeridos' },
        { status: 400 }
      );
    }

    const identifier = email.toLowerCase();

    const rateLimitCheck = checkRateLimit(identifier, 'login');
    if (!rateLimitCheck.success) {
      return NextResponse.json(
        { 
          error: rateLimitCheck.message,
          blockedUntil: rateLimitCheck.blockedUntil,
          remaining: rateLimitCheck.remaining,
        },
        { status: 429 }
      );
    }

    const supabase = await createClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const result = recordAttempt(identifier, 'login', false);
      
      return NextResponse.json(
        { 
          error: error.message.includes('Invalid login credentials') 
            ? 'Email o contraseña incorrectos'
            : error.message,
          remaining: result.remaining,
          blockedUntil: result.blockedUntil,
        },
        { status: 401 }
      );
    }

    recordAttempt(identifier, 'login', true);

    const { data: factorsData } = await supabase.auth.mfa.listFactors();
    const totpFactor = factorsData?.totp?.[0];

    if (totpFactor && totpFactor.status === 'verified') {
      return NextResponse.json({
        requiresMfa: true,
        factorId: totpFactor.id,
        user: {
          id: data.user?.id,
          email: data.user?.email,
        },
      });
    }

    return NextResponse.json({
      requiresMfa: false,
      user: data.user,
      session: data.session,
    });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
