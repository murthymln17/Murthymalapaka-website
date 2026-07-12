/**
 * Google Analytics 4 — detailed behavior via the GA4 Data API, plus the
 * realtime active-user count.
 *
 * Required environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_JSON - service account key JSON (added as a
 *                                 Viewer on the GA4 property)
 *   GA4_PROPERTY_ID             - numeric GA4 property ID
 */
import { json, configError, rangeDays } from './utils.js';
import { googleAccessToken } from './google.js';

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export async function handleGa4(request, env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GA4_PROPERTY_ID) {
    return configError('GA4 is not configured: set GOOGLE_SERVICE_ACCOUNT_JSON and GA4_PROPERTY_ID.');
  }

  const days = rangeDays(request);
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'today' }];
  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}`;
  const realtimeOnly = new URL(request.url).searchParams.has('realtime');

  let token;
  try {
    token = await googleAccessToken(env, SCOPE);
  } catch (err) {
    return json({ error: `Google authentication failed: ${err.message}` }, 502);
  }

  const post = async (path, body) => {
    const res = await fetch(`${base}:${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`GA4 Data API ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.json();
  };

  if (realtimeOnly) {
    try {
      const rt = await post('runRealtimeReport', { metrics: [{ name: 'activeUsers' }] });
      return json({ realtimeUsers: Number(rt.rows?.[0]?.metricValues?.[0]?.value || 0) });
    } catch (err) {
      return json({ error: err.message }, 502);
    }
  }

  const reports = {
    requests: [
      {
        dateRanges,
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'screenPageViews' },
          { name: 'sessions' },
          { name: 'averageSessionDuration' },
        ],
        orderBys: [{ dimension: { dimensionName: 'date' } }],
        limit: 366,
      },
      {
        dateRanges,
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
          { name: 'userEngagementDuration' },
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 12,
      },
      {
        dateRanges,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 10,
      },
      {
        dateRanges,
        dimensions: [{ name: 'sessionSource' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 12,
      },
    ],
  };

  let batch;
  let realtimeUsers = null;
  try {
    const [batchRes, realtimeRes] = await Promise.all([
      post('batchRunReports', reports),
      post('runRealtimeReport', { metrics: [{ name: 'activeUsers' }] }).catch(() => null),
    ]);
    batch = batchRes;
    if (realtimeRes) {
      realtimeUsers = Number(realtimeRes.rows?.[0]?.metricValues?.[0]?.value || 0);
    }
  } catch (err) {
    return json({ error: err.message }, 502);
  }

  const [daily, pages, channels, sources] = batch.reports || [];
  const rows = (report) => report?.rows || [];
  const metric = (row, i) => Number(row.metricValues?.[i]?.value || 0);

  const timeseries = rows(daily).map((r) => {
    const raw = r.dimensionValues[0].value; // yyyymmdd
    return {
      date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      users: metric(r, 0),
      pageviews: metric(r, 1),
      sessions: metric(r, 2),
      avgSessionDuration: metric(r, 3),
    };
  });

  const totals = timeseries.reduce(
    (acc, r) => ({
      users: acc.users + r.users,
      pageviews: acc.pageviews + r.pageviews,
      sessions: acc.sessions + r.sessions,
    }),
    { users: 0, pageviews: 0, sessions: 0 }
  );
  totals.avgSessionDuration = timeseries.length
    ? timeseries.reduce((s, r) => s + r.avgSessionDuration * r.sessions, 0) /
      Math.max(1, totals.sessions)
    : 0;

  return json({
    days,
    realtimeUsers,
    totals,
    timeseries,
    topPages: rows(pages).map((r) => ({
      path: r.dimensionValues[0].value,
      title: (r.dimensionValues[1].value || '').replace(/\s*\|\s*Murthy Malapaka\s*$/, ''),
      pageviews: metric(r, 0),
      users: metric(r, 1),
      avgEngagementSeconds: metric(r, 1) ? metric(r, 2) / metric(r, 1) : 0,
    })),
    channels: rows(channels).map((r) => ({
      label: r.dimensionValues[0].value,
      sessions: metric(r, 0),
      users: metric(r, 1),
    })),
    sources: rows(sources).map((r) => ({
      label: r.dimensionValues[0].value,
      sessions: metric(r, 0),
      users: metric(r, 1),
    })),
  });
}
