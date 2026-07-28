package hr.mrodek.apps.futsal_turniri.services;

import jakarta.enterprise.context.ApplicationScoped;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.text.MessageFormat;
import java.util.Locale;
import java.util.Map;
import java.util.PropertyResourceBundle;
import java.util.ResourceBundle;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Backend i18n lookup for every human-readable string that used to be
 * hardcoded Croatian across the controllers/services (validation/409/400
 * messages, push-notification title/body, email subjects/headings/body
 * copy). Bundles live at {@code src/main/resources/i18n/messages_{locale}.properties}
 * - one file per locale, plain key = value, organised with dotted keys that
 * mirror the feature area (e.g. {@code recording.error.invalidEmail},
 * {@code tournament.push.goal.title}).
 *
 * <h2>Encoding</h2>
 * The properties files are saved as UTF-8 (not escaped {@code \\uXXXX}) so
 * Croatian diacritics (č ć ž š đ) are readable straight in the file. The
 * classpath's default {@link ResourceBundle#getBundle(String, Locale)} would
 * decode them as ISO-8859-1 pre-Java 9; Java 21's default {@code Control}
 * (via {@link java.util.ResourceBundle.Control#getFormats}) DOES read
 * {@code .properties} as UTF-8, but we don't rely on that default lookup at
 * all - we load the file ourselves with an explicit
 * {@link InputStreamReader}{@code (in, StandardCharsets.UTF_8)} and hand it to
 * {@link PropertyResourceBundle#PropertyResourceBundle(java.io.Reader)},
 * which is documented to read verbatim from the given Reader. That sidesteps
 * the whole default-charset question instead of depending on it.
 *
 * <h2>Active locale</h2>
 * There is no per-user locale preference anywhere in this app today (no
 * {@code Accept-Language} parsing, no profile field), so every call site uses
 * the default-Croatian convenience overloads ({@link #t(String, Object...)}).
 * The {@link Locale}-parametrized overloads exist so wiring up real locale
 * switching later is a small addition (pass a resolved {@code Locale}
 * through), not a rewrite.
 */
@ApplicationScoped
public class MessageService {

    /** Default locale for every call site until a real locale-selection
     *  mechanism exists (see class javadoc). */
    public static final Locale DEFAULT_LOCALE = Locale.forLanguageTag("hr");

    private static final String BASE_NAME = "i18n.messages";

    /** One cached bundle per locale's language tag - bundles are immutable
     *  once loaded, so this never needs to be invalidated. */
    private final Map<String, ResourceBundle> bundles = new ConcurrentHashMap<>();

    /** Resolve {@code key} for {@link #DEFAULT_LOCALE} (Croatian), substituting
     *  {@code args} via {@link MessageFormat} (e.g. {@code {0}}, {@code {1}}). */
    public String t(String key, Object... args) {
        return t(DEFAULT_LOCALE, key, args);
    }

    /** Resolve {@code key} for the given {@code locale}, substituting
     *  {@code args} via {@link MessageFormat}. Falls back to the key itself
     *  (wrapped in {@code ???}) when missing, so a typo'd key surfaces loudly
     *  in testing instead of silently breaking a response. */
    public String t(Locale locale, String key, Object... args) {
        ResourceBundle bundle = bundleFor(locale);
        String pattern;
        try {
            pattern = bundle.getString(key);
        } catch (java.util.MissingResourceException e) {
            return "???" + key + "???";
        }
        if (args == null || args.length == 0) return pattern;
        return new MessageFormat(pattern, locale).format(args);
    }

    private ResourceBundle bundleFor(Locale locale) {
        String lang = locale != null && !locale.getLanguage().isBlank()
                ? locale.getLanguage()
                : DEFAULT_LOCALE.getLanguage();
        return bundles.computeIfAbsent(lang, this::loadBundle);
    }

    private ResourceBundle loadBundle(String lang) {
        String path = "/" + BASE_NAME.replace('.', '/') + "_" + lang + ".properties";
        try (InputStream in = MessageService.class.getResourceAsStream(path)) {
            if (in == null) {
                if (!lang.equals(DEFAULT_LOCALE.getLanguage())) {
                    return loadBundle(DEFAULT_LOCALE.getLanguage());
                }
                throw new IllegalStateException("Missing message bundle: " + path);
            }
            return new PropertyResourceBundle(new InputStreamReader(in, StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read message bundle: " + path, e);
        }
    }
}
