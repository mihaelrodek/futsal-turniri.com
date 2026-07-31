package hr.mrodek.apps.futsal_turniri.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamDefaultKitRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserTeamPresetRepository;
import hr.mrodek.apps.futsal_turniri.services.TeamNameNormalizer;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Admin-only endpoints for the cross-tournament "team database" - the
 * hidden/test flag and the duplicate-name finder + merge tool that live on
 * the "Baza ekipa" admin tab.
 *
 * <p>Team identity is name-based (see {@link TeamsRepository} - there's no
 * shared id across a team's rows in different tournaments), so every action
 * here operates on a NAME, not a single row: hiding "hides every Teams row
 * with that exact name, merging repoints every Teams row (plus every other
 * place a team name is stored as a free-text snapshot) onto one canonical
 * spelling.
 *
 * <p>Authorization: Firebase {@code role: "admin"} custom claim, same as
 * {@link AdminController}. Kept in its own controller (rather than growing
 * the already-large AdminController) because this is a distinct, self-
 * contained surface with its own duplicate-detection algorithm.
 */
@Path("/admin/team-database")
@RolesAllowed("admin")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AdminTeamDatabaseController {

    /** Near-equal names must differ by no more than this many single-character
     *  edits (on the normalized form) to be flagged as a merge suggestion. */
    private static final int SUGGESTION_MAX_DISTANCE = 2;

    /** Stores the dismissed-duplicate-groups list (see {@link #loadDismissed()})
     *  as a JSON array in a single app_settings row - no migration needed. */
    private static final String KEY_DISMISSED_DUPLICATES = "admin.dismissedTeamDuplicates";

    @Inject TeamsRepository teamsRepo;
    @Inject TournamentsRepository tournamentsRepo;
    @Inject UserTeamPresetRepository presetRepo;
    @Inject TeamDefaultKitRepository defaultKitRepo;
    @Inject AppSettingsRepository settings;
    @Inject ObjectMapper json;

    /**
     * Every distinct team name in the database with its usage stats and
     * demo flag, alphabetical. Feeds the "Baza ekipa" list + toggle.
     */
    @GET
    @Path("/teams")
    public Response listTeams() {
        List<TeamIdentityDto> dtos = teamsRepo.findAllNameStats().stream()
                .map(row -> {
                    long rowCount = ((Number) row[1]).longValue();
                    long demoCount = row[3] == null ? 0L : ((Number) row[3]).longValue();
                    return new TeamIdentityDto(
                            (String) row[0],
                            rowCount,
                            ((Number) row[2]).longValue(),
                            // every row sharing this name is flagged demo
                            demoCount == rowCount);
                })
                .toList();
        return Response.ok(dtos).build();
    }

    /**
     * Bulk-set the demo/hidden flag for every Teams row with this exact
     * name. Idempotent. 400 on a blank name.
     */
    @PUT
    @Path("/teams/demo")
    @Transactional
    public Response setDemo(SetTeamDemoRequest body) {
        if (body == null || body.name() == null || body.name().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("NAME_REQUIRED").build();
        }
        int updated = teamsRepo.setDemoByName(body.name(), body.demo());
        return Response.ok(Map.of("updated", updated)).build();
    }

    /**
     * Scans every (non-demo) team name and groups likely duplicates:
     *   - EXACT: names whose normalized form (lowercase, diacritics
     *     stripped, whitespace collapsed) is identical, e.g.
     *     "OGREVANJE ZAMUDA" vs "Ogrevanje Zamuda".
     *   - SUGGESTED: names whose normalized forms differ but are within
     *     {@value #SUGGESTION_MAX_DISTANCE} edits of each other, e.g. a
     *     typo. Distinct normalized clusters are grouped transitively (if
     *     A~B and B~C are both close, all three variants land in one group)
     *     via union-find.
     *
     * Demo/test teams are excluded - they're already known throwaway data,
     * not worth an admin's attention here.
     */
    @GET
    @Path("/duplicates")
    public Response duplicates() {
        // name -> stats, skip names that are demo everywhere. Uses the
        // public TeamNameVariantDto directly (rather than a private local
        // record) so it can be threaded through buildGroupDto without an
        // unchecked cast between two structurally-identical-but-distinct
        // local record types.
        List<TeamNameVariantDto> stats = new ArrayList<>();
        for (Object[] row : teamsRepo.findAllNameStats()) {
            String name = (String) row[0];
            long rowCount = ((Number) row[1]).longValue();
            long demoCount = row[3] == null ? 0L : ((Number) row[3]).longValue();
            if (name == null || name.isBlank()) continue;
            if (demoCount >= rowCount) continue; // fully-demo name, skip
            stats.add(new TeamNameVariantDto(name, rowCount, ((Number) row[2]).longValue()));
        }

        // Group by normalized form.
        Map<String, List<TeamNameVariantDto>> byNormalized = new LinkedHashMap<>();
        for (TeamNameVariantDto s : stats) {
            byNormalized.computeIfAbsent(TeamNameNormalizer.normalize(s.name()), k -> new ArrayList<>()).add(s);
        }

        List<TeamDuplicateGroupDto> groups = new ArrayList<>();
        for (var entry : byNormalized.entrySet()) {
            if (entry.getValue().size() > 1) {
                groups.add(buildGroupDto("EXACT", entry.getValue()));
            }
        }

        // Near-equal clustering across DISTINCT normalized keys (union-find).
        List<String> keys = new ArrayList<>(byNormalized.keySet());
        Map<String, String> parent = new HashMap<>();
        for (String k : keys) parent.put(k, k);
        for (int i = 0; i < keys.size(); i++) {
            for (int j = i + 1; j < keys.size(); j++) {
                String a = keys.get(i), b = keys.get(j);
                if (TeamNameNormalizer.levenshtein(a, b) <= SUGGESTION_MAX_DISTANCE) {
                    union(parent, a, b);
                }
            }
        }
        Map<String, List<String>> clusters = new LinkedHashMap<>();
        for (String k : keys) {
            clusters.computeIfAbsent(find(parent, k), r -> new ArrayList<>()).add(k);
        }
        for (var cluster : clusters.values()) {
            if (cluster.size() <= 1) continue; // no near-duplicate partner
            List<TeamNameVariantDto> variants = new ArrayList<>();
            for (String k : cluster) variants.addAll(byNormalized.get(k));
            groups.add(buildGroupDto("SUGGESTED", variants));
        }

        // Drop groups the admin already dismissed as "not actually duplicates".
        Set<String> dismissed = loadDismissed();
        if (!dismissed.isEmpty()) {
            groups.removeIf(g -> dismissed.contains(dismissKey(
                    g.variants().stream().map(TeamNameVariantDto::name).toList())));
        }

        return Response.ok(groups).build();
    }

    /**
     * Marks one duplicate group as "not actually the same team" so it stops
     * being suggested. Identified by the group's normalized name set (not an
     * id - groups aren't persisted rows), so if the group's membership later
     * changes (e.g. a new similarly-named team appears) it's treated as a
     * fresh suggestion rather than staying silently dismissed.
     */
    @POST
    @Path("/duplicates/dismiss")
    @Transactional
    public Response dismissDuplicate(DismissDuplicateRequest body) {
        if (body == null || body.names() == null || body.names().isEmpty()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("NAMES_REQUIRED").build();
        }
        Set<String> dismissed = loadDismissed();
        dismissed.add(dismissKey(body.names()));
        saveDismissed(dismissed);
        return Response.status(Response.Status.NO_CONTENT).build();
    }

    /** Order-independent identity key for a duplicate group: each name's
     *  normalized form, deduped and sorted. */
    private static String dismissKey(Collection<String> names) {
        return names.stream()
                .map(TeamNameNormalizer::normalize)
                .collect(Collectors.toCollection(TreeSet::new))
                .stream()
                .collect(Collectors.joining("|"));
    }

    private Set<String> loadDismissed() {
        String raw = settings.get(KEY_DISMISSED_DUPLICATES);
        if (raw == null || raw.isBlank()) return new LinkedHashSet<>();
        try {
            List<String> list = json.readValue(raw, new TypeReference<List<String>>() {});
            return new LinkedHashSet<>(list);
        } catch (Exception e) {
            return new LinkedHashSet<>();
        }
    }

    private void saveDismissed(Set<String> dismissed) {
        try {
            settings.put(KEY_DISMISSED_DUPLICATES, json.writeValueAsString(new ArrayList<>(dismissed)));
        } catch (Exception e) {
            // Serializing a List<String> can't realistically fail.
        }
    }

    /**
     * Builds the response DTO for one duplicate group: variants sorted by
     * usage (most rows first), with a suggested canonical spelling - the
     * most-used variant, tie-broken toward mixed-case over ALL-CAPS (a
     * title-cased club name usually reads better than a shouted one) and
     * then alphabetically. The admin can always override the suggestion
     * before confirming the merge.
     */
    private static TeamDuplicateGroupDto buildGroupDto(String type, List<TeamNameVariantDto> stats) {
        List<TeamNameVariantDto> sorted = stats.stream()
                .sorted(Comparator
                        .comparingLong(TeamNameVariantDto::rowCount).reversed()
                        .thenComparing((TeamNameVariantDto s) -> isShouting(s.name()))
                        .thenComparing(TeamNameVariantDto::name))
                .toList();
        return new TeamDuplicateGroupDto(type, sorted, sorted.get(0).name());
    }

    /** True when the name has letters and none of them are lowercase (ALL-CAPS). */
    private static boolean isShouting(String name) {
        if (name == null || name.isBlank()) return false;
        boolean hasLetter = false;
        for (char c : name.toCharArray()) {
            if (Character.isLetter(c)) {
                hasLetter = true;
                if (Character.isLowerCase(c)) return false;
            }
        }
        return hasLetter;
    }

    private static String find(Map<String, String> parent, String x) {
        String root = x;
        while (!parent.get(root).equals(root)) root = parent.get(root);
        // Path compression.
        while (!parent.get(x).equals(root)) {
            String next = parent.get(x);
            parent.put(x, root);
            x = next;
        }
        return root;
    }

    private static void union(Map<String, String> parent, String a, String b) {
        String ra = find(parent, a), rb = find(parent, b);
        if (!ra.equals(rb)) parent.put(ra, rb);
    }

    /**
     * Merges every Teams row (and every other denormalized team-name
     * string) whose name is in {@code names} onto {@code canonicalName}.
     * Destructive/irreversible from the UI's point of view (the admin picks
     * the canonical spelling; the UI must confirm before calling this).
     *
     * Touches, in order:
     *   1. Teams.name - the identity itself.
     *   2. Tournaments.winnerName / secondPlaceName / thirdPlaceName - podium
     *      snapshots that feed the all-time team medal table.
     *   3. UserTeamPreset.name - a user's saved "par" name, used by the
     *      by-name auto-claim fallback.
     *   4. TeamDefaultKit rows - repointed + deduped onto the canonical
     *      normalized name.
     */
    @POST
    @Path("/merge")
    @Transactional
    public Response merge(TeamMergeRequest body) {
        if (body == null || body.names() == null || body.names().isEmpty()
                || body.canonicalName() == null || body.canonicalName().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("NAMES_AND_CANONICAL_REQUIRED").build();
        }
        String canonical = body.canonicalName().trim();
        // Names actually needing a rewrite (everything except rows that are
        // already spelled exactly like the canonical form).
        List<String> toRename = body.names().stream()
                .filter(n -> n != null && !n.equals(canonical))
                .distinct()
                .toList();

        int teamsRenamed = teamsRepo.renameTeams(toRename, canonical);
        int podiumFieldsRenamed = tournamentsRepo.renamePodiumNames(toRename, canonical);
        int presetsRenamed = presetRepo.mergeNames(toRename, canonical);
        // The default-kits merge needs every OLD name's normalized form,
        // not just the un-renamed set (a kit could've been saved under any
        // spelling in the group, including one equal to the canonical form).
        Set<String> oldNormalized = new HashSet<>();
        for (String n : body.names()) oldNormalized.add(TeamNameNormalizer.normalize(n));
        int defaultKitsRepointed = defaultKitRepo.mergeInto(oldNormalized, canonical);

        return Response.ok(new TeamMergeResponse(
                teamsRenamed, podiumFieldsRenamed, presetsRenamed, defaultKitsRepointed)).build();
    }

    /* ─────────────────── DTOs ─────────────────── */

    public record TeamIdentityDto(String name, long rowCount, long tournamentsCount, boolean demo) {}

    public record TeamNameVariantDto(String name, long rowCount, long tournamentsCount) {}

    public record TeamDuplicateGroupDto(String type, List<TeamNameVariantDto> variants, String suggestedCanonical) {}

    public record SetTeamDemoRequest(@NotBlank String name, boolean demo) {}

    public record TeamMergeRequest(@NotEmpty List<String> names, @NotBlank String canonicalName) {}

    public record DismissDuplicateRequest(@NotEmpty List<String> names) {}

    public record TeamMergeResponse(int teamsRenamed, int podiumFieldsRenamed,
                                    int presetsRenamed, int defaultKitsRepointed) {}
}
