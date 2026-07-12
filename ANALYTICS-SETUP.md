# Analytics Dashboard — Setup Guide

The private dashboard at **https://murthymalapaka.com/dashboard/** shows live
analytics from three sources:

| Source | What it shows |
|---|---|
| Google Analytics 4 | Visitors, pageviews, which articles people read, how long they stay, and where they came from (LinkedIn, Google, direct, …) |
| Google Search Console | Google search performance — clicks, impressions, CTR, position, top queries |
| Cloudflare Web Analytics | Overall edge traffic — visits, pageviews, referrers, countries, devices |

Each source works independently: connect them one at a time, and any source
that isn't configured yet simply shows a "Not connected yet" notice on the
dashboard.

You can preview the dashboard design with sample data at any time:
**`/dashboard/?demo=1`** (no credentials needed).

---

## 0. One-time: choose a dashboard password

The dashboard and its API are protected by a single password of your choosing.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/) go to
   **Workers & Pages → your Pages project → Settings → Variables and Secrets**.
2. Add a variable for the **Production** environment:
   - Name: `DASHBOARD_TOKEN`
   - Value: a long password of your choosing (a password-manager-generated one is ideal)
   - Type: **Secret**
3. You'll enter this password once in the dashboard on each device (iPhone,
   Mac); it's remembered by the browser afterwards.

> All environment variables in this guide go in this same **Variables and
> Secrets** screen, as **Secret** type, and take effect on the next
> deployment (trigger one with **Deployments → Retry/Create deployment**, or
> just push any commit).

---

## 1. Cloudflare Web Analytics

### 1a. Turn on tracking
1. In the Cloudflare dashboard, go to **Analytics & Logs → Web Analytics**.
2. Click **Add a site**, enter `murthymalapaka.com`.
3. Cloudflare gives you a JS snippet containing a `"token": "..."` value.
   - If your site is served through Cloudflare Pages, you can instead enable
     Web Analytics from the Pages project (**Metrics → Web Analytics →
     Enable**) and Cloudflare injects the beacon automatically — no code
     change needed.
   - Otherwise, copy the token into `CF_BEACON_TOKEN` at the top of
     `assets/js/analytics.js` and push.

### 1b. Let the dashboard read the data
1. **Site tag**: in Web Analytics, open your site → the URL contains
   `.../web-analytics/overview?siteTag=XXXX` (or find it in the site's
   settings / the JS snippet setup screen). That hex string is your site tag.
2. **Account ID**: visible on any zone's **Overview** page (right column),
   or in the dashboard URL right after `dash.cloudflare.com/`.
3. **API token**: go to **My Profile → API Tokens → Create Token → Create
   Custom Token**:
   - Permissions: **Account → Account Analytics → Read**
   - Account resources: your account
4. Add these Pages environment variables:

| Variable | Value |
|---|---|
| `CF_API_TOKEN` | the API token from step 3 |
| `CF_ACCOUNT_ID` | your account ID |
| `CF_SITE_TAG` | the Web Analytics site tag |

---

## 2. Google service account (shared by GA4 + Search Console)

Both Google sources authenticate with one **service account** — a robot
Google identity the dashboard uses to read your data.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and
   create a project (e.g. `murthymalapaka-analytics`). The free tier is more
   than enough — this costs nothing.
2. Enable two APIs (**APIs & Services → Library**):
   - **Google Analytics Data API**
   - **Google Search Console API**
3. Create the service account (**IAM & Admin → Service Accounts → Create**):
   - Name: `website-dashboard` — no project roles needed.
4. Open the new service account → **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads. Keep it private.
5. Add a Pages environment variable:

| Variable | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | the **entire contents** of the downloaded JSON file, pasted as one value |

6. Note the service account's email address (looks like
   `website-dashboard@…iam.gserviceaccount.com`) — you'll grant it access in
   the next two sections.

---

## 3. Google Analytics 4

### 3a. Turn on tracking
1. At [analytics.google.com](https://analytics.google.com/) create a
   **GA4 property** for `murthymalapaka.com` (Admin → Create → Property),
   then add a **Web** data stream for `https://murthymalapaka.com`.
2. Copy the stream's **Measurement ID** (`G-XXXXXXXXXX`).
3. Paste it into `GA4_MEASUREMENT_ID` at the top of
   `assets/js/analytics.js` and push. Every page already loads this file.

### 3b. Let the dashboard read the data
1. In GA4 **Admin → Property → Property access management → Add user**, add
   the service account's email with the **Viewer** role.
2. In **Admin → Property settings**, copy the numeric **Property ID**
   (e.g. `498765432`).
3. Add a Pages environment variable:

| Variable | Value |
|---|---|
| `GA4_PROPERTY_ID` | the numeric property ID |

Data appears in GA4 within a few minutes of the tag going live; the
"on site now" live counter comes from GA4's realtime API.

---

## 4. Google Search Console

1. At [search.google.com/search-console](https://search.google.com/search-console),
   add a **Domain** property for `murthymalapaka.com` if you don't have one.
   Verification is a DNS TXT record — since DNS is on Cloudflare, add the
   record there (Cloudflare can often do this automatically).
2. In **Settings → Users and permissions → Add user**, add the service
   account's email with **Full** permission (Restricted also works).
3. Add a Pages environment variable:

| Variable | Value |
|---|---|
| `GSC_SITE_URL` | `sc-domain:murthymalapaka.com` (for a Domain property) or `https://murthymalapaka.com/` (for a URL-prefix property) |

Note: Google reports search data with a ~2-day delay, and a brand-new
property starts with no history — data accumulates from verification onward.

---

## 5. Using the dashboard

- Open **https://murthymalapaka.com/dashboard/** on any device and enter
  your dashboard password once.
- **iPhone**: in Safari tap **Share → Add to Home Screen** for a one-tap,
  full-screen app.
- **Mac**: bookmark it, or in Safari **File → Add to Dock**.
- Switch between 7 / 28 / 90-day views; the live visitor count refreshes
  every minute automatically.

## Environment variable summary

| Variable | Used by | Required for |
|---|---|---|
| `DASHBOARD_TOKEN` | all endpoints | everything |
| `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_SITE_TAG` | `/api/cloudflare` | Cloudflare section |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `/api/ga4`, `/api/search-console` | both Google sections |
| `GA4_PROPERTY_ID` | `/api/ga4` | Audience section + live counter |
| `GSC_SITE_URL` | `/api/search-console` | Google Search section |

## Local development

The API endpoints are Cloudflare Pages Functions, so `python3 -m http.server`
serves the pages but not the API. To run everything locally:

```bash
npx wrangler pages dev . \
  --binding DASHBOARD_TOKEN=devpassword \
  --binding CF_API_TOKEN=... # etc.
```

Or just use `/dashboard/?demo=1` for UI work — no API needed.

## Security notes

- All credentials live server-side as Cloudflare secrets; the browser only
  ever sees your dashboard password, never the API keys.
- `/dashboard/` and `/api/` are excluded from robots.txt and the dashboard
  page carries `noindex`.
- For stronger protection than a shared password, you can additionally put
  [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)
  (free for personal use) in front of `/dashboard/*` and `/api/*` — one-time
  email PIN login tied to your address.
