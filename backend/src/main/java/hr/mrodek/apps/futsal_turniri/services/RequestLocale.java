package hr.mrodek.apps.futsal_turniri.services;

import jakarta.enterprise.context.RequestScoped;

import java.util.Locale;

/**
 * The language the CURRENT request asked for, resolved once per request by
 * {@link hr.mrodek.apps.futsal_turniri.filters.LocaleRequestFilter} from the
 * {@code X-Locale} header the frontend sends (see {@code frontend/src/api/http.ts}).
 * {@link MessageService#t(String, Object...)} reads this instead of always
 * using {@link MessageService#DEFAULT_LOCALE}, so every existing call site
 * becomes locale-aware with no changes of its own.
 *
 * <p>Request-scoped rather than a plain field on the (application-scoped)
 * filter or {@code MessageService} - concurrent requests on different
 * threads must never see each other's language.
 */
@RequestScoped
public class RequestLocale {

    private Locale locale = MessageService.DEFAULT_LOCALE;

    public Locale get() {
        return locale;
    }

    public void set(Locale locale) {
        this.locale = locale != null ? locale : MessageService.DEFAULT_LOCALE;
    }
}
