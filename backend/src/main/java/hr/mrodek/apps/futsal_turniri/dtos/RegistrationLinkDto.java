package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * A registration link as the ORGANIZER sees it (list + create response).
 *
 * <p>Carries the raw {@code token} - this shape is only ever returned from the
 * organizer-gated endpoints, since the token is what lets anyone register.
 *
 * @param url        ready-to-send absolute link, built server-side so the
 *                   organizer copies one string instead of assembling it
 * @param teamCount  registrations filed through this link so far
 */
public record RegistrationLinkDto(
        Long id,
        String token,
        String url,
        String label,
        boolean active,
        int useCount,
        int teamCount,
        String createdAt
) {}
