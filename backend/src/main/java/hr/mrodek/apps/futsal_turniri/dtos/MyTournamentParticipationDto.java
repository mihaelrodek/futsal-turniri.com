package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One row per (user, tournament) team the user has self-registered.
 * Carries the bare-minimum tournament metadata so the profile page can
 * render a card without a second roundtrip per item.
 */
public record MyTournamentParticipationDto(
        UUID tournamentUuid,
        /**
         * Pretty URL slug for {@code /tournaments/{slug}} links. May be null
         * for legacy tournaments that haven't been backfilled yet - frontend
         * should fall back to {@code tournamentUuid} in that case.
         */
        String tournamentSlug,
        String tournamentName,
        String tournamentLocation,
        OffsetDateTime tournamentStartAt,
        String tournamentStatus,   // DRAFT | STARTED | FINISHED
        String winnerName,

        Long teamId,
        String teamName,
        boolean pendingApproval,
        boolean eliminated,
        boolean isWinner
) {
    /** Backward-compat constructor for callers that don't yet pass the slug. */
    public MyTournamentParticipationDto(
            UUID tournamentUuid,
            String tournamentName,
            String tournamentLocation,
            OffsetDateTime tournamentStartAt,
            String tournamentStatus,
            String winnerName,
            Long teamId,
            String teamName,
            boolean pendingApproval,
            boolean eliminated,
            boolean isWinner
    ) {
        this(tournamentUuid, null, tournamentName, tournamentLocation,
             tournamentStartAt, tournamentStatus, winnerName,
             teamId, teamName, pendingApproval, eliminated, isWinner);
    }
}
