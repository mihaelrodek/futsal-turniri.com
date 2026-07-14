import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Stream ad library (admin) - the pool of images / short videos the admin can
   show in the home-page hero while the stream banner is in ADS mode. Each ad's
   blob lives in MinIO; `url` is the anonymous-readable proxy path the public
   banner points an <img>/<video loop> at.
   ────────────────────────────────────────────────────────────────────────── */

export type AdMediaType = "IMAGE" | "VIDEO"

/** AD replaces the stream (ADS mode); OVERLAY is drawn centred over the video. */
export type AdPurpose = "AD" | "OVERLAY"

export type AdMedia = {
    id: number
    mediaType: AdMediaType
    url: string
    label: string | null
    createdAt: string | null
}

/** One purpose's media library (admin only), newest first. */
export async function fetchStreamAds(purpose: AdPurpose = "AD"): Promise<AdMedia[]> {
    const { data } = await http.get<AdMedia[]>("/stream-ads", {
        params: { purpose },
        silent: true,
    } as any)
    return data ?? []
}

/** Upload a new media item (image or video). The backend decides the media
 *  type from the file's magic bytes. */
export async function uploadStreamAd(file: File, label: string, purpose: AdPurpose = "AD"): Promise<AdMedia> {
    const form = new FormData()
    form.append("file", file)
    if (label.trim()) form.append("label", label.trim())
    form.append("purpose", purpose)
    // Pass "multipart/form-data" explicitly (same trick as uploadAvatar /
    // updatePoster): axios detects the FormData body and replaces this with the
    // proper Content-Type INCLUDING the boundary. Needed because the global
    // axios default Content-Type: application/json would otherwise be sent and
    // the backend's @Consumes(MULTIPART_FORM_DATA) would reject it with 415.
    const { data } = await http.post<AdMedia>("/stream-ads", form, {
        headers: { "Content-Type": "multipart/form-data" },
        successMessage: "Reklama je dodana.",
    } as any)
    return data
}

/** Delete an ad from the library (also removes its MinIO blob). */
export async function deleteStreamAd(id: number): Promise<void> {
    await http.delete(`/stream-ads/${id}`, { successMessage: "Reklama je obrisana." } as any)
}
