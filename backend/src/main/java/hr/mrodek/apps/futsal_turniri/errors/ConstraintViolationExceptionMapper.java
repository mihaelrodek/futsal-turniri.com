package hr.mrodek.apps.futsal_turniri.errors;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Maps JSR-303 validation failures to a 400 with a per-field error map.
 * The property path is shortened to the leaf name so consumers don't have to
 * parse JAX-RS-flavoured paths like "create.req.name".
 */
@Provider
public class ConstraintViolationExceptionMapper implements ExceptionMapper<ConstraintViolationException> {

    @Override
    public Response toResponse(ConstraintViolationException ex) {
        Map<String, List<String>> details = new LinkedHashMap<>();

        for (ConstraintViolation<?> cv : ex.getConstraintViolations()) {
            String field = leafName(cv.getPropertyPath().toString());
            details.computeIfAbsent(field, k -> new ArrayList<>()).add(cv.getMessage());
        }

        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON)
                .entity(ApiError.of("VALIDATION_FAILED", "Request validation failed", details))
                .build();
    }

    private static String leafName(String path) {
        if (path == null || path.isEmpty()) return "_";
        int i = path.lastIndexOf('.');
        return (i < 0) ? path : path.substring(i + 1);
    }
}
