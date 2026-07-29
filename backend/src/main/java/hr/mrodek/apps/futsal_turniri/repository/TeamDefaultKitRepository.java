package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.TeamDefaultKit;
import hr.mrodek.apps.futsal_turniri.services.TeamNameNormalizer;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Objects;

@ApplicationScoped
public class TeamDefaultKitRepository implements AppRepository<TeamDefaultKit, Long> {

    /** Every saved kit for a team identity, most recently touched first. */
    public List<TeamDefaultKit> findByNormalizedName(String normalizedName) {
        return list("normalizedName", Sort.by("updatedAt").descending(), normalizedName);
    }

    /**
     * Records {@code (jersey, shorts)} as a default kit for the identity
     * matched by {@code teamName} (normalized). No-op when both colours are
     * null (nothing worth remembering). If the exact combination is already
     * saved, just bumps its {@code updatedAt} (most-recently-used ordering)
     * instead of creating a duplicate row - this IS the 1:N "append new /
     * touch existing" semantics: a per-tournament override never deletes a
     * different, previously-saved combination.
     */
    public void upsert(String teamName, String jersey, String shorts) {
        if (teamName == null || teamName.isBlank()) return;
        if (jersey == null && shorts == null) return;
        String normalized = TeamNameNormalizer.normalize(teamName);
        if (normalized.isEmpty()) return;

        TeamDefaultKit existing = findByNormalizedName(normalized).stream()
                .filter(k -> Objects.equals(k.getJerseyColor(), jersey) && Objects.equals(k.getShortsColor(), shorts))
                .findFirst()
                .orElse(null);
        if (existing != null) {
            // Touch a field so @UpdateTimestamp bumps updatedAt - keeps the
            // most-recently-confirmed kit first for the pre-fill lookup.
            existing.setTeamName(teamName.trim());
            persist(existing);
            return;
        }

        TeamDefaultKit kit = new TeamDefaultKit();
        kit.setNormalizedName(normalized);
        kit.setTeamName(teamName.trim());
        kit.setJerseyColor(jersey);
        kit.setShortsColor(shorts);
        persist(kit);
    }

    /**
     * Merge support (admin duplicate-name merge): repoint every saved kit
     * whose normalized name is one of {@code oldNormalizedNames} onto the
     * canonical identity, then dedupe rows that now collide on
     * (canonical normalized name, jersey, shorts) - keeping the most
     * recently updated of each duplicate combination. Returns the number of
     * rows repointed (post-dedupe count may be lower).
     */
    public int mergeInto(java.util.Collection<String> oldNormalizedNames, String canonicalName) {
        String canonicalNormalized = TeamNameNormalizer.normalize(canonicalName);
        if (canonicalNormalized.isEmpty()) return 0;

        var toRepoint = list("normalizedName in ?1", oldNormalizedNames);
        int repointed = 0;
        for (TeamDefaultKit kit : toRepoint) {
            if (!canonicalNormalized.equals(kit.getNormalizedName())) {
                kit.setNormalizedName(canonicalNormalized);
                kit.setTeamName(canonicalName.trim());
                persist(kit);
                repointed++;
            }
        }

        // Dedupe: same normalized name + same colour pair should only exist once.
        var all = findByNormalizedName(canonicalNormalized);
        var seen = new java.util.HashSet<String>();
        for (TeamDefaultKit kit : all) {
            String key = (kit.getJerseyColor() == null ? "" : kit.getJerseyColor())
                    + "|" + (kit.getShortsColor() == null ? "" : kit.getShortsColor());
            if (!seen.add(key)) {
                delete(kit);
            }
        }
        return repointed;
    }
}
