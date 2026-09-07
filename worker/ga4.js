/**
 * Google Analytics 4 — detailed behavior via the GA4 Data API, plus the
 * realtime active-user count.
 *
 * Required environment variables:
 *   GOOGLE_SERVICE_ACCOUNT_JSON - service account key JSON (added as a
 *                                 Viewer on the GA4 property)
 *   GA4_PROPERTY_ID             - numeric GA4 property ID
 */
import { json, configError, rangeDays, fillDailySeries, runBatchedReports } from './utils.js';
import { googleAccessToken } from './google.js';

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/** Offset, in ms, of an IANA time zone at a given UTC instant. */
function zoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const asIfUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second)
  );
  return asIfUtc - utcMs;
}

/**
 * GA4's dateHourMinute is a wall-clock reading in the PROPERTY's time zone,
 * carrying no offset. Convert it to a true instant so the dashboard can then
 * render it in the viewer's local time. Treating the string as UTC (the
 * original bug) shifted every timestamp twice.
 */
function wallClockToInstant(raw, timeZone) {
  const y = Number(raw.slice(0, 4));
  const mo = Number(raw.slice(4, 6));
  const d = Number(raw.slice(6, 8));
  const h = Number(raw.slice(8, 10));
  const mi = Number(raw.slice(10, 12));
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  if (!timeZone) return new Date(naive); // no metadata: best effort, unshifted
  let ts = naive - zoneOffsetMs(naive, timeZone);
  // Re-evaluate once: near a DST boundary the offset at the corrected instant
  // can differ from the offset at the naive guess.
  const refined = naive - zoneOffsetMs(ts, timeZone);
  if (refined !== ts) ts = refined;
  return new Date(ts);
}

/**
 * GA4 reports activity per minute, so a single visit spans several rows.
 * Group rows from the same place/source/landing page within 30 minutes into
 * one visit. Returns the 25 most recent, newest first. Output carries no
 * identity fields — GA4 exposes none, and none are derived here.
 */
function stitchVisits(rawRows, metric, timeZone) {
  const parseMinute = (raw) => wallClockToInstant(raw, timeZone);
  const visits = [];
  for (const r of rawRows) {
    const [rawMinute, city, country, source, landingPage] = r.dimensionValues.map((d) => d.value);
    if (!/^\d{12}$/.test(rawMinute)) continue; // '(other)' and thresholded rows
    const at = parseMinute(rawMinute);
    const key = `${city}|${country}|${source}|${landingPage}`;
    const open = visits.find((v) => v.key === key && Math.abs(v.startedAt - at) <= 30 * 60 * 1000);
    if (open) {
      open.pageviews += metric(r, 0);
      open.engagementSeconds += metric(r, 1);
      if (at < open.startedAt) open.startedAt = at;
    } else {
      visits.push({
        key,
        startedAt: at,
        city: city && city !== '(not set)' ? city : null,
        country: country && country !== '(not set)' ? country : null,
        source: source || '(direct)',
        landingPage,
        pageviews: metric(r, 0),
        engagementSeconds: metric(r, 1),
      });
    }
  }
  visits.sort((a, b) => b.startedAt - a.startedAt);
  return visits.slice(0, 25).map((v) => ({
    startedAt: v.startedAt.toISOString(),
    city: v.city,
    country: v.country,
    source: v.source,
    landingPage: v.landingPage,
    pageviews: v.pageviews,
    engagementSeconds: v.engagementSeconds,
  }));
}

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
      {
        // Where readers actually are. GA4 carries the full history here;
        // the Cloudflare countries card only covers the period since its
        // beacon started collecting.
        dateRanges,
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }, { name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
        limit: 15,
      },
      {
        // 5: recent activity at minute granularity, so a visit that follows
        // a LinkedIn post is visible as a moment rather than a daily total.
        // Rows are pseudonymous by construction — GA4 exposes no identity.
        dateRanges,
        dimensions: [
          { name: 'dateHourMinute' },
          { name: 'city' },
          { name: 'country' },
          { name: 'sessionSource' },
          { name: 'landingPagePlusQueryString' },
        ],
        metrics: [{ name: 'screenPageViews' }, { name: 'userEngagementDuration' }],
        orderBys: [{ dimension: { dimensionName: 'dateHourMinute' }, desc: true }],
        limit: 200,
      },
    ],
  };

  let batch;
  let realtimeUsers = null;
  try {
    const [reportList, realtimeRes] = await Promise.all([
      runBatchedReports(base, token, reports.requests),
      post('runRealtimeReport', { metrics: [{ name: 'activeUsers' }] }).catch(() => null),
    ]);
    batch = { reports: reportList };
    if (realtimeRes) {
      realtimeUsers = Number(realtimeRes.rows?.[0]?.metricValues?.[0]?.value || 0);
    }
  } catch (err) {
    return json({ error: err.message }, 502);
  }

  const [daily, pages, channels, sources, countries, recent] = batch.reports || [];
  const rows = (report) => report?.rows || [];
  const metric = (row, i) => Number(row.metricValues?.[i]?.value || 0);

  const timeseries = fillDailySeries(
    rows(daily).map((r) => {
      const raw = r.dimensionValues[0].value; // yyyymmdd
      return {
        date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
        users: metric(r, 0),
        pageviews: metric(r, 1),
        sessions: metric(r, 2),
        avgSessionDuration: metric(r, 3),
      };
    }),
    days,
    { users: 0, pageviews: 0, sessions: 0, avgSessionDuration: 0 }
  );

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
    countries: rows(countries).map((r) => ({
      label: r.dimensionValues[0].value || '(not set)',
      users: metric(r, 0),
      sessions: metric(r, 1),
    })),
    propertyTimeZone: recent?.metadata?.timeZone || null,
    recentVisits: stitchVisits(rows(recent), metric, recent?.metadata?.timeZone),
  });
}
