package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.UserTeamPreset;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@ApplicationScoped
public class UserTeamPresetRepository implements AppRepository<UserTeamPreset, Long> {

    /**
     * All non-archived presets the user is a party to - either as the
     * primary or as the claimed co-owner. The Moji parovi list uses this
     * so both owners see the same set after a claim.
     */
    public List<UserTeamPreset> findActiveForViewer(String uid) {
        return list(
                "(userUid = ?1 or coOwnerUid = ?1) and archived = false",
                Sort.by("name").ascending(),
                uid
        );
    }

    /** Legacy primary-only lookup. Kept for migration / public profile. */
    public List<UserTeamPreset> findByUserUid(String uid) {
        return list("userUid = ?1", Sort.by("name").ascending(), uid);
    }

    public Optional<UserTeamPreset> findByUuidAndUserUid(UUID uuid, String uid) {
        return find("uuid = ?1 and userUid = ?2", uuid, uid).firstResultOptional();
    }

    /**
     * Lookup used by mutation endpoints - either owner (primary or
     * co-owner) can edit / archive-request / etc. The controller decides
     * which subset of actions to allow.
     */
    public Optional<UserTeamPreset> findByUuidForOwnerOrCoOwner(UUID uuid, String uid) {
        return find(
                "uuid = ?1 and (userUid = ?2 or coOwnerUid = ?2)",
                uuid, uid
        ).firstResultOptional();
    }

    /** Case-insensitive lookup used to dedupe before auto-saving on self-register. */
    public Optional<UserTeamPreset> findByUserUidAndNameIgnoreCase(String uid, String name) {
        if (uid == null || name == null) return Optional.empty();
        return find("userUid = ?1 and lower(name) = ?2", uid, name.trim().toLowerCase())
                .firstResultOptional();
    }

    /** Single preset lookup by share token (for /claim-name/{token}). */
    public Optional<UserTeamPreset> findByClaimToken(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        return find("claimToken", token).firstResultOptional();
    }

    /**
     * Merge support (admin duplicate-name merge): a saved "par" preset is
     * itself a denormalized team-name string used by {@code
     * TeamsRepository.findMyParticipations}'s by-name fallback, so a merge
     * needs to rename these too or a user's future tournaments under the
     * canonical spelling would stop auto-claiming. Renaming is scoped
     * per-user and deduped: if the same user already owns a preset with the
     * canonical name, the old-spelling preset is deleted instead of renamed
     * (a user can't have two presets that collide on name). Returns the
     * number of presets renamed (deletions aren't counted).
     */
    public int mergeNames(java.util.Collection<String> names, String canonicalName) {
        if (names == null || names.isEmpty()) return 0;
        var affected = list("name in ?1", names);
        int renamed = 0;
        for (UserTeamPreset preset : affected) {
            boolean alreadyHasCanonical = find(
                    "userUid = ?1 and lower(name) = ?2 and id != ?3",
                    preset.getUserUid(), canonicalName.trim().toLowerCase(), preset.getId()
            ).firstResultOptional().isPresent();
            if (alreadyHasCanonical) {
                delete(preset);
            } else {
                preset.setName(canonicalName.trim());
                persist(preset);
                renamed++;
            }
        }
        return renamed;
    }
}
