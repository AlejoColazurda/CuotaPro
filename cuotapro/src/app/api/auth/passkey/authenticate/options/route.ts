import { NextRequest, NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { createClient } from '@/lib/supabase/server';

const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email } = body;

    const supabase = await createClient();

    let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] = [];

    if (email) {
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('email', email)
        .single();

      if (users) {
        const { data: passkeys } = await supabase
          .from('passkeys')
          .select('credential_id, transports')
          .eq('user_id', users.id);

        allowCredentials = passkeys?.map((p) => ({
          id: p.credential_id,
          transports: p.transports as AuthenticatorTransport[] | undefined,
        })) || [];
      }
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials,
    });

    await supabase.auth.updateUser({
      data: { webauthn_auth_challenge: options.challenge },
    });

    return NextResponse.json(options);
  } catch (error) {
    console.error('Passkey auth options error:', error);
    return NextResponse.json(
      { error: 'Error al generar opciones de autenticación' },
      { status: 500 }
    );
  }
}
