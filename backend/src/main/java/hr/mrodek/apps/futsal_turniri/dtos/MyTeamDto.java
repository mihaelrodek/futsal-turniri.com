package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/**
 * One team on the user's "my teams" list, displayed under Predlošci ->
 * Moji pari. The viewer is either the primary submitter or a co-owner
 * who claimed via the share link. Carries enough info to render the
 * row without an N+1: team name, tournament context, both submitters,
 * and the claim token (only when the viewer is the primary, so they
 * can copy the share link).
 */
public record MyTeamDto(
        Long teamId,
        String teamName,
        Long tournamentId,
        String tournamentName,
        String tournamentRef,    // slug or uuid for deep-linking
        OffsetDateTime tournamentStartAt,
        boolean isPrimary,        // true if viewer is the primary submitter
        boolean pendingApproval,
        String primaryName,
        String primarySlug,
        String coOwnerName,
        String coOwnerSlug,
        /** Only emitted when {@code isPrimary} - the viewer's share link. */
        String claimToken
) {}
