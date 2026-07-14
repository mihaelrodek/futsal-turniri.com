package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Server-side rendered preview HTML for crawlers (WhatsApp, Slack, Facebook,
 * Telegram, Twitter, LinkedIn, Discord, …). These bots do NOT execute JS, so
 * the per-route {@code useDocumentHead} hook in the SPA is invisible to them.
 * Without this endpoint, every shared tournament URL gets the same generic
 * preview from the static {@code index.html}.
 *
 * <p>Endpoint: {@code GET /api/preview/tournaments/{uuid}} → text/html with
 * tournament-specific {@code og:*} / Twitter-card meta tags.
 *
 * <p>Wiring it up: in your reverse proxy (nginx, Cloudflare Worker, etc.),
 * detect known crawler User-Agents on {@code /turniri/<slug>} and rewrite
 * to {@code /api/preview/tournaments/<slug>}. Real users keep getting the
 * SPA. The English alias {@code /tournaments/<slug>} 301-redirects to the
 * Croatian path at the Caddy layer, so the same rewrite covers it. See
 * the snippet in {@code Caddyfile} for the exact regex.
 *
 * <p>The body also has a {@code <meta http-equiv="refresh">} that bounces a
 * human who lands on this URL directly back to the SPA route, so it's safe
 * to expose without a UA filter.
 */
@Path("/preview/tournaments")
public class TournamentPreviewController {

    @Inject
    TournamentsRepository tournamentsRepo;

    @Inject
    TeamsRepository teamsRepo;

    @ConfigProperty(name = "app.public-base-url", defaultValue = "https://futsal-turniri.com")
    String publicBaseUrl;

    // Optional<> rather than a defaulted String - Quarkus refuses to register
    // an empty defaultValue, so a non-Optional String here would crash boot
    // when APP_DEFAULT_OG_IMAGE isn't set in the environment.
    @ConfigProperty(name = "app.default-og-image")
    Optional<String> defaultOgImage;

    /** Croatian-localized formatter, e.g. "ned, 24. svibnja 2026. u 18:00". */
    private static final DateTimeFormatter HR_DATETIME =
            DateTimeFormatter.ofPattern("EEE, d. MMMM yyyy. 'u' HH:mm", Locale.forLanguageTag("hr-HR"));

    @GET
    @Path("/{idOrSlug}")
    @Produces("text/html; charset=UTF-8")
    public Response preview(@PathParam("idOrSlug") String idOrSlug) {
        // Accept either UUID (legacy share URLs) or pretty slug (new format).
        Tournaments t = tournamentsRepo.findByUuidOrSlug(idOrSlug).orElse(null);
        // Admin-hidden tournaments 404 for crawlers too - this endpoint is
        // anonymous, so hidden == not found (keeps them out of link previews
        // and search indexes).
        if (t == null || t.isHidden()) {
            return Response.status(Response.Status.NOT_FOUND)
                    .type("text/html; charset=UTF-8")
                    .entity(notFoundHtml())
                    .build();
        }

        String name = t.getName() != null ? t.getName() : "Futsal turnir";
        String description = buildDescription(t);

        String base = publicBaseUrl.replaceAll("/+$", "");
        // Canonical SPA URL is Croatian (/turniri/...). English /tournaments/...
        // still works as a 301 alias via Caddy, but we never emit it from
        // server-side rendering or canonical links - Google would otherwise
        // index the alias instead of the canonical URL.
        String spaUrl = base + "/turniri/" + idOrSlug;


        // og:image must be an absolute URL - bots fetch it directly from
        // wherever they are. Priority:
        //   1. Finished tournament with a winner → server-rendered share
        //      card (podium + status). Composes much better in WhatsApp
        //      / Discord / Slack previews than a raw banner.
        //   2. Uploaded banner (proxied via /api/resources/...).
        //   3. Default fallback configured in app.properties.
        String image;
        boolean finishedWithWinner = t.getStatus() == hr.mrodek.apps.futsal_turniri.enums.TournamentStatus.FINISHED
                && t.getWinnerName() != null && !t.getWinnerName().isBlank();
        if (finishedWithWinner) {
            String key = t.getSlug() != null ? t.getSlug() : t.getUuid().toString();
            image = base + "/api/tournaments/" + key + "/share-image.png";
        } else if (t.getResource() != null && t.getResource().getId() != null) {
            image = base + "/api/resources/" + t.getResource().getId() + "/image";
        } else {
            image = defaultOgImage.filter(s -> !s.isBlank()).orElse(null);
        }

        return Response.ok(renderHtml(t, name, description, image, spaUrl)).build();
    }

    /**
     * SSR preview for the shareable "turnir mode" page
     * ({@code /turniri/<slug>/uzivo}). A spectator sharing the live-stream link
     * on WhatsApp / Facebook / … gets a "Uživo prijenos … putem kamere" card
     * instead of the generic site preview. Caddy rewrites crawler hits on
     * {@code /turniri/<slug>/uzivo} to {@code /api/preview/tournaments/<slug>/uzivo}.
     */
    @GET
    @Path("/{idOrSlug}/uzivo")
    @Produces("text/html; charset=UTF-8")
    public Response previewLive(@PathParam("idOrSlug") String idOrSlug) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(idOrSlug).orElse(null);
        if (t == null || t.isHidden()) {
            return Response.status(Response.Status.NOT_FOUND)
                    .type("text/html; charset=UTF-8")
                    .entity(notFoundHtml())
                    .build();
        }

        String name = t.getName() != null ? t.getName() : "Futsal turnir";
        String title = "Uživo prijenos — " + name;
        String description = "Gledaj uživo prijenos turnira " + name
                + " putem kamere - rezultati, tijek utakmice i tablica u stvarnom vremenu.";

        String base = publicBaseUrl.replaceAll("/+$", "");
        String key = t.getSlug() != null ? t.getSlug() : t.getUuid().toString();
        String spaUrl = base + "/turniri/" + key + "/uzivo";

        // Prefer the tournament's own banner as the card image; else the
        // branded default OG card.
        String image;
        if (t.getResource() != null && t.getResource().getId() != null) {
            image = base + "/api/resources/" + t.getResource().getId() + "/image";
        } else {
            image = defaultOgImage.filter(s -> !s.isBlank()).orElse(null);
        }

        return Response.ok(renderLiveHtml(title, description, image, spaUrl)).build();
    }

    /* ───────────────────── helpers ───────────────────── */

    /** Minimal live-stream OG head + plain-text body (see {@link #previewLive}). */
    private String renderLiveHtml(String title, String description, String image, String spaUrl) {
        StringBuilder sb = new StringBuilder(1024);
        sb.append("<!doctype html>\n<html lang=\"hr\">\n<head>\n");
        sb.append("<meta charset=\"UTF-8\">\n");
        sb.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n");
        sb.append("<title>").append(escapeHtml(title)).append(" - futsal-turniri.com</title>\n");
        sb.append("<meta name=\"description\" content=\"").append(escapeAttr(description)).append("\">\n");
        sb.append("<link rel=\"canonical\" href=\"").append(escapeAttr(spaUrl)).append("\">\n");

        sb.append("<meta property=\"og:type\" content=\"video.other\">\n");
        sb.append("<meta property=\"og:locale\" content=\"hr_HR\">\n");
        sb.append("<meta property=\"og:site_name\" content=\"futsal-turniri.com\">\n");
        sb.append("<meta property=\"og:title\" content=\"").append(escapeAttr(title)).append("\">\n");
        sb.append("<meta property=\"og:description\" content=\"").append(escapeAttr(description)).append("\">\n");
        sb.append("<meta property=\"og:url\" content=\"").append(escapeAttr(spaUrl)).append("\">\n");
        if (image != null && !image.isBlank()) {
            sb.append("<meta property=\"og:image\" content=\"").append(escapeAttr(image)).append("\">\n");
            sb.append("<meta property=\"og:image:alt\" content=\"").append(escapeAttr(title)).append("\">\n");
        }

        sb.append("<meta name=\"twitter:card\" content=\"")
                .append(image != null && !image.isBlank() ? "summary_large_image" : "summary")
                .append("\">\n");
        sb.append("<meta name=\"twitter:title\" content=\"").append(escapeAttr(title)).append("\">\n");
        sb.append("<meta name=\"twitter:description\" content=\"").append(escapeAttr(description)).append("\">\n");
        if (image != null && !image.isBlank()) {
            sb.append("<meta name=\"twitter:image\" content=\"").append(escapeAttr(image)).append("\">\n");
        }

        sb.append("</head>\n<body>\n<article>\n");
        sb.append("<h1>").append(escapeHtml(title)).append("</h1>\n");
        sb.append("<p>").append(escapeHtml(description)).append("</p>\n");
        sb.append("<p><a href=\"").append(escapeAttr(spaUrl))
                .append("\">Otvori uživo prijenos na futsal-turniri.com</a></p>\n");
        sb.append("</article>\n</body>\n</html>\n");
        return sb.toString();
    }

    /**
     * Compose the og:description as: "{location} • {datetime} • Kotizacija
     * {entry} € • Prijavi se i pogledaj sve detalje turnira na
     * futsal-turniri.com". Each segment is added only when its source
     * field is present so we don't ship dangling separators.
     */
    String buildDescription(Tournaments t) {
        StringBuilder sb = new StringBuilder();

        if (t.getLocation() != null && !t.getLocation().isBlank()) {
            sb.append(t.getLocation().trim()).append(" • ");
        }

        if (t.getStartAt() != null) {
            sb.append(formatHrDateTime(t.getStartAt())).append(" • ");
        }

        // Entry price - default is 0.
        BigDecimal entry = t.getEntryPrice() != null ? t.getEntryPrice() : BigDecimal.ZERO;
        sb.append("Kotizacija ").append(formatEur(entry)).append(" €");

        sb.append(" • Prijavi se i pogledaj sve detalje turnira na futsal-turniri.com");
        return sb.toString();
    }

    /** "10" instead of "10.00" but "10.50" stays "10.50". */
    private String formatEur(BigDecimal v) {
        BigDecimal stripped = v.stripTrailingZeros();
        if (stripped.scale() < 0) stripped = stripped.setScale(0, RoundingMode.UNNECESSARY);
        return stripped.toPlainString();
    }

    private String formatHrDateTime(OffsetDateTime ts) {
        return HR_DATETIME.format(ts);
    }

    /**
     * Build a minimal HTML response. Crawlers only need the {@code <head>};
     * the {@code <body>} is a plain-text fallback for humans who land here
     * directly, and the {@code meta refresh} bounces them to the SPA.
     */
    private String renderHtml(Tournaments t, String name, String description, String image, String spaUrl) {
        StringBuilder sb = new StringBuilder(2048);
        sb.append("<!doctype html>\n");
        sb.append("<html lang=\"hr\">\n<head>\n");
        sb.append("<meta charset=\"UTF-8\">\n");
        sb.append("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n");
        sb.append("<title>").append(escapeHtml(name)).append(" - futsal-turniri.com</title>\n");
        sb.append("<meta name=\"description\" content=\"").append(escapeAttr(description)).append("\">\n");
        sb.append("<link rel=\"canonical\" href=\"").append(escapeAttr(spaUrl)).append("\">\n");

        // OpenGraph
        sb.append("<meta property=\"og:type\" content=\"article\">\n");
        sb.append("<meta property=\"og:locale\" content=\"hr_HR\">\n");
        sb.append("<meta property=\"og:site_name\" content=\"futsal-turniri.com\">\n");
        sb.append("<meta property=\"og:title\" content=\"").append(escapeAttr(name)).append("\">\n");
        sb.append("<meta property=\"og:description\" content=\"").append(escapeAttr(description)).append("\">\n");
        sb.append("<meta property=\"og:url\" content=\"").append(escapeAttr(spaUrl)).append("\">\n");
        if (image != null && !image.isBlank()) {
            sb.append("<meta property=\"og:image\" content=\"").append(escapeAttr(image)).append("\">\n");
            sb.append("<meta property=\"og:image:alt\" content=\"").append(escapeAttr(name)).append("\">\n");
        }

        // Twitter
        sb.append("<meta name=\"twitter:card\" content=\"")
                .append(image != null && !image.isBlank() ? "summary_large_image" : "summary")
                .append("\">\n");
        sb.append("<meta name=\"twitter:title\" content=\"").append(escapeAttr(name)).append("\">\n");
        sb.append("<meta name=\"twitter:description\" content=\"").append(escapeAttr(description)).append("\">\n");
        if (image != null && !image.isBlank()) {
            sb.append("<meta name=\"twitter:image\" content=\"").append(escapeAttr(image)).append("\">\n");
        }

        // schema.org Event JSON-LD - the highest-leverage SEO addition.
        // Google uses this to render rich Event cards in SERPs (date,
        // location, price chip) and surfaces tournaments in its dedicated
        // Events experience on mobile. Required props (name, startDate,
        // location) are guaranteed by the entity; optional props are
        // emitted only when their source field is non-empty so we don't
        // ship "null" or "0 €" values to the crawler.
        sb.append("<script type=\"application/ld+json\">")
                .append(buildEventJsonLd(t, name, description, image, spaUrl))
                .append("</script>\n");

        // NB: we INTENTIONALLY do not emit a <meta http-equiv="refresh">
        // here. Caddy's UA-routing rewrites the original /turniri/<slug>
        // URL to /api/preview/tournaments/<slug> for crawlers, so when
        // Googlebot follows a refresh it loops right back here. The body
        // below is the only thing Googlebot will index for this URL.
        sb.append("</head>\n<body>\n");
        appendTournamentBody(sb, t, name, description, image, spaUrl);
        sb.append("</body>\n</html>\n");
        return sb.toString();
    }

    /**
     * Render the actual indexable content for a tournament page. This is
     * what Googlebot reads to decide whether this URL should rank for
     * queries like "futsal turnir Zagreb 24.05.2026" or "futsal turnir
     * {organizer}". Three rules guided the structure:
     *
     * <ol>
     *   <li><b>One H1, semantic sections.</b> A single &lt;h1&gt; with the
     *       tournament name; &lt;h2&gt;s for each meaningful section
     *       (Detalji, Nagrade, Sudionici, Kontakt). Google still leans
     *       heavily on heading structure to summarise a page.</li>
     *   <li><b>Real Croatian sentences, not keyword soup.</b> Google's
     *       spam systems flag pages whose text reads like a SERP target.
     *       We write the dates and prices into a natural HR sentence
     *       instead of repeating "{name} {location} {date}" five times.</li>
     *   <li><b>Match the SPA's content exactly.</b> Different formatting
     *       between the SPA (what users see) and this page (what bots
     *       see) is fine; <i>different facts</i> would be cloaking. So
     *       every field below is sourced from the same record the SPA
     *       fetches through {@code GET /api/tournaments/{id}}.</li>
     * </ol>
     */
    private void appendTournamentBody(StringBuilder sb, Tournaments t, String name,
                                      String description, String image, String spaUrl) {
        // Article wrapper - gives screen readers and Google a clear page
        // outline. The class names aren't styled (no CSS is shipped here)
        // but they're useful when the HTML is inspected during debugging.
        sb.append("<article>\n");
        sb.append("<h1>").append(escapeHtml(name)).append("</h1>\n");
        if (image != null && !image.isBlank()) {
            // alt text is the tournament name - descriptive and accurate.
            // width/height left unset so the browser/crawler renders at
            // the natural resource size.
            sb.append("<p><img src=\"").append(escapeAttr(image))
                    .append("\" alt=\"").append(escapeAttr(name)).append("\"></p>\n");
        }
        sb.append("<p>").append(escapeHtml(description)).append("</p>\n");

        // Details section - date, location, format, kotizacija. Built as a
        // semantic dl so each fact has a label crawlers can associate with
        // its value, instead of a free-floating paragraph.
        sb.append("<section>\n<h2>Detalji turnira</h2>\n<dl>\n");
        if (t.getStartAt() != null) {
            sb.append("<dt>Datum i vrijeme</dt><dd>")
                    .append(escapeHtml(formatHrDateTime(t.getStartAt())))
                    .append("</dd>\n");
        }
        if (t.getLocation() != null && !t.getLocation().isBlank()) {
            sb.append("<dt>Lokacija</dt><dd>")
                    .append(escapeHtml(t.getLocation().trim())).append("</dd>\n");
        }
        BigDecimal entry = t.getEntryPrice() != null ? t.getEntryPrice() : BigDecimal.ZERO;
        sb.append("<dt>Kotizacija po ekipi</dt><dd>")
                .append(escapeHtml(formatEur(entry))).append(" €</dd>\n");
        if (t.getMaxTeams() != null) {
            sb.append("<dt>Maksimalan broj ekipa</dt><dd>")
                    .append(t.getMaxTeams()).append("</dd>\n");
        }
        String organizer = organizerDisplayName(t);
        if (organizer != null) {
            sb.append("<dt>Organizator</dt><dd>")
                    .append(escapeHtml(organizer)).append("</dd>\n");
        }
        sb.append("</dl>\n</section>\n");

        // Free-text description from the organiser. Kept as a separate
        // section because the field is optional and often the longest
        // block of original Croatian text on the page - exactly what
        // Google needs to rank for long-tail queries.
        if (t.getDetails() != null && !t.getDetails().isBlank()) {
            sb.append("<section>\n<h2>Opis</h2>\n");
            // Preserve organiser-entered line breaks but escape HTML.
            for (String para : t.getDetails().split("\n\n+")) {
                String trimmed = para.trim();
                if (trimmed.isEmpty()) continue;
                sb.append("<p>").append(escapeHtml(trimmed).replace("\n", "<br>"))
                        .append("</p>\n");
            }
            sb.append("</section>\n");
        }

        // Rewards section - only when at least one tier has a value.
        BigDecimal r1 = t.getRewardFirst(), r2 = t.getRewardSecond(), r3 = t.getRewardThird();
        boolean hasReward = (r1 != null && r1.compareTo(BigDecimal.ZERO) > 0)
                || (r2 != null && r2.compareTo(BigDecimal.ZERO) > 0)
                || (r3 != null && r3.compareTo(BigDecimal.ZERO) > 0);
        if (hasReward) {
            sb.append("<section>\n<h2>Nagrade</h2>\n<ul>\n");
            if (r1 != null && r1.compareTo(BigDecimal.ZERO) > 0)
                sb.append("<li>1. mjesto: ").append(escapeHtml(formatEur(r1))).append(" €</li>\n");
            if (r2 != null && r2.compareTo(BigDecimal.ZERO) > 0)
                sb.append("<li>2. mjesto: ").append(escapeHtml(formatEur(r2))).append(" €</li>\n");
            if (r3 != null && r3.compareTo(BigDecimal.ZERO) > 0)
                sb.append("<li>3. mjesto: ").append(escapeHtml(formatEur(r3))).append(" €</li>\n");
            sb.append("</ul>\n</section>\n");
        }

        // Participants - list approved teams. For a FINISHED tournament,
        // highlight the winner up top. We deliberately skip pending /
        // rejected teams because those aren't part of the public record
        // and would be confusing in a search snippet.
        try {
            List<Teams> teams = teamsRepo.findByTournament_Id(t.getId()).stream()
                    .filter(p -> !p.isPendingApproval())
                    .toList();
            if (!teams.isEmpty()) {
                sb.append("<section>\n<h2>Sudionici</h2>\n");
                if (t.getWinnerName() != null && !t.getWinnerName().isBlank()) {
                    sb.append("<p><strong>Pobjednik turnira:</strong> ")
                            .append(escapeHtml(t.getWinnerName().trim())).append("</p>\n");
                }
                sb.append("<p>Ukupno prijavljenih ekipa: ").append(teams.size()).append(".</p>\n");
                sb.append("<ul>\n");
                for (Teams p : teams) {
                    if (p.getName() == null || p.getName().isBlank()) continue;
                    sb.append("<li>").append(escapeHtml(p.getName().trim())).append("</li>\n");
                }
                sb.append("</ul>\n</section>\n");
            }
        } catch (RuntimeException e) {
            // Defensive: a missing FK or lazy-init blow-up shouldn't take
            // down the preview entirely. Log and skip the section.
        }

        // Status banner - finished tournaments are still useful for SEO
        // ("futsal turnir Zagreb 2024 rezultati") so we don't hide them.
        // Just label clearly so the snippet doesn't mislead users.
        if (t.getStatus() == TournamentStatus.FINISHED) {
            sb.append("<p><em>Status: Turnir je završen.</em></p>\n");
        } else if (t.getStatus() == TournamentStatus.STARTED) {
            sb.append("<p><em>Status: Turnir je u tijeku.</em></p>\n");
        }

        // Footer call-to-action - single trusted link back to the SPA so
        // anyone (including the rare human who lands on this URL directly)
        // can jump to the interactive version. Also tells Google the
        // canonical destination if it crawls this URL outside the rewrite.
        sb.append("<hr>\n");
        sb.append("<p><a href=\"").append(escapeAttr(spaUrl))
                .append("\">Otvori turnir u aplikaciji futsal-turniri.com</a></p>\n");
        sb.append("</article>\n");
    }

    private String notFoundHtml() {
        return """
                <!doctype html>
                <html lang="hr"><head>
                <meta charset="UTF-8">
                <title>Turnir nije pronađen - futsal-turniri.com</title>
                <meta name="description" content="Traženi turnir ne postoji ili je uklonjen.">
                </head><body><p>Turnir nije pronađen.</p></body></html>
                """;
    }

    /**
     * Emit schema.org Event JSON-LD as a single-line JSON string. Embedded
     * inside {@code <script type="application/ld+json">…</script>} in
     * {@link #renderHtml}.
     *
     * <p>Why a hand-rolled serializer instead of Jackson:
     *   - The object graph is tiny and fully known at compile time. Pulling
     *     ObjectMapper just to emit ~12 keys would be overkill.
     *   - We need precise control over which optional properties are emitted
     *     vs. omitted (Google flags "price": null as an error, but is happy
     *     when offers is absent entirely).
     *   - Keeps this controller free of CDI-injected mappers and avoids any
     *     accidental coupling to the JSON content negotiation of the
     *     RESTEasy stack.
     *
     * <p>Schema choices:
     *   - {@code @type=Event} (not SportsEvent) - the JSON-LD models the
     *     tournament as a whole, which has no single homeTeam/awayTeam
     *     pairing, and Event renders the same rich result in SERPs.
     *   - {@code eventStatus} defaults to EventScheduled; we don't model
     *     cancellations, so there's no need to branch on TournamentStatus.
     *   - {@code eventAttendanceMode=OfflineEventAttendanceMode} - every
     *     futsal tournament is in-person.
     *   - {@code offers.availability=InStock} as long as the event hasn't
     *     started; once {@code startAt} is in the past we omit offers
     *     entirely (Google will flag past-dated offers as invalid).
     *   - {@code endDate} is set to {@code startAt + 6h} as a reasonable
     *     default - Google requires endDate to be after startDate when
     *     present, and most tournaments wrap within a single evening.
     */
    private String buildEventJsonLd(Tournaments t, String name, String description, String image, String spaUrl) {
        StringBuilder j = new StringBuilder(512);
        j.append('{');
        j.append("\"@context\":\"https://schema.org\",");
        j.append("\"@type\":\"Event\",");
        j.append("\"name\":\"").append(jsonEscape(name)).append("\",");
        j.append("\"description\":\"").append(jsonEscape(description)).append("\",");
        j.append("\"url\":\"").append(jsonEscape(spaUrl)).append("\",");
        j.append("\"inLanguage\":\"hr\",");
        j.append("\"eventStatus\":\"https://schema.org/EventScheduled\",");
        j.append("\"eventAttendanceMode\":\"https://schema.org/OfflineEventAttendanceMode\",");

        if (t.getStartAt() != null) {
            // ISO-8601 with offset - Google's parser handles "2026-05-24T18:00:00+02:00".
            j.append("\"startDate\":\"").append(jsonEscape(t.getStartAt().toString())).append("\",");
            // endDate is required by Google when startDate is present for some
            // rich-result eligibility paths; default to +6h since we don't
            // model duration explicitly. Safe over-estimate.
            OffsetDateTime end = t.getStartAt().plusHours(6);
            j.append("\"endDate\":\"").append(jsonEscape(end.toString())).append("\",");
        }

        // Location - required. If we have a textual location we ship it as
        // Place.name + address.addressLocality. Without it we fall back to
        // Place.name="Hrvatska" so the structured-data validator doesn't
        // reject the whole record for a missing required field.
        String loc = t.getLocation();
        if (loc != null && !loc.isBlank()) {
            String locClean = loc.trim();
            j.append("\"location\":{")
                    .append("\"@type\":\"Place\",")
                    .append("\"name\":\"").append(jsonEscape(locClean)).append("\",")
                    .append("\"address\":{")
                    .append("\"@type\":\"PostalAddress\",")
                    .append("\"addressLocality\":\"").append(jsonEscape(locClean)).append("\",")
                    .append("\"addressCountry\":\"HR\"")
                    .append("}");
            if (t.getLatitude() != null && t.getLongitude() != null) {
                j.append(",\"geo\":{")
                        .append("\"@type\":\"GeoCoordinates\",")
                        .append("\"latitude\":").append(t.getLatitude()).append(',')
                        .append("\"longitude\":").append(t.getLongitude())
                        .append('}');
            }
            j.append("},");
        } else {
            j.append("\"location\":{")
                    .append("\"@type\":\"Place\",")
                    .append("\"name\":\"Hrvatska\",")
                    .append("\"address\":{\"@type\":\"PostalAddress\",\"addressCountry\":\"HR\"}")
                    .append("},");
        }

        if (image != null && !image.isBlank()) {
            j.append("\"image\":[\"").append(jsonEscape(image)).append("\"],");
        }

        String organizer = organizerDisplayName(t);
        if (organizer != null) {
            // A custom organizer name is typically a club/association, the
            // fallback (account display name) is a person.
            boolean custom = t.getOrganizerName() != null && !t.getOrganizerName().isBlank();
            j.append("\"organizer\":{")
                    .append("\"@type\":\"").append(custom ? "Organization" : "Person").append("\",")
                    .append("\"name\":\"").append(jsonEscape(organizer)).append("\"")
                    .append("},");
        }

        // Offers - only when the event hasn't started yet AND we have a
        // non-zero entry price. Past-dated offers and price=0 entries both
        // produce structured-data warnings in Search Console.
        BigDecimal entry = t.getEntryPrice() != null ? t.getEntryPrice() : BigDecimal.ZERO;
        boolean inFuture = t.getStartAt() == null
                || t.getStartAt().isAfter(OffsetDateTime.now());
        if (inFuture && entry.compareTo(BigDecimal.ZERO) > 0) {
            j.append("\"offers\":{")
                    .append("\"@type\":\"Offer\",")
                    .append("\"url\":\"").append(jsonEscape(spaUrl)).append("\",")
                    .append("\"price\":\"").append(formatEur(entry)).append("\",")
                    .append("\"priceCurrency\":\"EUR\",")
                    .append("\"availability\":\"https://schema.org/InStock\",")
                    // validFrom: now - Google uses this to know when the
                    // offer becomes purchasable. Empty/missing is allowed.
                    .append("\"validFrom\":\"").append(jsonEscape(OffsetDateTime.now().toString())).append("\"")
                    .append("},");
        }

        // Trim the trailing comma we left at the end of the last key.
        if (j.charAt(j.length() - 1) == ',') j.setLength(j.length() - 1);
        j.append('}');
        return j.toString();
    }

    /**
     * JSON string escaping per RFC 8259. Also escapes {@code /} after {@code <}
     * so that {@code </script>} cannot appear inside the JSON payload while
     * it is embedded in an HTML {@code <script>} tag - without that, a
     * tournament name containing the literal "&lt;/script&gt;" would prematurely
     * close the script element.
     */
    /**
     * Public organizer name: the organizer-set free-text field when present
     * (udruga, klub, …), otherwise the creator's account display name.
     * Mirrors the SPA's Organizator box on the detail page. Null when
     * neither is set.
     */
    private static String organizerDisplayName(Tournaments t) {
        if (t.getOrganizerName() != null && !t.getOrganizerName().isBlank()) {
            return t.getOrganizerName().trim();
        }
        if (t.getCreatedByName() != null && !t.getCreatedByName().isBlank()) {
            return t.getCreatedByName().trim();
        }
        return null;
    }

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
                    // Only escape "/" when it's the slash in "</", which is
                    // the only sequence that can prematurely terminate a
                    // <script> block. Escaping every "/" makes the JSON
                    // noisier than it needs to be.
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

    /** Minimal HTML escape for text node content. */
    private static String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;");
    }

    /** Stricter escape for attribute values (also escapes quotes). */
    private static String escapeAttr(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
