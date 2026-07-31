package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/**
 * One "je li ovo ti?" suggestion on the owner's profile Turniri tab: a
 * roster player whose full name matches the signed-in user's first+last
 * name (case- and Croatian-diacritics-insensitively) and whose team
 * nobody has claimed yet. Carries enough context for the user to
 * recognise themselves - the player's name as entered on the roster,
 * the team it belongs to, and the tournament it was played at.
 */
public record PlayerClaimSuggestionDto(
        Long playerId,
        String playerName,
        String teamName,
        String tournamentName,
        String tournamentRef,    // slug or uuid for deep-linking
        OffsetDateTime tournamentStartAt
) {}
