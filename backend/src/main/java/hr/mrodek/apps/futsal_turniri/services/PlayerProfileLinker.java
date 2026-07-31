package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.repository.PlayersRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.jboss.logging.Logger;

import java.util.List;

/**
 * Server-side "which registered user is this roster row" linking.
 *
 * <p>Why this exists at all: the client-side flow only runs when the person
 * themselves opens the site while signed in, so a player who registers today
 * would see nothing from tournaments played last season until they happened
 * to log in. This runs on the writes instead - a roster is saved, a profile
 * name is set - so an appearance shows up on the right profile immediately,
 * whether or not that person is currently looking.
 *
 * <p>The safety rule is the whole design: link ONLY when exactly one profile
 * folds to that name. Two "Ivan Horvat"s cannot be told apart by name, so
 * neither gets linked and the manual, admin-approved request path
 * ({@code PlayerClaimRequestController}) takes over. The link is written to
 * {@code Player.claimedByUid}, which is identity only - unlike the team
 * submitter slots it grants no edit rights, so a wrong guess would show a
 * wrong appearance, never hand over control of someone's team.
 *
 * <p>Everything here is idempotent: already-linked rows are skipped, so the
 * startup backfill and the per-write hooks can both run as often as they like.
 */
@ApplicationScoped
public class PlayerProfileLinker {

    private static final Logger LOG = Logger.getLogger(PlayerProfileLinker.class);

    @Inject PlayersRepository playersRepo;
    @Inject UserProfileRepository profileRepo;

    /**
     * Self-injection so {@link #backfillAll()} can call the transactional
     * methods below THROUGH the CDI proxy - a plain this.foo() call would
     * bypass the interceptor and run the whole pass in (or outside) one
     * transaction, which is exactly what this design avoids.
     */
    @Inject PlayerProfileLinker self;

    /** What a linking pass did - surfaced by the admin backfill endpoint. */
    public record LinkResult(int scanned, int linked, int ambiguous) {}

    /**
     * Link one roster row if its name resolves to exactly one profile.
     *
     * @return true when this call actually wrote a link
     */
    @Transactional
    public boolean linkPlayer(Player player) {
        if (!isLinkable(player)) return false;

        String needle = PersonNameFolder.fold(player.getName());
        if (needle.isBlank() || !needle.contains(" ")) {
            // Single-token roster entries ("MARIO", a nickname) are far too
            // weak to identify a person - leave them for the manual path.
            return false;
        }

        List<UserProfile> matches = profileRepo.findByFoldedFullName(needle);
        if (matches.size() != 1) return false;

        player.setClaimedByUid(matches.get(0).getUserUid());
        playersRepo.persist(player);
        return true;
    }

    /** Link every still-unlinked row of one team's roster. */
    @Transactional
    public int linkRoster(Teams team) {
        if (team == null || team.getId() == null) return 0;
        int linked = 0;
        for (Player p : playersRepo.findByTeam_Id(team.getId())) {
            if (linkPlayer(p)) linked++;
        }
        return linked;
    }

    /**
     * Link every roster row that matches this ONE profile - run right after a
     * user registers or edits their name, so their history from old
     * tournaments appears without them going looking for it.
     *
     * <p>Still respects the uniqueness rule: a name shared with another
     * registered user links nothing.
     */
    @Transactional
    public int linkForProfile(UserProfile profile) {
        if (profile == null || profile.getUserUid() == null) return 0;

        String needle = PersonNameFolder.needle(profile.getFirstName(), profile.getLastName());
        if (needle == null) needle = PersonNameFolder.needleFromDisplayName(profile.getDisplayName());
        if (needle == null) return 0;

        // Somebody else registered under the same name - ambiguous, skip.
        if (profileRepo.findByFoldedFullName(needle).size() != 1) return 0;

        int linked = 0;
        for (Player p : playersRepo.findUnlinkedByFoldedName(needle)) {
            if (!isLinkable(p)) continue;
            p.setClaimedByUid(profile.getUserUid());
            playersRepo.persist(p);
            linked++;
        }
        if (linked > 0) {
            LOG.infof("Linked %d roster row(s) to profile %s", linked, profile.getUserUid());
        }
        return linked;
    }

    /**
     * One pass over every unlinked roster row - the mechanism that back-fills
     * historical tournaments after this feature ships. Idempotent.
     *
     * <p>Deliberately NOT one big transaction: a full-table pass can outlive
     * the default 60s transaction timeout, and the pass that repairs history
     * is the last thing that should fail on a fresh deploy. Ids are collected
     * once, then each row is linked in its own short transaction - a row that
     * fails costs that row, not the whole run.
     */
    public LinkResult backfillAll() {
        List<Long> ids = self.unlinkedPlayerIds();
        int linked = 0;
        int ambiguous = 0;
        for (Long id : ids) {
            try {
                switch (self.linkPlayerById(id)) {
                    case LINKED -> linked++;
                    case AMBIGUOUS -> ambiguous++;
                    case SKIPPED -> { }
                }
            } catch (RuntimeException e) {
                LOG.debugf(e, "Backfill skipped player %d", id);
            }
        }
        LOG.infof("Player-profile backfill: scanned=%d linked=%d ambiguous=%d",
                ids.size(), linked, ambiguous);
        return new LinkResult(ids.size(), linked, ambiguous);
    }

    /** Outcome of a single row - counted by {@link #backfillAll()}. */
    public enum Outcome { LINKED, AMBIGUOUS, SKIPPED }

    @Transactional
    public List<Long> unlinkedPlayerIds() {
        return playersRepo.findAllUnlinkedIds();
    }

    @Transactional
    public Outcome linkPlayerById(Long id) {
        Player p = playersRepo.findByIdOptional(id).orElse(null);
        if (p == null || !isLinkable(p)) return Outcome.SKIPPED;
        String needle = PersonNameFolder.fold(p.getName());
        if (needle.isBlank() || !needle.contains(" ")) return Outcome.SKIPPED;
        List<UserProfile> matches = profileRepo.findByFoldedFullName(needle);
        if (matches.isEmpty()) return Outcome.SKIPPED;
        if (matches.size() > 1) return Outcome.AMBIGUOUS;
        p.setClaimedByUid(matches.get(0).getUserUid());
        playersRepo.persist(p);
        return Outcome.LINKED;
    }

    /** Demo/showcase rows and hidden tournaments never take part. */
    private boolean isLinkable(Player player) {
        if (player == null || player.getClaimedByUid() != null) return false;
        if (player.isDemo() || player.getName() == null || player.getName().isBlank()) return false;
        Teams team = player.getTeam();
        if (team == null || team.isDemo()) return false;
        Tournaments t = team.getTournament();
        return t == null || !t.isHidden();
    }
}
