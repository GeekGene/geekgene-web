# The Geek Gene — geekgene.com

Single-page site for The Geek Gene, LLC. It's plain HTML, CSS and JavaScript (no framework, no
build step), served by Cloudflare Workers Static Assets. A small Worker handles the contact form.

- `public/`: the website
- `src/worker.js`: `POST /api/contact` (Turnstile check → email via Mailgun)
- `wrangler.jsonc`: Cloudflare config

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev        # http://localhost:8787
```

Deployment: see **[DEPLOYMENT.md](DEPLOYMENT.md)**.
