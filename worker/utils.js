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
