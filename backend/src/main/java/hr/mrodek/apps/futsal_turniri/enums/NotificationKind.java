package hr.mrodek.apps.futsal_turniri.enums;

/**
 * What a stored {@link hr.mrodek.apps.futsal_turniri.model.UserNotification}
 * was about. Purely descriptive: it drives the icon/colour the "Obavijesti"
 * inbox renders and nothing else - no behaviour hangs off it, so adding a
 * value never needs a migration (the column is a plain varchar).
 *
 * <p>{@link #GENERIC} is the fallback for every push whose call site doesn't
 * name a kind, so an unclassified notification is still stored and readable.
 */
public enum NotificationKind {
    /** A followed match kicked off. */
    MATCH_START,
    /** Final whistle (group stage or knockout). */
    MATCH_END,
    /** Half-time whistle. */
    HALF_TIME,
    /** Second half kicked off. */
    SECOND_HALF,
    /** A goal was scored in a followed match. */
    GOAL,
    /** The organizer approved a team/pair registration. */
    TEAM_APPROVED,
    /** A round was drawn - which table / which opponent. */
    SCHEDULE,
    /** Knockout bracket news (drawn, advanced). */
    BRACKET,
    /** The recipient's team is out of the tournament. */
    ELIMINATED,
    /** Match-recording request lifecycle (approved / rejected / delivered). */
    RECORDING,
    /**
     * Something landed in the admin queue and needs a human: a new recording
     * request, a camera/quote inquiry, a player-claim request. Only ever sent
     * to platform admins, and always carries a deep link into the matching
     * /admin module. Not tied to a match or tournament, so it groups under
     * "other" in the inbox.
     */
    ADMIN_REQUEST,
    /** Anything not classified at the call site. */
    GENERIC
}
