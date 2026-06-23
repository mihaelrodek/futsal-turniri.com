package hr.mrodek.apps.futsal_turniri.errors;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

import java.util.NoSuchElementException;

/** Turns NoSuchElementException into a clean 404. */
@Provider
public class NotFoundExceptionMapper implements ExceptionMapper<NoSuchElementException> {

    @Override
    public Response toResponse(NoSuchElementException ex) {
        return Response.status(Response.Status.NOT_FOUND)
                .type(MediaType.APPLICATION_JSON)
                .entity(ApiError.of("NOT_FOUND", ex.getMessage() != null ? ex.getMessage() : "Resource not found"))
                .build();
    }
}
