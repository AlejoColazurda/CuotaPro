import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit, recordAttempt } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const { email, password, fullName, businessName, slug } = await request.json();

    if (!email || !password || !fullName || !businessName || !slug) {
      return NextResponse.json(
        { error: 'Todos los campos son requeridos' },
        { status: 400 }
      );
    }

    const ip = request.headers.get('x-forwarded-for') || 
               request.headers.get('x-real-ip') || 
               'unknown';

    const rateLimitCheck = checkRateLimit(ip, 'signup');
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

    const { data: existingTenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', slug.toLowerCase())
      .single();

    if (existingTenant) {
      return NextResponse.json(
        { error: 'Ese slug ya está en uso. Elegí otro.' },
        { status: 400 }
      );
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        },
      },
    });

    if (authError) {
      recordAttempt(ip, 'signup', false);
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      );
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: 'Error al crear el usuario' },
        { status: 400 }
      );
    }

    recordAttempt(ip, 'signup', true);

    return NextResponse.json({
      user: authData.user,
      message: 'Cuenta creada. Revisá tu email para confirmar.',
    });
  } catch {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}
