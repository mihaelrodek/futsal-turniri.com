package hr.mrodek.apps.futsal_turniri.errors;

import jakarta.inject.Inject;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.logging.Logger;

/**
 * Fallback mapper for anything not caught by a more-specific
 * {@link ExceptionMapper}. Returns a generic 500 without leaking the stack
 * trace to the client; the full exception is logged server-side.
 *
 * <p>{@link WebApplicationException}s are passed through unchanged so
 * framework-raised errors (404 from unknown routes, 415 from wrong
 * content-type, etc.) keep their original response - but we now also
 * <em>audit-log</em> the security-relevant statuses (401 / 403) at WARN
 * with the caller's JWT subject + request path. Without this, a credential
 * stuffing or IDOR-probing campaign would leave zero traces in our logs.
 */
@Provider
public class GenericExceptionMapper implements ExceptionMapper<RuntimeException> {

    private static final Logger LOG = Logger.getLogger(GenericExceptionMapper.class);

    @Context UriInfo uriInfo;
    @Inject JsonWebToken jwt;

    @Override
    public Response toResponse(RuntimeException ex) {
        if (ex instanceof WebApplicationException wae) {
            int status = wae.getResponse().getStatus();
            // Audit log security-relevant statuses so we can spot probing
            // / abuse in the access logs. WARN level keeps them visible
            // even when the app logs at INFO; the message itself contains
            // no secret material (path, subject, reason - JWT secrets
            // never logged).
            if (status == 401 || status == 403) {
                String path = uriInfo != null ? uriInfo.getPath() : "?";
                String sub = "anonymous";
                try {
                    if (jwt != null && jwt.getName() != null) {
                        sub = jwt.getSubject();
                    }
                } catch (Exception ignored) {
                    // jwt may not be in a request context - fine, stay anonymous
                }
                LOG.warnf("AUTHZ %d %s subject=%s reason=%s",
                        status, path, sub, ex.getMessage());
            }
            return wae.getResponse();
        }
        LOG.error("Unhandled exception reaching REST boundary", ex);
        return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                .type(MediaType.APPLICATION_JSON)
                .entity(ApiError.of("INTERNAL_ERROR", "An unexpected error occurred"))
                .build();
    }
}
