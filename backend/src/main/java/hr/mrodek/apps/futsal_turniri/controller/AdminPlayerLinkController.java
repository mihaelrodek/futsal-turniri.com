package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.services.PlayerProfileLinker;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/**
 * Manual trigger for the roster ⇄ profile linking pass.
 *
 * <p>The same pass runs by itself - at boot and on every roster save, profile
 * registration and login - so this exists for the case where an admin has just
 * merged team names or fixed a typo'd roster and wants the profiles updated
 * now rather than at the next write. Idempotent: already-linked rows are
 * skipped, ambiguous names (two registered users with the same name) are
 * counted and left alone for the manual claim-request flow.
 */
@Path("/admin/player-links")
@RolesAllowed("admin")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AdminPlayerLinkController {

    @Inject PlayerProfileLinker linker;

    @POST
    @Path("/backfill")
    public PlayerProfileLinker.LinkResult backfill() {
        return linker.backfillAll();
    }
}
