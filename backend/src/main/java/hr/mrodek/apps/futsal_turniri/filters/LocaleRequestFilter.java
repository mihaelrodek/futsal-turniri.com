package hr.mrodek.apps.futsal_turniri.filters;

import hr.mrodek.apps.futsal_turniri.services.MessageService;
import hr.mrodek.apps.futsal_turniri.services.RequestLocale;
import jakarta.inject.Inject;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.ext.Provider;

import java.util.Locale;
import java.util.Set;

/**
 * Resolves the language of every incoming request from the {@code X-Locale}
 * header (sent by {@code frontend/src/api/http.ts} for the language the user
 * picked in the navbar switcher) into the request-scoped {@link RequestLocale},
 * which {@link MessageService} then uses for every {@code messages.t(key, ...)}
 * call in this request - emails, push notifications, and 400/409 validation
 * messages all come back in the requester's chosen language with zero change
 * to any individual controller.
 *
 * <p>Only "hr" / "en" / "sl" are recognised today (see {@code SUPPORTED}) -
 * anything else (missing header, typo, a future locale the backend bundles
 * don't have yet) falls back to {@link MessageService#DEFAULT_LOCALE}.
 * {@link MessageService#loadBundle} would itself fall back to the default
 * bundle for an unknown language anyway, but resolving it here means the
 * {@code MessageFormat} locale-dependent number/date formatting is correct
 * too, not just the bundle lookup.
 */
@Provider
public class LocaleRequestFilter implements ContainerRequestFilter {

    private static final String HEADER = "X-Locale";
    private static final Set<String> SUPPORTED = Set.of("hr", "en", "sl");

    @Inject RequestLocale requestLocale;

    @Override
    public void filter(ContainerRequestContext ctx) {
        requestLocale.set(resolve(ctx.getHeaderString(HEADER)));
    }

    private static Locale resolve(String header) {
        if (header == null || header.isBlank()) return MessageService.DEFAULT_LOCALE;
        String lang = header.trim().toLowerCase();
        return SUPPORTED.contains(lang) ? Locale.forLanguageTag(lang) : MessageService.DEFAULT_LOCALE;
    }
}
