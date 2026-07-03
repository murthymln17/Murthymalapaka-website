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
├── assets/
│   ├── images/
│   ├── css/
│   └── js/
```

Plain static HTML/CSS/JS — no build step required.

## Local preview

Serve the folder with any static file server, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploying to Cloudflare Pages

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), go to **Workers & Pages → Create → Pages → Connect to Git**.
2. Select this repository (`murthymln17/Murthymalapaka-website`) and the branch to deploy.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** (leave blank)
   - **Build output directory:** `/`
4. Deploy. Cloudflare will auto-redeploy on every push to the connected branch.
5. Optionally add a custom domain under the project's **Custom domains** tab.
