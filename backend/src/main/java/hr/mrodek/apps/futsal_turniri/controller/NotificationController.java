package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.NotificationInboxDto;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.UserNotification;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserNotificationRepository;
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import hr.mrodek.apps.futsal_turniri.services.RecordingRequestNotifier;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The "Obavijesti" inbox - everything push has ever delivered to the caller,
 * which until the {@code user_notifications} table existed was unreviewable:
 * a missed lock-screen banner was simply gone.
 *
 * <p>Strictly self-service. Every read and every write is scoped to the
 * caller's own Firebase UID taken from the token - there is no id, uid or
 * filter a client can pass to reach anyone else's rows, and the mark-as-read
 * update carries the uid inside its own WHERE clause rather than checking
 * after a load.
 *
 * Routes (all require a signed-in user):
 *   GET  /notifications        - my inbox, grouped by match / tournament, newest first
 *   POST /notifications/read   - mark the given ids read (empty body = mark everything read)
 */
@Path("/notifications")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class NotificationController {

    /**
     * How far back the inbox goes. A busy follower collects a few notifications
     * per match; 200 is several tournaments' worth and keeps the response (and
     * the label lookups below) bounded. Older rows stay in the table.
     */
    private static final int MAX_ITEMS = 200;

    private static final String GROUP_OTHER = "other";

    @Inject UserNotificationRepository repo;
    @Inject MatchesRepository matchesRepo;
    @Inject TournamentsRepository tournamentsRepo;
    @Inject MessageService messages;
    @Inject JsonWebToken jwt;

    @GET
    @Transactional
    public NotificationInboxDto inbox() {
        String uid = jwt.getSubject();
        List<UserNotification> rows = repo.findRecentByUserUid(uid, MAX_ITEMS);

        // Newest-first in, so each bucket comes out newest-first for free.
        Map<String, List<UserNotification>> buckets = new LinkedHashMap<>();
        for (UserNotification n : rows) {
            buckets.computeIfAbsent(groupKey(n), k -> new ArrayList<>()).add(n);
        }

        List<NotificationInboxDto.Group> groups = new ArrayList<>(buckets.size());
        for (var entry : buckets.entrySet()) {
            groups.add(toGroup(entry.getKey(), entry.getValue()));
        }
        // The insertion order already is latest-desc; sorting makes that a
        // guarantee rather than a side-effect of the query's ORDER BY.
        // (latestAt is created_at, NOT NULL, so the comparison is total.)
        groups.sort((a, b) -> b.latestAt().compareTo(a.latestAt()));

        return new NotificationInboxDto((int) repo.countUnread(uid), groups);
    }

    /**
     * Mark notifications read. A missing body, or missing/empty {@code ids},
     * means mark everything of mine as read - that's what the screen's
     * mark-all button does.
     */
    @POST
    @Path("/read")
    @Transactional
    public MarkReadResult markRead(MarkReadBody body) {
        String uid = jwt.getSubject();
        long marked = repo.markRead(uid, body == null ? null : body.ids());
        return new MarkReadResult(marked, repo.countUnread(uid));
    }

    /* ===================== grouping ===================== */

    private static String groupKey(UserNotification n) {
        if (n.getMatchId() != null) return "match:" + n.getMatchId();
        if (n.getTournamentId() != null) return "tournament:" + n.getTournamentId();
        return GROUP_OTHER;
    }

    /** {@code items} is guaranteed non-empty and newest-first by the caller. */
    private NotificationInboxDto.Group toGroup(String key, List<UserNotification> items) {
        UserNotification latest = items.get(0);
        Long matchId = latest.getMatchId();
        Long tournamentId = latest.getTournamentId();

        int unread = 0;
        for (UserNotification n : items) {
            if (n.getReadAt() == null) unread++;
        }

        return new NotificationInboxDto.Group(
                key,
                matchId,
                tournamentId,
                groupTitle(matchId, tournamentId, latest),
                latestUrl(items),
                unread,
                latest.getCreatedAt(),
                items.stream().map(NotificationController::toItem).toList()
        );
    }

    /**
     * Heading for the group. Resolved at READ time from the live row, so a
     * renamed team/tournament reads correctly; when the subject has since been
     * deleted (the ids are plain columns with no FK, exactly so history
     * survives that) we fall back to the newest notification's own title.
     */
    private String groupTitle(Long matchId, Long tournamentId, UserNotification latest) {
        if (matchId != null) {
            Matches match = matchesRepo.findByIdOptional(matchId).orElse(null);
            if (match != null) return RecordingRequestNotifier.matchLabel(match);
            return latest.getTitle();
        }
        if (tournamentId != null) {
            String name = tournamentsRepo.findByIdOptional(tournamentId)
                    .map(t -> t.getName())
                    .orElse(null);
            if (name != null && !name.isBlank()) return name;
            return latest.getTitle();
        }
        return messages.t("notifications.group.other");
    }

    /** Deep link for the group: the newest item that carries one. */
    private static String latestUrl(List<UserNotification> items) {
        for (UserNotification n : items) {
            if (n.getUrl() != null && !n.getUrl().isBlank()) return n.getUrl();
        }
        return null;
    }

    private static NotificationInboxDto.Item toItem(UserNotification n) {
        return new NotificationInboxDto.Item(
                n.getId(),
                n.getKind() == null ? null : n.getKind().name(),
                n.getTitle(),
                n.getBody(),
                n.getUrl(),
                n.getCreatedAt(),
                n.getReadAt()
        );
    }

    /* ===================== wire shapes ===================== */

    /** {@code ids} null or empty = every unread notification of the caller. */
    public record MarkReadBody(List<Long> ids) {}

    /** {@code marked} = rows actually flipped; {@code unreadCount} = the fresh badge value. */
    public record MarkReadResult(long marked, long unreadCount) {}
}
