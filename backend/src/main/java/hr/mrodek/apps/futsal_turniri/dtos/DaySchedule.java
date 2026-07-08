package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * One day of a multi-day schedule plan: when the first match of the day kicks
 * off (ISO offset date-time) and how many matches are played that day. The
 * rest of the day's kickoffs follow at the configured slot length.
 */
public record DaySchedule(
        String firstKickoff, // ISO-8601 offset date-time, e.g. 2026-07-20T09:00:00+02:00
        int matches
) {}
