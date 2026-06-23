/* ──────────────────────────────────────────────────────────────────────────
   Tiny RFC-5545 .ics builder for "add a match to your calendar".

   Output is a one-event VCALENDAR string that iOS Safari, Android Chrome,
   Outlook and Google Calendar all import on click — no calendar-specific
   APIs, no platform forks. The blob download trick (see `downloadIcs`)
   is the same pattern the avatar uploader uses for client-side files.

   We intentionally keep the schema small (no RRULE, no organizer, no
   ATTENDEEs). Listing a tournament match doesn't need recurrence and
   the SPA has no read access to participants' email addresses anyway.
   ────────────────────────────────────────────────────────────────────── */

export type IcsEvent = {
    /** Stable UID for the event — typically `match-{id}@nogometni-turniri.com`.
     *  Calendar clients use this to dedupe re-imports of the same match. */
    uid: string
    /** Required. Localised free-text title — "Team A vs Team B". */
    summary: string
    /** Optional venue / address text. */
    location?: string | null
    /** Optional long-form description. The deep-link back to the match
     *  page is appended automatically when {@link IcsEvent.url} is set. */
    description?: string | null
    /** Deep link back to the match / tournament page. Surfaced both in
     *  the standalone URL property (Outlook/Google honour it) and at
     *  the end of the description (iOS only renders the description). */
    url?: string | null
    /** Kickoff time. */
    start: Date
    /** Match end. If absent we default to `start + 60min`. */
    end?: Date
}

/** RFC-5545 "DATE-TIME" form in UTC: 20260105T140000Z. Calendar clients
 *  will localise back to the user's timezone on import. */
function fmtUtc(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0")
    return (
        d.getUTCFullYear() +
        pad(d.getUTCMonth() + 1) +
        pad(d.getUTCDate()) +
        "T" +
        pad(d.getUTCHours()) +
        pad(d.getUTCMinutes()) +
        pad(d.getUTCSeconds()) +
        "Z"
    )
}

/** Escape per RFC-5545 §3.3.11 — commas, semicolons and backslashes get
 *  prefixed, hard newlines become literal "\n". Required or calendar
 *  clients refuse to parse the whole event. */
function esc(s: string): string {
    return s
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;")
}

/** Long property lines must be folded at 75 octets (RFC-5545 §3.1). We
 *  fold every 70 chars to stay safely under the limit even with multi-
 *  byte UTF-8 for Croatian diacritics. */
function fold(line: string): string {
    if (line.length <= 70) return line
    const parts: string[] = []
    for (let i = 0; i < line.length; i += 70) {
        parts.push((i === 0 ? "" : " ") + line.slice(i, i + 70))
    }
    return parts.join("\r\n")
}

export function buildMatchIcs(evt: IcsEvent): string {
    const end = evt.end ?? new Date(evt.start.getTime() + 60 * 60 * 1000)
    const desc = [evt.description, evt.url].filter(Boolean).join("\\n\\n")
    const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//nogometni-turniri.com//Match//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        fold("UID:" + evt.uid),
        // DTSTAMP is "when this iCal record was created". Spec requires it
        // for METHOD:PUBLISH events.
        "DTSTAMP:" + fmtUtc(new Date()),
        "DTSTART:" + fmtUtc(evt.start),
        "DTEND:" + fmtUtc(end),
        fold("SUMMARY:" + esc(evt.summary)),
        evt.location ? fold("LOCATION:" + esc(evt.location)) : null,
        desc ? fold("DESCRIPTION:" + desc) : null,
        evt.url ? fold("URL:" + evt.url) : null,
        "END:VEVENT",
        "END:VCALENDAR",
    ].filter((l): l is string => l !== null)
    // RFC-5545 line break is CRLF, not LF. Some Android calendar parsers
    // silently accept LF; iOS Calendar (which is the strictest of the
    // three big platforms) rejects the whole file.
    return lines.join("\r\n")
}

/** Trigger a download of the given .ics text as `filename.ics`. Works
 *  the same as the browser's regular file-save path; mobile browsers
 *  hand the file to the OS, which prompts to add the event. */
export function downloadIcs(filename: string, ics: string): void {
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename.toLowerCase().endsWith(".ics") ? filename : `${filename}.ics`
    document.body.appendChild(a)
    a.click()
    // Defer revoke + DOM cleanup until the browser has actually dispatched
    // the download. 0ms is enough for Chrome/Firefox/Edge; Safari has been
    // observed to need a tick on slower devices.
    setTimeout(() => {
        URL.revokeObjectURL(url)
        a.remove()
    }, 100)
}
