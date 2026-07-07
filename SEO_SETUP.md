# SEO setup - manual steps

Companion to the prerendering + structured-data changes in the backend +
Caddy. **Code is shipped; the items below are what you (a human) need to
do once.**

Order matters: deploy first, then verify the prerendering actually works
from the public internet, then register with Google.

---

## 1. Deploy the new code

```bash
# From the repo root, on the prod host.
# --env-file is required so compose substitutes POSTGRES_*, MINIO_*,
# FIREBASE_*, CORS_ORIGINS, APP_PUBLIC_BASE_URL, etc. - without it
# the containers come up with blank values and the backend crashes
# on startup.
docker compose -f docker-compose.prod.yaml --env-file .env.prod pull
docker compose -f docker-compose.prod.yaml --env-file .env.prod up -d --build backend edge
```

Make sure both `backend` and `edge` (Caddy) restart - the Caddyfile
changes only take effect after Caddy reloads.

---

## 2. Verify the prerendering works

The whole point of the new code is that **bots get HTML with real
content** while users still get the SPA. Confirm this with curl from a
machine *outside* your network (so DNS / Caddy / TLS are all in the
path):

```bash
# Homepage - should return Futsal turniri H1 + list of upcoming tournaments
curl -A "Googlebot/2.1 (+http://www.google.com/bot.html)" \
     https://futsal-turniri.com/ | head -100

# Tournament list (Croatian canonical)
curl -A "Googlebot/2.1" https://futsal-turniri.com/turniri | head -100

# Tournament detail (replace <slug> with a real one)
curl -A "Googlebot/2.1" \
     https://futsal-turniri.com/turniri/<slug> | head -100

# Profile detail
curl -A "Googlebot/2.1" \
     https://futsal-turniri.com/profil/<slug> | head -100

# English aliases - should 301-redirect to Croatian. Add -i to see headers.
curl -i -A "Googlebot/2.1" https://futsal-turniri.com/tournaments | head -10

# And compare - a regular browser UA should still get the SPA's index.html
curl -A "Mozilla/5.0" https://futsal-turniri.com/ | head -20
```

**What you want to see:**
- The Googlebot variants contain `<h1>`, `<dl>`, tournament names, dates -
  real Croatian text in the body.
- The Mozilla variant contains `<div id="root"></div>` and `main.tsx`.

If the bot variant returns the SPA HTML, Caddy didn't restart or the
UA regex didn't match. Check `docker logs edge`.

---

## 3. Verify domain in Google Search Console

This is the most important step. Without it, you have no visibility
into what Google sees, no way to submit your sitemap, and no way to
request indexing.

1. Go to <https://search.google.com/search-console>.
2. Sign in with your Google account (use the one you want to own the
   property long-term - adding additional users later is easy, changing
   the owner is annoying).
3. Click "Add property". Pick **Domain** (not "URL prefix") - that
   covers `futsal-turniri.com`, `www.futsal-turniri.com`, `http://`,
   `https://`, and all subdomains under one property.
4. Enter `futsal-turniri.com`.
5. Google will show you a TXT record to add to DNS. It looks like:
   ```
   google-site-verification=abc123def456ghi789...
   ```
6. Add this as a **TXT record** on the **root** (`@`) of `futsal-turniri.com`
   in your DNS provider's control panel. Leave existing TXT records
   (SPF, DKIM) alone - TXT records can coexist.
7. Wait 5–30 minutes for DNS propagation. You can check with:
   ```bash
   dig TXT futsal-turniri.com +short
   ```
   The verification string should appear in the output.
8. Click "Verify" in Search Console.

If verification fails, the most common cause is the TXT record was
added on the wrong host (e.g., `www.futsal-turniri.com` instead of the
root). Double-check the host is `@` or blank.

---

## 4. Submit the sitemap

Once the property is verified:

1. In Search Console, left sidebar → **Sitemaps**.
2. Under "Add a new sitemap", enter:
   ```
   api/sitemap.xml
   ```
   (just the path - Search Console prepends `https://futsal-turniri.com/`).
3. Click "Submit".
4. Status should turn to "Success" within a minute (Search Console
   fetches the sitemap to validate it).
5. The "Discovered URLs" count will populate over the next 1-3 days as
   Google starts crawling. Don't refresh anxiously - first indexing
   takes time, especially on a new domain.

---

## 5. Request indexing for top pages

For your 5-10 most important URLs, force-trigger an indexing request
instead of waiting for the natural crawl:

1. In Search Console, top search bar - paste a URL like
   `https://futsal-turniri.com/`.
2. The "URL Inspection" report opens.
3. Click "Request indexing".
4. Google runs a live test, then queues the URL for indexing
   (usually 1-7 days).

Do this for:
- `https://futsal-turniri.com/`
- `https://futsal-turniri.com/turniri`
- `https://futsal-turniri.com/kalendar`
- `https://futsal-turniri.com/karta`
- Each upcoming tournament page (high-traffic ones)
- A few of your own profile + popular profiles

The daily quota is ~10 manual indexing requests per property, so don't
try to inspect 100 URLs at once.

---

## 6. Check "URL Inspection → View tested page → Screenshot"

This is the most diagnostic feature in Search Console. After inspecting
a URL:

1. Click "View tested page" (top right of the report).
2. Click "Screenshot" - this shows you what Googlebot *actually saw*
   when it rendered the page.
3. Click "HTML" - this shows you the post-render HTML Googlebot stored.

**What to confirm:**
- For `/`, `/tournaments`, `/tournaments/{slug}`, `/profile/{slug}`:
  the HTML should be the server-rendered preview (h1, tournament data),
  not the empty SPA shell.
- For `/calendar`, `/map`, `/find-pair`: HTML is the SPA shell, which is
  fine - these aren't ranking targets.

If `/` shows the SPA shell to Googlebot, the Caddy UA-routing isn't
working. Go back to step 2.

---

## 7. Bing Webmaster Tools (5 minutes, worthwhile)

Bing has 3–5 % search market share in Croatia, plus DuckDuckGo and
others use Bing's index under the hood, so this is more impactful than
the raw number suggests.

1. Go to <https://www.bing.com/webmasters>.
2. Sign in.
3. Click "Import" - you can import the property + sitemap straight from
   Search Console with one click.
4. Done.

---

## 8. Monitor weekly

The first 2-4 weeks after a new property is verified are quiet - Google
is still building its initial index. After that, check Search Console
weekly:

- **Performance** report: see which queries are showing your site in
  results. This is where you discover what people are actually
  searching for. Look for queries with high impressions but low CTR -
  those are pages where the snippet (meta description / title) could
  be rewritten for clarity.
- **Coverage** / **Pages**: shows how many pages are indexed vs. how
  many were submitted. If you have 50 tournaments but only 5 indexed,
  something's wrong (most often: thin content, or robots.txt blocking).
- **Core Web Vitals**: LCP, INP, CLS scores. Anything red here is
  costing you ranking. Optimise with PageSpeed Insights:
  <https://pagespeed.web.dev/analysis?url=https://futsal-turniri.com/>.

---

## 9. Optional: IndexNow (for instant tournament indexing)

Bing supports the IndexNow API - when a new tournament is created,
ping IndexNow and Bing crawls within minutes instead of days. Google
doesn't support it yet, but Bing + Yandex do. If you want this, ask
me to add it to the backend's `createTournament` path - it's a single
HTTP POST.

---

## Reality check

After completing 1-7, expect:

- **Week 1-2**: indexed-page count creeps up to maybe 10-30 pages
  (homepage, list page, a handful of tournaments). Search impressions
  stay near zero. This is normal.
- **Week 3-6**: most tournament + profile pages get indexed. Branded
  queries ("futsal turniri") start appearing in Search Console
  Performance with a few hundred impressions/week.
- **Month 2-3**: long-tail queries start ranking ("futsal turnir Zagreb",
  "futsal turnir 2026"). Impressions grow into the low thousands. Some
  pages will start ranking in the top 10 for niche queries.
- **Month 4+**: ranking depends on whether you build backlinks (the
  next lever after prerendering). Without backlinks, you cap at niche
  long-tail queries. With even a handful of HR Wikipedia / Futsal forum /
  Facebook group links, you can compete for the main "futsal turniri"
  query.

If after 6 weeks nothing is indexed, the problem is almost always:
(a) Search Console isn't actually verified, (b) the prerendering isn't
returning real content to Googlebot, or (c) robots.txt is blocking
something it shouldn't.
