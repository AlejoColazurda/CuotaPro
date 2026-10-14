import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { createClient } from '@/lib/supabase/server';

const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
const origin = process.env.WEBAUTHN_ORIGIN || `https://${rpID}`;

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json();
    const { credential, name } = body;

    const expectedChallenge = user.user_metadata?.webauthn_challenge;

    if (!expectedChallenge) {
      return NextResponse.json(
        { error: 'No se encontró el desafío de registro' },
        { status: 400 }
      );
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json(
        { error: 'Verificación fallida' },
        { status: 400 }
      );
    }

    const { credential: regCred, credentialDeviceType } = verification.registrationInfo;

    const { error: insertError } = await supabase.from('passkeys').insert({
      user_id: user.id,
      credential_id: regCred.id,
      public_key: Buffer.from(regCred.publicKey).toString('base64'),
      counter: Number(regCred.counter),
      device_type: credentialDeviceType,
      transports: credential.response.transports,
      name: name || 'Mi dispositivo',
    } as Record<string, unknown>);

    if (insertError) {
      console.error('Error saving passkey:', insertError);
      return NextResponse.json(
        { error: 'Error al guardar la passkey' },
        { status: 500 }
      );
    }

    await supabase.auth.updateUser({
      data: { webauthn_challenge: null },
    });

    await supabase.from('audit_log').insert({
      user_id: user.id,
      action: 'passkey_registered',
      entity_type: 'passkey',
      new_data: { device_type: credentialDeviceType, name },
    } as Record<string, unknown>);

    return NextResponse.json({ verified: true });
  } catch (error) {
    console.error('Passkey registration verify error:', error);
    return NextResponse.json(
      { error: 'Error al verificar el registro' },
      { status: 500 }
    );
  }
}
