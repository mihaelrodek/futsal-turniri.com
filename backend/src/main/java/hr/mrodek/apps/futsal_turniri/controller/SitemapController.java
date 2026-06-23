package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Public, anonymous endpoints for crawler discovery. Because Quarkus is
 * configured with {@code quarkus.http.root-path=/api}, these resolve to:
 *
 *   GET /api/sitemap.xml
 *   GET /api/robots.txt   (also mirrored as a static file in frontend/public/)
 *
 * The static {@code frontend/public/robots.txt} is the canonical one served
 * at {@code /robots.txt}; it points crawlers at {@code /api/sitemap.xml},
 * which is the URL most reverse-proxy setups are easiest to wire up.
 * If you'd prefer the sitemap to live at the bare {@code /sitemap.xml},
 * add an nginx rewrite in your prod deployment.
 *
 * Soft-deleted tournaments are filtered out automatically by the
 * {@code @Where(is_deleted = false)} clause on the {@code Tournaments}
 * entity, so we don't need to filter here.
 */
@Path("")
public class SitemapController {

    @Inject TournamentsRepository tournamentsRepo;
    @Inject UserProfileRepository profileRepo;

    @ConfigProperty(name = "app.public-base-url", defaultValue = "https://futsal-turniri.com")
    String publicBaseUrl;

    @GET
    @Path("/sitemap.xml")
    @Produces("application/xml; charset=UTF-8")
    public Response sitemap() {
        String base = publicBaseUrl.replaceAll("/+$", "");
        DateTimeFormatter iso = DateTimeFormatter.ISO_OFFSET_DATE_TIME;

        StringBuilder sb = new StringBuilder(8 * 1024);
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        sb.append("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n");

        // Static high-value pages first. URLs are Croatian since we moved
        // user-facing routes off the English aliases (English aliases still
        // work via Caddy 301 → Croatian, but we don't list them here — the
        // sitemap should contain only canonical URLs).
        appendUrl(sb, base + "/",         null, "weekly",  "1.0");
        appendUrl(sb, base + "/turniri",  null, "daily",   "0.9");
        appendUrl(sb, base + "/kalendar", null, "daily",   "0.7");
        appendUrl(sb, base + "/karta",    null, "weekly",  "0.7");

        // Tournament detail pages — one entry per non-deleted tournament.
        // Prefer the pretty slug when present so the sitemap surfaces the
        // canonical, shareable URL; fall back to UUID for any leftover row
        // the slug-backfill hasn't touched yet.
        List<Tournaments> tournaments = tournamentsRepo.listAll();
        for (Tournaments t : tournaments) {
            String key;
            if (t.getSlug() != null && !t.getSlug().isBlank()) {
                key = t.getSlug();
            } else if (t.getUuid() != null) {
                key = t.getUuid().toString();
            } else {
                continue;
            }
            String loc = base + "/turniri/" + key;
            OffsetDateTime lastMod = t.getUpdatedAt() != null ? t.getUpdatedAt() : t.getStartAt();
            appendUrl(sb, loc, lastMod == null ? null : iso.format(lastMod), "weekly", "0.8");
        }

        // Public player profiles. Phone numbers aren't in the sitemap itself,
        // but the profile pages are publicly visible (product decision).
        List<UserProfile> profiles = profileRepo.listAll();
        for (UserProfile p : profiles) {
            if (p.getSlug() == null || p.getSlug().isBlank()) continue;
            String loc = base + "/profil/" + p.getSlug();
            appendUrl(sb, loc, null, "weekly", "0.6");
        }

        sb.append("</urlset>\n");

        return Response.ok(sb.toString())
                // Conservative cache — search bots usually re-fetch daily anyway,
                // and a stale entry for a few minutes won't hurt.
                .header("Cache-Control", "public, max-age=300")
                .build();
    }

    @GET
    @Path("/robots.txt")
    @Produces("text/plain; charset=UTF-8")
    public Response robots() {
        String base = publicBaseUrl.replaceAll("/+$", "");
        // Disallow lists use the Croatian paths since those are the only
        // canonical user-facing URLs now (English equivalents 301 to these
        // via Caddy). A bot following an English link will be redirected
        // to the Croatian path, so blocking by Croatian is sufficient.
        String body = """
                User-agent: *
                Disallow: /prijava
                Disallow: /registracija
                Disallow: /turniri/novi
                Disallow: /pronadi-para
                Disallow: /api/

                Sitemap: %s/sitemap.xml
                """.formatted(base);
        return Response.ok(body).build();
    }

    /** Build a single {@code <url>} block. {@code lastmod}, {@code changefreq}, and {@code priority} are optional. */
    private void appendUrl(StringBuilder sb, String loc, String lastmod, String changefreq, String priority) {
        sb.append("  <url>\n");
        sb.append("    <loc>").append(escape(loc)).append("</loc>\n");
        if (lastmod != null) sb.append("    <lastmod>").append(escape(lastmod)).append("</lastmod>\n");
        if (changefreq != null) sb.append("    <changefreq>").append(changefreq).append("</changefreq>\n");
        if (priority != null) sb.append("    <priority>").append(priority).append("</priority>\n");
        sb.append("  </url>\n");
    }

    /** XML-escape user-derivable text. Tournament UUIDs and our own slugs are already safe, but escape defensively. */
    private static String escape(String s) {
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }
}
