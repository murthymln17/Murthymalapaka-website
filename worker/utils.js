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
