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
}
