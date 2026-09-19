/**
 * Cloudflare Web Analytics (RUM) via the GraphQL Analytics API.
 *
 * Required environment variables:
 *   CF_API_TOKEN  - API token with "Account Analytics: Read"
 *
 * Optional (defaults below are for murthymalapaka.com and are not secrets):
 *   CF_ACCOUNT_ID - Cloudflare account ID
 *   CF_SITE_TAG   - Web Analytics site tag
 */
import { json, configError, rangeDays, fillDailySeries } from './utils.js';

const QUERY = `
query Dashboard($accountTag: string, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      timeseries: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 366, orderBy: [date_ASC]) {
        count
        sum { visits }
        dimensions { date }
      }
      topPaths: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 12, orderBy: [count_DESC]) {
        count
        sum { visits }
        dimensions { requestPath }
      }
      topReferrers: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 12, orderBy: [count_DESC]) {
        count
        sum { visits }
        dimensions { refererHost }
      }
      countries: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 10, orderBy: [count_DESC]) {
        count
        sum { visits }
        dimensions { countryName }
      }
      devices: rumPageloadEventsAdaptiveGroups(filter: $filter, limit: 6, orderBy: [count_DESC]) {
        count
        dimensions { deviceType }
      }
    }
  }
}`;

const DEFAULT_ACCOUNT_ID = '2c58538c94b77c5a803d0cd1aa293afb';
const DEFAULT_SITE_TAG = '077479bae8114ace81c2daabd3162d15';

// Must match the dataset name bound as VISITS in wrangler.jsonc.
const VISITS_DATASET = 'mm_site_visits';

/**
 * Visiting networks from the Worker's own edge log (worker/edge-log.js),
 * read back through the Analytics Engine SQL API. Web Analytics cannot
 * answer this — its RUM dataset carries no network dimension, and no
 * geography finer than country.
 *
 * Returns null rather than throwing: the dataset does not exist until the
 * first visit after deploy, and this must not take the rest of the
 * Cloudflare card set down with it.
 */
async function fetchNetworks(env, accountId, days) {
  // `days` is the integer from rangeDays(), clamped 1–365, so it is safe
  // to interpolate — the SQL API takes no bound parameters.
  const sql = `SELECT blob1 AS org, blob7 AS kind, blob4 AS country,
      SUM(_sample_interval) AS visits
    FROM ${VISITS_DATASET}
    WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
      AND blob1 != ''
    GROUP BY org, kind, country
    ORDER BY visits DESC
    LIMIT 300`;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
      body: sql,
    }
  );
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const rows = body?.data;
  if (!Array.isArray(rows)) return null;

  // One network can appear under several countries; fold those together
  // and keep the country it was seen from most.
  const byOrg = new Map();
  const totals = { org: 0, consumer: 0, infra: 0 };
  for (const r of rows) {
    const visits = Number(r.visits) || 0;
    const kind = r.kind === 'org' || r.kind === 'consumer' ? r.kind : 'infra';
    totals[kind] += visits;
    if (kind !== 'org') continue;
    const entry = byOrg.get(r.org) || { label: r.org, visits: 0, country: null, topCountry: 0 };
    entry.visits += visits;
    if (visits > entry.topCountry) {
      entry.topCountry = visits;
      entry.country = r.country || null;
    }
    byOrg.set(r.org, entry);
  }

  const organisations = [...byOrg.values()]
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 12)
    .map(({ label, visits, country }) => ({ label, visits, country }));

  return {
    organisations,
    orgVisits: totals.org,
    consumerVisits: totals.consumer,
    infraVisits: totals.infra,
  };
}

export async function handleCloudflareAnalytics(request, env) {
  if (!env.CF_API_TOKEN) {
    return configError('Cloudflare Web Analytics is not configured: add the CF_API_TOKEN secret (Account Analytics: Read).');
  }
  const accountId = env.CF_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
  const siteTag = env.CF_SITE_TAG || DEFAULT_SITE_TAG;

  const days = rangeDays(request);
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);

  const filter = {
    AND: [
      { datetime_geq: since.toISOString() },
      { datetime_leq: until.toISOString() },
      { siteTag },
    ],
  };

  // Started before the GraphQL call and awaited after it, so the two share
  // one round trip rather than queueing.
  const networksPromise = fetchNetworks(env, accountId, days).catch(() => null);

  let res;
  try {
    res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { accountTag: accountId, filter } }),
    });
  } catch (err) {
    return json({ error: `Could not reach the Cloudflare API: ${err.message}` }, 502);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.errors?.length) {
    const message = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    return json({ error: `Cloudflare API error: ${message}` }, 502);
  }

  const account = body.data?.viewer?.accounts?.[0];
  if (!account) {
    return json({ error: 'Cloudflare API returned no account data — check CF_ACCOUNT_ID and token permissions.' }, 502);
  }

  const pick = (rows, dim) =>
    (rows || []).map((r) => ({
      label: r.dimensions[dim] || '(none)',
      pageviews: r.count,
      visits: r.sum?.visits ?? null,
    }));

  const timeseries = fillDailySeries(
    (account.timeseries || []).map((r) => ({
      date: r.dimensions.date,
      pageviews: r.count,
      visits: r.sum?.visits ?? 0,
    })),
    days,
    { pageviews: 0, visits: 0 }
  );

  const totals = timeseries.reduce(
    (acc, r) => ({ pageviews: acc.pageviews + r.pageviews, visits: acc.visits + r.visits }),
    { pageviews: 0, visits: 0 }
  );

  return json({
    days,
    totals,
    timeseries,
    networks: await networksPromise,
    topPaths: pick(account.topPaths, 'requestPath'),
    topReferrers: pick(account.topReferrers, 'refererHost').map((r) => ({
      ...r,
      label: r.label === '(none)' || r.label === '' ? 'Direct / none' : r.label,
    })),
    countries: pick(account.countries, 'countryName'),
    devices: (account.devices || []).map((r) => ({
      label: r.dimensions.deviceType || 'unknown',
      pageviews: r.count,
    })),
  });
}
