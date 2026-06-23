package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.UserTeamPreset;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserTeamPresetRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Server-side rendered preview HTML for crawlers (WhatsApp, Slack, Facebook,
 * Telegram, Twitter, …) sharing a profile URL. Companion to {@link
 * TournamentPreviewController}; same proxy-routing pattern.
 *
 * <p>Endpoint: {@code GET /api/preview/profiles/{slug}} → text/html with
 * profile-specific {@code og:*} meta tags. Caddy rewrites the canonical
 * Croatian SPA path {@code /profil/<slug>} (and its English alias
 * {@code /profile/<slug>}, which 301s to the Croatian one) here for
 * crawlers; real users keep getting the SPA.
 *
 * <p>Phone numbers are deliberately NOT included in the preview meta —
 * crawlers cache the meta indefinitely and we don't want phone numbers
 * sitting in WhatsApp / Slack message scrollback. The same redaction
 * is enforced for anonymous JSON reads in {@link PublicProfileController}.
 */
@Path("/preview/profiles")
public class ProfilePreviewController {

    @Inject UserProfileRepository profileRepo;
    @Inject UserTeamPresetRepository presetRepo;
    @Inject TeamsRepository teamRepo;

    @ConfigProperty(name = "app.public-base-url", defaultValue = "https://nogometni-turniri.com")
    String publicBaseUrl;

    // Optional<> rather than a defaulted String — Quarkus refuses to register
    // an empty defaultValue, so a non-Optional String would crash boot when
    // APP_DEFAULT_OG_IMAGE isn't set in the environment.
    @ConfigProperty(name = "app.default-og-image")
    Optional<String> defaultOgImage;

    @GET
    @Path("/{slug}")
    @Produces("text/html; charset=UTF-8")
    public Response preview(@PathParam("slug") String slug) {
        UserProfile profile = profileRepo.findBySlug(slug).orElse(null);
        if (profile == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .type("text/html; charset=UTF-8")
                    .entity(notFoundHtml())
                    .build();
        }

        String displayName = (profile.getDisplayName() != null && !profile.getDisplayName().isBlank())
                ? profile.getDisplayName()
                : "Futsal igrač";

        // Reuse the same broadened "my participations" matcher the JSON API
        // uses, so the counts here line up exactly with the profile page.
        List<String> presetNames = presetRepo.findByUserUid(profile.getUserUid()).stream()
                .map(UserTeamPreset::getName)
                .toList();
        List<Teams> participations = teamRepo.findMyParticipations(profile.getUserUid(), presetNames);

        int total = participations.size();
        int wins = 0;
        for (Teams p : participations) {
            Tournaments t = p.getTournament();
            if (t != null && t.getWinnerName() != null && p.getName() != null
                    && t.getWinnerName().trim().equalsIgnoreCase(p.getName().trim())) {
                wins++;
            }
        }

        String description = buildDescription(displayName, total, wins);

        String base = publicBaseUrl.replaceAll("/+$", "");
        // Canonical profile URL is Croatian (/profil/...). See sibling
        // comment in TournamentPreviewController for the same rationale.
        String spaUrl = base + "/profil/" + slug;

        // Prefer the user's own avatar as og:image / schema.org image —
        // falls back to the app-default og image when missing. This makes
        // shared profile links look personalised in WhatsApp/Telegram
        // previews and gives Google a unique image for the Person rich
        // result.
        String image;
        if (profile.getAvatar() != null && profile.getAvatar().getId() != null) {
            image = base + "/api/resources/" + profile.getAvatar().getId() + "/image";
        } else {
            image = defaultOgImage.filter(s -> !s.isBlank()).orElse(null);
        }

        return Response.ok(renderHtml(displayName, slug, description, image, spaUrl, total, wins)).build();
    }

    /* ───────────────────── helpers ───────────────────── */

    /**
     * "{name} — {total} turnira, {wins} pobjeda na nogometni-turniri.com".
     * Uses Croatian noun-form rules for "turnir" / "pobjeda" so the
     * preview reads naturally for 1, 2-4, and 5+ counts.
     */
    String buildDescription(String displayName, int totalTournaments, int wins) {
        return displayName
                + " — "
                + totalTournaments + " " + plurariseTurnir(totalTournaments)
                + ", "
                + wins + " " + plurarisePobjeda(wins)
                + " na nogometni-turniri.com";
    }

    /** Croatian plural rule for "turnir": 1=turnir, 2-4=turnira, 5+=turnira (genitive plural). */
    private static String plurariseTurnir(int n) {
        int mod10 = n % 10;
        int mod100 = n % 100;
        if (mod10 == 1 && mod100 != 11) return "turnir";
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "turnira";
        return "turnira";
    }

    /** Same idea for "pobjeda" — 1=pobjeda, 2-4=pobjede, 5+=pobjeda (genitive plural). */
    private static String plurarisePobjeda(int n) {
        int mod10 = n % 10;
        int mod100 = n % 100;
        if (mod10 == 1 && mod100 != 11) return "pobjeda";
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "pobjede";
        return "pobjeda";
    }

    private String renderHtml(String name, String slug, String description, String image, String spaUrl, int totalTournaments, int wins) {
        StringBuilder sb = new StringBuilder(2048);
        sb.append("<!doctype html>\n");
        sb.append("<html lang=\"hr\">\n<head>\n");
        sb.append("<meta charset=\"UTF-8\">\n");
        sb.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n");
        sb.append("<title>").append(escapeHtml(name)).append(" — nogometni-turniri.com</title>\n");
        sb.append("<meta name=\"description\" content=\"").append(escapeAttr(description)).append("\">\n");
        sb.append("<link rel=\"canonical\" href=\"").append(escapeAttr(spaUrl)).append("\">\n");

        sb.append("<meta property=\"og:type\" content=\"profile\">\n");
        sb.append("<meta property=\"og:locale\" content=\"hr_HR\">\n");
        sb.append("<meta property=\"og:site_name\" content=\"nogometni-turniri.com\">\n");
        sb.append("<meta property=\"og:title\" content=\"").append(escapeAttr(name)).append("\">\n");
        sb.append("<meta property=\"og:description\" content=\"").append(escapeAttr(description)).append("\">\n");
        sb.append("<meta property=\"og:url\" content=\"").append(escapeAttr(spaUrl)).append("\">\n");
        sb.append("<meta property=\"profile:username\" content=\"")
                .append(escapeAttr(spaUrl.substring(spaUrl.lastIndexOf('/') + 1))).append("\">\n");
        if (image != null && !image.isBlank()) {
            sb.append("<meta property=\"og:image\" content=\"").append(escapeAttr(image)).append("\">\n");
            sb.append("<meta property=\"og:image:alt\" content=\"").append(escapeAttr(name)).append("\">\n");
        }

        sb.append("<meta name=\"twitter:card\" content=\"")
                .append(image != null && !image.isBlank() ? "summary_large_image" : "summary")
                .append("\">\n");
        sb.append("<meta name=\"twitter:title\" content=\"").append(escapeAttr(name)).append("\">\n");
        sb.append("<meta name=\"twitter:description\" content=\"").append(escapeAttr(description)).append("\">\n");
        if (image != null && !image.isBlank()) {
            sb.append("<meta name=\"twitter:image\" content=\"").append(escapeAttr(image)).append("\">\n");
        }

        // schema.org Person JSON-LD. Gives Google enough structure to
        // surface the profile as a rich knowledge-panel-style result for
        // "{name} futsal" branded queries. We omit any field whose source is
        // empty (no contact info, no DOB) — Google warns on null values
        // but ignores missing ones.
        sb.append("<script type=\"application/ld+json\">")
                .append(buildPersonJsonLd(name, slug, description, image, spaUrl, totalTournaments, wins))
                .append("</script>\n");

        // NB: intentionally NO <meta http-equiv="refresh"> here. Caddy's
        // UA rewrite means a refresh loops Googlebot right back to this
        // controller. Body content below is what gets indexed.
        sb.append("</head>\n<body>\n");
        appendProfileBody(sb, name, description, image, spaUrl, totalTournaments, wins);
        sb.append("</body>\n</html>\n");
        return sb.toString();
    }

    /**
     * Render the actual indexable content for a profile page. Three goals:
     *
     * <ol>
     *   <li><b>Rank for "{name} futsal".</b> The H1 + JSON-LD knowsAbout
     *       combo gives Google a strong signal that this page is about
     *       a person who plays futsal — exactly what someone Googling
     *       "{name} futsal" is looking for.</li>
     *   <li><b>Match the SPA's public-profile data.</b> Stats and
     *       tournament list are sourced from the same record the SPA
     *       fetches; no inflated content that would count as cloaking.</li>
     *   <li><b>No phone numbers anywhere.</b> Same redaction rule as the
     *       JSON API: phones never leave the backend for anonymous
     *       readers, and a crawler is anonymous by definition.</li>
     * </ol>
     */
    private void appendProfileBody(StringBuilder sb, String name, String description,
                                   String image, String spaUrl,
                                   int totalTournaments, int wins) {
        sb.append("<article>\n");
        sb.append("<h1>").append(escapeHtml(name)).append("</h1>\n");
        if (image != null && !image.isBlank()) {
            sb.append("<p><img src=\"").append(escapeAttr(image))
                    .append("\" alt=\"").append(escapeAttr(name))
                    .append(" — profilna slika\"></p>\n");
        }
        sb.append("<p>").append(escapeHtml(description)).append("</p>\n");

        sb.append("<section>\n<h2>Statistika</h2>\n<ul>\n");
        sb.append("<li>Ukupno turnira: ").append(totalTournaments).append("</li>\n");
        sb.append("<li>Pobjede: ").append(wins).append("</li>\n");
        sb.append("</ul>\n</section>\n");

        sb.append("<hr>\n<p><a href=\"").append(escapeAttr(spaUrl))
                .append("\">Otvori profil u aplikaciji nogometni-turniri.com</a></p>\n");
        sb.append("</article>\n");
    }

    private String notFoundHtml() {
        return """
                <!doctype html>
                <html lang="hr"><head>
                <meta charset="UTF-8">
                <title>Profil nije pronađen — nogometni-turniri.com</title>
                <meta name="description" content="Traženi profil ne postoji.">
                </head><body><p>Profil nije pronađen.</p></body></html>
                """;
    }

    /**
     * Compact schema.org Person JSON-LD. {@code knowsAbout} pins the player
     * to the futsal concept which helps Google understand the topical
     * context of these profile pages; without it the algorithm tends to
     * match generic name-only queries unrelated to the sport.
     *
     * <p>The win/total counts are surfaced as a single {@code description}
     * string rather than as separate properties — there is no
     * schema.org-blessed "wins" field on Person, and we get richer SERP
     * snippets by keeping the counts inside the human-readable description.
     */
    private String buildPersonJsonLd(String name, String slug, String description,
                                     String image, String spaUrl, int totalTournaments, int wins) {
        StringBuilder j = new StringBuilder(384);
        j.append('{');
        j.append("\"@context\":\"https://schema.org\",");
        j.append("\"@type\":\"Person\",");
        j.append("\"name\":\"").append(jsonEscape(name)).append("\",");
        j.append("\"url\":\"").append(jsonEscape(spaUrl)).append("\",");
        if (slug != null && !slug.isBlank()) {
            j.append("\"identifier\":\"").append(jsonEscape(slug)).append("\",");
            j.append("\"alternateName\":\"").append(jsonEscape(slug)).append("\",");
        }
        j.append("\"description\":\"").append(jsonEscape(description)).append("\",");
        if (image != null && !image.isBlank()) {
            j.append("\"image\":\"").append(jsonEscape(image)).append("\",");
        }
        // knowsAbout pins the topical context to futsal — improves
        // search relevance for queries like "{name} futsal" or "{name} mali nogomet".
        j.append("\"knowsAbout\":[\"Futsal\",\"Mali nogomet\",\"Nogomet\"],");
        // interactionStatistic gives Google a hook into structured win/total
        // counts. We use UserInteractionCount which is the closest fit; both
        // metrics are emitted independently so each renders as a separate
        // stat in Google's knowledge surface.
        j.append("\"interactionStatistic\":[")
                .append("{\"@type\":\"InteractionCounter\",\"interactionType\":\"https://schema.org/RegisterAction\",\"userInteractionCount\":")
                .append(totalTournaments).append("},")
                .append("{\"@type\":\"InteractionCounter\",\"interactionType\":\"https://schema.org/WinAction\",\"userInteractionCount\":")
                .append(wins).append("}")
                .append("]");
        j.append('}');
        return j.toString();
    }

    /**
     * JSON string escaping per RFC 8259. Also escapes {@code /} after {@code <}
     * so that {@code </script>} cannot appear inside the JSON payload while
     * embedded in an HTML {@code <script>} tag.
     */
    private static String jsonEscape(String s) {
        if (s == null) return "";
        StringBuilder out = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"'  -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '/'  -> {
                    if (i > 0 && s.charAt(i - 1) == '<') out.append("\\/");
                    else out.append('/');
                }
                default -> {
                    if (c < 0x20) {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        return out.toString();
    }

    private static String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }

    private static String escapeAttr(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    @SuppressWarnings("unused")
    private static String safeLowerCase(String s) {
        return s == null ? null : s.toLowerCase(Locale.ROOT);
    }
}
