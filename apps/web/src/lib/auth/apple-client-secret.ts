import { createPrivateKey, sign } from 'node:crypto';
import { env } from '@/lib/env';

// Apple's OAuth "client secret" is not a static string: it's an ES256-signed JWT
// that we mint from the Sign-in-with-Apple .p8 private key. Apple caps its
// lifetime at 6 months; we sign a fresh one each time better-auth builds its
// options (i.e. per server instance), so the token is always far from expiry and
// there is nothing to rotate manually — the whole point of choosing this over a
// hand-pasted secret.
//
// We deliberately avoid pulling in a JWT dependency: Node's crypto.sign with
// dsaEncoding 'ieee-p1363' emits the raw R||S signature JOSE (ES256) expects.

const SIX_MONTHS_SECONDS = 60 * 60 * 24 * 180;

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

export type AppleCredentials = {
  clientId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
};

/** All four Apple env vars present => credentials, else null (Apple disabled). */
export function getAppleCredentials(): AppleCredentials | null {
  const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = env;
  if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    return null;
  }
  return {
    clientId: APPLE_CLIENT_ID,
    teamId: APPLE_TEAM_ID,
    keyId: APPLE_KEY_ID,
    privateKey: APPLE_PRIVATE_KEY,
  };
}

/**
 * Sign the Apple client-secret JWT (ES256). Throws if the .p8 is malformed so a
 * misconfiguration surfaces loudly at auth init rather than as a silent OAuth
 * failure later. Returns null only when Apple is not configured at all.
 */
export function generateAppleClientSecret(creds: AppleCredentials): string {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const header = { alg: 'ES256', kid: creds.keyId };
  const payload = {
    iss: creds.teamId,
    iat: nowSeconds,
    exp: nowSeconds + SIX_MONTHS_SECONDS,
    aud: 'https://appleid.apple.com',
    sub: creds.clientId,
  };

  // Env stores the PEM with escaped newlines; restore them for the parser.
  const pem = creds.privateKey.replace(/\\n/g, '\n');
  const key = createPrivateKey(pem);

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', new TextEncoder().encode(signingInput), {
    key,
    dsaEncoding: 'ieee-p1363',
  });

  return `${signingInput}.${base64url(signature)}`;
}
