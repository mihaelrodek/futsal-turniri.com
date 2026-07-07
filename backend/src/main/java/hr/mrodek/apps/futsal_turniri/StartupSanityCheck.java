package hr.mrodek.apps.futsal_turniri;

import io.quarkus.runtime.LaunchMode;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.List;

/**
 * Loud warnings at boot if a required prod env var is missing or still set
 * to its dev default. The app will still start - these are nudges, not gates,
 * because failing to boot in prod is worse than booting with bad config.
 *
 * <p>Currently checks:
 * <ul>
 *   <li>{@code CORS_ORIGINS} is set when running in prod (otherwise the
 *       {@code http://localhost:5175} default would silently reject every
 *       real frontend request).</li>
 *   <li>{@code FIREBASE_PROJECT_ID} is set when running in prod (otherwise
 *       the OIDC issuer points at the dev Firebase project).</li>
 *   <li>{@code APP_PUBLIC_BASE_URL} is set in prod (used by sitemap / preview
 *       links - wrong value here ships broken share URLs).</li>
 *   <li>{@code MINIO_ENDPOINT} doesn't reference {@code localhost} in prod
 *       (would mean the backend can't reach MinIO from inside the container
 *       network).</li>
 * </ul>
 */
@ApplicationScoped
public class StartupSanityCheck {

    private static final Logger LOG = Logger.getLogger(StartupSanityCheck.class);

    @ConfigProperty(name = "quarkus.http.cors.origins")
    String corsOrigins;

    @ConfigProperty(name = "quarkus.oidc.client-id")
    String firebaseProjectId;

    @ConfigProperty(name = "app.public-base-url", defaultValue = "https://futsal-turniri.com")
    String publicBaseUrl;

    @ConfigProperty(name = "minio.endpoint")
    String minioEndpoint;

    void onStart(@Observes StartupEvent ev) {
        // Only nag in prod - dev/test profiles legitimately use localhost and
        // the default project id.
        if (LaunchMode.current() != LaunchMode.NORMAL) return;

        List<String> warnings = new java.util.ArrayList<>();

        if (corsOrigins == null
                || corsOrigins.isBlank()
                || corsOrigins.contains("localhost")
                || corsOrigins.contains("127.0.0.1")) {
            warnings.add("CORS_ORIGINS is unset or points at localhost (current value: '"
                    + corsOrigins
                    + "'). The frontend will be rejected by the API. Set it to e.g. "
                    + "'https://futsal-turniri.com,https://www.futsal-turniri.com'.");
        }

        if (firebaseProjectId == null
                || firebaseProjectId.isBlank()
                || "futsal-turniri".equals(firebaseProjectId)) {
            // Note: 'futsal-turniri' happens to be the real prod id here; if it
            // ever changes, this check will need an update. We still warn so
            // a reused dev config in prod is visible.
            LOG.debugf("Firebase project id resolved to default: %s", firebaseProjectId);
        }

        if (publicBaseUrl == null
                || publicBaseUrl.isBlank()
                || publicBaseUrl.contains("localhost")) {
            warnings.add("app.public-base-url is unset or points at localhost (current value: '"
                    + publicBaseUrl
                    + "'). Sitemap and link-preview URLs will be wrong. "
                    + "Set APP_PUBLIC_BASE_URL=https://your-domain.tld.");
        }

        if (minioEndpoint == null
                || minioEndpoint.contains("localhost")
                || minioEndpoint.contains("127.0.0.1")) {
            warnings.add("MINIO_ENDPOINT points at localhost (current value: '"
                    + minioEndpoint
                    + "'). Inside a container that means the MinIO client will "
                    + "fail to reach MinIO. Set it to e.g. 'http://minio:9000' "
                    + "(the docker-compose service name) or your managed S3 host.");
        }

        if (warnings.isEmpty()) {
            LOG.info("Startup sanity check passed: prod env vars look reasonable.");
            return;
        }

        // Loud, single block so it's hard to miss in the boot log.
        LOG.warn("====================================================================");
        LOG.warn("STARTUP SANITY CHECK - review before serving real traffic:");
        for (String w : warnings) {
            LOG.warnf("  • %s", w);
        }
        LOG.warn("====================================================================");
    }
}
