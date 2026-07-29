import { http } from "./http"

/** Lead for the custom "camera package" pricing tier - price on request. */
export interface CameraInquiryPayload {
    name: string
    contactEmail?: string
    contactPhone?: string
    tournamentName?: string
    message?: string
}

export async function submitCameraInquiry(payload: CameraInquiryPayload): Promise<void> {
    await http.post("/camera-inquiries", payload, {
        successMessage: "Upit je poslan - javljamo se uskoro s ponudom.",
    })
}
