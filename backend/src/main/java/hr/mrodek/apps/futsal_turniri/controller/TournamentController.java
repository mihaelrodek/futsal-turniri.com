package hr.mrodek.apps.futsal_turniri.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import hr.mrodek.apps.futsal_turniri.dtos.*;
import hr.mrodek.apps.futsal_turniri.dtos.SelfRegisterTeamRequest;
import hr.mrodek.apps.futsal_turniri.enums.MatchEventType;
import hr.mrodek.apps.futsal_turniri.enums.MatchLiveMode;
import hr.mrodek.apps.futsal_turniri.enums.MatchStage;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.mappers.MatchEventMapper;
import hr.mrodek.apps.futsal_turniri.mappers.PlayerMapper;
import hr.mrodek.apps.futsal_turniri.mappers.RoundMatchMapper;
import hr.mrodek.apps.futsal_turniri.mappers.TeamMapper;
import hr.mrodek.apps.futsal_turniri.mappers.TournamentMapper;
import hr.mrodek.apps.futsal_turniri.model.MatchEvent;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Resources;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.MatchEventRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import hr.mrodek.apps.futsal_turniri.repository.PlayersRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.RoundsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserTeamPresetRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import hr.mrodek.apps.futsal_turniri.services.*;
import io.quarkus.security.Authenticated;
import jakarta.annotation.security.RolesAllowed;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.eclipse.microprofile.jwt.JsonWebToken;
import jakarta.validation.Valid;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;

import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Path("/tournaments")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class TournamentController {

    @Inject TournamentMapper tournamentMapper;
    @Inject TeamMapper teamMapper;
    @Inject PlayerMapper playerMapper;
    @Inject RoundMatchMapper roundMatchMapper;
    @Inject MatchEventMapper matchEventMapper;
    @Inject ObjectMapper objectMapper;
    @Inject StorageService storageService;
    @Inject GeocodeService geocodeService;
    @Inject SlugService slugService;
    @Inject TournamentSlugService tournamentSlugService;
    @Inject PushService pushService;
    @Inject hr.mrodek.apps.futsal_turniri.services.EmailService emailService;

    @Inject TournamentsRepository tournamentsRepo;
    @Inject TeamsRepository teamRepo;
    @Inject PlayersRepository playerRepo;
    @Inject RoundsRepository roundsRepo;
    @Inject MatchesRepository matchesRepo;
    @Inject MatchEventRepository matchEventRepo;
    @Inject UserProfileRepository userProfileRepo;
    @Inject UserTeamPresetRepository userTeamPresetRepo;

    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;

    /** Pushes "live data changed" pings over WebSocket so /uzivo + fullscreen
     *  refetch instantly instead of waiting for their poll. */
    @Inject hr.mrodek.apps.futsal_turniri.realtime.LiveBroadcaster liveBroadcaster;

    /** Public base URL (e.g. https://futsal-turniri.com) - used to build the
     *  tournament link the QR code encodes. */
    @org.eclipse.microprofile.config.inject.ConfigProperty(
            name = "app.public-base-url", defaultValue = "https://futsal-turniri.com")
    String publicBaseUrl;

    /**
     * Best-effort display name from the verified ID token. Prefers the
     * Firebase {@code name} claim, falls back to {@code email}, otherwise
     * null. Shared between {@link #stampCreator} and the lazy profile
     * upsert in self-register.
     */
    private String displayNameFromJwt() {
        if (jwt == null || jwt.getRawToken() == null) return null;
        Object name = jwt.getClaim("name");
        if (name != null) return name.toString();
        Object email = jwt.getClaim("email");
        return email != null ? email.toString() : null;
    }

    /**
     * Stamp the current Firebase user as the creator of a tournament.
     * Reads the verified ID-token claims for UID and display name.
     * Falls back to email when no `name` is set (e.g. email/password signup
     * without a profile name).
     */
    private void stampCreator(Tournaments t) {
        if (jwt == null || jwt.getRawToken() == null) return;
        t.setCreatedByUid(jwt.getSubject());
        t.setCreatedByName(displayNameFromJwt());
    }

    /**
     * Throw 403 if the current user is neither the tournament's creator nor
     * an admin. Legacy tournaments without a creator can only be edited by
     * admins, since we have no original owner to defer to.
     */
    private void assertCanEdit(Tournaments t) {
        boolean admin = identity != null && identity.hasRole("admin");
        if (admin) return;
        String me = jwt != null ? jwt.getSubject() : null;
        boolean owner = me != null && me.equals(t.getCreatedByUid());
        if (!owner) {
            throw new jakarta.ws.rs.ForbiddenException("Only the creator or an admin can modify this tournament.");
        }
    }

    /**
     * Visibility gate for admin-hidden tournaments: visible to everyone when
     * not hidden; when hidden, only to the creator and admins. Works on
     * public endpoints too - with no bearer token the identity is anonymous
     * and this simply returns {@code !t.isHidden()}.
     */
    private boolean canView(Tournaments t) {
        if (!t.isHidden()) return true;
        boolean admin = identity != null && identity.hasRole("admin");
        if (admin) return true;
        String me = jwt != null ? jwt.getSubject() : null;
        return me != null && me.equals(t.getCreatedByUid());
    }

    /** Resolve location → lat/lng on create / update. Failure is non-fatal. */
    private void applyGeocoding(Tournaments t) {
        var loc = t.getLocation();
        if (loc == null || loc.isBlank()) {
            t.setLatitude(null);
            t.setLongitude(null);
            t.setGeocodedAt(null);
            return;
        }
        geocodeService.geocode(loc).ifPresentOrElse(
                ll -> {
                    t.setLatitude(ll.latitude());
                    t.setLongitude(ll.longitude());
                    t.setGeocodedAt(OffsetDateTime.now());
                },
                () -> {
                    // keep any previous coords if lookup failed; but stamp the attempt
                    t.setGeocodedAt(OffsetDateTime.now());
                }
        );
    }

    /* ===================== Create ===================== */

    /**
     * Reject a request with a startAt in the past. Mirrors the frontend's
     * {@code min} attribute and submit-time check - both layers exist
     * because either can be bypassed (custom client, slow form-fill).
     * Allows a 5-minute slack so clock skew between client and server
     * doesn't reject borderline-valid creates.
     */
    private static void assertStartInFuture(OffsetDateTime startAt) {
        if (startAt == null) return; // null is handled by other validation
        OffsetDateTime cutoff = OffsetDateTime.now().minusMinutes(5);
        if (startAt.isBefore(cutoff)) {
            throw new BadRequestException("Datum i vrijeme turnira ne mogu biti u prošlosti.");
        }
    }

    @POST
    @Authenticated
    @Transactional
    public Response create(@Valid CreateTournamentRequest req) {
        assertStartInFuture(req.startAt());
        Tournaments t = tournamentMapper.toEntity(req);
        stampCreator(t);
        applyGeocoding(t);
        // Generate slug before save so the unique index sees it on first
        // INSERT - the entity already has name + startAt populated by the
        // mapper at this point.
        t.setSlug(tournamentSlugService.generateUnique(t, null));
        Tournaments saved = tournamentsRepo.save(t);
        return Response.created(URI.create("/tournaments/" + saved.getSlug()))
                .entity(tournamentMapper.toDetails(saved))
                .build();
    }

    @POST
    @Path("/multipart")
    @Authenticated
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Transactional
    public Response createMultipart(
            @RestForm("data") String data,          // JSON string for CreateTournamentRequest
            @RestForm("poster") FileUpload poster   // optional image file
    ) {
        if (data == null || data.isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("Missing 'data' part").build();
        }

        final CreateTournamentRequest req;
        try {
            req = objectMapper.readValue(data, CreateTournamentRequest.class);
        } catch (Exception ex) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("Invalid JSON in 'data' part").build();
        }

        if (req.name() == null || req.name().trim().isEmpty()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("name is required").build();
        }
        assertStartInFuture(req.startAt());

        Tournaments t = tournamentMapper.toEntity(req);
        stampCreator(t);

        if (poster != null && poster.size() > 0) {
            Resources r = storageService.uploadPoster(poster);
            t.setResource(r);
        }

        applyGeocoding(t);
        t.setSlug(tournamentSlugService.generateUnique(t, null));
        Tournaments saved = tournamentsRepo.save(t);
        URI location = URI.create("/tournaments/" + saved.getSlug());
        return Response.created(location)
                .entity(tournamentMapper.toDetails(saved))
                .build();
    }

    /* ===================== Poster (edit) ===================== */

    /**
     * Replace the tournament's poster with the uploaded file. Owner-only.
     * Mirrors the multipart path in createMultipart but scoped to an
     * existing tournament. The previous Resources row is left in place;
     * StorageService is responsible for any retention/cleanup policy.
     */
    @POST
    @Path("/{uuid}/poster")
    @Authenticated
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Transactional
    public Response updatePoster(
            @PathParam("uuid") String uuid,
            @RestForm("poster") FileUpload poster
    ) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);
        if (poster == null || poster.size() == 0) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("Missing 'poster' file part").build();
        }
        Resources r = storageService.uploadPoster(poster);
        t.setResource(r);
        t.setUpdatedAt(OffsetDateTime.now());
        return Response.ok(tournamentMapper.toDetails(t)).build();
    }

    /** Remove the tournament's poster. Owner-only. */
    @DELETE
    @Path("/{uuid}/poster")
    @Authenticated
    @Transactional
    public Response deletePoster(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);
        t.setResource(null);
        t.setUpdatedAt(OffsetDateTime.now());
        return Response.ok(tournamentMapper.toDetails(t)).build();
    }

    /* ===================== Update ===================== */

    @PUT
    @Path("/{uuid}")
    @Authenticated
    @Transactional
    public Response update(@PathParam("uuid") String uuid, @Valid CreateTournamentRequest req) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);
        // Block moving the date into the past on edit too. Editing a
        // currently-running or finished tournament's date isn't sensible.
        assertStartInFuture(req.startAt());

        // Mapper applies all updatable fields in place. Status, winner and poster
        // are intentionally NOT touched here - they're owned by dedicated
        // endpoints (/start, /finish, /reset, /multipart).
        String previousLocation = t.getLocation();
        String previousName = t.getName();
        OffsetDateTime previousStartAt = t.getStartAt();

        // Format is editable, but only while no fixtures exist yet. Once the
        // draw / schedule has produced matches, changing the format would
        // desync the generated groups / bracket - so snapshot the current
        // format config and restore it after the mapping if matches exist.
        boolean hasFixtures = matchesRepo.count("tournament.id = ?1", t.getId()) > 0;
        var prevFormat = t.getFormat();
        var prevGroupCount = t.getGroupCount();
        var prevAdvancePerGroup = t.getAdvancePerGroup();
        var prevBracketFill = t.getBracketFill();

        tournamentMapper.applyUpdate(t, req);

        if (hasFixtures) {
            t.setFormat(prevFormat);
            t.setGroupCount(prevGroupCount);
            t.setAdvancePerGroup(prevAdvancePerGroup);
            t.setBracketFill(prevBracketFill);
        }
        t.setUpdatedAt(OffsetDateTime.now());

        // Re-geocode only when the location actually changed - saves Nominatim hits.
        if (!java.util.Objects.equals(previousLocation, t.getLocation())) {
            applyGeocoding(t);
        }

        // Regenerate the slug if the name or start date changed - those are the
        // only inputs that go into the slug. We pass the current id so the row's
        // existing slug doesn't trip the uniqueness check against itself.
        boolean nameChanged = !java.util.Objects.equals(previousName, t.getName());
        boolean dateChanged = !java.util.Objects.equals(previousStartAt, t.getStartAt());
        if (nameChanged || dateChanged || t.getSlug() == null || t.getSlug().isBlank()) {
            t.setSlug(tournamentSlugService.generateUnique(t, t.getId()));
        }

        return Response.ok(tournamentMapper.toDetails(t)).build();
    }

    /**
     * Soft-delete a tournament. Owner-or-admin (same gate as every other
     * mutation). Flips {@code is_deleted}; combined with the class-level
     * {@code @Where(is_deleted = false)} the row instantly disappears from
     * every read (lists, map, sitemap, live) while matches/teams/history stay
     * intact in the DB for a possible manual restore.
     *
     * <p>This endpoint was missing entirely - the SPA (owner "Obriši turnir"
     * and the admin dashboard) has always called {@code DELETE
     * /tournaments/{uuid}} and got 405, so deleting never worked.
     */
    @DELETE
    @Path("/{uuid}")
    @Authenticated
    @Transactional
    public Response delete(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);

        t.setDeleted(true);
        t.setUpdatedAt(OffsetDateTime.now());
        // A deleted tournament must not linger as the daily highlight.
        t.setFeaturedAt(null);
        return Response.noContent().build();
    }

    /**
     * One-shot backfill: geocodes every tournament that has a location but no coords.
     * Sleeps 1s between calls to respect Nominatim's usage policy. Returns a small
     * summary so the operator can see what happened.
     *
     * Admin-only: a regular logged-in user could otherwise pin the request thread
     * for several minutes per call (1s sleep × N tournaments) and burn the shared
     * Nominatim usage budget. The {@code role: "admin"} custom claim is set via
     * {@code scripts/set-admin.mjs}.
     */
    @POST
    @Path("/geocode-missing")
    @RolesAllowed("admin")
    @Transactional
    public Response geocodeMissing() {
        var all = tournamentsRepo.listAll();
        int attempted = 0, resolved = 0, skipped = 0;
        for (var t : all) {
            if (t.getLocation() == null || t.getLocation().isBlank()) { skipped++; continue; }
            if (t.getLatitude() != null && t.getLongitude() != null) { skipped++; continue; }
            applyGeocoding(t);
            attempted++;
            if (t.getLatitude() != null) resolved++;
            try { Thread.sleep(1100); } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        return Response.ok(java.util.Map.of(
                "total", all.size(),
                "attempted", attempted,
                "resolved", resolved,
                "skipped", skipped
        )).build();
    }

    /* ===================== Lifecycle ===================== */

    @PUT
    @Path("/{uuid}/start")
    @Authenticated
    @Transactional
    public Response startTournament(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);

        if (t.getStatus() == TournamentStatus.FINISHED) {
            return Response.status(Response.Status.CONFLICT).entity("ALREADY_FINISHED").build();
        }

        // A tournament needs at least two approved teams to start.
        // Pending self-registered teams are excluded from the count - the
        // organizer must approve them first (otherwise self-registrations
        // could let anyone start a tournament with bogus teams).
        long approvedCount = teamRepo.findByTournament_Id(t.getId()).stream()
                .filter(p -> !p.isPendingApproval())
                .count();
        if (approvedCount < 2) {
            return Response.status(Response.Status.CONFLICT).entity("INSUFFICIENT_TEAMS").build();
        }

        if (t.getStatus() != TournamentStatus.STARTED) {
            t.setStatus(TournamentStatus.STARTED);
            t.setUpdatedAt(OffsetDateTime.now());
        }
        return Response.ok(tournamentMapper.toDetails(t)).build();
    }

    @POST
    @Path("/{uuid}/finish")
    @Authenticated
    @Transactional
    public Response finishTournament(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);

        if (t.getStatus() == TournamentStatus.FINISHED) {
            return Response.ok(tournamentMapper.toDetails(t)).build();
        }

        // Champion = the FINAL match's winner (both knockout formats have a
        // final). We derive it from winnerTeam (a real FK, always set once the
        // final is recorded) rather than the unreliable `eliminated` flag,
        // which the group/knockout flow never maintains. Fall back to the
        // already-set winnerName for any legacy shape without a FINAL match.
        var finalMatch = matchesRepo.find(
                "tournament = ?1 and stage = ?2", t, MatchStage.FINAL).firstResult();
        Teams winner = finalMatch != null && finalMatch.getStatus() == MatchStatus.FINISHED
                ? finalMatch.getWinnerTeam() : null;
        boolean haveChampion = winner != null
                || (t.getWinnerName() != null && !t.getWinnerName().isBlank());
        if (!haveChampion) {
            // Can't finish before the final decides a winner.
            return Response.status(Response.Status.CONFLICT).entity("FINAL_NOT_DECIDED").build();
        }

        // Keep the elimination flags consistent (winner active, rest out) when
        // we know the actual winner team.
        if (winner != null) {
            for (var p : teamRepo.findByTournament_Id(t.getId())) {
                boolean shouldBeEliminated = !Objects.equals(p.getId(), winner.getId());
                if (p.isEliminated() != shouldBeEliminated) {
                    p.setEliminated(shouldBeEliminated);
                }
            }
        }

        t.setStatus(TournamentStatus.FINISHED);
        if (winner != null) t.setWinnerName(winner.getName());
        t.setUpdatedAt(OffsetDateTime.now());

        String winnerName = winner != null ? winner.getName() : t.getWinnerName();

        // Email the tournament's followers the final result. Fire-and-forget:
        // a mail hiccup must not fail the finish. No-op when SMTP is unconfigured.
        try {
            String url = emailService.baseUrl() + "/turniri/"
                    + (t.getSlug() != null ? t.getSlug() : t.getUuid());
            String html = emailService.shell(
                    "Turnir je završen",
                    "<p><strong>" + EmailService.escapeHtml(t.getName()) + "</strong> je završen.</p>"
                            + "<p style=\"font-size:17px;\">🏆 Pobjednik: <strong>"
                            + EmailService.escapeHtml(winnerName) + "</strong></p>"
                            + "<p>Pogledaj konačni poredak, strijelce i statistiku na stranici turnira.</p>",
                    url, "Pogledaj rezultate");
            emailService.sendToTournamentSubscribers(
                    t.getId(), "🏁 Turnir završen - " + t.getName(), html);
        } catch (Exception ignored) {
            // best-effort - the tournament is already finished
        }

        return Response.ok(tournamentMapper.toDetails(t)).build();
    }

    /**
     * Set the 2nd + 3rd place team names after the tournament finishes.
     * Owner or admin only. Both body fields are nullable - a null/blank
     * value clears that column, letting the organiser remove a wrongly-set
     * podium position.
     *
     * <p>Each non-blank name is matched (case-insensitive, trimmed)
     * against the tournament's own team names. Unknown names return
     * 400 - better than silently persisting garbage that the SPA can't
     * highlight on the Parovi tab.
     *
     * <p>Doesn't gate on tournament status. Most organisers will fill
     * the podium right after FINISH, but allowing edits while STARTED
     * (or even on a DRAFT) doesn't hurt and lets the organiser pre-fill
     * if they want.
     */
    @PATCH
    @Path("/{uuid}/podium")
    @Authenticated
    @Transactional
    public Response setPodium(@PathParam("uuid") String uuid,
                              PodiumRequest req) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);

        if (req == null) req = new PodiumRequest(null, null);

        // Build the set of valid team names once (case-insensitive,
        // trimmed) so we can validate both inputs against the same
        // dataset without doing two queries.
        var teamNames = teamRepo.findByTournament_Id(t.getId()).stream()
                .map(p -> p.getName() == null ? null : p.getName().trim().toLowerCase(java.util.Locale.ROOT))
                .filter(s -> s != null && !s.isEmpty())
                .collect(java.util.stream.Collectors.toSet());

        String second = normalisePodiumName(req.secondPlaceName());
        String third  = normalisePodiumName(req.thirdPlaceName());

        if (second != null && !teamNames.contains(second.toLowerCase(java.util.Locale.ROOT))) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("SECOND_PLACE_TEAM_NOT_FOUND").build();
        }
        if (third != null && !teamNames.contains(third.toLowerCase(java.util.Locale.ROOT))) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("THIRD_PLACE_TEAM_NOT_FOUND").build();
        }
        if (second != null && third != null
                && second.equalsIgnoreCase(third)) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("SAME_TEAM_FOR_SECOND_AND_THIRD").build();
        }
        // Don't allow podium to overlap with the gold winner - a single
        // team can't simultaneously be 1st AND (2nd|3rd).
        if (t.getWinnerName() != null) {
            String winner = t.getWinnerName().trim();
            if (second != null && winner.equalsIgnoreCase(second)) {
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity("SECOND_PLACE_EQUALS_WINNER").build();
            }
            if (third != null && winner.equalsIgnoreCase(third)) {
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity("THIRD_PLACE_EQUALS_WINNER").build();
            }
        }

        t.setSecondPlaceName(second);
        t.setThirdPlaceName(third);
        t.setUpdatedAt(OffsetDateTime.now());

        return Response.ok(tournamentMapper.toDetails(t)).build();
    }

    /** Trim + null-out empty strings so the DB stores a clean null. */
    private static String normalisePodiumName(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    /** Uppercase + trim a player name; null/blank → null. */
    private static String normalizePlayerName(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed.toUpperCase(java.util.Locale.ROOT);
    }

    /* ===================== Individual awards ===================== */

    /**
     * Data-driven suggestions for the three end-of-tournament awards. Best
     * scorer + best player come from the goal tally (most goals, podium as
     * tiebreak); best goalkeeper points at the team that went FURTHEST and
     * then conceded the fewest per match (the keeper player can't be inferred,
     * so the organiser picks it). Also returns the full player list so each
     * award can be chosen from a dropdown. Organizer-or-admin only.
     */
    @GET
    @Path("/{uuid}/awards/suggestions")
    @Authenticated
    public Response awardSuggestions(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);

        // Podium rank lookup for tiebreaks: 1 = winner … 3 = bronze, 99 = none.
        java.util.function.Function<String, Integer> podiumRank = (teamName) -> {
            if (teamName == null) return 99;
            String n = teamName.trim();
            if (t.getWinnerName() != null && t.getWinnerName().trim().equalsIgnoreCase(n)) return 1;
            if (t.getSecondPlaceName() != null && t.getSecondPlaceName().trim().equalsIgnoreCase(n)) return 2;
            if (t.getThirdPlaceName() != null && t.getThirdPlaceName().trim().equalsIgnoreCase(n)) return 3;
            return 99;
        };

        // Top scorer - most goals, podium placement as tiebreak.
        AwardSuggestionsDto.Suggestion topScorer = null;
        var goalRows = matchEventRepo.findGoalCountsByTournament(t);
        for (Object[] row : goalRows) {
            var player = (Player) row[0];
            var team = (Teams) row[1];
            long goals = (Long) row[2];
            var cand = new AwardSuggestionsDto.Suggestion(
                    player != null ? player.getName() : null,
                    team != null ? team.getName() : null,
                    goals);
            if (topScorer == null) {
                topScorer = cand;
            } else {
                // goalRows is already goals-desc; only re-rank within equal goals.
                if (cand.goals() == topScorer.goals()
                        && podiumRank.apply(cand.teamName()) < podiumRank.apply(topScorer.teamName())) {
                    topScorer = cand;
                }
            }
        }

        // Best goalkeeper - recommend the team that went FURTHEST, then
        // conceded the fewest per match. Progression dominates: a finalist that
        // conceded 5 outranks a group-stage team that conceded 2. One pass over
        // the FINISHED matches (group + knockout) builds, per team,
        // [conceded, played, progression].
        var acc = new java.util.LinkedHashMap<Long, int[]>();
        var teamById = new java.util.HashMap<Long, Teams>();
        for (Matches m : matchesRepo.list("tournament = ?1 and status = ?2", t, MatchStatus.FINISHED)) {
            Integer s1 = m.getScore1();
            Integer s2 = m.getScore2();
            // A bye/walkover proves the team advanced but has no score - it
            // counts toward progression, not the conceded average.
            boolean scored = s1 != null && s2 != null;
            accumulateGk(acc, teamById, m.getTeam1(), m, scored ? s2 : null);
            accumulateGk(acc, teamById, m.getTeam2(), m, scored ? s1 : null);
        }
        AwardSuggestionsDto.GoalkeeperHint gkHint = null;
        int bestProg = Integer.MIN_VALUE;
        double bestAvg = Double.MAX_VALUE;
        for (var e : acc.entrySet()) {
            int[] r = e.getValue(); // [conceded, played, progression]
            int prog = r[2];
            double avg = r[1] == 0 ? Double.MAX_VALUE : (double) r[0] / r[1];
            if (prog > bestProg || (prog == bestProg && avg < bestAvg)) {
                bestProg = prog;
                bestAvg = avg;
                Teams team = teamById.get(e.getKey());
                gkHint = new AwardSuggestionsDto.GoalkeeperHint(
                        team.getName(), r[0], progressionLabel(prog));
            }
        }

        // Every real player of the tournament, so the organiser can pick each
        // award (MVP / scorer / keeper) from a dropdown.
        var players = new java.util.ArrayList<AwardSuggestionsDto.PlayerOption>();
        for (Object[] row : playerRepo.findByTournamentWithTeamName(t.getId())) {
            players.add(new AwardSuggestionsDto.PlayerOption((String) row[0], (String) row[1]));
        }

        // best player mirrors the top scorer - goals + a deep run is the only
        // signal available; the organiser overrides when they disagree.
        return Response.ok(new AwardSuggestionsDto(topScorer, topScorer, gkHint, players)).build();
    }

    /** Fold one side of a match into the best-goalkeeper accumulator: bump the
     *  team's max progression, and (when {@code conceded} is non-null) add to
     *  its conceded total + played count. */
    private static void accumulateGk(
            java.util.Map<Long, int[]> acc, java.util.Map<Long, Teams> teamById,
            Teams team, Matches m, Integer conceded) {
        if (team == null) return;
        teamById.putIfAbsent(team.getId(), team);
        int[] r = acc.computeIfAbsent(team.getId(), k -> new int[3]);
        boolean won = m.getWinnerTeam() != null
                && m.getWinnerTeam().getId().equals(team.getId());
        int prog = won ? stageWinnerProgression(m.getStage()) : stageProgression(m.getStage());
        if (prog > r[2]) r[2] = prog;
        if (conceded != null) { r[0] += conceded; r[1] += 1; }
    }

    /** Progression score for reaching (playing in) a stage - loser's view.
     *  Higher = further. THIRD_PLACE/FINAL winners get a bump in
     *  {@link #stageWinnerProgression}. Never rank MatchStage by ordinal
     *  (THIRD_PLACE's ordinal sits above FINAL's). */
    private static int stageProgression(MatchStage s) {
        if (s == null) return 0;
        return switch (s) {
            case FINAL -> 11;        // runner-up
            case THIRD_PLACE -> 9;   // 4th (lost the 3rd-place match)
            case SEMIFINAL -> 8;     // only decisive if no 3rd-place match exists
            case QUARTERFINAL -> 6;
            case ROUND_OF_16 -> 4;
            case ROUND_OF_32 -> 2;
            case GROUP -> 0;
        };
    }

    /** Progression score when the team WON that stage's match. */
    private static int stageWinnerProgression(MatchStage s) {
        if (s == MatchStage.FINAL) return 12;        // champion
        if (s == MatchStage.THIRD_PLACE) return 10;  // 3rd place
        return stageProgression(s);
    }

    /** Human label for a progression score, shown as the goalkeeper hint. */
    private static String progressionLabel(int prog) {
        return switch (prog) {
            case 12 -> "PRVAK";
            case 11 -> "FINALE";
            case 10 -> "3. MJESTO";
            case 9 -> "4. MJESTO";
            case 8 -> "POLUFINALE";
            case 6 -> "ČETVRTFINALE";
            case 4 -> "OSMINA FINALA";
            case 2 -> "ŠESNAESTINA FINALA";
            default -> "SKUPINA";
        };
    }

    /**
     * Persist the three individual awards. Names are uppercased + trimmed
     * (matching roster storage); blank clears the award. Organizer-or-admin
     * only.
     */
    @POST
    @Path("/{uuid}/awards")
    @Authenticated
    @Transactional
    public Response setAwards(@PathParam("uuid") String uuid, AwardsRequest req) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);

        if (req == null) req = new AwardsRequest(null, null, null);
        t.setBestGoalkeeperName(normalizePlayerName(req.bestGoalkeeperName()));
        t.setBestPlayerName(normalizePlayerName(req.bestPlayerName()));
        t.setBestScorerName(normalizePlayerName(req.bestScorerName()));
        t.setUpdatedAt(OffsetDateTime.now());

        return Response.ok(tournamentMapper.toDetails(t)).build();
    }

    @POST
    @Path("/{uuid}/reset")
    @Authenticated
    @Transactional
    public Response resetTournament(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);

        // 1) Delete all matches first (avoid FK issues), then rounds
        matchesRepo.deleteByTournament(t);
        roundsRepo.deleteByTournament(t);

        // 2) Zero out team stats and un-eliminate everyone
        var teams = teamRepo.findByTournament_Id(t.getId());
        for (var p : teams) {
            p.setWins(0);
            p.setLosses(0);
            p.setEliminated(false);
        }

        // 3) Reset tournament status and winner
        t.setStatus(TournamentStatus.DRAFT);
        t.setWinnerName(null);
        t.setUpdatedAt(OffsetDateTime.now());

        return Response.ok(tournamentMapper.toDetails(t)).build();
    }

    /* ===================== Read ===================== */

    @GET
    public List<TournamentCardDto> list(
            @QueryParam("status") @DefaultValue("upcoming") String status,
            @QueryParam("offset") @DefaultValue("0") int offset,
            @QueryParam("limit") @DefaultValue("0") int limit) {
        // "finished" means explicit TournamentStatus.FINISHED - date isn't
        // the source of truth (a tournament that started today and is still
        // being scored is in progress, not finished). The other bucket
        // covers DRAFT + STARTED, sorted by startAt ascending so the soonest
        // event is first. Pagination is opt-in via offset/limit: pass
        // limit=0 (default) to get everything, or a positive limit to page.
        final List<Tournaments> items;
        if ("finished".equalsIgnoreCase(status)) {
            if (limit > 0) {
                items = tournamentsRepo.findFinishedPaged(Math.max(0, offset), limit);
            } else {
                items = tournamentsRepo.findFinishedPaged(0, Integer.MAX_VALUE);
            }
        } else {
            items = tournamentsRepo.findNotFinishedOrderByStartAtAsc();
        }

        // Admin-hidden tournaments stay in the list only for their creator
        // and admins (the SPA greys them out); everyone else never sees them.
        List<Tournaments> visible = items.stream().filter(this::canView).toList();

        if (visible.isEmpty()) return List.of();

        List<Long> ids = visible.stream().map(Tournaments::getId).toList();
        Map<Long, Long> counts = teamRepo.countByTournamentIds(ids).stream()
                .collect(Collectors.toMap(
                        r -> (Long) r[0],
                        r -> (Long) r[1]
                ));

        // Tournaments with a match in progress - drives the LIVE badge on cards.
        Set<Long> liveTournamentIds =
                new HashSet<>(matchesRepo.findTournamentIdsWithLiveMatch(ids));

        return tournamentMapper.toCardList(visible, counts, liveTournamentIds);
    }

    /**
     * Lightweight count for paginated finished listings - the SPA hits this
     * once to know whether to render the "Učitaj više" button after the
     * initial page of finished tournaments.
     */
    @GET
    @Path("/count")
    public java.util.Map<String, Long> count(
            @QueryParam("status") @DefaultValue("finished") String status) {
        if ("finished".equalsIgnoreCase(status)) {
            return java.util.Map.of("total", tournamentsRepo.countFinished());
        }
        // Other buckets aren't paged today so they don't need a count.
        return java.util.Map.of("total", 0L);
    }

    /**
     * Public "tournament of the day" lookup. Returns the admin-curated
     * featured tournament as a card DTO, or 204 No Content when none is
     * featured. The SPA's /uzivo hero hits this on page load.
     *
     * <p>Path declared BEFORE the catch-all {@code /{uuid}} so it doesn't
     * get swallowed by the slug matcher.
     */
    @GET
    @Path("/featured")
    public Response getFeatured() {
        return tournamentsRepo.findCurrentlyFeatured()
                .filter(t -> !t.isHidden()) // a hidden tournament can't be the public hero
                .map(t -> {
                    long count = teamRepo.countByTournamentIds(java.util.List.of(t.getId()))
                            .stream()
                            .findFirst()
                            .map(r -> (Long) r[1])
                            .orElse(0L);
                    Set<Long> liveIds = new HashSet<>(
                            matchesRepo.findTournamentIdsWithLiveMatch(java.util.List.of(t.getId())));
                    var card = tournamentMapper.toCardList(
                            java.util.List.of(t),
                            Map.of(t.getId(), count),
                            liveIds).get(0);
                    return Response.ok(card).build();
                })
                .orElseGet(() -> Response.noContent().build());
    }

    /**
     * Whether the roster is locked - i.e. the draw has been generated, so
     * teams may no longer be added or removed. True once any fixtures exist
     * (KNOCKOUT_ONLY bracket / generated schedule) OR any team has been placed
     * into a group (GROUPS_KNOCKOUT draw, even before fixtures). Removing a team
     * past this point would corrupt the groups / bracket, so the team-removal
     * endpoints enforce it too (not just the UI).
     */
    private boolean isRosterLocked(Tournaments t) {
        return matchesRepo.count("tournament.id = ?1", t.getId()) > 0
                || teamRepo.findByTournament_Id(t.getId()).stream()
                        .anyMatch(tm -> tm.getGroup() != null);
    }

    /** Public read of the roster-lock flag - drives the UI's add/remove gating. */
    @GET
    @Path("/{uuid}/roster-locked")
    public Response rosterLocked(@PathParam("uuid") String idOrSlug) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(idOrSlug).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        return Response.ok(java.util.Map.of("locked", isRosterLocked(t))).build();
    }

    @GET
    @Path("/{uuid}")
    public Response getById(@PathParam("uuid") String idOrSlug) {
        // Accepts either a UUID (legacy / shared URLs from before slugs landed)
        // or the new pretty slug, so existing bookmarks keep working.
        // Admin-hidden tournaments 404 for everyone except creator/admin -
        // indistinguishable from not existing (no visibility leak).
        return tournamentsRepo.findByUuidOrSlug(idOrSlug)
                .filter(this::canView)
                .map(tournamentMapper::toDetails)
                .map(dto -> Response.ok(dto).build())
                .orElseGet(() -> Response.status(Response.Status.NOT_FOUND).build());
    }

    /**
     * Server-rendered OG share image (1200×630 PNG) for the link-preview
     * card on social platforms. Wired as {@code og:image} from
     * {@code TournamentPreviewController} when the tournament is FINISHED
     * with a winnerName; the frontend's {@code useDocumentHead} mirrors
     * that for JS-rendered routes.
     *
     * <p>Lives in TournamentController (not a dedicated resource class)
     * so the @Path("/tournaments") root is owned by exactly one class -
     * historically a second resource class with the same root path
     * shadowed every {@code /tournaments/{x}} mapping under RESTEasy's
     * URI-template matcher and produced 404 on the legitimate routes.
     */
    /* =================== Per-tournament push subscriptions ===================
     * Used to live in a dedicated TournamentSubscriptionController, but that
     * class declared {@code @Path("/tournaments/{uuid}")} at the class level
     * and under Quarkus REST (RESTEasy Reactive) a second resource class with
     * the same {@code /tournaments/{uuid}} prefix shadows every sibling
     * route on this controller - so /tournaments/{uuid}, /tournaments/featured,
     * /tournaments/live, etc. all started returning 404. Consolidating the
     * subscribe endpoints here ensures a single resource class owns the
     * {@code /tournaments} URI tree.
     * ===================================================================== */

    @Inject hr.mrodek.apps.futsal_turniri.repository.TournamentSubscriptionRepository subRepo;
    @Inject hr.mrodek.apps.futsal_turniri.repository.MatchSubscriptionRepository matchSubRepo;

    /* ── Per-match push subscriptions ──────────────────────────────────────
     * Same shape as the per-tournament bell, but scoped to a single match so
     * a viewer can be notified the moment THAT match goes live. The push is
     * fired from the /start endpoint via pushService.sendToMatchSubscribers.
     * Lives here (not a separate resource) for the same single-owner reason
     * as the tournament subscription endpoints above. */

    @GET
    @Path("/{uuid}/matches/{matchId}/subscription")
    @io.quarkus.security.Authenticated
    public Response getMatchSubscription(
            @PathParam("uuid") String uuid, @PathParam("matchId") Long matchId) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        String myUid = jwt != null ? jwt.getSubject() : null;
        if (myUid == null || myUid.isBlank()) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        boolean subscribed = matchSubRepo.findByUserUidAndMatchId(myUid, match.getId()).isPresent();
        return Response.ok(java.util.Map.of("subscribed", subscribed)).build();
    }

    @POST
    @Path("/{uuid}/matches/{matchId}/subscribe")
    @io.quarkus.security.Authenticated
    @Transactional
    public Response subscribeMatch(
            @PathParam("uuid") String uuid, @PathParam("matchId") Long matchId) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        String myUid = jwt != null ? jwt.getSubject() : null;
        if (myUid == null || myUid.isBlank()) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        if (matchSubRepo.findByUserUidAndMatchId(myUid, match.getId()).isEmpty()) {
            var s = new hr.mrodek.apps.futsal_turniri.model.MatchSubscription();
            s.setUserUid(myUid);
            s.setMatch(match);
            matchSubRepo.persist(s);
        }
        return Response.status(Response.Status.CREATED).build();
    }

    @DELETE
    @Path("/{uuid}/matches/{matchId}/subscribe")
    @io.quarkus.security.Authenticated
    @Transactional
    public Response unsubscribeMatch(
            @PathParam("uuid") String uuid, @PathParam("matchId") Long matchId) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        String myUid = jwt != null ? jwt.getSubject() : null;
        if (myUid == null || myUid.isBlank()) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        matchSubRepo.deleteByUserUidAndMatchId(myUid, match.getId());
        return Response.noContent().build();
    }

    @GET
    @Path("/{uuid}/subscription")
    @io.quarkus.security.Authenticated
    public Response getSubscription(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        String myUid = jwt != null ? jwt.getSubject() : null;
        if (myUid == null || myUid.isBlank()) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        boolean subscribed = subRepo.findByUserUidAndTournamentId(myUid, t.getId()).isPresent();
        return Response.ok(java.util.Map.of("subscribed", subscribed)).build();
    }

    @POST
    @Path("/{uuid}/subscribe")
    @io.quarkus.security.Authenticated
    @Transactional
    public Response subscribe(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        String myUid = jwt != null ? jwt.getSubject() : null;
        if (myUid == null || myUid.isBlank()) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        if (subRepo.findByUserUidAndTournamentId(myUid, t.getId()).isEmpty()) {
            var s = new hr.mrodek.apps.futsal_turniri.model.TournamentSubscription();
            s.setUserUid(myUid);
            s.setTournament(t);
            subRepo.persist(s);

            // Confirmation email to the follower (their address is on the token).
            // Fire-and-forget; no-op when SMTP is unconfigured or no email claim.
            try {
                Object emailClaim = jwt.getClaim("email");
                String email = emailClaim != null ? emailClaim.toString() : null;
                if (email != null && !email.isBlank()) {
                    String url = emailService.baseUrl() + "/turniri/"
                            + (t.getSlug() != null ? t.getSlug() : t.getUuid());
                    String html = emailService.shell(
                            "Pratiš turnir",
                            "<p>Od sada pratiš <strong>" + EmailService.escapeHtml(t.getName())
                                    + "</strong>. Javit ćemo ti obavijesti o turniru (npr. konačni rezultat).</p>",
                            url, "Otvori turnir");
                    emailService.sendHtml(email, "Pratiš turnir - " + t.getName(), html);
                }
            } catch (Exception ignored) {
                // best-effort - the subscription is already saved
            }
        }
        return Response.status(Response.Status.CREATED).build();
    }

    @DELETE
    @Path("/{uuid}/subscribe")
    @io.quarkus.security.Authenticated
    @Transactional
    public Response unsubscribe(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        String myUid = jwt != null ? jwt.getSubject() : null;
        if (myUid == null || myUid.isBlank()) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        subRepo.deleteByUserUidAndTournamentId(myUid, t.getId());
        return Response.noContent().build();
    }

    @GET
    @Path("/{uuid}/share-image.png")
    @Produces("image/png")
    public Response shareImage(@PathParam("uuid") String idOrSlug) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(idOrSlug).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        try {
            byte[] png = hr.mrodek.apps.futsal_turniri.services.ShareImageRenderer.render(t);
            return Response.ok(png)
                    // 5-minute cache so a viral share doesn't recompute every
                    // fetch. Organizer edits invalidate via the SPA route,
                    // not via this image URL.
                    .header("Cache-Control", "public, max-age=300, s-maxage=300")
                    .build();
        } catch (Exception e) {
            return Response.serverError().build();
        }
    }

    /**
     * Branded QR code (PNG) that encodes this tournament's public page URL.
     * Scanning it opens the tournament. Generated on the fly from the slug -
     * nothing is persisted - and cached for a day since it only changes if
     * the slug changes. Public; used on the detail page (display + download).
     */
    @GET
    @Path("/{uuid}/qr.png")
    @Produces("image/png")
    public Response qrCode(@PathParam("uuid") String idOrSlug) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(idOrSlug).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        String base = publicBaseUrl.replaceAll("/+$", "");
        String ref = (t.getSlug() != null && !t.getSlug().isBlank())
                ? t.getSlug() : t.getUuid().toString();
        String url = base + "/turniri/" + ref;
        try {
            byte[] png = hr.mrodek.apps.futsal_turniri.services.QrCodeRenderer.render(url, 512);
            return Response.ok(png)
                    .header("Cache-Control", "public, max-age=86400, s-maxage=86400")
                    .build();
        } catch (Exception e) {
            return Response.serverError().build();
        }
    }

    /* ===================== Teams ===================== */

    @GET
    @Path("/{uuid}/teams")
    public Response listTeams(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        var teams = teamRepo.findByTournament_Id(t.getId());
        // Emit claim tokens only to the primary submitter of each team
        // (so they can copy the share link) or to organizer/admin.
        // Other viewers don't see tokens - the share link is for the
        // primary to hand out, not for the whole tournament to see.
        String viewerUid = (jwt != null) ? jwt.getSubject() : null;
        boolean viewerIsOrganizerOrAdmin =
                (identity != null && identity.hasRole("admin"))
                || (viewerUid != null && viewerUid.equals(t.getCreatedByUid()));
        return Response.ok(
                teamMapper.toDtoListEnrichedForViewer(
                        teams,
                        fetchSubmitterProfiles(teams),
                        viewerUid,
                        viewerIsOrganizerOrAdmin
                )
        ).build();
    }

    /**
     * Build a random opaque token for the team-sharing URL. 24 bytes of
     * SecureRandom encoded base64-url-no-padding = 32 chars - short
     * enough to fit in a clipboard-friendly URL, long enough that
     * brute-forcing is infeasible.
     */
    private static String generateClaimToken() {
        byte[] buf = new byte[24];
        new java.security.SecureRandom().nextBytes(buf);
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    /**
     * Bulk-load UserProfile rows for every distinct submitter UID across
     * the given teams - both primary submitters AND co-owners that
     * claimed the team via the share link. Same map serves both
     * enrichment lookups in TeamMapper.toDtoEnriched.
     */
    private java.util.Map<String, hr.mrodek.apps.futsal_turniri.model.UserProfile> fetchSubmitterProfiles(List<Teams> teams) {
        java.util.Set<String> uids = new java.util.HashSet<>();
        for (var p : teams) {
            if (p.getSubmittedByUid() != null) uids.add(p.getSubmittedByUid());
            if (p.getCoSubmittedByUid() != null) uids.add(p.getCoSubmittedByUid());
        }
        return userProfileRepo.findByUids(uids);
    }

    @PUT
    @Path("/{uuid}/teams")
    @Authenticated
    @Transactional
    public Response replaceTeams(
            @PathParam("uuid") String uuid,
            @Valid List<@Valid TeamDto> payload
    ) {
        var tournament = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (tournament == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(tournament);

        if (payload == null) {
            return Response.status(Response.Status.BAD_REQUEST).entity("Body required").build();
        }
        if (payload.stream().anyMatch(p -> p.name() == null || p.name().trim().isEmpty())) {
            return Response.status(Response.Status.BAD_REQUEST).entity("Each team needs a name").build();
        }

        // Managed rows for this tx
        var existing = teamRepo.findByTournament_Id(tournament.getId());
        Map<Long, Teams> byId = existing.stream()
                .filter(p -> p.getId() != null)
                .collect(Collectors.toMap(Teams::getId, p -> p));

        Set<Long> payloadIds = payload.stream()
                .map(TeamDto::id)
                .filter(Objects::nonNull)
                .map(Integer::longValue)
                .collect(Collectors.toSet());

        // Once the draw exists, teams can no longer be removed - reject a save
        // that drops any existing team (the UI disables this; this is the
        // server-side guard against a stale client or direct API call).
        if (isRosterLocked(tournament)) {
            boolean removingTeam = existing.stream()
                    .anyMatch(e -> e.getId() != null && !payloadIds.contains(e.getId()));
            if (removingTeam) {
                return Response.status(Response.Status.CONFLICT)
                        .entity("Ždrijeb je već generiran - ekipe se više ne mogu uklanjati.")
                        .build();
            }
        }

        // 1) delete removed rows first
        for (var e : existing) {
            if (e.getId() != null && !payloadIds.contains(e.getId())) {
                teamRepo.delete(e);
            }
        }

        // 2) update managed rows, collect new rows to insert
        List<Teams> toInsert = new ArrayList<>();
        for (var in : payload) {
            Long pid = (in.id() == null) ? null : in.id().longValue();

            if (pid != null && byId.containsKey(pid)) {
                var entity = byId.get(pid);
                teamMapper.updateEntity(entity, in);
            } else {
                var entity = new Teams();
                entity.setTournament(tournament);
                teamMapper.updateEntity(entity, in);
                toInsert.add(entity);
            }
        }

        if (!toInsert.isEmpty()) {
            teamRepo.saveAll(toInsert);
        }

        var all = teamRepo.findByTournament_Id(tournament.getId());
        // Same viewer-aware emission as listTeams - primary submitter
        // of each row sees their own claim token; everyone else gets
        // null in that field.
        String viewerUid = (jwt != null) ? jwt.getSubject() : null;
        boolean viewerIsOrganizerOrAdmin =
                (identity != null && identity.hasRole("admin"))
                || (viewerUid != null && viewerUid.equals(tournament.getCreatedByUid()));
        return Response.ok(
                teamMapper.toDtoListEnrichedForViewer(
                        all,
                        fetchSubmitterProfiles(all),
                        viewerUid,
                        viewerIsOrganizerOrAdmin
                )
        ).build();
    }

    /**
     * Any logged-in user can self-register a team against a tournament that
     * hasn't started yet. The team is created with `pendingApproval=true` and
     * `submittedByUid=current user` so the organizer can confirm or reject it.
     */
    @POST
    @Path("/{uuid}/teams/self-register")
    @Authenticated
    @Transactional
    public Response selfRegisterTeam(
            @PathParam("uuid") String uuid,
            @Valid SelfRegisterTeamRequest body
    ) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();

        if (t.getStatus() == TournamentStatus.STARTED || t.getStatus() == TournamentStatus.FINISHED) {
            return Response.status(Response.Status.CONFLICT).entity("TOURNAMENT_ALREADY_STARTED").build();
        }

        // Reject duplicate name from the same self-registering user - prevents
        // the same person from accidentally re-registering the same team.
        String myUid = jwt.getSubject();
        String trimmedName = body.name().trim();
        boolean alreadyRegistered = teamRepo.findByTournament_Id(t.getId()).stream()
                .anyMatch(existing ->
                        myUid != null && myUid.equals(existing.getSubmittedByUid())
                                && existing.getName() != null
                                && existing.getName().equalsIgnoreCase(trimmedName));
        if (alreadyRegistered) {
            return Response.status(Response.Status.CONFLICT).entity("ALREADY_REGISTERED").build();
        }

        // Make sure the user has a UserProfile row + slug *before* we persist
        // the team. Without this, team-list enrichment would render the row
        // without "Prijavio: …" any time the front-end /user/me/sync hadn't
        // landed yet (race between sign-in and the first self-register).
        slugService.ensureProfile(myUid, displayNameFromJwt());

        // Capacity is intentionally not enforced here - the organizer can review
        // the pending list and approve/reject to fit their tournament size.

        Teams p = new Teams();
        p.setTournament(t);
        p.setName(body.name().trim());
        p.setEliminated(false);
        p.setSubmittedByUid(jwt.getSubject());
        p.setPendingApproval(true);
        // Generate a team-level claim token (legacy - sharing now happens
        // at the preset level, but the column is kept for back-compat
        // with already-claimed teams).
        p.setClaimToken(generateClaimToken());

        // Auto-inherit co-owner from the user's matching preset. If the
        // user has already shared the name "Marko & Pero" and the
        // partner has claimed, every new Team self-registered under
        // that name should also surface on the partner's profile +
        // notifications. The preset is the source of truth.
        if (myUid != null) {
            userTeamPresetRepo.findByUserUidAndNameIgnoreCase(myUid, trimmedName)
                    .ifPresent(preset -> {
                        if (preset.getCoOwnerUid() != null && !preset.getCoOwnerUid().isBlank()) {
                            p.setCoSubmittedByUid(preset.getCoOwnerUid());
                        }
                    });
        }

        teamRepo.save(p);

        // Auto-save the typed name into the user's team-name address book so
        // they don't have to type it again next time. Skipped when the same
        // name (case-insensitive) is already saved.
        if (myUid != null) {
            var alreadySaved = userTeamPresetRepo
                    .findByUserUidAndNameIgnoreCase(myUid, trimmedName)
                    .isPresent();
            if (!alreadySaved) {
                var preset = new hr.mrodek.apps.futsal_turniri.model.UserTeamPreset();
                preset.setUserUid(myUid);
                preset.setName(trimmedName);
                userTeamPresetRepo.save(preset);
            }
        }

        return Response.status(Response.Status.CREATED)
                .entity(teamMapper.toDtoEnriched(p, fetchSubmitterProfiles(List.of(p))))
                .build();
    }

    /**
     * Organizer approves a pending self-registered team. Owner-or-admin only.
     */
    @POST
    @Path("/{uuid}/teams/{teamId}/approve")
    @Authenticated
    @Transactional
    public Response approveTeam(
            @PathParam("uuid") String uuid,
            @PathParam("teamId") Long teamId
    ) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);

        var teamOpt = teamRepo.findByIdOptional(teamId);
        if (teamOpt.isEmpty()) return Response.status(Response.Status.NOT_FOUND).build();

        var team = teamOpt.get();
        if (team.getTournament() == null || !Objects.equals(team.getTournament().getId(), t.getId())) {
            return Response.status(Response.Status.FORBIDDEN).build();
        }
        boolean wasPending = team.isPendingApproval();
        team.setPendingApproval(false);

        // Notify the player(s) whose team just got approved. Only push when
        // the row was actually pending - re-approving an already-approved
        // team would be a confusing duplicate notification. Both the
        // primary submitter and the share-link co-owner get the push.
        if (wasPending) {
            String tournamentRef = t.getSlug() != null && !t.getSlug().isBlank()
                    ? t.getSlug()
                    : (t.getUuid() != null ? t.getUuid().toString() : "");
            java.util.List<String> uids = new java.util.ArrayList<>(2);
            if (team.getSubmittedByUid() != null && !team.getSubmittedByUid().isBlank()) {
                uids.add(team.getSubmittedByUid());
            }
            if (team.getCoSubmittedByUid() != null && !team.getCoSubmittedByUid().isBlank()) {
                uids.add(team.getCoSubmittedByUid());
            }
            for (String uid : uids) {
                pushService.sendToUser(
                        uid,
                        new PushService.PushPayload(
                                "Prijava odobrena",
                                "Tvoj par \"" + team.getName() + "\" je prihvaćen na turniru " + t.getName() + ".",
                                "/turniri/" + tournamentRef
                        )
                );
            }
        }

        return Response.ok(teamMapper.toDtoEnriched(team, fetchSubmitterProfiles(List.of(team)))).build();
    }

    /**
     * Delete a single team from a tournament. Owner/admin only - same gating
     * as the bulk-replace PUT. Refuses to delete once the tournament has
     * started (matches reference team_id, so blowing them up would orphan
     * historical results).
     */
    @DELETE
    @Path("/{uuid}/teams/{teamId}")
    @Authenticated
    @Transactional
    public Response deleteTeam(
            @PathParam("uuid") String uuid,
            @PathParam("teamId") Long teamId
    ) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanEdit(t);

        // Once the draw exists (groups drawn / bracket / schedule generated), a
        // team can no longer be removed - it would corrupt the structure.
        if (isRosterLocked(t)) {
            return Response.status(Response.Status.CONFLICT)
                    .entity("Ždrijeb je već generiran - ekipe se više ne mogu uklanjati.")
                    .build();
        }
        if (t.getStatus() == TournamentStatus.STARTED || t.getStatus() == TournamentStatus.FINISHED) {
            return Response.status(Response.Status.CONFLICT).entity("TOURNAMENT_ALREADY_STARTED").build();
        }

        var teamOpt = teamRepo.findByIdOptional(teamId);
        if (teamOpt.isEmpty()) return Response.status(Response.Status.NOT_FOUND).build();

        var team = teamOpt.get();
        if (team.getTournament() == null || !Objects.equals(team.getTournament().getId(), t.getId())) {
            return Response.status(Response.Status.FORBIDDEN).build();
        }

        teamRepo.delete(team);
        return Response.noContent().build();
    }

    /* ===================== Players (roster) ===================== */

    /**
     * Resolve a team and verify it belongs to the given tournament.
     * Returns the managed {@link Teams} entity, or throws a JAX-RS
     * exception mapped to the right HTTP status:
     *   - 404 if the tournament or team doesn't exist
     *   - 404 if the team exists but belongs to a different tournament
     *     (treated as not-found to avoid leaking cross-tournament ids)
     */
    private Teams resolveTeamInTournament(String uuid, Long teamId) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) throw new NotFoundException("Tournament not found");
        var team = teamRepo.findByIdOptional(teamId).orElse(null);
        if (team == null
                || team.getTournament() == null
                || !Objects.equals(team.getTournament().getId(), t.getId())) {
            throw new NotFoundException("Team not found");
        }
        return team;
    }

    /**
     * Public read of a team's roster, ordered for stable rendering.
     * No auth - same visibility as the team list itself.
     */
    @GET
    @Path("/{uuid}/teams/{teamId}/players")
    public List<PlayerDto> listPlayers(
            @PathParam("uuid") String uuid,
            @PathParam("teamId") Long teamId
    ) {
        Teams team = resolveTeamInTournament(uuid, teamId);
        return playerMapper.toDtoList(playerRepo.findByTeam_Id(team.getId()));
    }

    /**
     * Add a player to a team's roster. Organizer-or-admin only (same
     * authorization as the other team-management endpoints). Rosters are
     * editable at any time - no tournament-status restriction.
     */
    @POST
    @Path("/{uuid}/teams/{teamId}/players")
    @Authenticated
    @Transactional
    public Response addPlayer(
            @PathParam("uuid") String uuid,
            @PathParam("teamId") Long teamId,
            @Valid CreatePlayerRequest body
    ) {
        Teams team = resolveTeamInTournament(uuid, teamId);
        assertCanEdit(team.getTournament());

        Player player = new Player();
        player.setTeam(team);
        // Players are stored uppercase so the same person aggregates cleanly
        // on the all-time scorer list regardless of how the name was typed.
        player.setName(normalizePlayerName(body.name()));
        player.setNumber(body.number());
        player.setCaptain(false);

        // Append to the end of the roster: one past the current max sort order.
        Integer maxSort = playerRepo.maxSortOrderForTeam(team.getId());
        player.setSortOrder(maxSort == null ? 0 : maxSort + 1);

        playerRepo.persist(player);

        return Response.status(Response.Status.CREATED)
                .entity(playerMapper.toDto(player))
                .build();
    }

    /**
     * Edit an existing roster player. Organizer-or-admin only. Rosters are
     * editable at any time. When {@code captain=true} is set, the captain
     * flag is cleared on every other player of the same team so a team
     * never has more than one captain. A null {@code captain} in the body
     * leaves the existing flag untouched.
     */
    @PUT
    @Path("/{uuid}/teams/{teamId}/players/{playerId}")
    @Authenticated
    @Transactional
    public Response updatePlayer(
            @PathParam("uuid") String uuid,
            @PathParam("teamId") Long teamId,
            @PathParam("playerId") Long playerId,
            @Valid UpdatePlayerRequest body
    ) {
        Teams team = resolveTeamInTournament(uuid, teamId);
        assertCanEdit(team.getTournament());

        Player player = playerRepo.findByIdOptional(playerId).orElse(null);
        if (player == null
                || player.getTeam() == null
                || !Objects.equals(player.getTeam().getId(), team.getId())) {
            throw new NotFoundException("Player not found");
        }

        player.setName(normalizePlayerName(body.name()));
        player.setNumber(body.number());

        if (body.captain() != null) {
            if (Boolean.TRUE.equals(body.captain())) {
                // Exactly one captain per team: clear it on every other
                // player of this team before promoting the current one.
                for (Player other : playerRepo.findByTeam_Id(team.getId())) {
                    if (!Objects.equals(other.getId(), player.getId()) && other.isCaptain()) {
                        other.setCaptain(false);
                    }
                }
                player.setCaptain(true);
            } else {
                player.setCaptain(false);
            }
        }

        return Response.ok(playerMapper.toDto(player)).build();
    }

    /**
     * Remove a player from a team's roster. Organizer-or-admin only.
     * Rosters are editable at any time - no tournament-status restriction.
     */
    @DELETE
    @Path("/{uuid}/teams/{teamId}/players/{playerId}")
    @Authenticated
    @Transactional
    public Response deletePlayer(
            @PathParam("uuid") String uuid,
            @PathParam("teamId") Long teamId,
            @PathParam("playerId") Long playerId
    ) {
        Teams team = resolveTeamInTournament(uuid, teamId);
        assertCanEdit(team.getTournament());

        Player player = playerRepo.findByIdOptional(playerId).orElse(null);
        if (player == null
                || player.getTeam() == null
                || !Objects.equals(player.getTeam().getId(), team.getId())) {
            throw new NotFoundException("Player not found");
        }

        playerRepo.delete(player);
        return Response.noContent().build();
    }

    /* ===================== Public live match listing ===================== */

    /**
     * Public endpoint - no auth required.
     * Returns all matches currently in status LIVE across every tournament.
     * Each element carries enough tournament and team context for a
     * "live now" widget. Soft-deleted tournaments are excluded automatically
     * by the {@code @Where(is_deleted=false)} clause on {@link
     * hr.mrodek.apps.futsal_turniri.model.Tournaments}.
     */
    @GET
    @Path("/live")
    public List<LiveMatchDto> listLiveMatches() {
        return matchesRepo.findAllLiveMatches()
                .stream()
                // Hidden tournaments never stream to the public live widgets.
                .filter(m -> m.getTournament() == null || !m.getTournament().isHidden())
                .map(m -> {
                    var t = m.getTournament();
                    return new LiveMatchDto(
                            m.getId(),
                            t != null && t.getUuid() != null ? t.getUuid().toString() : null,
                            t != null ? t.getSlug() : null,
                            t != null ? t.getName() : null,
                            m.getTeam1() != null ? m.getTeam1().getName() : null,
                            m.getTeam2() != null ? m.getTeam2().getName() : null,
                            m.getScore1(),
                            m.getScore2(),
                            m.getLiveMode() != null ? m.getLiveMode().name() : null,
                            m.getLiveStartedAt(),
                            m.getFirstHalfEndedAt(),
                            m.getSecondHalfStartedAt(),
                            m.getLivePausedAt(),
                            t != null ? t.getHalfLengthMin() : null,
                            t != null ? t.getHalfCount() : null,
                            m.getFouls1First(),
                            m.getFouls1Second(),
                            m.getFouls2First(),
                            m.getFouls2Second(),
                            t != null ? t.getFeaturedAt() : null,
                            m.getStage() != null ? m.getStage().name() : null
                    );
                })
                .collect(Collectors.toList());
    }

    /**
     * Public endpoint - no auth required.
     * Returns SCHEDULED matches across every tournament that have a kickoff
     * time from now onward, soonest-first, capped at 40. Powers the
     * "Nadolazeće utakmice" stream on the /uzivo page.
     */
    @GET
    @Path("/upcoming-matches")
    public List<UpcomingMatchDto> listUpcomingMatches() {
        return matchesRepo.findUpcomingMatches(OffsetDateTime.now(), 40)
                .stream()
                // Hidden tournaments never surface on the public upcoming feed.
                .filter(m -> m.getTournament() == null || !m.getTournament().isHidden())
                .map(m -> {
                    var t = m.getTournament();
                    return new UpcomingMatchDto(
                            m.getId(),
                            t != null && t.getUuid() != null ? t.getUuid().toString() : null,
                            t != null ? t.getSlug() : null,
                            t != null ? t.getName() : null,
                            m.getTeam1() != null ? m.getTeam1().getName() : null,
                            m.getTeam2() != null ? m.getTeam2().getName() : null,
                            m.getKickoffAt(),
                            m.getTableNo(),
                            m.getStage() != null ? m.getStage().name() : null,
                            m.getGroup() != null ? m.getGroup().getName() : null
                    );
                })
                .collect(Collectors.toList());
    }

    /* ===================== Public stats - goal scorers ===================== */

    /**
     * Public endpoint - no auth required.
     * Returns the tournament's goal scorers ranked by number of goals,
     * highest first. Resolves the tournament by UUID or slug (same pattern
     * as all other {@code /{uuid}} endpoints) and returns 404 if not found.
     */
    @GET
    @Path("/{uuid}/stats/scorers")
    public Response listScorers(@PathParam("uuid") String uuid) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        List<ScorerDto> scorers = matchEventRepo.findGoalCountsByTournament(t)
                .stream()
                .map(row -> {
                    var player = (hr.mrodek.apps.futsal_turniri.model.Player) row[0];
                    var team   = (hr.mrodek.apps.futsal_turniri.model.Teams)  row[1];
                    long goals = (Long) row[2];
                    return new ScorerDto(
                            player.getId(),
                            player.getName(),
                            team != null ? team.getName() : null,
                            goals
                    );
                })
                .collect(Collectors.toList());
        return Response.ok(scorers).build();
    }

    /* ===================== Live match (status + events) ===================== */

    /**
     * Resolve a match and verify it belongs to the given tournament.
     * Returns the managed {@link Matches} entity, or throws a JAX-RS
     * exception mapped to the right HTTP status:
     *   - 404 if the tournament or match doesn't exist
     *   - 404 if the match exists but belongs to a different tournament
     *     (treated as not-found to avoid leaking cross-tournament ids)
     */
    private Matches resolveMatchInTournament(String uuid, Long matchId) {
        var t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) throw new NotFoundException("Tournament not found");
        var match = matchesRepo.findByIdOptional(matchId).orElse(null);
        if (match == null
                || match.getTournament() == null
                || !Objects.equals(match.getTournament().getId(), t.getId())) {
            throw new NotFoundException("Match not found");
        }
        return match;
    }

    /**
     * Recompute {@code score1} / {@code score2} of a match from its GOAL +
     * OWN_GOAL events. A regular goal counts to the side whose team the
     * scorer belongs to (anonymous goals carry the side on the event's own
     * team). An OWN_GOAL always stores the BENEFICIARY in the event's team
     * column, so it counts to that side directly. Card events are ignored.
     * Called after every goal insert/delete so the score mirrors the timeline.
     */
    private void recomputeScoreFromGoals(Matches match) {
        Long team1Id = match.getTeam1() != null ? match.getTeam1().getId() : null;
        int score1 = 0;
        int score2 = 0;
        List<MatchEvent> goals = new ArrayList<>(
                matchEventRepo.findByMatch_IdAndType(match.getId(), MatchEventType.GOAL));
        goals.addAll(matchEventRepo.findByMatch_IdAndType(match.getId(), MatchEventType.OWN_GOAL));
        for (MatchEvent ev : goals) {
            final Long countsForTeamId;
            if (ev.getType() == MatchEventType.OWN_GOAL) {
                // Own goal: the event's team IS the beneficiary.
                countsForTeamId = ev.getTeam() != null ? ev.getTeam().getId() : null;
            } else {
                Player scorer = ev.getPlayer();
                // Named scorer → his team; anonymous goal → the team stored on
                // the event itself (so privacy goals count for the right side).
                countsForTeamId = (scorer != null && scorer.getTeam() != null)
                        ? scorer.getTeam().getId()
                        : (ev.getTeam() != null ? ev.getTeam().getId() : null);
            }
            if (team1Id != null && Objects.equals(countsForTeamId, team1Id)) {
                score1++;
            } else {
                score2++;
            }
        }
        match.setScore1(score1);
        match.setScore2(score2);
    }

    /**
     * Mark a match as in-progress (status LIVE). Organizer-or-admin only.
     * Idempotent - calling it on an already-live match just returns it.
     * Accepts an optional JSON body {@code { "mode": "TIMER" | "SIMPLE" }};
     * defaults to SIMPLE when the body is absent or mode is null/blank/invalid.
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/start")
    @Authenticated
    @Transactional
    public Response startMatch(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId,
            StartMatchRequest body
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());

        MatchLiveMode mode = MatchLiveMode.SIMPLE;
        if (body != null && body.mode() != null && !body.mode().isBlank()) {
            try {
                mode = MatchLiveMode.valueOf(body.mode().trim().toUpperCase());
            } catch (IllegalArgumentException ignored) {
                // unknown mode string → keep SIMPLE
            }
        }

        match.setStatus(MatchStatus.LIVE);
        match.setLiveMode(mode);
        match.setLiveStartedAt(java.time.OffsetDateTime.now());
        match.setLivePausedAt(null);

        // Notify everyone who tapped the bell on this specific match that it
        // just kicked off. Fire-and-forget - a flaky push must not abort the
        // start.
        Tournaments t = match.getTournament();
        if (t != null) {
            try {
                pushService.sendToMatchSubscribers(
                        match.getId(),
                        "▶️ Utakmica počinje - " + t.getName(),
                        matchVersusLine(match),
                        tournamentScheduleUrl(t));
            } catch (Exception ignored) {
                // swallowed - the match is already LIVE; push is best-effort.
            }
        }

        notifyLive(match);
        return Response.ok(roundMatchMapper.toMatchDto(match)).build();
    }

    /**
     * Mark a match as finished (status FINISHED). Organizer-or-admin only.
     * The score is the running total from the goal events; a match started
     * and finished with no goals registers as 0:0 (rather than a blank/null
     * score that wouldn't count in the group standings).
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/finish")
    @Authenticated
    @Transactional
    public Response finishMatch(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());

        match.setStatus(MatchStatus.FINISHED);
        match.setLivePausedAt(null);
        // No goals recorded → an explicit 0:0 so the result counts everywhere.
        if (match.getScore1() == null) match.setScore1(0);
        if (match.getScore2() == null) match.setScore2(0);
        // Set the winner (or null for a draw) from the final score.
        Integer fs1 = match.getScore1(), fs2 = match.getScore2();
        if (fs1 > fs2) match.setWinnerTeam(match.getTeam1());
        else if (fs2 > fs1) match.setWinnerTeam(match.getTeam2());
        else match.setWinnerTeam(null);

        // Notify the match's bell subscribers (+ tournament bell) of the final score.
        Tournaments t = match.getTournament();
        if (t != null) {
            firePushMatchSafe(
                    match.getId(),
                    t.getId(),
                    "🏁 Kraj utakmice - " + t.getName(),
                    matchScoreLine(match),
                    tournamentScheduleUrl(t)
            );
        }

        notifyLive(match);
        return Response.ok(roundMatchMapper.toMatchDto(match)).build();
    }

    /**
     * Reset a match back to SCHEDULED. Organizer-or-admin only. Wipes the live
     * state (mode, kickoff instants), the score/penalties/winner, the
     * accumulated fouls, and every recorded event - used when a match was
     * started by mistake or with a misbehaving timer and needs a clean restart.
     * The scheduled kickoff time is preserved so it can simply be started again.
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/reset")
    @Authenticated
    @Transactional
    public Response resetMatch(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());

        matchEventRepo.deleteByMatch_Id(match.getId());

        match.setStatus(MatchStatus.SCHEDULED);
        match.setLiveMode(null);
        match.setLiveStartedAt(null);
        match.setFirstHalfEndedAt(null);
        match.setSecondHalfStartedAt(null);
        match.setLivePausedAt(null);
        match.setScore1(null);
        match.setScore2(null);
        match.setPenalties1(null);
        match.setPenalties2(null);
        match.setWinnerTeam(null);
        match.setFouls1First(0);
        match.setFouls1Second(0);
        match.setFouls2First(0);
        match.setFouls2Second(0);

        notifyLive(match);
        return Response.ok(roundMatchMapper.toMatchDto(match)).build();
    }

    /**
     * Adjust a team's accumulated foul count for one half. Organizer/admin only.
     * {@code delta} is reduced to ±1 (a single foul step) and the count is
     * clamped at 0. Returns the match's updated foul tallies.
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/fouls")
    @Authenticated
    @Transactional
    public Response adjustFouls(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId,
            MatchFoulRequest body
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());
        if (body == null
                || (body.team() != 1 && body.team() != 2)
                || (body.half() != 1 && body.half() != 2)) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("team and half must be 1 or 2").build();
        }
        int step = Integer.signum(body.delta());
        if (body.team() == 1) {
            if (body.half() == 1) match.setFouls1First(clampFoul(match.getFouls1First(), step));
            else match.setFouls1Second(clampFoul(match.getFouls1Second(), step));
        } else {
            if (body.half() == 1) match.setFouls2First(clampFoul(match.getFouls2First(), step));
            else match.setFouls2Second(clampFoul(match.getFouls2Second(), step));
        }
        notifyLive(match);
        return Response.ok(new MatchFoulsDto(
                match.getFouls1First(), match.getFouls1Second(),
                match.getFouls2First(), match.getFouls2Second())).build();
    }

    private static int clampFoul(Integer current, int step) {
        return Math.max(0, (current == null ? 0 : current) + step);
    }

    /**
     * Reset both teams' accumulated fouls for one half back to 0. Organizer/
     * admin only - used at half-time / after a wrong entry.
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/fouls/reset")
    @Authenticated
    @Transactional
    public Response resetFouls(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId,
            @QueryParam("half") Integer half
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());
        int h = half == null ? 1 : half;
        if (h != 1 && h != 2) {
            return Response.status(Response.Status.BAD_REQUEST).entity("half must be 1 or 2").build();
        }
        if (h == 1) {
            match.setFouls1First(0);
            match.setFouls2First(0);
        } else {
            match.setFouls1Second(0);
            match.setFouls2Second(0);
        }
        notifyLive(match);
        return Response.ok(new MatchFoulsDto(
                match.getFouls1First(), match.getFouls1Second(),
                match.getFouls2First(), match.getFouls2Second())).build();
    }

    /**
     * Record the moment the 1st half was ended - the match enters the half-time
     * "pauza". Organizer-or-admin only; the match must be LIVE (409 otherwise).
     * Idempotent: a no-op if the 1st half was already ended.
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/first-half-end")
    @Authenticated
    @Transactional
    public Response endFirstHalf(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());

        if (match.getStatus() != MatchStatus.LIVE) {
            return Response.status(Response.Status.CONFLICT)
                    .entity("Match is not LIVE").build();
        }

        if (match.getFirstHalfEndedAt() == null) {
            match.setFirstHalfEndedAt(java.time.OffsetDateTime.now());
        }
        // Half-time IS the pause - a live-clock pause can't outlive the half.
        match.setLivePausedAt(null);

        // Fan out the half-time whistle to bell subscribers.
        Tournaments t = match.getTournament();
        if (t != null) {
            firePushSafe(
                    t.getId(),
                    "⏸️ Poluvrijeme - " + t.getName(),
                    matchVersusLine(match),
                    tournamentScheduleUrl(t)
            );
        }

        notifyLive(match);
        return Response.ok(roundMatchMapper.toMatchDto(match)).build();
    }

    /**
     * Record the 2nd-half kickoff instant. Organizer-or-admin only.
     * The match must be in status LIVE - returns 409 otherwise.
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/second-half")
    @Authenticated
    @Transactional
    public Response startSecondHalf(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());

        if (match.getStatus() != MatchStatus.LIVE) {
            return Response.status(Response.Status.CONFLICT)
                    .entity("Match is not LIVE").build();
        }

        // Defensive: the 1st half is implicitly over once the 2nd starts, so the
        // phase stays consistent even if the half-time step was skipped.
        if (match.getFirstHalfEndedAt() == null) {
            match.setFirstHalfEndedAt(java.time.OffsetDateTime.now());
        }
        match.setSecondHalfStartedAt(java.time.OffsetDateTime.now());
        // A pause can't survive a half transition - the fresh half starts NOW.
        match.setLivePausedAt(null);

        // Fan out the second-half kickoff to bell subscribers.
        Tournaments t = match.getTournament();
        if (t != null) {
            firePushSafe(
                    t.getId(),
                    "🟢 Drugo poluvrijeme - " + t.getName(),
                    matchVersusLine(match),
                    tournamentScheduleUrl(t)
            );
        }

        notifyLive(match);
        return Response.ok(roundMatchMapper.toMatchDto(match)).build();
    }

    /**
     * PAUSE the live clock (ball far away, injury, ...). Organizer-or-admin
     * only; the match must be LIVE. Idempotent - pausing an already-paused
     * match is a no-op. While paused every clock renders the elapsed time up
     * to the pause instant, so the display freezes for all viewers.
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/pause")
    @Authenticated
    @Transactional
    public Response pauseMatch(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());

        if (match.getStatus() != MatchStatus.LIVE) {
            return Response.status(Response.Status.CONFLICT)
                    .entity("Match is not LIVE").build();
        }
        if (match.getLivePausedAt() == null) {
            match.setLivePausedAt(java.time.OffsetDateTime.now());
        }
        notifyLive(match);
        return Response.ok(roundMatchMapper.toMatchDto(match)).build();
    }

    /**
     * RESUME a paused live clock. Organizer-or-admin only; the match must be
     * LIVE. Idempotent - resuming a non-paused match is a no-op. The trick:
     * the current half's start instant is shifted FORWARD by the pause
     * duration and the pause marker cleared, so every clock computation
     * ({@code now - halfStart}) keeps working with zero special cases.
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/resume")
    @Authenticated
    @Transactional
    public Response resumeMatch(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());

        if (match.getStatus() != MatchStatus.LIVE) {
            return Response.status(Response.Status.CONFLICT)
                    .entity("Match is not LIVE").build();
        }
        var pausedAt = match.getLivePausedAt();
        if (pausedAt != null) {
            var pause = java.time.Duration.between(pausedAt, java.time.OffsetDateTime.now());
            if (!pause.isNegative()) {
                if (match.getSecondHalfStartedAt() != null) {
                    match.setSecondHalfStartedAt(match.getSecondHalfStartedAt().plus(pause));
                } else if (match.getLiveStartedAt() != null) {
                    match.setLiveStartedAt(match.getLiveStartedAt().plus(pause));
                }
            }
            match.setLivePausedAt(null);
        }
        notifyLive(match);
        return Response.ok(roundMatchMapper.toMatchDto(match)).build();
    }

    /**
     * Public read of a match's event timeline, ordered by minute then id.
     * No auth - same visibility as the match list itself.
     */
    @GET
    @Path("/{uuid}/matches/{matchId}/events")
    public List<MatchEventDto> listMatchEvents(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        return matchEventMapper.toDtoList(
                matchEventRepo.findByMatch_IdOrdered(match.getId()));
    }

    /**
     * Add a goal or card event to a match. Organizer-or-admin only.
     * The carded/scoring player must belong to one of the two teams in
     * the match. {@code assistPlayerId} is honoured only for goals and
     * must, when present, belong to the scorer's own team. Adding a GOAL
     * triggers a score recompute from all goal events.
     */
    @POST
    @Path("/{uuid}/matches/{matchId}/events")
    @Authenticated
    @Transactional
    public Response addMatchEvent(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId,
            CreateMatchEventRequest body
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());

        if (body == null) {
            return Response.status(Response.Status.BAD_REQUEST).entity("Body required").build();
        }
        if (body.type() == null || body.type().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("type is required").build();
        }
        final MatchEventType type;
        try {
            type = MatchEventType.valueOf(body.type().trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ex) {
            return Response.status(Response.Status.BAD_REQUEST).entity("INVALID_EVENT_TYPE").build();
        }
        if (body.minute() == null) {
            return Response.status(Response.Status.BAD_REQUEST).entity("minute is required").build();
        }

        // EVERY event type may now be recorded without naming the player
        // (anonymous scorer / carded player - privacy or an unknown player);
        // then the side comes from teamId. An anonymous red card can't send
        // anyone off (the sent-off check is per playerId) - it's a record on
        // the timeline only, exactly the intended semantics.
        Player player = null;
        Teams eventTeam = null;
        if (body.playerId() == null) {
            if (body.teamId() == null) {
                return Response.status(Response.Status.BAD_REQUEST).entity("teamId is required").build();
            }
            eventTeam = teamRepo.findByIdOptional(body.teamId()).orElse(null);
            if (eventTeam == null || !teamBelongsToMatch(eventTeam, match)) {
                return Response.status(Response.Status.BAD_REQUEST).entity("TEAM_NOT_IN_MATCH").build();
            }
        } else {
            player = playerRepo.findByIdOptional(body.playerId()).orElse(null);
            if (player == null || player.getTeam() == null
                    || !playerBelongsToMatch(player, match)) {
                return Response.status(Response.Status.BAD_REQUEST).entity("PLAYER_NOT_IN_MATCH").build();
            }
            // A sent-off player (red card) can no longer affect the match - no
            // further goals or cards. The first red card itself is still allowed
            // (the player has no prior red at that point).
            if (matchEventRepo.playerSentOff(match.getId(), player.getId())) {
                return Response.status(Response.Status.BAD_REQUEST).entity("PLAYER_SENT_OFF").build();
            }
        }

        // Own goal: the request names the COMMITTING side (the player who put
        // it into his own net, or his team when anonymous); the score goes to
        // the opponent. Resolve the beneficiary here and store it on the
        // event's team column - the recompute and the DTO both read it there.
        Teams ownGoalBeneficiary = null;
        if (type == MatchEventType.OWN_GOAL) {
            Long committingTeamId = player != null
                    ? player.getTeam().getId()
                    : eventTeam.getId();
            Teams t1 = match.getTeam1();
            Teams t2 = match.getTeam2();
            if (t1 == null || t2 == null) {
                return Response.status(Response.Status.BAD_REQUEST).entity("TEAMS_NOT_SET").build();
            }
            ownGoalBeneficiary = Objects.equals(committingTeamId, t1.getId()) ? t2 : t1;
        }

        Player assist = null;
        if (body.assistPlayerId() != null) {
            if (type != MatchEventType.GOAL) {
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity("ASSIST_ONLY_FOR_GOALS").build();
            }
            if (player == null) {
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity("ASSIST_REQUIRES_NAMED_SCORER").build();
            }
            assist = playerRepo.findByIdOptional(body.assistPlayerId()).orElse(null);
            if (assist == null || assist.getTeam() == null
                    || !Objects.equals(assist.getTeam().getId(), player.getTeam().getId())) {
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity("ASSIST_PLAYER_NOT_ON_SCORER_TEAM").build();
            }
        }

        MatchEvent event = new MatchEvent();
        event.setMatch(match);
        event.setType(type);
        event.setPlayer(player);
        // Own goal → the beneficiary; otherwise team is only stored for an
        // unattributed event and derived from the player when one is named.
        event.setTeam(type == MatchEventType.OWN_GOAL
                ? ownGoalBeneficiary
                : (player == null ? eventTeam : null));
        event.setMinute(body.minute());
        event.setAssistPlayer(assist);
        matchEventRepo.persist(event);

        // A goal (own or regular) changes the score; cards never do.
        if (type == MatchEventType.GOAL || type == MatchEventType.OWN_GOAL) {
            recomputeScoreFromGoals(match);

            // Fan out to every user that opted into this tournament's
            // bell. After the score recompute so the body reflects the
            // new total. Wrapped in try/catch so push failure can't
            // roll back the goal we just persisted.
            Tournaments t = match.getTournament();
            if (t != null) {
                firePushMatchSafe(
                        match.getId(),
                        t.getId(),
                        "⚽ Gol - " + t.getName(),
                        matchScoreLine(match),
                        tournamentScheduleUrl(t)
                );
            }
        }

        notifyLive(match);
        return Response.status(Response.Status.CREATED)
                .entity(matchEventMapper.toDto(event))
                .build();
    }

    /**
     * Delete a single match event. Organizer-or-admin only. Deleting a
     * GOAL triggers a score recompute from the remaining goal events.
     */
    @DELETE
    @Path("/{uuid}/matches/{matchId}/events/{eventId}")
    @Authenticated
    @Transactional
    public Response deleteMatchEvent(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId,
            @PathParam("eventId") Long eventId
    ) {
        Matches match = resolveMatchInTournament(uuid, matchId);
        assertCanEdit(match.getTournament());

        MatchEvent event = matchEventRepo.findByIdOptional(eventId).orElse(null);
        if (event == null
                || event.getMatch() == null
                || !Objects.equals(event.getMatch().getId(), match.getId())) {
            throw new NotFoundException("Match event not found");
        }

        boolean wasGoal = event.getType() == MatchEventType.GOAL
                || event.getType() == MatchEventType.OWN_GOAL;
        matchEventRepo.delete(event);

        if (wasGoal) {
            recomputeScoreFromGoals(match);
        }

        notifyLive(match);
        return Response.noContent().build();
    }

    /** Push a realtime "live data changed" ping for a match, keyed on the
     *  tournament's canonical UUID (NOT the request path param, which may be a
     *  slug - clients filter on the real uuid). */
    private void notifyLive(Matches match) {
        if (match == null || match.getTournament() == null) return;
        var t = match.getTournament();
        if (t.getUuid() == null) return;
        liveBroadcaster.liveUpdate(t.getUuid().toString(), match.getId());
    }

    /** True if the player's team is one of the two teams in the match. */
    private static boolean playerBelongsToMatch(Player player, Matches match) {
        Long teamId = player.getTeam().getId();
        Long t1 = match.getTeam1() != null ? match.getTeam1().getId() : null;
        Long t2 = match.getTeam2() != null ? match.getTeam2().getId() : null;
        return Objects.equals(teamId, t1) || Objects.equals(teamId, t2);
    }

    private static boolean teamBelongsToMatch(Teams team, Matches match) {
        Long teamId = team.getId();
        Long t1 = match.getTeam1() != null ? match.getTeam1().getId() : null;
        Long t2 = match.getTeam2() != null ? match.getTeam2().getId() : null;
        return Objects.equals(teamId, t1) || Objects.equals(teamId, t2);
    }

    /**
     * Best-effort SPA URL for the tournament's match-schedule tab. Prefers
     * the pretty slug, falls back to the UUID for legacy rows that haven't
     * been slug-backfilled yet. Returns null only when the tournament has
     * neither identifier, which shouldn't happen for any persisted row.
     */
    private static String tournamentScheduleUrl(Tournaments t) {
        if (t == null) return null;
        String ref = t.getSlug();
        if (ref == null || ref.isBlank()) {
            ref = t.getUuid() != null ? t.getUuid().toString() : null;
        }
        if (ref == null) return null;
        return "/turniri/" + ref + "?tab=raspored";
    }

    /**
     * Format the body line for a match push: {@code "<Team1> <score1>:<score2> <Team2>"}.
     * Falls back to dashes when a score hasn't been set yet so the
     * notification body never reads "null:null".
     */
    private static String matchScoreLine(Matches m) {
        String t1 = m.getTeam1() != null && m.getTeam1().getName() != null ? m.getTeam1().getName() : "?";
        String t2 = m.getTeam2() != null && m.getTeam2().getName() != null ? m.getTeam2().getName() : "?";
        Integer s1 = m.getScore1();
        Integer s2 = m.getScore2();
        return t1 + " " + (s1 == null ? "-" : s1) + ":" + (s2 == null ? "-" : s2) + " " + t2;
    }

    /** "Team1 vs Team2" - used by the second-half kickoff push. */
    private static String matchVersusLine(Matches m) {
        String t1 = m.getTeam1() != null && m.getTeam1().getName() != null ? m.getTeam1().getName() : "?";
        String t2 = m.getTeam2() != null && m.getTeam2().getName() != null ? m.getTeam2().getName() : "?";
        return t1 + " vs " + t2;
    }

    /**
     * Fire-and-forget push fan-out wrapper. Swallows every exception
     * so a flaky push service can never abort the underlying match-event
     * write - the user-facing 201/200 response is what matters; the push
     * is a best-effort side-effect.
     */
    private void firePushSafe(Long tournamentId, String title, String body, String url) {
        try {
            pushService.sendToTournamentSubscribers(tournamentId, title, body, url);
        } catch (Exception e) {
            // Intentionally swallowed: the goal/half/finish has already
            // been written. We log via the service's own logger; nothing
            // for the caller to do here.
        }
    }

    /** Like {@link #firePushSafe} but also notifies this match's bell
     *  subscribers (deduped against the tournament subscribers). */
    private void firePushMatchSafe(Long matchId, Long tournamentId, String title, String body, String url) {
        try {
            pushService.sendToMatchAndTournamentSubscribers(matchId, tournamentId, title, body, url);
        } catch (Exception e) {
            // Swallowed - the event is already persisted; push is best-effort.
        }
    }
}
