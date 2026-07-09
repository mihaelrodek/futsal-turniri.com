package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.EmailForUsernameRequest;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import hr.mrodek.apps.futsal_turniri.services.SlugService;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;

import java.util.Map;

/**
 * Public (anonymous) auth-helper endpoints. Firebase Auth has no concept of
 * usernames, so username uniqueness (registration) and username→email lookup
 * (login) are handled here. Anonymous by design - usernames are public
 * handles; the edge rate limit (Caddy) bounds abuse/enumeration.
 */
@Path("/auth")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AuthController {

    @Inject SlugService slugService;
    @Inject UserProfileRepository profileRepo;

    /**
     * Live username-availability check for the registration form. Returns the
     * normalized form (exactly what will be stored) plus whether it's free /
     * too short, so the UI can show the final handle and gate the submit.
     */
    @GET
    @Path("/username-available")
    public Map<String, Object> usernameAvailable(@QueryParam("u") String u) {
        if (u == null || u.isBlank()) {
            return Map.of("normalized", "", "available", false, "tooShort", true);
        }
        String normalized = slugService.normalizeUsername(u);
        boolean tooShort = normalized == null || normalized.length() < SlugService.MIN_USERNAME_LENGTH;
        boolean available = !tooShort && slugService.isUsernameAvailable(normalized, null);
        return Map.of(
                "normalized", normalized == null ? "" : normalized,
                "available", available,
                "tooShort", tooShort);
    }

    /**
     * Resolve a username to its account email so the SPA can complete a Firebase
     * email/password sign-in (Firebase can't authenticate by username). 404 when
     * the username is unknown or carries no email.
     *
     * <p>NOTE: this necessarily reveals the email behind a username (email
     * enumeration) - inherent to username-login on Firebase, since the client
     * must know the email to sign in. Bounded by the edge rate limit.
     */
    @POST
    @Path("/email-for-username")
    public Map<String, String> emailForUsername(@Valid EmailForUsernameRequest body) {
        if (body == null || body.username() == null || body.username().isBlank()) {
            throw new NotFoundException();
        }
        String normalized = slugService.normalizeUsername(body.username());
        String email = profileRepo.findBySlug(normalized)
                .map(UserProfile::getEmail)
                .filter(e -> e != null && !e.isBlank())
                .orElseThrow(NotFoundException::new);
        return Map.of("email", email);
    }
}
