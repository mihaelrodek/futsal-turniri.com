import { http } from "./http"

/** "Zatraži ponudu" lead for the custom camera package - price on request.
 *  Name, both contacts, tournament name and a description are all mandatory. */
export interface CameraInquiryPayload {
    name: string
    contactEmail: string
    contactPhone: string
    tournamentName: string
    message: string
}

export async function submitCameraInquiry(payload: CameraInquiryPayload): Promise<void> {
    await http.post("/camera-inquiries", payload, {
        successMessage: "Upit je poslan - javljamo se uskoro s ponudom.",
    })
}

/** Wire shape returned by GET /camera-inquiries (admin). */
export interface CameraInquiryDto {
    id: number
    name: string
    contactEmail: string
    contactPhone: string
    tournamentName: string
    message: string
    createdAt: string
    /** Set once an admin has dealt with the lead. An inquiry has no other
     *  lifecycle, so this flag is the only thing that lets the admin
     *  dashboard's „nova ponuda" badge ever clear. Null = still open. */
    handledAt: string | null
}

export async function fetchCameraInquiries(): Promise<CameraInquiryDto[]> {
    const res = await http.get<CameraInquiryDto[]>("/camera-inquiries")
    return res.data
}

/** Marks a lead handled (or re-opens it). Returns the updated row. */
export async function setCameraInquiryHandled(
    id: number,
    handled: boolean,
): Promise<CameraInquiryDto> {
    const res = await http.post<CameraInquiryDto>(`/camera-inquiries/${id}/handled`, { handled })
    return res.data
}
