// Builds /search-index.json, the data behind the site search at /search/.
// Called by update-homepage-insights.js, so publishing an article (step 4 in
// CLAUDE.md) refreshes the index too. Never hand-edit search-index.json.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX_FILE = path.join(ROOT, 'search-index.json');

// Top-level pages worth searching besides the articles.
const PAGES = [
  { file: 'about/index.html', url: '/about/', tag: 'About' },
  { file: 'publications/index.html', url: '/publications/', tag: 'Publications' },
  { file: 'frameworks/index.html', url: '/frameworks/', tag: 'Frameworks' },
];

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', copy: '©',
  rarr: '→', larr: '←', times: '×', middot: '·',
};

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

function toText(html) {
  return decode(
    html
      .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function between(html, startRe, endTag) {
  const start = html.search(startRe);
  if (start === -1) return '';
  const end = html.indexOf(endTag, start);
  return html.slice(start, end === -1 ? undefined : end);
}

function pageEntry({ file, url, tag }) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const title = decode(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? url).replace(/\s*\|\s*Murthy Malapaka$/, '').trim();
  const description = decode(html.match(/<meta name="description" content="([^"]*)">/)?.[1] ?? '');
  return { type: 'page', url, title, tag, description, text: toText(between(html, /<main\b/, '</main>')) };
}

function articleEntry(article) {
  const html = fs.readFileSync(path.join(ROOT, 'insights', article.slug, 'index.html'), 'utf8');
  return {
    type: 'insight',
    url: article.url,
    title: toText(article.title),
    tag: toText(article.tag),
    description: decode(article.description),
    date: article.datePublished.slice(0, 10),
    readTime: toText(article.readTime),
    text: toText(between(html, /<article\b/, '</article>')),
  };
}

// articles: the sorted list readInsights() already produced.
// Returns true if the file changed (or would change, under checkOnly).
function buildSearchIndex(articles, { checkOnly = false } = {}) {
  const entries = [...articles.map(articleEntry), ...PAGES.map(pageEntry)];
  const json = JSON.stringify({ entries }) + '\n';
  const current = fs.existsSync(INDEX_FILE) ? fs.readFileSync(INDEX_FILE, 'utf8') : '';
  if (json === current) return false;
  if (!checkOnly) fs.writeFileSync(INDEX_FILE, json);
  return true;
}

module.exports = { buildSearchIndex };
