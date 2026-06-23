package hr.mrodek.apps.futsal_turniri.errors;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

/**
 * Thrown by service code when caller data is structurally valid but
 * semantically wrong (e.g. "round does not belong to tournament").
 * Map to 400 Bad Request.
 */
@Provider
public class IllegalArgumentExceptionMapper implements ExceptionMapper<IllegalArgumentException> {

    @Override
    public Response toResponse(IllegalArgumentException ex) {
        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON)
                .entity(ApiError.of("BAD_REQUEST", ex.getMessage() != null ? ex.getMessage() : "Bad request"))
                .build();
    }
}
