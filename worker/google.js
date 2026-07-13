/**
 * Google service-account authentication for Workers/Pages Functions.
 *
 * Expects GOOGLE_SERVICE_ACCOUNT_JSON to hold the full JSON key file of a
 * service account. Signs a JWT with WebCrypto (RS256) and exchanges it for
 * an OAuth2 access token. Tokens are cached per scope for their lifetime.
 */

const tokenCache = new Map(); // scope -> { token, expiresAt }

function base64UrlEncode(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlEncodeString(text) {
  return base64UrlEncode(new TextEncoder().encode(text));
}

function pemToDer(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function googleAccessToken(env, scope) {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;

  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not configured');
  }

  // Tolerate common paste mangling (mobile keyboards): smart quotes,
  // BOM / zero-width characters, Unicode spaces and line separators.
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\uFEFF\u200B-\u200D\u2060]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    .replace(/[\u2028\u2029\u0085]/g, '\n')
    .trim();

  let sa;
  try {
    sa = JSON.parse(raw);
  } catch (parseErr) {
    const head = raw.slice(0, 20);
    const bad = raw.match(/[^\x20-\x7E\n\r\t]/);
    const badNote = bad
      ? ` First unexpected character: U+${bad[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} at position ${bad.index}.`
      : ` Parser said: ${parseErr.message.slice(0, 120)}.`;
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (length ${raw.length}, starts with \u201C${head}\u2026\u201D).${badNote} ` +
        'Re-copy the ENTIRE key file, from the opening { to the closing }, and paste it again.'
    );
  }
  if (!sa.client_email || !sa.private_key) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON parsed but is missing client_email or private_key - it does not look like a service account key file.'
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlEncodeString(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  tokenCache.set(scope, {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  });
  return data.access_token;
}
