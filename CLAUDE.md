# CLAUDE.md

Working notes for this repository. Plain static HTML/CSS/JS — **no build step,
no framework, no bundler.** Edit the `.html` files directly.

## Deployment — read this before diagnosing "the site isn't updating"

The site is **not** GitHub Pages. The `CNAME` file at the repo root makes it
look like Pages, and there are no workflows under `.github/`, so it is easy to
misread.

It deploys via **Cloudflare Workers Builds**, connected to this repo as the
`murthymalapaka-website` Worker. Every push to `main` runs `npx wrangler
deploy`, publishing the static files as Worker assets alongside the API code in
`worker/`. Config lives in `wrangler.jsonc`.

Consequences worth knowing:

- **A merge to `main` is the deploy.** Nothing else needs running.
- **It is not instant.** No `package.json`/`node_modules` is committed, so each
  build downloads wrangler before uploading. Allow a few minutes.
- **Cloudflare sends an email when the publish completes.** That email is the
  reliable "it is live" signal — wait for it before concluding anything is
  broken.
- **Build logs live in the Cloudflare dashboard**, under Workers & Pages →
  `murthymalapaka-website` → Deployments / Builds. Not in GitHub.
- Agent sessions generally **cannot fetch `murthymalapaka.com`** — the sandbox
  egress proxy denies it (`403` on CONNECT / `EGRESS_BLOCKED`). Do not treat a
  failed fetch as evidence the site is down; ask the human to check.

## Publishing a new insight article

1. Create `insights/<slug>/index.html`. Copy the most recent article as the
   template — it carries the full `<head>` (meta, OG, Twitter, canonical) and
   the Article + Person JSON-LD block. Update every URL, title, description and
   the `datePublished`/`dateModified` dates.
2. The article page **must** contain these, or step 4 throws: `"datePublished"`
   in the JSON-LD, and inside `<div class="article-hero">` an `<h1>`, a
   `<span class="tag">`, a `<p class="read-time">`, plus a
   `<meta name="description">`.
3. Add the entry at the top of the list in `insights/index.html`.
4. Run `node scripts/update-homepage-insights.js` to regenerate the homepage's
   "Latest Insight" card and "Recently published" list. Never hand-edit the
   regions between the `AUTO-GENERATED:` markers in `index.html`.
   `--check` verifies without writing.
5. Add the new URL to `sitemap.xml` and bump the `<lastmod>` on `/insights/`.
6. Commit, push, open a PR against `main`, and squash-merge — repo history uses
   the `… (#NN)` squash convention.

Read time in the hero has run roughly 200–230 words per minute in existing
articles; keep new ones consistent with that.

## Dashboard & analytics

The private dashboard at `/dashboard/` (code: `dashboard/index.html`,
`assets/js/dashboard.js`, `assets/css/dashboard.css`) is served by the Worker,
whose API lives in `worker/` (`/api/ga4`, `/api/search-console`,
`/api/cloudflare`, `/api/insights`). Preview UI changes with
`/dashboard/?demo=1` — no credentials needed.

**When the user reports a LinkedIn post** (date, linked article, impressions,
reactions), append it to the `posts` array in `worker/linkedin-posts.json`
and merge — the dashboard's "LinkedIn posts → site traffic" card is driven by
that file. Field shapes are documented in the file's `_readme`.

## Styling

Reuse the classes already in `assets/css/style.css` rather than adding new
ones or inlining a local look: `lede`, `body-list`, `takeaways`, `table-scroll`
+ `data-table`, `diagram` / `diagram-node` / `diagram-arrow` / `diagram-merge`
(and the `--wide` / `--final` modifiers), `pub-list`, `tag`, `reveal`.

Only add to `style.css` when a genuinely new component is needed. Before
publishing, check every class used on the page resolves — the one accepted
exception is `author-note`, which existing articles style inline.

## Assets and privacy

`.assetsignore` lists everything that must **not** be published as a public
static asset. Anything not listed there is world-readable at
`murthymalapaka.com/<path>`. When adding a repo-only file (docs, notes,
tooling), add it to `.assetsignore` in the same change.

`worker/` serves the site plus a private analytics API under `/api/*`, gated by
the `DASHBOARD_TOKEN` secret. Everything outside `/api/` falls through to the
assets binding, so new pages need no routing changes. Never commit tokens —
secrets live in the Worker's settings (see `ANALYTICS-SETUP.md`).

## Local preview

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Note this serves every file, including the
`.assetsignore`d ones, so it is not an accurate check of what is public.
