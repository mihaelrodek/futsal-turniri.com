package hr.mrodek.apps.futsal_turniri.errors;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

/**
 * Domain guard-clauses throw IllegalStateException when the operation is
 * forbidden by current state (e.g. "next round already started, cannot buy
 * extra life"). Map to 409 Conflict - the request is syntactically valid
 * but the resource's state makes it inapplicable.
 */
@Provider
public class IllegalStateExceptionMapper implements ExceptionMapper<IllegalStateException> {

    @Override
    public Response toResponse(IllegalStateException ex) {
        return Response.status(Response.Status.CONFLICT)
                .type(MediaType.APPLICATION_JSON)
                .entity(ApiError.of("CONFLICT", ex.getMessage() != null ? ex.getMessage() : "Operation not allowed in current state"))
                .build();
    }
}
