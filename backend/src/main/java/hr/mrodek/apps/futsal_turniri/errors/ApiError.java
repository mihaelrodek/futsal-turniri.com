package hr.mrodek.apps.futsal_turniri.errors;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;

/**
 * Uniform error envelope returned by all {@link jakarta.ws.rs.ext.ExceptionMapper}s.
 *
 * @param code    short machine-readable code (e.g. "NOT_FOUND", "VALIDATION_FAILED")
 * @param message human-readable summary
 * @param details optional map of per-field errors (used for validation failures)
 * @param timestamp server-side timestamp, useful for correlating with logs
 */
public record ApiError(
        String code,
        String message,
        Map<String, List<String>> details,
        OffsetDateTime timestamp
) {
    public static ApiError of(String code, String message) {
        return new ApiError(code, message, null, OffsetDateTime.now());
    }

    public static ApiError of(String code, String message, Map<String, List<String>> details) {
        return new ApiError(code, message, details, OffsetDateTime.now());
    }
}
