/**
 * Auth gate for every /api/* route.
 *
 * Requires the DASHBOARD_TOKEN environment variable (set in the Cloudflare
 * Pages project settings) and a matching "Authorization: Bearer <token>"
 * header on every request. The dashboard page collects the token once and
 * stores it in the browser.
 */

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return new Uint8Array(digest);
}

// Constant-time comparison via hashing so token length/content never leaks.
async function tokensMatch(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

export async function onRequest(context) {
  const { request, env, next } = context;

  if (!env.DASHBOARD_TOKEN) {
    return Response.json(
      { error: 'Dashboard is not configured: set the DASHBOARD_TOKEN environment variable in Cloudflare Pages.' },
      { status: 503 }
    );
  }

  const header = request.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');

  if (!token || !(await tokensMatch(token, env.DASHBOARD_TOKEN))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return next();
}
