package hr.mrodek.apps.futsal_turniri.enums;

/**
 * Lifecycle of a manual "this roster player is me" request - the fallback
 * path for people whose registered name doesn't fold-match any roster row,
 * so nothing could be auto-linked. An admin decides, because a wrong link
 * would hand someone else's tournament history (and team edit rights) to
 * the wrong person.
 */
public enum PlayerClaimRequestStatus {
    PENDING,
    APPROVED,
    REJECTED,
    /** Withdrawn by the requester before an admin got to it. */
    CANCELLED
}
