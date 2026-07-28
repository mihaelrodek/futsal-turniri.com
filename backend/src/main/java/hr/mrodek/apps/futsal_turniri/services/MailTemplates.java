package hr.mrodek.apps.futsal_turniri.services;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Loads email body fragments from classpath resources
 * ({@code src/main/resources/mail/*.html}) and does simple {@code {{token}}}
 * substitution - deliberately no template engine dependency (no Qute), so
 * there is no build-time step that "DO NOT run mvn" leaves unverified.
 *
 * <p>Templates are plain HTML with {@code {{key}}} placeholders. Callers are
 * responsible for HTML-escaping any user-supplied value before it goes into
 * {@code vars} (see {@link EmailService#escapeHtml}) - this class does no
 * escaping of its own, exactly like the inline string concatenation it
 * replaces.
 */
public final class MailTemplates {

    private MailTemplates() {}

    /** Renders {@code /mail/{templateName}.html}, substituting every {@code {{key}}} in vars. */
    public static String render(String templateName, Map<String, String> vars) {
        String tpl = load(templateName);
        for (var entry : vars.entrySet()) {
            tpl = tpl.replace("{{" + entry.getKey() + "}}", entry.getValue() == null ? "" : entry.getValue());
        }
        return tpl;
    }

    private static String load(String templateName) {
        String path = "/mail/" + templateName + ".html";
        try (InputStream in = MailTemplates.class.getResourceAsStream(path)) {
            if (in == null) throw new IllegalStateException("Missing mail template: " + path);
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to read mail template: " + path, e);
        }
    }
}
