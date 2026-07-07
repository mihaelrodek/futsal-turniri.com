import { http } from "./http";
import type {
    CreateTournamentPayload,
    TournamentCard,
    TournamentDetails,
} from "../types/tournaments";
import type { TeamDraft, TeamShort } from "../types/teams";

export async function createTournament(payload: CreateTournamentPayload): Promise<TournamentDetails> {
    const body: CreateTournamentPayload = {
        name: payload.name.trim(),
        location: payload.location ?? null,
        details: payload.details ?? null,
        startAt: payload.startAt ?? null,
        status: payload.status ?? "DRAFT",
        // null = no cap; backend defaults to 16 only if it sees null AND
        // the format actually needs an upper bound. Open-entry tournaments
        // can ship null here and the field stays blank in the UI.
        maxTeams: payload.maxTeams ?? null,
        format: payload.format ?? "GROUPS_KNOCKOUT",
        groupCount: payload.groupCount ?? null,
        advancePerGroup: payload.advancePerGroup ?? null,
        bracketFill: payload.bracketFill ?? null,
        entryPrice: payload.entryPrice ?? 0,
        contactName: payload.contactName ?? null,
        contactPhone: payload.contactPhone ?? null,
        rewardType: payload.rewardType ?? null,
        rewardFirst: payload.rewardFirst ?? null,
        rewardSecond: payload.rewardSecond ?? null,
        rewardThird: payload.rewardThird ?? null,
        resourceId: payload.resourceId ?? null,
    };

    const { data } = await http.post<TournamentDetails>(
        "/tournaments",
        body,
        { successMessage: "Turnir je kreiran." } as any,
    );
    return data;
}

export async function fetchTournaments(
    status: "upcoming" | "finished" = "upcoming",
    opts?: { offset?: number; limit?: number },
): Promise<TournamentCard[]> {
    const params: Record<string, string | number> = { status };
    if (opts?.offset != null) params.offset = opts.offset;
    if (opts?.limit != null) params.limit = opts.limit;
    const { data } = await http.get<TournamentCard[]>("/tournaments", { params });
    return data;
}

/**
 * Backend-side total count for a status bucket. Used by the "Učitaj više"
 * button on the finished list to know when to stop offering more.
 */
export async function fetchTournamentsCount(
    status: "finished" = "finished",
): Promise<number> {
    const { data } = await http.get<{ total: number }>("/tournaments/count", {
        params: { status },
        // No success toast for a background count.
        silent: true,
    } as any);
    return data.total
}

export async function fetchTournamentDetails(uuid: string): Promise<TournamentDetails> {
    const { data } = await http.get<TournamentDetails>(`/tournaments/${uuid}`);
    return data;
}

/** Whether the roster is locked (the draw has been generated) - once true,
 *  teams can no longer be added or removed. */
export async function fetchRosterLocked(uuid: string): Promise<boolean> {
    const { data } = await http.get<{ locked: boolean }>(
        `/tournaments/${uuid}/roster-locked`,
        { silent: true } as any,
    );
    return !!data?.locked;
}

export async function updateTournament(
    uuid: string,
    payload: CreateTournamentPayload,
): Promise<TournamentDetails> {
    const { data } = await http.put<TournamentDetails>(
        `/tournaments/${uuid}`,
        payload,
        { successMessage: "Turnir je ažuriran." } as any,
    );
    return data;
}

/**
 * Replace the tournament's poster image. Sent as multipart so the
 * browser sets the boundary automatically. Owner-only on the backend.
 *
 * Note: we pass "multipart/form-data" explicitly (the same trick the
 * working uploadAvatar uses). Axios detects the FormData body and
 * replaces this value with the proper Content-Type including the
 * boundary. Setting the header to `undefined` is unreliable here
 * because the global axios default Content-Type: application/json
 * can leak through depending on how the merge resolves.
 */
export async function uploadTournamentPoster(
    uuid: string,
    file: File,
): Promise<TournamentDetails> {
    const fd = new FormData()
    fd.append("poster", file)
    const { data } = await http.post<TournamentDetails>(
        `/tournaments/${uuid}/poster`,
        fd,
        {
            headers: { "Content-Type": "multipart/form-data" },
            silent: true, // the JSON save already toasted "Turnir je ažuriran."
        } as any,
    )
    return data
}

/** Remove the tournament's poster. */
export async function deleteTournamentPoster(uuid: string): Promise<TournamentDetails> {
    const { data } = await http.delete<TournamentDetails>(
        `/tournaments/${uuid}/poster`,
        { silent: true } as any,
    )
    return data
}

export async function fetchTeams(tournamentId: string): Promise<TeamShort[]> {
    const { data } = await http.get<TeamShort[]>(`/tournaments/${tournamentId}/teams`);
    return data;
}

export async function fetchTournamentTeams(uuid: string): Promise<TeamShort[]> {
    const { data } = await http.get<TeamShort[]>(`/tournaments/${uuid}/teams`)
    return data
}

export async function replaceTeams(tournamentId: string, teams: Array<TeamShort | TeamDraft>): Promise<TeamShort[]> {
    const hasEmpty = teams.some(p => !p.name || p.name.trim() === "");
    if (hasEmpty) throw new Error("Team name cannot be empty.");

    const payload = teams.map(p => ({
        id: typeof p.id === "number" && p.id > 0 ? p.id : null,
        name: p.name.trim(),
        isEliminated: !!p.isEliminated,
    }));

    const { data } = await http.put<TeamShort[]>(`/tournaments/${tournamentId}/teams`, payload);
    return data;
}

export async function finishTournament(uuid: string): Promise<TournamentDetails> {
    const { data } = await http.post<TournamentDetails>(
        `/tournaments/${uuid}/finish`,
        undefined,
        { successMessage: "Turnir je završen." } as any,
    )
    return data
}

export async function startTournament(uuid: string): Promise<TournamentDetails> {
    // 409 statuses (INSUFFICIENT_TEAMS, ALREADY_FINISHED) are handled by the
    // caller - suppress the generic red toast to avoid stacked messages.
    const { data } = await http.put<TournamentDetails>(
        `/tournaments/${uuid}/start`,
        undefined,
        {
            successMessage: "Turnir je pokrenut.",
            silentErrorStatuses: [409],
        } as any,
    )
    return data
}

export async function resetTournament(uuid: string): Promise<TournamentDetails> {
    const res = await http.post<TournamentDetails>(
        `/tournaments/${uuid}/reset`,
        {},
        { successMessage: "Turnir je resetiran." } as any,
    )
    return res.data
}

/**
 * Set 2nd + 3rd place after the tournament finishes. Either field may
 * be null/empty to clear that podium position. Backend rejects names
 * that don't match a team in the tournament, names that match the
 * gold winner, or both fields being identical.
 */
export async function setPodium(
    uuid: string,
    secondPlaceName: string | null,
    thirdPlaceName: string | null,
): Promise<TournamentDetails> {
    const { data } = await http.patch<TournamentDetails>(
        `/tournaments/${uuid}/podium`,
        { secondPlaceName, thirdPlaceName },
        { successMessage: "Postolje spremljeno." } as any,
    )
    return data
}

export async function selfRegisterTeam(tournamentUuid: string, name: string): Promise<TeamShort> {
    const { data } = await http.post<TeamShort>(
        `/tournaments/${tournamentUuid}/teams/self-register`,
        { name },
        { successMessage: "Prijava poslana." } as any,
    )
    return data
}

export async function approveTeam(tournamentUuid: string, teamId: number): Promise<TeamShort> {
    const { data } = await http.post<TeamShort>(
        `/tournaments/${tournamentUuid}/teams/${teamId}/approve`,
        undefined,
        { successMessage: "Ekipa je odobrena." } as any,
    )
    return data
}

export async function deleteTeam(tournamentUuid: string, teamId: number): Promise<void> {
    await http.delete(
        `/tournaments/${tournamentUuid}/teams/${teamId}`,
        { successMessage: "Ekipa je obrisana." } as any,
    )
}

export async function deleteTournament(tournamentUuid: string): Promise<void> {
    await http.delete(
        `/tournaments/${tournamentUuid}`,
        { successMessage: "Turnir je obrisan." } as any,
    )
}

/* ── Individual awards (best GK / player / scorer) ──────────────────── */

export type AwardSuggestions = {
    bestScorer: { name: string | null; teamName: string | null; goals: number } | null
    bestPlayer: { name: string | null; teamName: string | null; goals: number } | null
    bestGoalkeeperTeam: { teamName: string | null; goalsConceded: number } | null
}

export type AwardsPayload = {
    bestGoalkeeperName?: string | null
    bestPlayerName?: string | null
    bestScorerName?: string | null
}

/** Data-driven award suggestions for a finished tournament (organizer-only). */
export async function fetchAwardSuggestions(
    tournamentUuid: string,
): Promise<AwardSuggestions> {
    const { data } = await http.get<AwardSuggestions>(
        `/tournaments/${tournamentUuid}/awards/suggestions`,
        { silent: true } as any,
    )
    return data
}

/** Persist the three individual awards (organizer-only). */
export async function saveAwards(
    tournamentUuid: string,
    payload: AwardsPayload,
): Promise<TournamentDetails> {
    const { data } = await http.post<TournamentDetails>(
        `/tournaments/${tournamentUuid}/awards`,
        payload,
        { successMessage: "Nagrade su spremljene." } as any,
    )
    return data
}

/**
 * "Tournament of the day" - public read.
 *
 * Returns the admin-curated featured TournamentCard, or {@code null} when
 * none is featured. The backend responds with 204 No Content in the empty
 * case, which axios surfaces as an empty response body - we normalise
 * both shapes to {@code null} so callers can `?? something` cleanly.
 *
 * Defensive 404 handling: until the backend ships with the new
 * `/tournaments/featured` route, requests fall through to the
 * catch-all `/{uuid}` handler which 404s. We catch any failure here
 * and return null so the SPA degrades gracefully (no hero, no toast)
 * across both old and new backend builds. The `silent: true` flag is
 * still set as a redundant safety net, and `silentErrorStatuses`
 * silences the toast specifically for 404s in case anyone tweaks the
 * interceptor later.
 */
export async function fetchFeaturedTournament(): Promise<TournamentCard | null> {
    try {
        const res = await http.get<TournamentCard | "">(
            "/tournaments/featured",
            { silent: true, silentErrorStatuses: [404] } as any,
        )
        if (res.status === 204) return null
        if (!res.data || typeof res.data !== "object") return null
        return res.data as TournamentCard
    } catch {
        // Backend route not yet deployed, network blip, anything -
        // hide the hero, page keeps working.
        return null
    }
}

/** Admin: mark a tournament as the daily highlight. Idempotent - calling
 *  on an already-featured tournament just refreshes the timestamp. */
export async function featureTournament(uuid: string): Promise<void> {
    await http.post(
        `/admin/tournaments/${uuid}/feature`,
        undefined,
        { successMessage: "Turnir je istaknut za dan." } as any,
    )
}

/** Admin: remove the daily highlight from a tournament. */
export async function unfeatureTournament(uuid: string): Promise<void> {
    await http.delete(
        `/admin/tournaments/${uuid}/feature`,
        { successMessage: "Istaknuto uklonjeno." } as any,
    )
}

/** Admin: mark a tournament as NOT publicly visible - only the creator and
 *  admins keep seeing/opening it (greyed out); everyone else gets 404 and it
 *  drops out of lists, live, sitemap and link previews. Reversible. */
export async function hideTournament(uuid: string): Promise<void> {
    await http.post(
        `/admin/tournaments/${uuid}/hidden`,
        undefined,
        { successMessage: "Turnir je sakriven od javnosti." } as any,
    )
}

/** Admin: make a hidden tournament publicly visible again. */
export async function unhideTournament(uuid: string): Promise<void> {
    await http.delete(
        `/admin/tournaments/${uuid}/hidden`,
        { successMessage: "Turnir je ponovno javno vidljiv." } as any,
    )
}
