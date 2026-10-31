# Deploying geekgene.com — GitHub → Cloudflare

This site is a static page served by **Cloudflare Workers (Static Assets)**, plus a tiny
Worker script that handles the contact form at `/api/contact`. Every push to GitHub
`main` deploys automatically via **Cloudflare Workers Builds**.

```
geekgene-web/
├── public/              ← the website (served as-is, no build step)
│   ├── index.html
│   ├── privacy.html
│   ├── 404.html
│   ├── css/ js/ img/ fonts/
├── src/worker.js        ← contact form handler (Turnstile + email)
├── wrangler.jsonc       ← Cloudflare config (name, domains, vars)
├── .dev.vars.example    ← local secrets template
└── package.json         ← just wrangler, for local dev
```

**What you'll set up (≈20 minutes):**

1. Preview locally (optional)
2. Push the code to GitHub
3. Create a Turnstile widget (spam protection)
4. Gather your Mailgun details
5. Connect the GitHub repo to Cloudflare
6. Add secrets
7. Attach the custom domain and test

---

## 0. Prerequisites

- A GitHub account (and optionally the `gh` CLI)
- Your Cloudflare account with the **geekgene.com** zone (already in place ✅)
- Node.js 20+ (only needed for local preview / CLI deploys)
- Your Mailgun account, with a verified sending domain

---

## 1. Preview locally (optional)

```bash
cd geekgene-web
npm install
cp .dev.vars.example .dev.vars     # uses Cloudflare's always-pass Turnstile test keys
npm run dev                        # → http://localhost:8787
```

The page, the scroll effects and the privacy page all work locally. The contact form
will pass Turnstile (test keys) but return *"couldn't send"* until you put a real
`MAILGUN_API_KEY` in `.dev.vars`. If you do add the key, it sends a real email.

> `.dev.vars` is git-ignored. Never commit real secrets.

---

## 2. Push to GitHub

```bash
cd geekgene-web
git init -b main
git add .
git commit -m "Initial Geek Gene site"
```

Then create the repo and push. Use **either** of these:

```bash
# With the GitHub CLI
gh repo create geekgene-web --private --source=. --push
```

```bash
# Or: create an empty repo named geekgene-web at https://github.com/new, then
git remote add origin git@github.com:<your-github-user>/geekgene-web.git
git push -u origin main
```

A private repo is fine; Cloudflare gets access through its GitHub app.

---

## 3. Create a Turnstile widget

Turnstile is Cloudflare's privacy-friendly CAPTCHA replacement.

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. **Widget name:** `geekgene.com contact form`
3. **Hostnames:** add `geekgene.com` and `www.geekgene.com`
4. **Widget mode:** *Managed* (recommended).
5. Click **Create**. Copy the **Site Key** and the **Secret Key**.

Put the **Site Key** (public) into `public/index.html`, replacing the test key:

```html
<div class="cf-turnstile" data-sitekey="1x00000000000000000000AA" data-theme="dark"></div>
                                       ^^^^^^^^^^^^^^^^^^^^^^^^ replace with your Site Key
```

Commit and push that change. You'll add the **Secret Key** in step 6.

> To keep testing locally after this, either add `localhost` to the widget's
> hostnames, or temporarily switch back to the test site key.

---

## 4. Gather your Mailgun details

In the Mailgun dashboard:

| What | Where to find it | Goes into |
|---|---|---|
| **Sending domain** (e.g. `mg.geekgene.com` or `geekgene.com`) | *Sending → Domains* | `MAILGUN_DOMAIN` in `wrangler.jsonc` |
| **Region** (US or EU) | shown on the domain page | `MAILGUN_API_BASE`: `https://api.mailgun.net` (US) or `https://api.eu.mailgun.net` (EU) |
| **Sending API key** | *Sending → Domain settings → Sending API keys → Add sending key* | secret `MAILGUN_API_KEY` (step 6) |

Use a domain-scoped **sending key** rather than your account-wide API key. It can
only send mail, nothing else.

Now open `wrangler.jsonc` and check the `vars`:

```jsonc
"vars": {
  "CONTACT_TO": "artbrock@geekgene.com",
  "CONTACT_FROM": "Geek Gene Website <website@mg.geekgene.com>",   // must be @ your Mailgun domain
  "MAILGUN_DOMAIN": "mg.geekgene.com",                             // ← your actual sending domain
  "MAILGUN_API_BASE": "https://api.mailgun.net"                    // ← or https://api.eu.mailgun.net
}
```

Commit and push any changes.

The email **Reply-To** is set to the visitor's address, so you can just hit *Reply*.

---

## 5. Connect the GitHub repo to Cloudflare

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**
   (under the *Workers* tab).
2. Authorize the **Cloudflare GitHub app**, and give it access to `geekgene-web`.
3. Select the `geekgene-web` repo and configure:
   - **Project name:** `geekgene-web`. This **must match** `"name"` in `wrangler.jsonc`.
   - **Build command:** *(leave empty)*. There's no build step.
   - **Deploy command:** `npx wrangler deploy` (the default).
   - **Root directory:** `/`
   - **Production branch:** `main`
4. Click **Create and deploy**.

The first deploy publishes the site to `https://geekgene-web.<your-subdomain>.workers.dev`
and also tries to attach the custom domains listed in `wrangler.jsonc` (see step 7).

> **If the first deploy fails** with an error about the custom domain or an existing DNS
> record, jump to step 7, clear the old records, then click **Retry deployment**.

---

## 6. Add secrets

Cloudflare dashboard → **Workers & Pages** → `geekgene-web` → **Settings** →
**Variables and Secrets** → **Add**:

| Type | Name | Value |
|---|---|---|
| Secret | `TURNSTILE_SECRET_KEY` | Turnstile **Secret Key** from step 3 |
| Secret | `MAILGUN_API_KEY` | Mailgun **sending key** from step 4 |

Or from your machine with the CLI (run `npx wrangler login` once first):

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put MAILGUN_API_KEY
```

Secrets take effect immediately. Deploys don't overwrite them.

> The plain `vars` live in `wrangler.jsonc`, so each deploy resets them to what's in
> the repo. Change them in the file, not in the dashboard.

---

## 7. Custom domain (geekgene.com + www)

`wrangler.jsonc` already declares both hostnames as **Custom Domains**:

```jsonc
"routes": [
  { "pattern": "geekgene.com", "custom_domain": true },
  { "pattern": "www.geekgene.com", "custom_domain": true }
]
```

On deploy, Cloudflare creates the DNS records and SSL certificates for these automatically.

**One thing to check first.** If `geekgene.com` or `www.geekgene.com` currently has
an **A, AAAA or CNAME** record pointing at old hosting, Cloudflare won't overwrite it.
Go to **DNS → Records**, note the old values somewhere (for rollback), delete
**only those A/AAAA/CNAME records for `@` and `www`**, then redeploy.

> ⚠️ Leave all **MX**, **TXT** (SPF/DKIM/DMARC) and Mailgun records alone. Your
> Email Routing forwarding and Mailgun sending depend on them.

You can also attach the domains in the dashboard: `geekgene-web` → **Settings** →
**Domains & Routes** → **Add** → **Custom domain**.

### Optional: send www to the bare domain

Both hostnames serve the site as-is. To make `geekgene.com` the single canonical address:
**Rules → Redirect Rules → Create rule** →

- *If:* Hostname equals `www.geekgene.com`
- *Then:* Dynamic redirect to `concat("https://geekgene.com", http.request.uri.path)`,
  status **301**, *Preserve query string* ✔

---

## 8. Test the live site

1. Visit **https://geekgene.com**. Check the nav jumps, scroll animations and the mobile menu.
2. Visit **https://geekgene.com/privacy**.
3. Visit **https://geekgene.com/does-not-exist**. You should see the styled 404 page.
4. Send yourself a message through the contact form. It should arrive at
   `artbrock@geekgene.com` within a few seconds.
5. If it doesn't arrive: **Workers & Pages → geekgene-web → Observability / Logs**.
   Failures are logged as `Email send failed: …` with Mailgun's exact error.

---

## Day-to-day updates

```bash
# edit files in public/ …
git commit -am "Update projects"
git push
```

Workers Builds deploys `main` automatically, usually in under a minute. Pushes to
other branches get a **preview URL** (shown on the GitHub commit / PR), so you can
check changes before merging.

To deploy straight from your machine instead: `npx wrangler deploy`.

---

## Alternative: Cloudflare email sending (instead of Mailgun)

The Worker falls back to Cloudflare's `send_email` binding (Email Routing) when no
`MAILGUN_API_KEY` secret is set. To switch:

1. **Email → Email Routing → Destination addresses**: make sure the address you want
   to receive mail at is listed and **Verified**. The `send_email` binding can only
   deliver to verified **destination** addresses. That's usually the real inbox your
   `artbrock@geekgene.com` rule forwards to, not the `@geekgene.com` alias itself.
2. In `wrangler.jsonc`:
   - uncomment `"send_email": [{ "name": "SEND_EMAIL" }]` (add a comma after the
     `observability` line),
   - set `CONTACT_TO` to that verified destination address,
   - set `CONTACT_FROM` to an address on your zone, e.g.
     `Geek Gene Website <website@geekgene.com>`.
3. Delete the `MAILGUN_API_KEY` secret, then push.

> Cloudflare has also been rolling out a newer **Email Service** (beta) for sending to
> any recipient. If you adopt it, check its current docs. The binding API may differ
> from the Email Routing binding used here, and `sendViaCloudflare()` in
> `src/worker.js` is the one function you'd need to adapt.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Deploy fails: *"name does not match"* | The Cloudflare project name must equal `"name"` in `wrangler.jsonc` (`geekgene-web`). |
| Deploy fails on custom domain | Old A/AAAA/CNAME records for `@`/`www` still exist. See step 7. |
| Form says *"Verification failed."* | Site key and secret key aren't from the same widget, or the hostname isn't listed on the widget. |
| Form says *"Please complete the verification check."* | The Turnstile widget didn't load. Check ad-blockers and the browser console. |
| Form says *"couldn't send your message"* | See Worker logs. Usually a wrong `MAILGUN_DOMAIN`, the wrong region (`MAILGUN_API_BASE`), a missing `MAILGUN_API_KEY`, or a `CONTACT_FROM` that isn't on the Mailgun domain. |
| `/privacy.html` redirects to `/privacy` | Expected. Cloudflare serves clean URLs. |
| Changes not showing | Hard-refresh. Static assets are cached at the edge, but a new deploy invalidates them. |
