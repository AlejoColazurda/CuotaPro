import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import crypto from 'crypto';

function generateRecoveryCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return codes;
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export async function POST() {
  try {
    const supabase = await createClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json(
        { error: 'No autenticado' },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('totp_enabled')
      .eq('id', user.id)
      .single() as { data: { totp_enabled: boolean } | null };

    if (!profile?.totp_enabled) {
      return NextResponse.json(
        { error: '2FA debe estar habilitado primero' },
        { status: 400 }
      );
    }

    const codes = generateRecoveryCodes();
    const hashedCodes = codes.map(hashCode);

    await supabase
      .from('user_profiles')
      .update({ recovery_codes: hashedCodes } as Record<string, unknown>)
      .eq('id', user.id);

    return NextResponse.json({
      codes,
      message: 'Guardá estos códigos en un lugar seguro. Cada uno se puede usar solo una vez.',
    });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: 'Código de recuperación requerido' },
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

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('recovery_codes')
      .eq('id', user.id)
      .single() as { data: { recovery_codes: string[] | null } | null };

    if (!profile?.recovery_codes || profile.recovery_codes.length === 0) {
      return NextResponse.json(
        { error: 'No hay códigos de recuperación disponibles' },
        { status: 400 }
      );
    }

    const hashedInput = hashCode(code.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    const codeIndex = profile.recovery_codes.findIndex((c: string) => c === hashedInput);

    if (codeIndex === -1) {
      return NextResponse.json(
        { error: 'Código de recuperación inválido' },
        { status: 400 }
      );
    }

    const updatedCodes = [...profile.recovery_codes];
    updatedCodes.splice(codeIndex, 1);

    await supabase
      .from('user_profiles')
      .update({ recovery_codes: updatedCodes } as Record<string, unknown>)
      .eq('id', user.id);

    return NextResponse.json({
      success: true,
      remainingCodes: updatedCodes.length,
    });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
