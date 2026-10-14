import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { factorId } = await request.json();

    if (!factorId) {
      return NextResponse.json(
        { error: 'Factor ID es requerido' },
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

    const { error } = await supabase.auth.mfa.unenroll({
      factorId,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    await supabase
      .from('user_profiles')
      .update({ 
        totp_enabled: false,
        totp_secret: null,
        totp_verified_at: null,
        recovery_codes: null,
      } as Record<string, unknown>)
      .eq('id', user.id);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
