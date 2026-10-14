import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const { factorId, code } = await request.json();

    if (!factorId || !code) {
      return NextResponse.json(
        { error: 'Factor ID y código son requeridos' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: 'No autenticado' },
        { status: 401 }
      );
    }

    const rateLimitCheck = checkRateLimit(user.id, 'totp');
    if (!rateLimitCheck.success) {
      return NextResponse.json(
        { error: rateLimitCheck.message },
        { status: 429 }
      );
    }

    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    });

    if (challengeError) {
      return NextResponse.json(
        { error: challengeError.message },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challengeData.id,
      code,
    });

    if (error) {
      recordAttempt(user.id, 'totp', false);
      return NextResponse.json(
        { error: 'Código inválido' },
        { status: 400 }
      );
    }

    recordAttempt(user.id, 'totp', true);

    await supabase
      .from('user_profiles')
      .update({ 
        totp_enabled: true,
        totp_verified_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', user.id);

    return NextResponse.json({
      success: true,
      session: data,
    });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
