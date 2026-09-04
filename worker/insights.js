/**
 * /api/insights — the judgment layer over the raw sources.
 *
 * Pulls GA4 (required) and Search Console (optional) for the requested
 * range plus the previous period, joins in the manually maintained
 * LinkedIn post log, and computes objective-oriented answers:
 *
 *  - Reach → Read → Connect funnel with period-over-period deltas
 *  - Executive-intent share of search impressions (vocabulary match)
 *  - Per-article effectiveness (views, LinkedIn-sourced visits, search)
 *  - Day-of-week traffic pattern and LinkedIn post-day lift
 *  - An advisor brief: deterministic narrative by default, written by
 *    Claude when the optional ANTHROPIC_API_KEY secret is configured.
 *
 * Required env: GOOGLE_SERVICE_ACCOUNT_JSON, GA4_PROPERTY_ID.
 * Optional env: GSC_SITE_URL override, ANTHROPIC_API_KEY, INSIGHTS_MODEL.
 */
import { json, configError, rangeDays, isoDate } from './utils.js';
import { googleAccessToken } from './google.js';
import linkedinLog from './linkedin-posts.json' with { type: 'json' };

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const DEFAULT_GSC_SITE = 'sc-domain:murthymalapaka.com';

// Vocabulary that marks a search query as executive/operating-model intent
// rather than generic tech curiosity. Lowercase substrings.
const EXEC_TERMS = [
  'operating model', 'operating models', 'transformation', 'enterprise ai',
  'ai strategy', 'ai adoption', 'ai native', 'ai-native', 'digital labor',
  'digital labour', 'intelligent automation', 'it operations', 'itops',
  'sre', 'governance', 'cio', 'cto', 'coo', 'cxo', 'chief', 'executive',
  'leadership', 'board', 'cost take', 'avoided cost', 'headcount',
  'forward deployed', 'forward-deployed',
];
const BRAND_TERMS = ['malapaka', 'murthy'];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------------- GA4 ---------------- */

async function fetchGa4(env, token, days) {
  const base = `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}`;
  const current = { startDate: `${days}daysAgo`, endDate: 'today' };
  const previous = { startDate: `${2 * days}daysAgo`, endDate: `${days + 1}daysAgo` };
  const linkedinFilter = {
    filter: {
      fieldName: 'sessionSource',
      stringFilter: { matchType: 'CONTAINS', value: 'linkedin', caseSensitive: false },
    },
  };

  const body = {
    requests: [
      {
        // 0: daily totals, current + previous period
        dateRanges: [current, previous],
        dimensions: [{ name: 'date' }],
        metrics: [
          { name: 'sessions' },
          { name: 'activeUsers' },
          { name: 'screenPageViews' },
          { name: 'engagedSessions' },
          { name: 'userEngagementDuration' },
        ],
        limit: 800,
      },
      {
        // 1: per-page totals
        dateRanges: [current],
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'activeUsers' },
          { name: 'userEngagementDuration' },
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 200,
      },
      {
        // 2: LinkedIn-sourced sessions per page
        dateRanges: [current],
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        dimensionFilter: linkedinFilter,
        limit: 200,
      },
      {
        // 3: LinkedIn-sourced sessions per day (post-day correlation)
        dateRanges: [current],
        dimensions: [{ name: 'date' }],
        metrics: [{ name: 'sessions' }],
        dimensionFilter: linkedinFilter,
        limit: 400,
      },
      {
        // 4: outbound clicks by destination domain ("connecting" signal)
        dateRanges: [current],
        dimensions: [{ name: 'linkDomain' }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          andGroup: {
            expressions: [
              { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'click' } } },
              { filter: { fieldName: 'outbound', stringFilter: { matchType: 'EXACT', value: 'true' } } },
            ],
          },
        },
        limit: 50,
      },
    ],
  };

  const res = await fetch(`${base}:batchRunReports`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`GA4 Data API ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()).reports || [];
}

const mval = (row, i) => Number(row.metricValues?.[i]?.value || 0);
const ga4Date = (raw) => `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;

/* ---------------- Search Console ---------------- */

async function fetchGsc(env, token, days) {
  const site = env.GSC_SITE_URL || DEFAULT_GSC_SITE;
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site)}/searchAnalytics/query`;
  const run = async (body) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Search Console ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).rows || [];
  };
  const [currentDates, previousDates, queries, pages] = await Promise.all([
    run({ startDate: isoDate(-days), endDate: isoDate(0), dimensions: ['date'], rowLimit: 800 }),
    run({ startDate: isoDate(-2 * days), endDate: isoDate(-days - 1), dimensions: ['date'], rowLimit: 800 }),
    run({ startDate: isoDate(-days), endDate: isoDate(0), dimensions: ['query'], rowLimit: 250 }),
    run({ startDate: isoDate(-days), endDate: isoDate(0), dimensions: ['page'], rowLimit: 250 }),
  ]);
  const totals = (rows) =>
    rows.reduce(
      (a, r) => ({ clicks: a.clicks + r.clicks, impressions: a.impressions + r.impressions }),
      { clicks: 0, impressions: 0 }
    );
  return {
    totals: totals(currentDates),
    previousTotals: totals(previousDates),
    queries: queries.map((r) => ({
      query: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position,
    })),
    pages: pages.map((r) => ({
      path: (r.keys[0] || '').replace(/^https?:\/\/[^/]+/, '') || '/',
      clicks: r.clicks, impressions: r.impressions, position: r.position,
    })),
  };
}

/* ---------------- computations ---------------- */

function classifyQueries(queries) {
  let execImpr = 0, brandImpr = 0, totalImpr = 0;
  const execQueries = [];
  for (const q of queries) {
    totalImpr += q.impressions;
    const text = q.query.toLowerCase();
    if (BRAND_TERMS.some((t) => text.includes(t))) {
      brandImpr += q.impressions;
    } else if (EXEC_TERMS.some((t) => text.includes(t))) {
      execImpr += q.impressions;
      execQueries.push(q);
    }
  }
  execQueries.sort((a, b) => b.impressions - a.impressions);
  return {
    totalImpressions: totalImpr,
    executiveImpressions: execImpr,
    brandImpressions: brandImpr,
    executiveShare: totalImpr ? execImpr / totalImpr : 0,
    brandShare: totalImpr ? brandImpr / totalImpr : 0,
    topExecutiveQueries: execQueries.slice(0, 8),
  };
}

function weekdayPattern(daily) {
  const sums = Array(7).fill(0), counts = Array(7).fill(0);
  for (const d of daily) {
    const wd = new Date(`${d.date}T00:00:00Z`).getUTCDay();
    sums[wd] += d.sessions;
    counts[wd] += 1;
  }
  const pattern = WEEKDAYS.map((label, i) => ({
    day: label,
    avgSessions: counts[i] ? sums[i] / counts[i] : 0,
  }));
  const ranked = [...pattern].sort((a, b) => b.avgSessions - a.avgSessions);
  return { pattern, bestDays: ranked.slice(0, 2).filter((d) => d.avgSessions > 0).map((d) => d.day) };
}

function postDayLift(posts, schedule, dailyLinkedin, dailyAll) {
  const loggedByDate = new Map(
    posts.filter((p) => dailyAll.some((d) => d.date === p.date)).map((p) => [p.date, p])
  );
  // A standing posting schedule (e.g. every Mon and Thu) makes those weekdays
  // post days even without a logged entry; logged posts add detail on top.
  const scheduleIdx = new Set((schedule || []).map((d) => WEEKDAYS.indexOf(d)).filter((i) => i >= 0));
  const postDates = new Set(loggedByDate.keys());
  for (const d of dailyAll) {
    if (scheduleIdx.has(new Date(`${d.date}T00:00:00Z`).getUTCDay())) postDates.add(d.date);
  }
  if (!postDates.size) return null;

  const liSessions = new Map(dailyLinkedin.map((d) => [d.date, d.sessions]));
  const allSessions = new Map(dailyAll.map((d) => [d.date, d.sessions]));

  // Compare the post days themselves against all remaining days; the
  // 48-hour view below is per-post attribution, not part of the averages.
  let postDayTotal = 0, postDayCount = 0, otherTotal = 0, otherCount = 0;
  for (const d of dailyAll) {
    if (postDates.has(d.date)) { postDayTotal += d.sessions; postDayCount++; }
    else { otherTotal += d.sessions; otherCount++; }
  }

  const perPost = [...postDates].sort().reverse().slice(0, 10).map((date) => {
    const logged = loggedByDate.get(date);
    const li48 = (liSessions.get(date) || 0) + (liSessions.get(isoNext(date)) || 0);
    return {
      date,
      topic: logged?.topic || null,
      articlePath: logged?.articlePath || null,
      impressions: logged?.impressions ?? null,
      linkedinSessionsNext48h: li48,
      siteSessionsNext48h: (allSessions.get(date) || 0) + (allSessions.get(isoNext(date)) || 0),
      clickThroughRate: logged?.impressions ? li48 / logged.impressions : null,
    };
  });

  return {
    scheduleDays: [...scheduleIdx].sort().map((i) => WEEKDAYS[i]),
    postsInWindow: postDayCount,
    loggedPostsInWindow: loggedByDate.size,
    avgSessionsOnPostDays: postDayCount ? postDayTotal / postDayCount : 0,
    avgSessionsOnOtherDays: otherCount ? otherTotal / otherCount : 0,
    perPost,
  };
}

function isoNext(date) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
}

function pctChange(current, previous) {
  if (!previous) return null;
  return (current - previous) / previous;
}

/* ---------------- deterministic advisor brief ---------------- */

function fmtPctDelta(delta) {
  if (delta === null) return 'no prior-period data';
  const pct = Math.round(delta * 100);
  return pct >= 0 ? `up ${pct}%` : `down ${Math.abs(pct)}%`;
}

function buildBrief(ins, days) {
  const lines = [];
  const f = ins.funnel;
  lines.push(
    `Reach: ${f.reach.value.toLocaleString('en-US')} (${fmtPctDelta(f.reach.delta)} vs the prior ${days} days) — ` +
      `${f.reach.searchImpressions.toLocaleString('en-US')} search impressions and ${f.reach.linkedinSessions} LinkedIn-sourced visits.`
  );
  lines.push(
    `Read: ${f.read.articleViews} article views with ${Math.round(f.read.avgEngagementSeconds)}s average engagement; ` +
      `${f.read.engagedSessions} engaged sessions overall.`
  );
  const connectBits = [`${f.connect.contactViews} contact-page views`];
  if (f.connect.linkedinProfileClicks) connectBits.push(`${f.connect.linkedinProfileClicks} clicks through to your LinkedIn profile`);
  lines.push(`Connect: ${f.connect.value} actions — ${connectBits.join(' and ')}.`);
  if (ins.search) {
    const s = ins.search;
    lines.push(
      `${Math.round(s.executiveShare * 100)}% of search impressions come from executive-intent queries` +
        (s.topExecutiveQueries[0] ? ` (top: “${s.topExecutiveQueries[0].query}”)` : '') +
        `; ${Math.round(s.brandShare * 100)}% are people searching your name.`
    );
  }
  if (ins.weekday.bestDays.length) {
    lines.push(`Traffic peaks on ${ins.weekday.bestDays.join(' and ')}.`);
  }
  if (ins.linkedin) {
    const l = ins.linkedin;
    const lift = l.avgSessionsOnOtherDays
      ? Math.round(((l.avgSessionsOnPostDays - l.avgSessionsOnOtherDays) / l.avgSessionsOnOtherDays) * 100)
      : null;
    const label = l.scheduleDays && l.scheduleDays.length
      ? `LinkedIn post days (${l.scheduleDays.join(' & ')}${l.loggedPostsInWindow ? `, ${l.loggedPostsInWindow} logged post${l.loggedPostsInWindow === 1 ? '' : 's'}` : ''})`
      : `Across ${l.postsInWindow} logged LinkedIn post day${l.postsInWindow === 1 ? '' : 's'}, post days`;
    lines.push(
      `${label} average ${l.avgSessionsOnPostDays.toFixed(1)} sessions vs ${l.avgSessionsOnOtherDays.toFixed(1)} on other days` +
        (lift !== null ? ` (${lift >= 0 ? '+' : ''}${lift}% lift)` : '') + '.'
    );
    if (!l.loggedPostsInWindow) {
      lines.push('Log individual posts (date + impressions) to add per-post click-through on top of the schedule correlation.');
    }
  } else {
    lines.push(
      'No LinkedIn posting schedule or logged posts — tell Claude your posting days or post stats to unlock the post-to-traffic correlation.'
    );
  }
  return lines;
}

/* ---------------- optional Claude-written brief ---------------- */

const briefCache = new Map(); // key -> { expires, text }

async function claudeBrief(env, ins, days) {
  const key = `${isoDate(0)}:${days}`;
  const cached = briefCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.text;

  const payload = {
    windowDays: days,
    funnel: ins.funnel,
    search: ins.search && {
      executiveShare: ins.search.executiveShare,
      brandShare: ins.search.brandShare,
      topExecutiveQueries: ins.search.topExecutiveQueries.slice(0, 5),
    },
    weekday: ins.weekday,
    linkedin: ins.linkedin,
    topArticles: ins.articles.slice(0, 8),
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.INSIGHTS_MODEL || 'claude-sonnet-5',
      max_tokens: 700,
      system:
        'You are the analytics advisor for murthymalapaka.com, a personal thought-leadership site. ' +
        'The objective: reach CXOs and executive search firms, get them reading the articles, and get them to connect ' +
        '(contact page, LinkedIn profile). You receive computed metrics as JSON. Write a short advisor brief: ' +
        '3-5 plain-prose bullet points (no headers, no markdown emphasis), each grounded in a specific number from the data, ' +
        'ending with exactly one concrete recommended action for the coming week. Be direct and honest about weak numbers; ' +
        'never invent data that is not in the JSON.',
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('Claude API returned no text');
  const lines = text.split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
  briefCache.set(key, { expires: Date.now() + 6 * 3600 * 1000, text: lines });
  return lines;
}

/* ---------------- handler ---------------- */

export async function handleInsights(request, env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.GA4_PROPERTY_ID) {
    return configError('Insights need GA4: set GOOGLE_SERVICE_ACCOUNT_JSON and GA4_PROPERTY_ID.');
  }
  const days = rangeDays(request);

  let ga4Token;
  try {
    ga4Token = await googleAccessToken(env, GA4_SCOPE);
  } catch (err) {
    return json({ error: `Google authentication failed: ${err.message}` }, 502);
  }

  let reports;
  let gsc = null;
  let gscError = null;
  try {
    const gscTokenPromise = googleAccessToken(env, GSC_SCOPE);
    const [ga4Reports, gscResult] = await Promise.all([
      fetchGa4(env, ga4Token, days),
      gscTokenPromise.then((t) => fetchGsc(env, t, days)).catch((err) => {
        gscError = err.message;
        return null;
      }),
    ]);
    reports = ga4Reports;
    gsc = gscResult;
  } catch (err) {
    return json({ error: err.message }, 502);
  }

  // --- unpack GA4 report 0 (current + previous period share one report) ---
  const dailyCurrent = [];
  const prevTotals = { sessions: 0, users: 0, pageviews: 0 };
  const curTotals = { sessions: 0, users: 0, pageviews: 0, engagedSessions: 0, engagementSeconds: 0 };
  for (const row of reports[0]?.rows || []) {
    const dims = row.dimensionValues.map((d) => d.value);
    const range = dims[dims.length - 1]; // 'date_range_0' | 'date_range_1'
    if (range === 'date_range_1') {
      prevTotals.sessions += mval(row, 0);
      prevTotals.users += mval(row, 1);
      prevTotals.pageviews += mval(row, 2);
    } else {
      dailyCurrent.push({ date: ga4Date(dims[0]), sessions: mval(row, 0) });
      curTotals.sessions += mval(row, 0);
      curTotals.users += mval(row, 1);
      curTotals.pageviews += mval(row, 2);
      curTotals.engagedSessions += mval(row, 3);
      curTotals.engagementSeconds += mval(row, 4);
    }
  }
  dailyCurrent.sort((a, b) => a.date.localeCompare(b.date));

  const pages = (reports[1]?.rows || []).map((r) => ({
    path: r.dimensionValues[0].value,
    title: (r.dimensionValues[1].value || '').replace(/\s*\|\s*Murthy Malapaka\s*$/, ''),
    pageviews: mval(r, 0),
    users: mval(r, 1),
    engagementSeconds: mval(r, 2),
  }));
  const linkedinByPage = new Map(
    (reports[2]?.rows || []).map((r) => [r.dimensionValues[0].value, mval(r, 0)])
  );
  const linkedinDaily = (reports[3]?.rows || []).map((r) => ({
    date: ga4Date(r.dimensionValues[0].value),
    sessions: mval(r, 0),
  }));
  const outboundClicks = (reports[4]?.rows || []).map((r) => ({
    domain: r.dimensionValues[0].value,
    clicks: mval(r, 0),
  }));

  const isArticle = (path) => path.startsWith('/insights/') && path.replace(/\/+$/, '') !== '/insights';
  const articlePages = pages.filter((p) => isArticle(p.path));
  const articleViews = articlePages.reduce((a, p) => a + p.pageviews, 0);
  const contactViews = pages
    .filter((p) => p.path.replace(/\/+$/, '') === '/contact')
    .reduce((a, p) => a + p.pageviews, 0);
  const linkedinProfileClicks = outboundClicks
    .filter((c) => c.domain.includes('linkedin'))
    .reduce((a, c) => a + c.clicks, 0);
  const linkedinSessions = linkedinDaily.reduce((a, d) => a + d.sessions, 0);

  const gscByPath = new Map((gsc?.pages || []).map((p) => [p.path.replace(/\/+$/, '') || '/', p]));
  const articles = articlePages.map((p) => {
    const key = p.path.replace(/\/+$/, '') || '/';
    const search = gscByPath.get(key);
    return {
      path: p.path,
      title: p.title,
      pageviews: p.pageviews,
      avgEngagementSeconds: p.users ? p.engagementSeconds / p.users : 0,
      linkedinSessions: linkedinByPage.get(p.path) || 0,
      searchImpressions: search?.impressions ?? 0,
      searchClicks: search?.clicks ?? 0,
    };
  });

  const searchImpressions = gsc?.totals.impressions ?? 0;
  const reachValue = searchImpressions + linkedinSessions;
  const prevReach = gsc ? gsc.previousTotals.impressions : null;

  const insights = {
    days,
    funnel: {
      reach: {
        value: reachValue,
        searchImpressions,
        linkedinSessions,
        // Delta uses search impressions only when GSC history exists; the
        // LinkedIn component has no per-period baseline of its own.
        delta: gsc ? pctChange(searchImpressions, prevReach) : null,
      },
      read: {
        value: articleViews,
        articleViews,
        engagedSessions: curTotals.engagedSessions,
        avgEngagementSeconds: curTotals.users ? curTotals.engagementSeconds / curTotals.users : 0,
        delta: pctChange(curTotals.pageviews, prevTotals.pageviews),
      },
      connect: {
        value: contactViews + linkedinProfileClicks,
        contactViews,
        linkedinProfileClicks,
        delta: null,
      },
    },
    totalsDelta: {
      sessions: pctChange(curTotals.sessions, prevTotals.sessions),
      users: pctChange(curTotals.users, prevTotals.users),
    },
    search: gsc ? classifyQueries(gsc.queries) : null,
    searchUnavailable: gscError,
    weekday: weekdayPattern(dailyCurrent),
    linkedin: postDayLift(linkedinLog.posts || [], linkedinLog.schedule || [], linkedinDaily, dailyCurrent),
    loggedPosts: (linkedinLog.posts || []).length,
    articles: articles.sort((a, b) => b.pageviews - a.pageviews).slice(0, 15),
  };

  insights.brief = buildBrief(insights, days);
  insights.briefSource = 'computed';
  if (env.ANTHROPIC_API_KEY) {
    try {
      insights.brief = await claudeBrief(env, insights, days);
      insights.briefSource = 'claude';
    } catch {
      // fall back silently to the deterministic brief
    }
  }

  return json(insights);
}
