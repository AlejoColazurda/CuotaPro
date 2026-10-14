import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { createClient } from '@/lib/supabase/server';

const rpName = 'CuotaPro';
const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const { data: existingPasskeys } = await supabase
      .from('passkeys')
      .select('credential_id, transports')
      .eq('user_id', user.id);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: user.email || user.id,
      userDisplayName: user.user_metadata?.full_name || user.email || 'Usuario',
      attestationType: 'none',
      excludeCredentials: existingPasskeys?.map((passkey) => ({
        id: passkey.credential_id,
        transports: passkey.transports as AuthenticatorTransport[] | undefined,
      })) || [],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
    });

    const { error } = await supabase.auth.updateUser({
      data: { webauthn_challenge: options.challenge },
    });

    if (error) {
      console.error('Error storing challenge:', error);
    }

    return NextResponse.json(options);
  } catch (error) {
    console.error('Passkey registration options error:', error);
    return NextResponse.json(
      { error: 'Error al generar opciones de registro' },
      { status: 500 }
    );
  }
}
