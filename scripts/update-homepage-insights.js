#!/usr/bin/env node
// Regenerates the "Latest Insight" card and "Recently published" list on the
// homepage from the articles under /insights/. Run this after publishing a
// new insight (adding its folder + updating insights/index.html).
//
// Usage: node scripts/update-homepage-insights.js [--check]
//   --check   exit 1 if index.html is out of date, without writing (for CI)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INSIGHTS_DIR = path.join(ROOT, 'insights');
const HOMEPAGE = path.join(ROOT, 'index.html');
const RECENT_COUNT = 3; // items shown below the "Latest Insight" card

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
      const readTime = html.match(/<p class="read-time">([\s\S]*?)<\/p>/)?.[1]?.trim();
      const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1];

      if (!datePublished || !title || !tag || !readTime || !description) {
        throw new Error(`insights/${slug}/index.html is missing one of: datePublished, <h1>, <span class="tag">, <p class="read-time">, meta description`);
      }

      return { slug, datePublished, title, tag, readTime, description, url: `/insights/${slug}/` };
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
          <div class="insight-date">${article.readTime}</div>
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

  if (updated === original) {
    console.log('Homepage insights are already up to date.');
    return;
  }

  if (checkOnly) {
    console.error('Homepage insights are out of date. Run: node scripts/update-homepage-insights.js');
    process.exit(1);
  }

  fs.writeFileSync(HOMEPAGE, updated);
  console.log(`Updated index.html — latest insight: "${latest.title}" (${latest.datePublished})`);
  console.log(`Recently published: ${recent.map((a) => a.title).join(', ')}`);
}

main();
