package hr.mrodek.apps.futsal_turniri.filters;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.ext.Provider;

/**
 * Defense-in-depth security headers on every response.
 *
 * <p>The intent is that the reverse proxy (nginx / Cloudflare / whatever sits
 * in front of the Quarkus app in prod) will also set these - but mistakes happen,
 * proxies get reconfigured, and it's cheap to add them at the application
 * boundary so they're applied no matter what's in front.
 *
 * <p>What each header does:
 * <ul>
 *   <li>{@code Strict-Transport-Security}: forces HTTPS for the next year.
 *       Set even on API responses; it's a hint to the browser, not the
 *       caller. Skipped on plain-HTTP requests so {@code curl http://localhost}
 *       in dev doesn't get a hostile header back.</li>
 *   <li>{@code X-Content-Type-Options: nosniff}: stops the browser from
 *       MIME-sniffing. Critical for the MinIO poster URLs we expose, but
 *       harmless on JSON.</li>
 *   <li>{@code X-Frame-Options: DENY}: clickjacking guard. The SPA never
 *       embeds the API in an iframe.</li>
 *   <li>{@code Referrer-Policy: strict-origin-when-cross-origin}: don't leak
 *       the full request path to other origins on outbound clicks.</li>
 *   <li>{@code Permissions-Policy}: revoke camera/mic/geolocation/payment from
 *       any context that loads our pages. The SPA only uses geolocation, and
 *       requests it explicitly, so blocking it here is correct.</li>
 * </ul>
 *
 * <p>{@code Content-Security-Policy} is intentionally NOT set here. The API
 * mostly serves JSON, where CSP is a no-op; the SPA's CSP belongs in the
 * reverse-proxy config that serves {@code index.html}, where it can reference
 * the right origins (Firebase Auth, MinIO public bucket, OpenStreetMap tiles
 * for the map page, etc.) without becoming brittle.
 */
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter {

    private static final String HSTS = "max-age=31536000; includeSubDomains";
    private static final String PERMISSIONS_POLICY =
            "geolocation=(self), camera=(), microphone=(), payment=(), interest-cohort=()";

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        MultivaluedMap<String, Object> h = res.getHeaders();

        // Idempotent: don't overwrite values another filter (or the proxy)
        // already set, just fill gaps.
        putIfAbsent(h, "X-Content-Type-Options", "nosniff");
        putIfAbsent(h, "X-Frame-Options", "DENY");
        putIfAbsent(h, "Referrer-Policy", "strict-origin-when-cross-origin");
        putIfAbsent(h, "Permissions-Policy", PERMISSIONS_POLICY);

        // HSTS only for HTTPS - sending it over plain HTTP is a no-op per
        // RFC 6797, but some browsers warn about it in dev. Easier to skip.
        String scheme = req.getUriInfo() != null
                ? req.getUriInfo().getRequestUri().getScheme()
                : null;
        if ("https".equalsIgnoreCase(scheme)) {
            putIfAbsent(h, "Strict-Transport-Security", HSTS);
        }
    }

    private static void putIfAbsent(MultivaluedMap<String, Object> h, String name, String value) {
        if (!h.containsKey(name)) h.add(name, value);
    }
}
