package hr.mrodek.apps.futsal_turniri.filters;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.ext.Provider;

import java.util.Set;

/**
 * Adds a short, shared-cacheable {@code Cache-Control} to a whitelist of
 * public read-only collection endpoints whose response is identical for
 * everyone (no auth-dependent fields).
 *
 * <p>Why a whitelist and not "all GETs": endpoints like
 * {@code /public/users/{slug}} vary by caller (phone is redacted for
 * anonymous viewers), so caching them with {@code public} could leak the
 * authenticated variant through a shared cache. We only tag the truly
 * uniform list/aggregate reads.
 *
 * <p>Effect:
 *   • Browser caches the response for {@code max-age} → instant back/forward
 *     navigation and the index.html warm-up fetch is reused by axios.
 *   • If a CDN/edge (e.g. Cloudflare proxy) is ever put in front,
 *     {@code s-maxage} lets it serve the list from the edge and offload the
 *     backend. Harmless when no edge is present.
 *
 * <p>Endpoints that set their own {@code Cache-Control} (OG image, share
 * image, posters, sitemap) are skipped — we never overwrite an explicit value.
 */
@Provider
public class PublicReadCacheFilter implements ContainerResponseFilter {

    private static final String CACHE_VALUE = "public, max-age=20, s-maxage=60";

    /** Paths (relative to the {@code /api} root) that are safe to cache publicly.
     *
     *  NOTE: {@code tournaments/live} is deliberately NOT here. It carries
     *  real-time match scores polled every few seconds by the /uzivo page and
     *  the fullscreen TV display; a 20s browser cache made a freshly-entered
     *  goal invisible until the cache expired or the page was hard-refreshed.
     *  Live data must always hit the backend. */
    private static final Set<String> CACHEABLE = Set.of(
            "tournaments",
            "tournaments/featured",
            "tournaments/upcoming-matches",
            "tournaments/count",
            "players/scorers"
    );

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        if (!"GET".equalsIgnoreCase(req.getMethod())) return;
        if (res.getStatus() != 200) return;
        // Respect an explicit Cache-Control set by the resource method.
        if (res.getHeaders().containsKey(HttpHeaders.CACHE_CONTROL)) return;

        String path = req.getUriInfo().getPath();
        if (path == null) return;
        // Normalise: drop leading slash and an optional "api/" prefix so the
        // match works regardless of how the root-path is reported.
        if (path.startsWith("/")) path = path.substring(1);
        if (path.startsWith("api/")) path = path.substring(4);
        if (path.endsWith("/")) path = path.substring(0, path.length() - 1);

        if (CACHEABLE.contains(path)) {
            res.getHeaders().putSingle(HttpHeaders.CACHE_CONTROL, CACHE_VALUE);
            // The tournaments list is no longer auth-uniform: admin-hidden
            // rows are included for their creator/admins only. Without Vary
            // the browser could serve an ANONYMOUS cached copy (e.g. from the
            // index.html warm-up fetch) to a signed-in admin for up to 20s —
            // the hidden tournament flickered in and out of the list. Vary
            // keys the browser cache on the Authorization header so anonymous
            // and signed-in responses never mix. Harmless for the endpoints
            // that really are uniform (no Authorization → same cache key).
            res.getHeaders().putSingle(HttpHeaders.VARY, "Authorization");
        }
    }
}
