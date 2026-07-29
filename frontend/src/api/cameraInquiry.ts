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
}

export async function fetchCameraInquiries(): Promise<CameraInquiryDto[]> {
    const res = await http.get<CameraInquiryDto[]>("/camera-inquiries")
    return res.data
}
