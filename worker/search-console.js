/**
 * Google Search Console — search performance for the site.
 *
 * Required environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_JSON - service account key JSON (added as a user in GSC)
 *   GSC_SITE_URL                - property, e.g. "sc-domain:murthymalapaka.com"
 *                                 or "https://murthymalapaka.com/"
 */
import { json, configError, rangeDays, isoDate } from './utils.js';
import { googleAccessToken } from './google.js';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export async function handleSearchConsole(request, env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GSC_SITE_URL) {
    return configError(
      'Search Console is not configured: set GOOGLE_SERVICE_ACCOUNT_JSON and GSC_SITE_URL.'
    );
  }

  const days = rangeDays(request);
  // Search Console data lags ~2 days; extend the window back so a short
  // range still returns finalized days.
  const endDate = isoDate(0);
  const startDate = isoDate(-days);

  let token;
  try {
    token = await googleAccessToken(env, SCOPE);
  } catch (err) {
    return json({ error: `Google authentication failed: ${err.message}` }, 502);
  }

  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    env.GSC_SITE_URL
  )}/searchAnalytics/query`;

  const runQuery = async (body) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, ...body }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Search Console API ${res.status}: ${detail.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.rows || [];
  };

  let byDate, byQuery, byPage;
  try {
    [byDate, byQuery, byPage] = await Promise.all([
      runQuery({ dimensions: ['date'], rowLimit: 400 }),
      runQuery({ dimensions: ['query'], rowLimit: 12 }),
      runQuery({ dimensions: ['page'], rowLimit: 12 }),
    ]);
  } catch (err) {
    return json({ error: err.message }, 502);
  }

  const timeseries = byDate.map((r) => ({
    date: r.keys[0],
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.ctr,
    position: r.position,
  }));

  const totals = timeseries.reduce(
    (acc, r) => ({
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
    }),
    { clicks: 0, impressions: 0 }
  );
  totals.ctr = totals.impressions ? totals.clicks / totals.impressions : 0;
  totals.position = timeseries.length
    ? timeseries.reduce((s, r) => s + r.position * r.impressions, 0) /
      Math.max(1, totals.impressions)
    : 0;

  const mapRows = (rows) =>
    rows.map((r) => ({
      label: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: r.ctr,
      position: r.position,
    }));

  return json({
    days,
    startDate,
    endDate,
    totals,
    timeseries,
    topQueries: mapRows(byQuery),
    topPages: mapRows(byPage).map((r) => ({
      ...r,
      label: r.label.replace(/^https?:\/\/[^/]+/, '') || '/',
    })),
  });
}
