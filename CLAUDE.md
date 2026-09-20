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

### The site serves but every `/api/*` call fails

Pages load normally, the dashboard renders, and every card reads
*"Temporarily unavailable. Request failed."* That combination means the Worker
is not receiving traffic at all — **not** that a deploy or the API code broke.

Static assets are served by the asset layer *without invoking the Worker*, so
when the domain stops routing to the Worker the site looks perfectly healthy
while everything under `/api/` dies. Cloudflare's error rate stays at 0%,
because nothing is reaching the Worker to fail.

**One-tap check.** Open `https://murthymalapaka.com/api/ga4?days=7`:

- `{"error":"Unauthorized"}` → the Worker is serving; look elsewhere.
- A GitHub Pages 404, or any HTML → the domain is not routed to the Worker.

`https://murthymalapaka-website.murthymln17.workers.dev/api/ga4?days=7` bypasses
the custom domains entirely and confirms the Worker itself is fine.

**What happened on 2026-09-20.** Workers & Pages → `murthymalapaka-website` →
Domains had *no* custom domains and no routes. The apex carried four GitHub
Pages A records (`185.199.108–111.153`) and `www` a CNAME to
`murthymln17.github.io`, so traffic fell through to GitHub Pages, which served
the repo's static files happily and 404'd on `/api/`. The cause of the
custom domains disappearing was never established; the Cloudflare Audit Log is
the only place that would know.

**The fix.** Delete the apex A records and the `www` CNAME (keep the
`google-site-verification` TXT — it verifies Search Console, which the
dashboard reads). Then Domains → Add Domain twice: Subdomain field **blank**
for the apex, then `www`. The field takes the label only; typing the full
hostname produces `www.murthymalapaka.com.murthymalapaka.com`. Certificates
take a few minutes, and until they issue the browser shows a cert error and
the dashboard stays empty — that is expected, not a second fault.

**While GitHub Pages serves the domain, `.assetsignore` does not apply.** It is
a Workers Assets feature. Every repo-only file — `CLAUDE.md`, `worker/`,
`ANALYTICS-SETUP.md` — is publicly fetchable for as long as that lasts.

Routing currently lives only in the Cloudflare dashboard; `wrangler.jsonc`
declares no `routes`, so nothing in the repo asserts it on deploy.

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

**LinkedIn data lives in `worker/linkedin-posts.json`** and drives the
Objectives section's Reach/Connect figures, the post-traffic correlation, and
the Audience-quality card. Two refresh paths:

- *A single post*: append `{date, topic, articlePath, impressions, engagements}`
  to `posts`.
- *A new LinkedIn export* (Analytics → Export, an .xlsx with Discovery /
  Engagement / Top Posts / Followers / Audience + Content Demographics tabs —
  the user usually sends screenshots of the tabs): replace the whole `export`
  object and merge new rows into `posts`. **Always checksum** the transcribed
  daily impressions against the Discovery tab's total before committing; the
  2026-06-07→09-04 export reconciled exactly at 10,467.

`schedule` lists standing posting weekdays — those count as post days even
without a logged post. Field shapes are documented in the file's `_readme`.

**LinkedIn links should be UTM-tagged.** GA4 sees no referrer from LinkedIn's
in-app browser and a bare `lnkd.in` referrer from its shortener, so untagged
LinkedIn visits land in Direct/Referral and the platform looks smaller than it
is. The dashboard's *Campaign links* card builds the tagged URL; the
convention is `utm_source=linkedin`, `utm_medium=social` (this is what puts the
visit in Organic Social), `utm_campaign=<page-slug>-<yyyy-mm-dd>`,
`utm_content=post|comment|profile|dm` — **all lowercase**, since GA4 counts
`Social` and `social` separately. Tagged sessions appear in the *Tagged
campaigns* card. Attribution in `worker/insights.js` matches a session source
containing `linkedin` or `lnkd.in`; keep both if that filter is ever touched.
See `ANALYTICS-SETUP.md` §5c.

**A binding the account cannot provision fails the whole deploy.** `wrangler
deploy` rejects the config before publishing anything, so the site silently
stays on its previous version and no Cloudflare email arrives. If a deploy
goes missing after a `wrangler.jsonc` change, suspect the binding first.
This is why the `analytics_engine_datasets` entry is currently commented
out there.

**Visiting networks** come from the Worker's own edge log, not from either
analytics product: `worker/edge-log.js` writes `request.cf.asOrganization`
(plus city/region/country/path/colo and a consumer/infra/org classification)
to Workers Analytics Engine on each page read, and `worker/cf-analytics.js`
reads it back via the Analytics Engine SQL API. No IP is stored. Assets, the
dashboard and self-declared bots are skipped. To change what counts as a
consumer or infrastructure network, edit the substring lists in
`edge-log.js` — the classification is written with the datapoint, so edits
affect new visits only. **Currently dormant**: the binding is commented out
in `wrangler.jsonc` pending confirmation that Analytics Engine is available
on the account; `logVisit` no-ops without it and the card says so. See
`ANALYTICS-SETUP.md` §5d.

Note that GA4's city is an IP guess and is often wrong (a phone resolves to
its carrier's gateway); the Recent activity column is labelled *Approx.
location* for that reason. Cloudflare Web Analytics has no city dimension at
all, so it is not an alternative source for it.

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
