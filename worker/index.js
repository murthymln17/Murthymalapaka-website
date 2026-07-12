/**
 * Cloudflare Worker for murthymalapaka.com.
 *
 * Serves the static site (via the assets binding) and the private
 * analytics API under /api/*. Every API route requires the
 * DASHBOARD_TOKEN secret (set in the Worker's Settings → Variables and
 * Secrets) and a matching "Authorization: Bearer <token>" header — the
 * dashboard page at /dashboard/ collects the token once per browser.
 */
import { json } from './utils.js';
import { handleGa4 } from './ga4.js';
import { handleSearchConsole } from './search-console.js';
import { handleCloudflareAnalytics } from './cf-analytics.js';

const routes = {
  '/api/ga4': handleGa4,
  '/api/search-console': handleSearchConsole,
  '/api/cloudflare': handleCloudflareAnalytics,
};

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

async function handleApi(request, env, pathname) {
  if (!env.DASHBOARD_TOKEN) {
    return json(
      { error: 'Dashboard is not configured: set the DASHBOARD_TOKEN secret on the Worker.' },
      503
    );
  }

  const header = request.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token || !(await tokensMatch(token, env.DASHBOARD_TOKEN))) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const handler = routes[pathname.replace(/\/+$/, '')];
  if (!handler) return json({ error: 'Not found' }, 404);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    return await handler(request, env);
  } catch (err) {
    return json({ error: `Internal error: ${err.message}` }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url.pathname);
    }
    return env.ASSETS.fetch(request);
  },
};
