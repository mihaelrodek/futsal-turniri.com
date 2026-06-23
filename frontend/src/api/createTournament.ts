import { http } from "./http"
import type { CreateTournamentPayload, TournamentDetails } from "../types/tournaments"

/**
 * Creates a tournament.
 * - If `posterFile` is provided, sends ONE multipart/form-data request to /tournaments/multipart
 *   with JSON in the "data" part and the file in the "poster" part.
 * - If no file, falls back to the original JSON POST /tournaments.
 */
export async function createTournament(
    data: CreateTournamentPayload,
    posterFile?: File | null
): Promise<TournamentDetails> {
    if (posterFile) {
        const fd = new FormData()
        fd.append("data", JSON.stringify(data))
        fd.append("poster", posterFile, posterFile.name)

        // Do NOT set Content-Type; your http client (e.g. axios) will add the boundary automatically.
        const res = await http.post<TournamentDetails>("/tournaments/multipart", fd, {
            // Let the browser set the proper multipart boundary
            headers: { "Content-Type": undefined as any },
            successMessage: "Turnir je kreiran.",
        } as any)
        return res.data
    }

    // No file: keep the old JSON endpoint
    const res = await http.post<TournamentDetails>(
        "/tournaments",
        data,
        { successMessage: "Turnir je kreiran." } as any,
    )
    return res.data
}