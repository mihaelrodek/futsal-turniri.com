package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.StreamPresenceRequest;
import hr.mrodek.apps.futsal_turniri.services.StreamPresenceService;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.Map;

/**
 * "How many people are watching the stream right now" counter.
 *
 * <p>Public and provider-agnostic: since a Veo/HLS court camera exposes no
 * viewer-count API, the SPA heartbeats this endpoint from every open stream tab
 * and we report how many distinct sessions are currently active
 * ({@link StreamPresenceService}). Always {@code no-store} - the count changes
 * constantly and must never be served stale from a cache/SW.
 */
@Path("/stream-presence")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class StreamPresenceController {

    @Inject StreamPresenceService presence;

    /** Heartbeat for one viewer session; returns the current count {@code {count}}. */
    @POST
    @Path("/ping")
    public Response ping(StreamPresenceRequest req) {
        int count = presence.heartbeat(req == null ? null : req.sessionId());
        return Response.ok(Map.of("count", count))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .build();
    }

    /** Read-only current count {@code {count}} (no heartbeat). */
    @GET
    public Response count() {
        return Response.ok(Map.of("count", presence.count()))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .build();
    }
}
