import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   "Kontaktiraj nas" - the generic public contact form (/kontakt) plus the
   admin inbox behind it. Mirrors `cameraInquiry.ts`: a fully public create,
   an admin list, and one `handledAt` toggle that is the only state a message
   ever carries (the reply itself happens over email).
   ────────────────────────────────────────────────────────────────────── */

/**
 * Why the visitor is writing. Fixed keys, mirrored by
 * `ContactController.REASONS` - the wire value is the KEY, never the label,
 * so a stored row carries no language. Order here is the order of the
 * dropdown; labels live in i18n under `pages.contactPage.reasons`.
 */
export const CONTACT_REASONS = [
    "PLACANJE",
    "SNIMKA",
    "TURNIR",
    "SURADNJA",
    "INFORMACIJE",
    "GRESKA",
    "OSTALO",
] as const

export type ContactReason = (typeof CONTACT_REASONS)[number]

/** Body of POST /contact. `subject` is the only optional field. */
export interface ContactMessagePayload {
    name: string
    email: string
    /** Optional - most senders skip it, so it may be omitted entirely. */
    subject?: string
    message: string
    reason: ContactReason
}

/**
 * Sends the public contact form.
 *
 * Deliberately raises NO success toast: the page renders an inline
 * confirmation block instead (it has to say that a confirmation email went
 * out, which is more than a toast should carry). Errors still surface
 * through the global interceptor - including the backend's 429 when the
 * in-memory spam guard trips.
 */
export async function submitContactMessage(payload: ContactMessagePayload): Promise<void> {
    await http.post("/contact", payload)
}

/** Wire shape returned by GET /contact (admin). */
export interface ContactMessageDto {
    id: number
    name: string
    email: string
    /** Null when the sender left the subject blank. */
    subject: string | null
    message: string
    /** Never null on the wire: the backend maps a missing/unknown value (and
     *  every row written before the field existed) to „OSTALO". */
    reason: ContactReason
    createdAt: string
    /** Set once an admin has answered. A message has no other lifecycle, so
     *  this flag is the only thing that lets the admin dashboard's „poruke"
     *  badge ever clear. Null = still open. */
    handledAt: string | null
    /** Firebase uid when the sender happened to be signed in - informational
     *  only, the form itself is public. */
    userUid: string | null
}

export async function fetchContactMessages(): Promise<ContactMessageDto[]> {
    const res = await http.get<ContactMessageDto[]>("/contact")
    return res.data
}

/** Marks a message answered (or re-opens it). Returns the updated row. */
export async function setContactMessageHandled(
    id: number,
    handled: boolean,
): Promise<ContactMessageDto> {
    const res = await http.post<ContactMessageDto>(`/contact/${id}/handled`, { handled })
    return res.data
}

/**
 * Query key for the admin inbox. Exported here rather than added to `qk`
 * (queryClient.ts) so this feature owns its own cache entry without turning
 * that file into a merge point - same reasoning as
 * `ADMIN_PENDING_COUNTS_KEY` in `adminCounts.ts`.
 */
export const ADMIN_CONTACT_MESSAGES_KEY = ["admin", "contactMessages"] as const
