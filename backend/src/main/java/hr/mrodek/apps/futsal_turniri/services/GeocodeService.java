package hr.mrodek.apps.futsal_turniri.services;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;

/**
 * Forward geocoding via OpenStreetMap Nominatim.
 * <p>
 * Free, no API key required, but the
 * <a href="https://operations.osmfoundation.org/policies/nominatim/">usage policy</a>
 * requires:
 *   - max 1 request per second
 *   - a valid User-Agent identifying this application
 *   - no bulk geocoding
 * <p>
 * We satisfy this by geocoding lazily — once per tournament create/update,
 * and via a manual backfill endpoint that yields between requests.
 */
@ApplicationScoped
public class GeocodeService {

    private static final Logger LOG = Logger.getLogger(GeocodeService.class);

    @ConfigProperty(name = "geocode.user-agent", defaultValue = "futsal-turniri.com/1.0 (mihael.rodek1@gmail.com)")
    String userAgent;

    @ConfigProperty(name = "geocode.endpoint", defaultValue = "https://nominatim.openstreetmap.org/search")
    String endpoint;

    @ConfigProperty(name = "geocode.country-codes", defaultValue = "hr,ba,si,rs,me")
    String countryCodes;

    @Inject
    ObjectMapper json;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();

    public record LatLng(double latitude, double longitude) {}

    /**
     * Resolve a free-text location string into coordinates.
     * Returns empty if the input is blank, the lookup fails, or no result is found.
     */
    public Optional<LatLng> geocode(String location) {
        if (location == null || location.isBlank()) return Optional.empty();

        String url = endpoint
                + "?format=json"
                + "&limit=1"
                + "&countrycodes=" + URLEncoder.encode(countryCodes, StandardCharsets.UTF_8)
                + "&q=" + URLEncoder.encode(location.trim(), StandardCharsets.UTF_8);

        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(10))
                .header("User-Agent", userAgent)
                .header("Accept", "application/json")
                .header("Accept-Language", "hr,en")
                .GET()
                .build();

        try {
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                LOG.warnf("Nominatim returned status %d for '%s'", res.statusCode(), location);
                return Optional.empty();
            }
            JsonNode arr = json.readTree(res.body());
            if (!arr.isArray() || arr.isEmpty()) {
                LOG.debugf("Nominatim found no result for '%s'", location);
                return Optional.empty();
            }
            JsonNode first = arr.get(0);
            double lat = Double.parseDouble(first.get("lat").asText());
            double lon = Double.parseDouble(first.get("lon").asText());
            return Optional.of(new LatLng(lat, lon));
        } catch (Exception e) {
            LOG.warnf(e, "Geocoding failed for '%s'", location);
            return Optional.empty();
        }
    }
}
