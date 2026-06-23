package hr.mrodek.apps.futsal_turniri.enums;

/**
 * How a live match is run on the scoreboard.
 *
 * <p>{@code TIMER} runs a counting clock from {@code liveStartedAt};
 * {@code SIMPLE} is a manual scoreboard with no running clock.
 */
public enum MatchLiveMode {
    TIMER,
    SIMPLE
}
