package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.PlayerClaimRequestDto;
import hr.mrodek.apps.futsal_turniri.dtos.PlayerClaimSuggestionDto;
import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.model.PlayerClaimRequest;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

/**
 * Entity → DTO mapping for the player-claim flow, shared by the user-facing
 * and admin controllers so both render a request identically. Kept out of
 * either controller because a JAX-RS resource is a poor thing to inject into
 * another one (its class-level security annotations come along for the ride).
 */
@ApplicationScoped
public class PlayerClaimRequestMapper {

    @Inject UserProfileRepository profileRepo;

    /** A roster player offered in the search/suggestion list. */
    public PlayerClaimSuggestionDto toSuggestionDto(Player p) {
        Teams team = p.getTeam();
        Tournaments t = team == null ? null : team.getTournament();
        String ref = null;
        if (t != null) {
            ref = t.getSlug() != null && !t.getSlug().isBlank()
                    ? t.getSlug()
                    : (t.getUuid() != null ? t.getUuid().toString() : null);
        }
        return new PlayerClaimSuggestionDto(
                p.getId(),
                p.getName(),
                team == null ? null : team.getName(),
                t == null ? null : t.getName(),
                ref,
                t == null ? null : t.getStartAt()
        );
    }

    /**
     * @param withRequester fill in the requester's identity. Admin view only -
     *                      a user's own list must never carry anyone else's PII.
     */
    public PlayerClaimRequestDto toDto(PlayerClaimRequest r, boolean withRequester) {
        String name = null;
        String email = null;
        String slug = null;
        if (withRequester) {
            var profile = profileRepo.findByUid(r.getUserUid()).orElse(null);
            if (profile != null) {
                name = profile.getDisplayName();
                email = profile.getEmail();
                slug = profile.getSlug();
            }
        }
        return new PlayerClaimRequestDto(
                r.getId(),
                r.getPlayer() == null ? null : r.getPlayer().getId(),
                r.getPlayerName(),
                r.getTeamName(),
                r.getTournamentName(),
                r.getComment(),
                r.getStatus() == null ? null : r.getStatus().name(),
                r.getAdminNote(),
                r.getCreatedAt(),
                r.getDecidedAt(),
                name,
                email,
                slug
        );
    }
}
