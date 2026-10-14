import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { createClient } from '@/lib/supabase/server';

const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
const origin = process.env.WEBAUTHN_ORIGIN || `https://${rpID}`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { credential } = body;

    const supabase = await createClient();

    const { data: passkey } = await supabase
      .from('passkeys')
      .select('*, user_profiles!inner(id, email)')
      .eq('credential_id', credential.id)
      .single();

    if (!passkey) {
      return NextResponse.json(
        { error: 'Passkey no encontrada' },
        { status: 400 }
      );
    }

    const { data: { user } } = await supabase.auth.getUser();
    const expectedChallenge = user?.user_metadata?.webauthn_auth_challenge;

    if (!expectedChallenge) {
      return NextResponse.json(
        { error: 'No se encontró el desafío de autenticación' },
        { status: 400 }
      );
    }

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credential_id,
        publicKey: Buffer.from(passkey.public_key, 'base64'),
        counter: passkey.counter,
        transports: passkey.transports as AuthenticatorTransport[] | undefined,
      },
    });

    if (!verification.verified) {
      return NextResponse.json(
        { error: 'Verificación fallida' },
        { status: 400 }
      );
    }

    await supabase
      .from('passkeys')
      .update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', passkey.id);

    await supabase.from('audit_log').insert({
      user_id: passkey.user_id,
      action: 'user_login',
      new_data: { method: 'passkey', device_type: passkey.device_type },
    });

    return NextResponse.json({ verified: true });
  } catch (error) {
    console.error('Passkey auth verify error:', error);
    return NextResponse.json(
      { error: 'Error al verificar la autenticación' },
      { status: 500 }
    );
  }
}
