package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/**
 * One manual "this roster player is me" request, as shown both to its author
 * (on their profile) and to the admin deciding it. The *_name fields are the
 * snapshots taken at request time, so the row stays readable even after the
 * organizer renamed or deleted the roster entry.
 *
 * <p>{@code requesterName} / {@code requesterEmail} are filled for the admin
 * view only - they're what the admin checks the comment against.
 */
public record PlayerClaimRequestDto(
        Long id,
        Long playerId,
        String playerName,
        String teamName,
        String tournamentName,
        String comment,
        String status,           // PENDING | APPROVED | REJECTED | CANCELLED
        String adminNote,
        OffsetDateTime createdAt,
        OffsetDateTime decidedAt,

        // admin-only context
        String requesterName,
        String requesterEmail,
        String requesterSlug
) {}
