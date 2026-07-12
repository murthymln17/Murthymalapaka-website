/**
 * Cloudflare Web Analytics (RUM) via the GraphQL Analytics API.
 *
 * Required environment variables:
 *   CF_API_TOKEN  - API token with "Account Analytics: Read"
 *   CF_ACCOUNT_ID - Cloudflare account ID
 *   CF_SITE_TAG   - Web Analytics site tag for murthymalapaka.com
 */
import { json, configError, rangeDays } from './_utils.js';

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

export async function onRequestGet(context) {
  const { request, env } = context;

  const missing = ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_SITE_TAG'].filter((k) => !env[k]);
  if (missing.length) {
    return configError(`Cloudflare Web Analytics is not configured: missing ${missing.join(', ')}.`);
  }

  const days = rangeDays(request);
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);

  const filter = {
    AND: [
      { datetime_geq: since.toISOString() },
      { datetime_leq: until.toISOString() },
      { siteTag: env.CF_SITE_TAG },
    ],
  };

  let res;
  try {
    res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { accountTag: env.CF_ACCOUNT_ID, filter } }),
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

  const timeseries = (account.timeseries || []).map((r) => ({
    date: r.dimensions.date,
    pageviews: r.count,
    visits: r.sum?.visits ?? 0,
  }));

  const totals = timeseries.reduce(
    (acc, r) => ({ pageviews: acc.pageviews + r.pageviews, visits: acc.visits + r.visits }),
    { pageviews: 0, visits: 0 }
  );

  return json({
    days,
    totals,
    timeseries,
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
