#!/usr/bin/env node
// Regenerates the "Latest Insight" card and "Recently published" list on the
// homepage from the articles under /insights/. Run this after publishing a
// new insight (adding its folder + updating insights/index.html).
//
// Usage: node scripts/update-homepage-insights.js [--check]
//   --check   exit 1 if index.html is out of date, without writing (for CI)

const fs = require('fs');
const path = require('path');
const { buildSearchIndex } = require('./build-search-index');

const ROOT = path.join(__dirname, '..');
const INSIGHTS_DIR = path.join(ROOT, 'insights');
const HOMEPAGE = path.join(ROOT, 'index.html');
const INSIGHTS_LIST = path.join(INSIGHTS_DIR, 'index.html');
const RECENT_COUNT = 3; // items shown below the "Latest Insight" card
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-25" (or a full ISO timestamp) -> "25 Nov 2026". Parsed by hand so
// the server's time zone can never shift the day.
function formatDate(iso) {
  const [, y, m, d] = iso.match(/^(\d{4})-(\d{2})-(\d{2})/) || [];
  if (!y) throw new Error(`Unrecognised datePublished: ${iso}`);
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// The visible date is generated from datePublished, so it can never disagree
// with the JSON-LD. Article heroes, insights/index.html and the homepage all
// use this markup; style.css lays it out per context.
function dateHtml(iso) {
  return `<time datetime="${iso.slice(0, 10)}">${formatDate(iso)}</time>`;
}
const DATE_RE = /<time\b[^>]*>[\s\S]*?<\/time>\s*(?:&middot;|·)?\s*/;

function readInsights() {
  const slugs = fs
    .readdirSync(INSIGHTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  return slugs
    .map((slug) => {
      const file = path.join(INSIGHTS_DIR, slug, 'index.html');
      const html = fs.readFileSync(file, 'utf8');

      const datePublished = html.match(/"datePublished":\s*"([^"]+)"/)?.[1];
      const title = html.match(/<div class="article-hero">[\s\S]*?<h1>([\s\S]*?)<\/h1>/)?.[1]?.trim();
      const tag = html.match(/<div class="article-hero">[\s\S]*?<span class="tag">([\s\S]*?)<\/span>/)?.[1]?.trim();
      // Hero reads "<time>25 Nov 2026</time> · 6 min read"; keep just the read time.
      const readTime = html.match(/<p class="read-time">([\s\S]*?)<\/p>/)?.[1]?.replace(DATE_RE, '').trim();
      const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1];

      if (!datePublished || !title || !tag || !readTime || !description) {
        throw new Error(`insights/${slug}/index.html is missing one of: datePublished, <h1>, <span class="tag">, <p class="read-time">, meta description`);
      }

      return { slug, file, html, datePublished, title, tag, readTime, description, url: `/insights/${slug}/` };
    })
    .sort((a, b) => (a.datePublished < b.datePublished ? 1 : a.datePublished > b.datePublished ? -1 : 0));
}

function replaceBetween(source, marker, html) {
  const startTag = `<!-- AUTO-GENERATED:${marker}:START`;
  const endTag = `<!-- AUTO-GENERATED:${marker}:END -->`;
  const startIdx = source.indexOf(startTag);
  const endIdx = source.indexOf(endTag);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Could not find AUTO-GENERATED:${marker} markers in index.html`);
  }
  const startLineEnd = source.indexOf('\n', startIdx) + 1;
  return source.slice(0, startLineEnd) + html + source.slice(endIdx);
}

function latestInsightHtml(article) {
  return `        <div class="card reveal">
          <span class="tag">Latest Insight</span>
          <h3>${article.title}</h3>
          <p>${article.description}</p>
          <a href="${article.url}" class="card-link">Read More →</a>
        </div>
        `;
}

function recentInsightsHtml(articles) {
  return articles
    .map(
      (article) => `        <div class="insight-item">
          <div class="insight-date">${dateHtml(article.datePublished)} ${article.readTime}</div>
          <div>
            <span class="tag">${article.tag}</span>
            <h3><a href="${article.url}">${article.title}</a></h3>
            <p>${article.description}</p>
          </div>
        </div>
`
    )
    .join('') + '        ';
}

function withHeroDate(article) {
  return article.html.replace(
    /<p class="read-time">[\s\S]*?<\/p>/,
    `<p class="read-time">${dateHtml(article.datePublished)} &middot; ${article.readTime}</p>`
  );
}

// insights/index.html is hand-curated; only each entry's date column is generated.
function withListDates(source, articles) {
  const bySlug = new Map(articles.map((a) => [a.slug, a]));
  const seen = new Set();
  const updated = source.replace(
    /(<div class="insight-date">)([\s\S]*?)(<\/div>\s*<div>\s*<span class="tag">[\s\S]*?<h3><a href="\/insights\/([^/"]+)\/">)/g,
    (match, open, _old, rest, slug) => {
      const article = bySlug.get(slug);
      if (!article) throw new Error(`insights/index.html links to /insights/${slug}/, which has no article`);
      seen.add(slug);
      return `${open}${dateHtml(article.datePublished)} ${article.readTime}${rest}`;
    }
  );
  const missing = articles.filter((a) => !seen.has(a.slug)).map((a) => a.slug);
  if (missing.length) throw new Error(`insights/index.html has no entry for: ${missing.join(', ')} (step 3 in CLAUDE.md)`);
  return updated;
}

function main() {
  const checkOnly = process.argv.includes('--check');
  const articles = readInsights();

  if (articles.length < RECENT_COUNT + 1) {
    throw new Error(`Need at least ${RECENT_COUNT + 1} insights to fill the homepage sections, found ${articles.length}`);
  }

  const [latest, ...rest] = articles;
  const recent = rest.slice(0, RECENT_COUNT);

  const original = fs.readFileSync(HOMEPAGE, 'utf8');
  let updated = replaceBetween(original, 'LATEST-INSIGHT', latestInsightHtml(latest));
  updated = replaceBetween(updated, 'RECENT-INSIGHTS', recentInsightsHtml(recent));

  const indexChanged = buildSearchIndex(articles, { checkOnly });
  const homepageChanged = updated !== original;

  // Visible publish dates: article heroes and the insights list.
  const dateWrites = articles
    .map((a) => ({ file: a.file, label: `insights/${a.slug}/index.html`, before: a.html, after: withHeroDate(a) }))
    .filter((w) => w.after !== w.before);
  const listBefore = fs.readFileSync(INSIGHTS_LIST, 'utf8');
  const listAfter = withListDates(listBefore, articles);
  if (listAfter !== listBefore) dateWrites.push({ file: INSIGHTS_LIST, label: 'insights/index.html', after: listAfter });

  if (checkOnly) {
    const stale = [
      homepageChanged && 'homepage insights',
      indexChanged && 'search-index.json',
      ...dateWrites.map((w) => `dates in ${w.label}`),
    ].filter(Boolean);
    if (stale.length) {
      console.error(`Out of date: ${stale.join(', ')}. Run: node scripts/update-homepage-insights.js`);
      process.exit(1);
    }
    console.log('Homepage insights, publish dates and search index are up to date.');
    return;
  }

  for (const w of dateWrites) fs.writeFileSync(w.file, w.after);
  if (dateWrites.length) console.log(`Updated publish dates in ${dateWrites.length} file(s).`);
  console.log(indexChanged ? `Rebuilt search-index.json (${articles.length} insights).` : 'Search index is already up to date.');

  if (!homepageChanged) {
    console.log('Homepage insights are already up to date.');
    return;
  }

  fs.writeFileSync(HOMEPAGE, updated);
  console.log(`Updated index.html — latest insight: "${latest.title}" (${latest.datePublished})`);
  console.log(`Recently published: ${recent.map((a) => a.title).join(', ')}`);
}

main();
