package hr.mrodek.apps.futsal_turniri.dtos;

/** Optional client click time for pausing the live match clock. */
public record PauseMatchRequest(String occurredAt) {
}
