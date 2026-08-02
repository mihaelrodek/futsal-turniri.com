import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Admin "Pošalji mail" module (backend: AdminMailController, /admin/mail).

   Transactional email is fire-and-forget everywhere else in the platform, so
   a dropped "zahtjev je odobren" leaves no trace and no retry. This module is
   the manual escape hatch: re-send the exact copy the automatic notifier would
   have sent (to any address), or write a free-form message - and keep an audit
   log of every attempt.
   ────────────────────────────────────────────────────────────────────── */

/** Backend enum AdminMailController.MailTemplateKey (wire values). */
export type AdminMailTemplateKey =
    | "FREEFORM"
    | "RECORDING_RECEIVED"
    | "RECORDING_APPROVED"
    | "RECORDING_PAYMENT_LINK"
    | "RECORDING_DELIVERED"

export type AdminMailTemplate = {
    key: AdminMailTemplateKey
    /** Localised label, rendered by the backend message bundle. */
    label: string
    /** True when the template renders one recording request and can't be sent without one. */
    needsRecordingRequest: boolean
}

/** One row of the recording-request picker - enough to recognise a request
 *  without typing its uuid. */
export type AdminMailRecordingPick = {
    uuid: string
    /** "Ekipa A - Ekipa B" (undecided knockout slots read "TBD"). */
    matchLabel: string
    tournamentName: string | null
    contactEmail: string | null
    status: string
    paid: boolean
}

/** Audit row written by every send from this screen. */
export type AdminSentMail = {
    id: number
    createdAt: string
    /** Firebase UID of the admin who pressed send. */
    sentByUid: string | null
    toEmail: string
    templateKey: AdminMailTemplateKey
    subject: string
    /** First ~500 characters of the sent body, tags stripped. */
    bodyPreview: string | null
    recordingRequestUuid: string | null
    /** Accepted by the mailer - the SMTP hand-off itself is asynchronous. */
    ok: boolean
    errorMessage: string | null
}

export type SendAdminMailPayload = {
    templateKey: AdminMailTemplateKey
    toEmail: string
    /** FREEFORM only. */
    subject?: string | null
    /** FREEFORM only - plain text; blank lines become paragraphs. */
    bodyText?: string | null
    /** Required by every template except FREEFORM. */
    recordingRequestUuid?: string | null
}

/**
 * Query keys for this module. Exported here rather than added to `qk`
 * (queryClient.ts) for the same reason `ADMIN_PENDING_COUNTS_KEY` is - one
 * shared cache entry per read, without that file becoming a merge point.
 */
export const ADMIN_MAIL_TEMPLATES_KEY = ["admin", "mail", "templates"] as const
export const ADMIN_MAIL_LOG_KEY = ["admin", "mail", "log"] as const
export const adminMailRecordingPickKey = (q: string) =>
    ["admin", "mail", "recordingRequests", q] as const

/** The templates an admin can pick from, in backend-declared order. */
export async function fetchAdminMailTemplates(): Promise<AdminMailTemplate[]> {
    const { data } = await http.get<AdminMailTemplate[]>("/admin/mail/templates")
    return data
}

/**
 * Recent recording requests for the picker, newest first. `q` (optional)
 * matches the match label, tournament name, contact email and uuid.
 */
export async function fetchAdminMailRecordingRequests(
    q?: string,
): Promise<AdminMailRecordingPick[]> {
    const { data } = await http.get<AdminMailRecordingPick[]>("/admin/mail/recording-requests", {
        params: q && q.trim() ? { q: q.trim() } : undefined,
    })
    return data
}

/**
 * Renders + sends the mail and returns the audit row it wrote.
 *
 * 409 {"code": …} when a template's precondition fails - REQUEST_NOT_FOUND,
 * NOT_APPROVED, ALREADY_PAID, STRIPE_NOT_CONFIGURED, NOT_DELIVERED, NOT_PAID,
 * MAIL_NOT_CONFIGURED. The screen owns that UX (it maps each code to a
 * specific sentence), so the generic red toast is suppressed for 409.
 */
export async function sendAdminMail(payload: SendAdminMailPayload): Promise<AdminSentMail> {
    const { data } = await http.post<AdminSentMail>("/admin/mail/send", payload, {
        silent: true,
        silentErrorStatuses: [409],
    })
    return data
}

/** Everything sent from this screen, newest first. */
export async function fetchAdminMailLog(): Promise<AdminSentMail[]> {
    const { data } = await http.get<AdminSentMail[]>("/admin/mail/log")
    return data
}
