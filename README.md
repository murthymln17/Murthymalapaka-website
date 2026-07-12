# Murthy Malapaka — Website

Personal site for Murthy Malapaka, Executive Technology Strategist & AI Transformation Leader.

## Structure

```
/
├── index.html          (Home)
├── about/
├── insights/
├── frameworks/
├── speaking/
├── contact/
├── dashboard/          (private analytics dashboard — see ANALYTICS-SETUP.md)
├── worker/             (Cloudflare Worker: serves the site + dashboard API)
├── wrangler.jsonc      (Worker configuration)
├── assets/
│   ├── images/
│   ├── css/
│   └── js/
```

Plain static HTML/CSS/JS — no build step required. The only server-side code
is the Cloudflare Worker under `worker/`, which serves the static files and
powers the private analytics dashboard at `/dashboard/`
(setup: [ANALYTICS-SETUP.md](ANALYTICS-SETUP.md)).

## Local preview

Serve the folder with any static file server, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploying to Cloudflare Workers

The repository is connected to Cloudflare Workers Builds as the
`murthymalapaka-website` Worker: every push to `main` runs
`npx wrangler deploy`, which publishes the static files as Worker assets
(everything except the paths listed in `.assetsignore`) together with the
API code in `worker/`. Configuration lives in `wrangler.jsonc`.

To serve the site at the custom domain, add `murthymalapaka.com` under the
Worker's **Settings → Domains & Routes**.
