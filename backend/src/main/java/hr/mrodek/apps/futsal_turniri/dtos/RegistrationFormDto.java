package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * What the PUBLIC registration form is told about the tournament it is
 * registering for. Deliberately thin: enough for whoever opens the link to
 * confirm they are filling in the right form, and nothing that isn't already
 * on the public tournament page.
 *
 * @param open       false when the link was revoked or the tournament already
 *                   started - the form renders read-only and says why
 * @param closedCode {@code null} while open, else {@code LINK_REVOKED} /
 *                   {@code TOURNAMENT_ALREADY_STARTED}
 * @param label      the organizer's note on the link ("NK Sokol"), shown back
 *                   so the recipient sees the link was meant for them
 */
public record RegistrationFormDto(
        String tournamentName,
        String tournamentSlug,
        String location,
        String startAt,
        String organizerName,
        String label,
        boolean open,
        String closedCode
) {}
