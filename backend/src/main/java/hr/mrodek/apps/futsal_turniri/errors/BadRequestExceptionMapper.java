package hr.mrodek.apps.futsal_turniri.errors;

import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

/**
 * Surfaces the message of a {@link BadRequestException} to the client.
 *
 * <p>Plain {@code new BadRequestException("…")} builds a 400 with an EMPTY
 * body - the message lives only on the Java exception and never reaches the
 * HTTP response, so the SPA could only show a generic "bad request" fallback.
 * This mapper (more specific than {@link GenericExceptionMapper}, which would
 * otherwise pass the bodyless response through) re-wraps the message into the
 * standard {@link ApiError} envelope so the frontend toast shows the actual
 * reason - e.g. "Sve utakmice grupne faze moraju imati upisan rezultat prije
 * eliminacije" when generating the knockout bracket too early.
 */
@Provider
public class BadRequestExceptionMapper implements ExceptionMapper<BadRequestException> {

    @Override
    public Response toResponse(BadRequestException ex) {
        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.APPLICATION_JSON)
                .entity(ApiError.of("BAD_REQUEST",
                        ex.getMessage() != null ? ex.getMessage() : "Bad request"))
                .build();
    }
}
