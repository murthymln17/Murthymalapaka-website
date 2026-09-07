export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export function configError(message) {
  return json({ error: message, notConfigured: true }, 501);
}

/** Parse ?days= from the request URL, clamped to 1–365 (default 28). */
export function rangeDays(request) {
  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get('days') || '28', 10);
  if (!Number.isFinite(days)) return 28;
  return Math.min(365, Math.max(1, days));
}

/** yyyy-mm-dd in UTC, offset by `deltaDays` from now. */
export function isoDate(deltaDays = 0) {
  const d = new Date(Date.now() + deltaDays * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Fill a daily timeseries so every date in the last `days` days (UTC) is
 * present, inserting zero-valued rows for dates the source omitted. Sources
 * (GA4, Search Console, Cloudflare) all skip days with no traffic, which
 * makes charts silently misrepresent the x-axis on low-traffic sites.
 *
 * rows: [{ date: 'yyyy-mm-dd', ...metrics }]; zeroRow: metrics for an empty day.
 */
export function fillDailySeries(rows, days, zeroRow) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const filled = [];
  for (let i = days; i >= 0; i--) {
    const date = isoDate(-i);
    filled.push(byDate.get(date) || { date, ...zeroRow });
  }
  return filled;
}

/**
 * The GA4 Data API rejects a batchRunReports call carrying more than five
 * report requests ("Batch requests are limited to 5 requests"). Split the
 * list into compliant chunks, run them in parallel, and return the reports
 * flattened back into the caller's original order.
 */
export const GA4_BATCH_LIMIT = 5;

export async function runBatchedReports(propertyBase, token, requests) {
  const chunks = [];
  for (let i = 0; i < requests.length; i += GA4_BATCH_LIMIT) {
    chunks.push(requests.slice(i, i + GA4_BATCH_LIMIT));
  }
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const res = await fetch(`${propertyBase}:batchRunReports`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: chunk }),
      });
      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`GA4 Data API ${res.status}: ${detail.slice(0, 300)}`);
      }
      return (await res.json()).reports || [];
    })
  );
  return results.flat();
}
