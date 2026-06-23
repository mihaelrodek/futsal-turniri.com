import type { TeamShort } from "../types/teams";
// Use the shared http instance so this file inherits the Firebase auth header
// AND the global success/error toast interceptors. The standalone axios.create
// it used before bypassed both.
import { http as api } from "./http";

export async function getTeams(tournamentId: string): Promise<TeamShort[]> {
    const { data } = await api.get(`/tournaments/${tournamentId}/teams`);
    return (data ?? []).map((p: any) => ({
        id: Number(p.id),
        name: p.name,
        isEliminated: !!p.isEliminated,
    }));
}

export type TeamUpsert = {
    id?: string;
    name: string;
    isEliminated?: boolean;
};

export async function replaceTeams(
    tournamentId: string,
    teams: TeamShort[]
): Promise<TeamShort[]> {
    const { data } = await api.put(`/tournaments/${tournamentId}/teams`, teams);
    return (data ?? []).map((p: any) => ({
        id: Number(p.id),
        name: p.name,
        isEliminated: !!p.isEliminated,
    }));
}
