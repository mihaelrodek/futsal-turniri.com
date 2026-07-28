package hr.mrodek.apps.futsal_turniri.enums;

/**
 * Lifecycle of a paid match-recording request.
 *
 * <pre>
 * REQUESTED -> APPROVED  -> DELIVERED
 *           -> REJECTED
 *           -> CANCELLED  (by the requester, only while REQUESTED)
 * </pre>
 */
public enum RecordingRequestStatus {
    REQUESTED,
    APPROVED,
    REJECTED,
    DELIVERED,
    CANCELLED
}
