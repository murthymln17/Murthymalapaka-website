/**
 * Edge visit log — what network each page request came from.
 *
 * Cloudflare hands every Worker request a `request.cf` object carrying its
 * own IP-geolocation lookup, including `asOrganization`: the name of the
 * network that owns the visitor's address. For a home connection that is
 * the ISP; for someone reading from an office it is often the employer.
 * That second case is the interesting one, and nothing in GA4 or Cloudflare
 * Web Analytics reports it — hence this log.
 *
 * Written to Workers Analytics Engine (binding VISITS) and read back by
 * /api/cloudflare. No IP address is stored: `asOrganization` is already the
 * aggregated network name, and the raw address never leaves the request.
 *
 * Deliberately partial by nature — a reader on a home connection shows
 * their ISP, not their employer, and a corporate VPN shows the egress
 * network. Read the card as "organisations that appeared", never as a
 * count of who visited.
 */

/**
 * Networks that tell us nothing about who the reader is. Matched as
 * lowercase substrings of asOrganization, so 'jio' catches "Reliance Jio
 * Infocomm Limited". Extend either list rather than filtering in the UI —
 * the classification is stored with the datapoint, so changes here apply
 * to new visits only.
 */
const CONSUMER_NETWORKS = [
  // India
  'jio', 'airtel', 'bsnl', 'vodafone', 'idea cellular', 'act fibernet',
  'hathway', 'excitel', 'tikona', 'you broadband', 'railtel', 'tata play',
  // North America
  'comcast', 'xfinity', 'spectrum', 'charter communications', 'cox communications',
  'at&t', 'verizon', 't-mobile', 'sprint', 'centurylink', 'frontier communications',
  'optimum', 'altice', 'rogers', 'bell canada', 'shaw communications', 'telus',
  // Europe
  'bt group', 'british telecom', 'sky broadband', 'virgin media', 'talktalk',
  'deutsche telekom', 'telefonica', 'orange', 'free sas', 'vodafone group',
  'kpn', 'ziggo', 'proximus', 'swisscom', 'telia', 'telenor', 'elisa',
  // Rest of world
  'telstra', 'optus', 'singtel', 'starhub', 'etisalat', 'stc', 'zain',
  'safaricom', 'mtn', 'claro', 'telmex', 'vivo', 'oi movel', 'ntt docomo',
  'softbank', 'kddi', 'chunghwa', 'pldt', 'globe telecom',
];

/**
 * Clouds, hosting and VPN exits. Traffic from these is usually a crawler,
 * a link preview fetcher or someone behind a VPN — not a reader whose
 * employer we can name. Google/Microsoft/Amazon sit here because their
 * crawler and cloud traffic vastly outnumbers the occasional employee
 * reading from a corporate desk, and the two are indistinguishable at
 * this level.
 */
const INFRA_NETWORKS = [
  'amazon', 'aws', 'google', 'microsoft', 'azure', 'oracle', 'alibaba',
  'digitalocean', 'linode', 'akamai', 'fastly', 'cloudflare', 'ovh',
  'hetzner', 'vultr', 'choopa', 'contabo', 'scaleway', 'leaseweb',
  'm247', 'datacamp', 'nordvpn', 'expressvpn', 'surfshark', 'privateinternet',
  'facebook', 'meta platforms', 'bytedance', 'digital ocean',
];

const BOT_AGENTS = [
  'bot', 'crawl', 'spider', 'slurp', 'preview', 'fetcher', 'headless',
  'curl', 'wget', 'python-requests', 'go-http-client', 'monitor', 'lighthouse',
];

/** 'consumer' | 'infra' | 'org' — see the lists above. */
export function classifyNetwork(org) {
  const name = (org || '').toLowerCase();
  if (!name) return 'infra';
  if (INFRA_NETWORKS.some((n) => name.includes(n))) return 'infra';
  if (CONSUMER_NETWORKS.some((n) => name.includes(n))) return 'consumer';
  return 'org';
}

/**
 * Only page reads are worth a datapoint: not assets, not the private
 * dashboard, not anything that announces itself as a bot. Assets would
 * multiply every visit by a dozen and drown the counts.
 */
function isPageRequest(request, pathname) {
  if (request.method !== 'GET') return false;
  if (pathname.startsWith('/dashboard')) return false;
  const last = pathname.split('/').pop() || '';
  if (last.includes('.') && !last.endsWith('.html')) return false;
  const agent = (request.headers.get('User-Agent') || '').toLowerCase();
  if (!agent) return false;
  if (BOT_AGENTS.some((b) => agent.includes(b))) return false;
  return true;
}

/**
 * Record one page read. Fire-and-forget by design: Analytics Engine writes
 * do not block the response, and a failure here must never cost the reader
 * their page.
 */
export function logVisit(request, env, pathname) {
  if (!env.VISITS || !isPageRequest(request, pathname)) return;
  const cf = request.cf || {};
  const org = cf.asOrganization || '';
  try {
    env.VISITS.writeDataPoint({
      // 1: network, 2: city, 3: region, 4: country, 5: path, 6: colo, 7: class
      blobs: [
        String(org).slice(0, 150),
        String(cf.city || '').slice(0, 80),
        String(cf.region || '').slice(0, 80),
        String(cf.country || '').slice(0, 8),
        pathname.slice(0, 200),
        String(cf.colo || '').slice(0, 8),
        classifyNetwork(org),
      ],
      doubles: [1],
      // Sampling, if volume ever makes it kick in, should preserve the
      // per-network shape — that is what the card is built on.
      indexes: [String(org || 'unknown').slice(0, 90)],
    });
  } catch (err) {
    // A logging failure is not the reader's problem.
  }
}
