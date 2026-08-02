package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * The signed-in user's whole "Obavijesti" screen in one payload, already
 * grouped so the client renders it verbatim.
 *
 * <p>Grouping is by subject, not by time: ten pushes about one match (kickoff,
 * three goals, half-time, final whistle...) collapse into ONE group with ten
 * items, which is the difference between a readable inbox and a wall. Rows
 * with no match fall back to their tournament, and everything else lands in a
 * single {@code other} group.
 *
 * <p>{@code unreadCount} is the true total for the user (the badge), which can
 * exceed the number of unread items in {@code groups} - the list itself is
 * capped at the newest N notifications.
 */
public record NotificationInboxDto(int unreadCount, List<Group> groups) {

    /**
     * One subject's notifications, newest first.
     *
     * @param key           {@code "match:{id}"}, {@code "tournament:{id}"} or {@code "other"}
     * @param matchId       null unless this is a match group
     * @param tournamentId  null unless the group's rows carry one
     * @param title         match label / tournament name, falling back to the newest item's title
     * @param url           deep link for the whole group - the newest item's link
     * @param unread        unread items within this group
     * @param latestAt      newest item's timestamp; groups are sorted by this, descending
     */
    public record Group(
            String key,
            Long matchId,
            Long tournamentId,
            String title,
            String url,
            int unread,
            OffsetDateTime latestAt,
            List<Item> items
    ) {}

    /** One stored notification. {@code kind} is a {@code NotificationKind} name. */
    public record Item(
            Long id,
            String kind,
            String title,
            String body,
            String url,
            OffsetDateTime createdAt,
            OffsetDateTime readAt
    ) {}
}
