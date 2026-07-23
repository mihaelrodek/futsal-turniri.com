import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode, Ref } from "react"
import { Box, Button, Dialog, Flex, IconButton, Portal, Text } from "@chakra-ui/react"
import { FiDownload, FiX } from "react-icons/fi"
import { toJpeg, toPng } from "html-to-image"
import { jsPDF } from "jspdf"
import type { Group, GroupMatch, GroupStandingRow, ThirdPlacedRow, ThirdPlacedTable } from "../types/groups"
import type { Bracket, BracketMatch } from "../types/bracket"
import type { ScheduledMatch } from "../types/schedule"
import type { MatchEventDto, MatchEventType } from "../types/matchEvents"
import { fetchMatchEvents } from "../api/matchEvents"
import type { ScorerDto } from "../api/stats"
import { showError, showSuccess } from "../toaster"

/* ────────────────────────────────────────────────────────────────────────────
   Branded export - "plakat" (poster) generator for the group draw and the
   match schedule (futsal-turniri.com brand).

   Two portrait artifacts (plus the landscape bracket):
     - groups   → teams listed per group (Grupa A, B, C… cards).
     - schedule → matches grouped by day, each with time / stage tag / pairing.
   Both carry the same page furniture: a large low-opacity watermark mark, the
   tournament name, the organizer, a date • location line and a
   futsal-turniri.com footer.

   The portrait posters (groups + schedule) are PAGINATED: the content is split
   up-front into `PageContent` chunks and each chunk renders into its OWN
   fixed-size A4 DOM node (all pages mounted together in the hidden capture
   container). Page 1 carries the full header (name + QR); pages 2+ get a compact
   one-line header with a "Stranica X/Y" indicator. Every page keeps the
   watermark + centred footer via the shared `PosterPage` shell.

   Each page node is snapshotted with html-to-image (mirrors the
   BracketTab.shareBracket pattern: node → dataUrl → download). PDF = one jsPDF
   doc, one A4 page per rendered page node; JPG = one file when there is a single
   page, otherwise one JPG per page (`-1`, `-2`, … suffixes). The landscape
   bracket poster stays a single page.

   IMPORTANT - hard-coded hex colours (deliberate exception to the design-token
   rule): the poster must look IDENTICAL whether the app is in light or dark
   theme. html-to-image captures the *computed* colours, so theme tokens would
   flip the poster to dark colours for a dark-mode viewer. Every colour below is
   a literal brand hex so the exported artifact is theme-independent.
   ─────────────────────────────────────────────────────────────────────────── */

/** Tournament meta surfaced onto the poster header/footer. */
export type ExportMeta = {
    tournamentName: string
    organizerName?: string | null
    location?: string | null
    /** ISO tournament start - rendered as the "date" line. */
    startAt?: string | null
    /** Public tournament URL - shape `${origin}/turniri/<slugOrUuid>`. Its last
     *  path segment identifies the tournament for the branded QR endpoint
     *  (`/api/tournaments/<slugOrUuid>/qr.png`). The URL itself is NOT printed
     *  on the poster - only the QR + "Skeniraj i otvori turnir" caption. */
    tournamentUrl: string
}

/* -- Brand palette (literal hex, see file header) -------------------------
   SPECTO: navy + cyan brand pairing (no turf greens). `green` now names the
   brand ACCENT token (deep teal - headers/badges/hairline-rules/tiles), kept
   distinct from `win`, the semantic success-green used ONLY for genuine
   win/goal markers (winner names, positive goal-diff, goal glyphs) so the
   brand recolor doesn't wash out match-result meaning. */
const C = {
    /* Brand ACCENT - the app's main dark-theme surface #111F31 (bg.panel, the
       navbar colour): group letter tiles, "N prolaze" chips, hairline rules,
       rank numbers, headers. The qualifying-row MARK stays cyan (greenMid) -
       see the tables below. */
    green: "#111F31",
    greenMid: "#2AD4C8",
    ink: "#1B2836",
    inkSoft: "#3D4C5B",
    surface: "#EDF1F5",
    line: "#DDE3E8",
    white: "#ffffff",
    muted: "#5F7080",
    greenWash: "rgba(42,212,200,0.12)",
    zebra: "rgba(42,212,200,0.10)",
    /* Semantic success green (win/goal markers only - see file header note). */
    win: "#16A34A",
    /* Live accent (only place a non-brand hue appears on the poster). */
    live: "#d64545",
    liveWash: "rgba(214,69,69,0.07)",
}
/* Font stacks hard-coded to match system.ts tokens (heading / mono / body). */
const F_HEAD = "'Bricolage Grotesque', 'Inter', system-ui, -apple-system, sans-serif"
const F_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace"
const F_BODY = "'Inter', system-ui, -apple-system, sans-serif"

/* A4 at 96dpi (css px). Captured at pixelRatio 2 for print crispness. Portrait
   is the default (groups / schedule posters); the bracket poster is landscape
   (brackets are wide), so the page dimensions are orientation-driven. */
const A4_W = 794
const A4_H = 1123
// A3 is √2× A4 in each dimension. The bracket poster uses A3 PORTRAIT so a full
// R32 two-sided draw gets far wider columns (the fixed-px header / footer /
// padding become a smaller fraction of the bigger sheet, so more of it is body).
const A3_W = 1123
const A3_H = 1587

type Orientation = "portrait" | "landscape" | "a3portrait"
/** Page css px per page size. Landscape swaps A4's w/h; a3portrait is the big
 *  bracket sheet. All are printed portrait except `landscape` (unused now). */
const PAGE_PX: Record<Orientation, { w: number; h: number }> = {
    portrait: { w: A4_W, h: A4_H },
    landscape: { w: A4_H, h: A4_W },
    a3portrait: { w: A3_W, h: A3_H },
}

/* -- Stage labels (mirrors ScheduleTab.STAGE_LABEL) ---------------------- */
const STAGE_LABEL: Record<string, string> = {
    GROUP: "Grupa",
    ROUND_OF_32: "1/16 finala",
    ROUND_OF_16: "Osmina finala",
    QUARTERFINAL: "Četvrtfinale",
    SEMIFINAL: "Polufinale",
    FINAL: "Finale",
    THIRD_PLACE: "Za 3. mjesto",
}
const HR_WEEKDAYS = ["NEDJELJA", "PONEDJELJAK", "UTORAK", "SRIJEDA", "ČETVRTAK", "PETAK", "SUBOTA"]

/* ── helpers ─────────────────────────────────────────────────────────── */

/** URL-safe slug of the tournament name (Croatian diacritics folded). */
function slugify(s: string): string {
    return (
        s
            .toLowerCase()
            .replace(/č|ć/g, "c")
            .replace(/đ/g, "d")
            .replace(/š/g, "s")
            .replace(/ž/g, "z")
            .normalize("NFKD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "turnir"
    )
}

/** Local calendar-day key (YYYY-MM-DD) used to bucket the schedule. */
function dateKey(iso?: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "SUBOTA, 18.7.2026." day heading for the schedule sections. */
function dayHeaderLabel(key: string): string {
    const [y, m, d] = key.split("-").map(Number)
    const dt = new Date(y, m - 1, d)
    return `${HR_WEEKDAYS[dt.getDay()]}, ${d}.${m}.${y}.`
}

/** HH:mm (local) kickoff time. */
function hhmm(iso: string | null): string {
    if (!iso) return "--:--"
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return "--:--"
    const p = (n: number) => String(n).padStart(2, "0")
    return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Long date line, e.g. "18. srpnja 2026.". */
function formatDateLong(iso?: string | null): string | null {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString("hr-HR", { day: "numeric", month: "long", year: "numeric" })
}

/* Short Croatian weekday (Sun-indexed), for the multi-day kickoff prefix. */
const HR_WEEKDAYS_SHORT = ["ned", "pon", "uto", "sri", "čet", "pet", "sub"]

/** "pon 29.06. · 13:15" - short weekday + short date + time (multi-day kickoff). */
export function dayDateTimeShort(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return "--:--"
    const p = (n: number) => String(n).padStart(2, "0")
    return `${HR_WEEKDAYS_SHORT[d.getDay()]} ${p(d.getDate())}.${p(d.getMonth() + 1)}. · ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** True when the given kickoffs span more than one distinct local calendar day
 *  - the trigger for showing day+date (not just HH:mm) on every kickoff. */
export function isMultiDay(isos: (string | null | undefined)[]): boolean {
    const keys = new Set<string>()
    for (const iso of isos) {
        const k = dateKey(iso)
        if (k) keys.add(k)
    }
    return keys.size > 1
}

/** Kickoff label for on-page / poster rows: "pon 29.06. · 13:15" when the
 *  tournament is multi-day, else the bare "13:15". */
export function kickoffLabel(iso: string, withDay: boolean): string {
    return withDay ? dayDateTimeShort(iso) : hhmm(iso)
}

/** Branded-QR endpoint for a tournament, derived from the ExportMeta URL
 *  (`${origin}/turniri/<slugOrUuid>` → `/api/tournaments/<slugOrUuid>/qr.png`).
 *  Same-origin, so the fetch below stays taint-free. Null when no URL. */
function qrEndpoint(tournamentUrl: string | null | undefined): string | null {
    if (!tournamentUrl) return null
    const seg = tournamentUrl.replace(/\/+$/, "").split("/").pop()
    if (!seg) return null
    // ?v bust: the QR PNG is cached hard (max-age 86400 + s-maxage + the SW), so
    // a design change stays stale for a day otherwise. Bump on any QR change.
    return `/api/tournaments/${encodeURIComponent(seg)}/qr.png?v=3`
}

/** Stage/group tag for a schedule row. */
function stageTag(m: ScheduledMatch): string {
    if (m.stage === "GROUP") return m.groupName ? `Grupa ${m.groupName}` : "Grupa"
    return STAGE_LABEL[m.stage] ?? m.stage
}

/** Knockout pairing fallback chain (mirrors ScheduleTab). */
function pairingName(name: string | null, pred: string | null, label: string | null): string {
    return name ?? pred ?? label ?? "TBD"
}

/** Stage/group badge for the match poster ("Grupa X" / "Četvrtfinale" …), or
 *  null when the stage is unknown. Uses the same STAGE_LABEL map as the rest of
 *  the export so the badge text matches the schedule / bracket posters. */
function matchStageBadge(stage?: string | null, groupName?: string | null): string | null {
    if (!stage) return null
    if (stage === "GROUP") return groupName ? `Grupa ${groupName}` : "Grupa"
    return STAGE_LABEL[stage] ?? null
}

/** Full kickoff line for the match header - "subota, 18. srpnja 2026. · 20:30". */
function matchKickoffLine(iso: string | null): string | null {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    const date = d.toLocaleDateString("hr-HR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    return `${date} · ${hhmm(iso)}`
}

/* ── brand marks (inlined SVG - no network fetch, canvas-safe) ─────────── */

/** Full brand mark (light tile + teal goal + ball) - footer / header lockup.
 *  Matches the in-app Logo / app icon: #EDF0F3 tile + #17A79D teal art. */
function BrandMark({ size }: { size: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112" width={size} height={size}>
            <rect x="0" y="0" width="112" height="112" rx="28" fill="#EDF0F3" />
            <g stroke="#17A79D" strokeWidth="1" opacity="0.6">
                <path d="M42 38 V82 M54 38 V82 M66 38 V82 M78 38 V82" />
                <path d="M30 50 H82 M30 62 H82 M30 74 H82" />
            </g>
            <path d="M30 82 V38 H82 V82" fill="none" stroke="#17A79D" strokeWidth="3.6" strokeLinejoin="round" />
            <svg x="39" y="60" width="34" height="34" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="46" fill="#fff" stroke="#17A79D" strokeWidth="2.6" />
                <g stroke="#17A79D" strokeWidth="2.3" strokeLinecap="round" fill="none">
                    <path d="M50,33 L50,7" />
                    <path d="M50,33 L50,7" transform="rotate(72 50 50)" />
                    <path d="M50,33 L50,7" transform="rotate(144 50 50)" />
                    <path d="M50,33 L50,7" transform="rotate(216 50 50)" />
                    <path d="M50,33 L50,7" transform="rotate(288 50 50)" />
                </g>
                <g fill="#17A79D">
                    <path d="M50,34 L65.22,45.06 L59.41,62.94 L40.59,62.94 L34.78,45.06 Z" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(72 50 50)" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(144 50 50)" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(216 50 50)" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(288 50 50)" />
                </g>
            </svg>
        </svg>
    )
}

/** Monochrome teal mark (no tile) - the huge background watermark. */
function WatermarkMark({ size }: { size: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112" width={size} height={size}>
            <g stroke="#17A79D" strokeWidth="1.4" opacity="0.6">
                <path d="M42 38 V82 M54 38 V82 M66 38 V82 M78 38 V82" />
                <path d="M30 50 H82 M30 62 H82 M30 74 H82" />
            </g>
            <path d="M30 82 V38 H82 V82" fill="none" stroke="#17A79D" strokeWidth="3.6" strokeLinejoin="round" />
            <svg x="39" y="60" width="34" height="34" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="46" fill="none" stroke="#17A79D" strokeWidth="2.6" />
                <g stroke="#17A79D" strokeWidth="2.3" strokeLinecap="round" fill="none">
                    <path d="M50,33 L50,7" />
                    <path d="M50,33 L50,7" transform="rotate(72 50 50)" />
                    <path d="M50,33 L50,7" transform="rotate(144 50 50)" />
                    <path d="M50,33 L50,7" transform="rotate(216 50 50)" />
                    <path d="M50,33 L50,7" transform="rotate(288 50 50)" />
                </g>
                <g fill="#17A79D">
                    <path d="M50,34 L65.22,45.06 L59.41,62.94 L40.59,62.94 L34.78,45.06 Z" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(72 50 50)" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(144 50 50)" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(216 50 50)" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(288 50 50)" />
                </g>
            </svg>
        </svg>
    )
}

/* ── poster page shell (shared furniture) ──────────────────────────────────
   ONE rendered A4 page. `pageIndex` / `pageCount` drive the header variant:
   page 0 gets the full lockup (name 3/4 + QR 1/4 + organizer + date•location),
   pages 1+ get a compact one-line header (small name + right-aligned
   "Stranica X/Y" indicator) so the paginated body gets the room. Every page
   keeps the upright watermark + the centred futsal-turniri.com footer, and is a
   FIXED-height A4 node (overflow hidden) so each page captures to exactly A4. */

function PosterPage({
    meta,
    qrDataUrl,
    nodeRef,
    orientation = "portrait",
    pageIndex,
    pageCount,
    headerExtra,
    children,
}: {
    meta: ExportMeta
    /** PNG data-URL of the branded (club-logo) QR; null until fetched. */
    qrDataUrl?: string | null
    /** Assigned to the page's root node so the dialog can snapshot it. */
    nodeRef?: Ref<HTMLDivElement>
    /** Page orientation - portrait (groups / schedule) or landscape (bracket). */
    orientation?: Orientation
    /** 0-based page index (0 → full header) and total page count. */
    pageIndex: number
    pageCount: number
    /** Optional extra line under the date•location line on page 1 (e.g. the
     *  match poster's UŽIVO + stage row). */
    headerExtra?: ReactNode
    children: ReactNode
}) {
    const dateStr = formatDateLong(meta.startAt)
    const metaLine = [dateStr, meta.location].filter(Boolean).join("  •  ")
    const page = PAGE_PX[orientation]
    const first = pageIndex === 0
    return (
        <div
            ref={nodeRef}
            style={{
                position: "relative",
                width: `${page.w}px`,
                height: `${page.h}px`,
                background: C.surface,
                color: C.ink,
                fontFamily: F_BODY,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                boxSizing: "border-box",
            }}
        >
            {/* Watermark - huge, low-opacity, upright, centred. */}
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    pointerEvents: "none",
                    zIndex: 0,
                }}
            >
                <div style={{ opacity: 0.05 }}>
                    <WatermarkMark size={640} />
                </div>
            </div>

            {/* Content column (above the watermark). */}
            <div
                style={{
                    position: "relative",
                    zIndex: 1,
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    minHeight: 0,
                    padding: "56px 56px 0",
                    boxSizing: "border-box",
                }}
            >
                {first ? (
                    <>
                        {/* Full header - name block (~3/4) left, QR block (~1/4) top-right. */}
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "28px" }}>
                            <div style={{ flex: 3, minWidth: 0 }}>
                                <div
                                    style={{
                                        fontFamily: F_HEAD,
                                        fontSize: "42px",
                                        fontWeight: 800,
                                        letterSpacing: "-0.02em",
                                        lineHeight: 1.04,
                                        color: C.ink,
                                    }}
                                >
                                    {meta.tournamentName}
                                </div>
                                {meta.organizerName ? (
                                    <div
                                        style={{
                                            fontFamily: F_MONO,
                                            fontSize: "12px",
                                            fontWeight: 700,
                                            letterSpacing: "0.12em",
                                            color: C.inkSoft,
                                            textTransform: "uppercase",
                                            marginTop: "16px",
                                        }}
                                    >
                                        ORGANIZATOR: {meta.organizerName}
                                    </div>
                                ) : null}
                                {metaLine ? (
                                    <div style={{ fontSize: "15px", fontWeight: 600, color: C.inkSoft, marginTop: "6px" }}>
                                        {metaLine}
                                    </div>
                                ) : null}
                                {headerExtra ? (
                                    <div style={{ marginTop: "10px" }}>{headerExtra}</div>
                                ) : null}
                            </div>
                            {/* Top-right lockup - the branded QR (prominent) once it is
                                ready, otherwise the plain brand mark as a graceful
                                fallback so the header stays balanced. */}
                            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "9px" }}>
                                {qrDataUrl ? (
                                    <>
                                        {/* Branded QR (club logo baked in by the backend) -
                                            rendered plain (the PNG carries its own light
                                            backdrop). No page URL is printed (QR only). */}
                                        <img
                                            src={qrDataUrl}
                                            alt=""
                                            style={{
                                                display: "block",
                                                width: "124px",
                                                height: "124px",
                                                borderRadius: "14px",
                                            }}
                                        />
                                        <div
                                            style={{
                                                fontFamily: F_HEAD,
                                                fontSize: "14px",
                                                fontWeight: 800,
                                                letterSpacing: "0.01em",
                                                color: C.green,
                                                textAlign: "center",
                                                lineHeight: 1.2,
                                                maxWidth: "128px",
                                            }}
                                        >
                                            Skeniraj QR kod i otvori turnir
                                        </div>
                                    </>
                                ) : (
                                    <BrandMark size={66} />
                                )}
                            </div>
                        </div>

                        {/* Green rule */}
                        <div style={{ height: "3px", background: C.green, borderRadius: "2px", margin: "26px 0 30px" }} />
                    </>
                ) : (
                    <>
                        {/* Compact continuation header - small name + page indicator. */}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "20px" }}>
                            <div
                                style={{
                                    fontFamily: F_HEAD,
                                    fontSize: "20px",
                                    fontWeight: 800,
                                    letterSpacing: "-0.01em",
                                    color: C.ink,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    minWidth: 0,
                                }}
                            >
                                {meta.tournamentName}
                            </div>
                            <div
                                style={{
                                    fontFamily: F_MONO,
                                    fontSize: "12px",
                                    fontWeight: 700,
                                    letterSpacing: "0.06em",
                                    color: C.inkSoft,
                                    whiteSpace: "nowrap",
                                    flexShrink: 0,
                                }}
                            >
                                Stranica {pageIndex + 1}/{pageCount}
                            </div>
                        </div>
                        <div style={{ height: "3px", background: C.green, borderRadius: "2px", margin: "16px 0 24px" }} />
                    </>
                )}

                {/* Body - clips so the footer can never be pushed off the page. */}
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{children}</div>

                {/* Footer - a single centred brand line (QR now lives top-right
                    in the header). Deliberately minimal: no mark, no second row. */}
                <div
                    style={{
                        borderTop: `1px solid ${C.line}`,
                        marginTop: "30px",
                        padding: "16px 0 26px",
                        textAlign: "center",
                    }}
                >
                    <span
                        style={{
                            fontFamily: F_MONO,
                            fontSize: "13px",
                            fontWeight: 700,
                            letterSpacing: "0.28em",
                            color: C.green,
                        }}
                    >
                        futsal-turniri.com
                    </span>
                </div>
            </div>
        </div>
    )
}

/* ── shared match row ──────────────────────────────────────────────────── */

/** Normalized poster match row - shared by the schedule poster and the
 *  single-group "Utakmice" list so the two stay pixel-identical. */
type PosterMatchRow = {
    /** ISO kickoff, or null when a time isn't set. */
    kickoffAt: string | null
    /** Stage / group tag pill text; omitted → the tag column is dropped
     *  (the single-group list has no per-row stage). */
    stage?: string | null
    /** When true, a timed row shows the short day+date above the HH:mm (the
     *  multi-day condition; set by the single-group list). */
    showDay?: boolean
    t1: string
    t2: string
    score1: number | null
    score2: number | null
    /** Penalty-shootout totals - shown on a second line under the regulation
     *  result when both are set (a decided shootout). */
    penalties1?: number | null
    penalties2?: number | null
    /** Which side won (1 = t1, 2 = t2) - the winning name is bolded green.
     *  Null for a draw / undecided. */
    winner?: 1 | 2 | null
    status: string
}

/** Short "pon 29.06." day label (weekday + date, no time). */
function dayDateShort(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const p = (n: number) => String(n).padStart(2, "0")
    return `${HR_WEEKDAYS_SHORT[d.getDay()]} ${p(d.getDate())}.${p(d.getMonth() + 1)}.`
}

/** One match row: [time-or-result] | [optional stage tag] | [t1 vs t2].
 *  Status-aware leading cell - FINISHED shows the bold result, LIVE shows it in
 *  the live accent, otherwise the kickoff time (or "-" when not yet timed). When
 *  `showDay` is set a timed row prefixes the day+date above the HH:mm. */
function MatchRowPoster({ row, compact }: { row: PosterMatchRow; compact?: boolean }) {
    const live = row.status === "LIVE"
    const finished = row.status === "FINISHED"
    const hasScore = row.score1 != null && row.score2 != null
    const showResult = (live || finished) && hasScore
    const leadColor = live ? C.live : showResult ? C.ink : row.kickoffAt ? C.ink : C.muted
    // Decided penalty shootout → a second line under the regulation result.
    const showPens = showResult && row.penalties1 != null && row.penalties2 != null
    // Two-line lead (day above time) only when timed, no result, and multi-day.
    const stackDay = !showResult && !!row.kickoffAt && !!row.showDay
    const w1 = row.winner === 1
    const w2 = row.winner === 2
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: compact ? "12px" : "16px",
                background: live ? C.liveWash : C.white,
                border: `1px solid ${live ? C.live : C.line}`,
                borderRadius: "10px",
                // Compact rows (single-group combined page) trim the vertical
                // padding so all six fixtures of a 4-team group fit one page.
                padding: compact ? "7px 14px" : "11px 16px",
            }}
        >
            <span
                style={{
                    fontFamily: F_MONO,
                    fontSize: showResult ? "15px" : "16px",
                    fontWeight: 800,
                    color: leadColor,
                    width: stackDay ? "86px" : "58px",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                    display: stackDay || showPens ? "flex" : undefined,
                    flexDirection: stackDay || showPens ? "column" : undefined,
                    // flex-start keeps the inner pens column at its natural
                    // width (default stretch would widen it to the full cell
                    // and break the centred-under-the-score alignment).
                    alignItems: stackDay || showPens ? "flex-start" : undefined,
                    lineHeight: stackDay || showPens ? 1.15 : undefined,
                }}
            >
                {showResult ? (
                    showPens ? (
                        /* Score + shootout in a natural-width column so the
                           "(4:5)" line centres exactly under the score above. */
                        <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
                            <span>{`${row.score1} : ${row.score2}`}</span>
                            <span style={{ fontSize: "10px", fontWeight: 700, color: C.muted }}>
                                {`(${row.penalties1}:${row.penalties2})`}
                            </span>
                        </span>
                    ) : (
                        `${row.score1} : ${row.score2}`
                    )
                ) : row.kickoffAt ? (
                    stackDay ? (
                        <>
                            <span style={{ fontSize: "10px", fontWeight: 700, color: C.muted }}>
                                {dayDateShort(row.kickoffAt)}
                            </span>
                            <span>{hhmm(row.kickoffAt)}</span>
                        </>
                    ) : (
                        hhmm(row.kickoffAt)
                    )
                ) : (
                    "-"
                )}
            </span>
            {row.stage ? (
                <span
                    style={{
                        fontFamily: F_MONO,
                        fontSize: "10px",
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        color: C.green,
                        background: C.greenWash,
                        padding: "5px 10px",
                        borderRadius: "999px",
                        width: "118px",
                        boxSizing: "border-box",
                        textAlign: "center",
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {row.stage}
                </span>
            ) : null}
            <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px" }}>
                <span
                    style={{
                        flex: 1,
                        textAlign: "right",
                        fontSize: "15px",
                        fontWeight: w1 ? 800 : 600,
                        color: w1 ? C.win : C.ink,
                        lineHeight: 1.2,
                        wordBreak: "break-word",
                    }}
                >
                    {row.t1}
                </span>
                <span style={{ fontFamily: F_MONO, fontSize: "12px", fontWeight: 700, color: C.muted, flexShrink: 0 }}>
                    vs
                </span>
                <span
                    style={{
                        flex: 1,
                        textAlign: "left",
                        fontSize: "15px",
                        fontWeight: w2 ? 800 : 600,
                        color: w2 ? C.win : C.ink,
                        lineHeight: 1.2,
                        wordBreak: "break-word",
                    }}
                >
                    {row.t2}
                </span>
            </span>
        </div>
    )
}

/** Group fixtures → poster rows, ordered by kickoff (unscheduled last, by id).
 *  No stage tag - a single group's rows are all the same stage. */
function groupMatchesToRows(matches: GroupMatch[]): PosterMatchRow[] {
    // A single group's fixtures normally share a day; when they span >1 date
    // each timed row shows the day+date above the HH:mm.
    const multiDay = isMultiDay(matches.map((m) => m.kickoffAt))
    return [...matches]
        .sort((a, b) => {
            const ta = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.POSITIVE_INFINITY
            const tb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.POSITIVE_INFINITY
            if (ta !== tb) return ta - tb
            return a.matchId - b.matchId
        })
        .map((m) => {
            // Group matches have no shootout - the winner is the higher score of
            // a finished, non-drawn match.
            const decided = m.status === "FINISHED" && m.score1 != null && m.score2 != null
            const winner: 1 | 2 | null =
                decided && m.score1! !== m.score2! ? (m.score1! > m.score2! ? 1 : 2) : null
            return {
                kickoffAt: m.kickoffAt ?? null,
                showDay: multiDay,
                t1: m.team1Name ?? "-",
                t2: m.team2Name ?? "-",
                score1: m.score1,
                score2: m.score2,
                winner,
                status: m.status,
            }
        })
}

/* ── Groups poster ─────────────────────────────────────────────────────── */

/** One group card. `big` scales it up for the single-group export scope so a
 *  lone group reads as an intentional, centred poster rather than one small
 *  card floating in a grid. When `standings` is set the body switches from the
 *  plain team list to a compact standings table (see GroupCardBody). */
function GroupCard({ g, big, standings: showStandings, dense }: { g: Group; big?: boolean; standings?: boolean; dense?: boolean }) {
    const teams = g.standings ?? []
    // Fixed row rhythm for the plain team list (mirrors StandingsTable): every
    // row is tall enough for a two-line name so neighbouring cards align.
    const listNameFont = big ? 20 : 16
    const listPadV = big ? 11 : 7
    const listRowMinH = Math.ceil(listNameFont * 1.25 * 2) + listPadV * 2
    // Once every group match is played, the top `effectiveAdvance` teams are the
    // qualifiers - highlight them in the table and show a "{n} PROLAZE" chip.
    const groupMatches = g.matches ?? []
    const groupFinished = groupMatches.length > 0 && groupMatches.every((m) => m.status === "FINISHED")
    const advance = groupFinished ? Math.max(0, Math.min(teams.length, g.effectiveAdvance ?? 0)) : 0
    return (
        <div
            style={{
                background: C.white,
                border: `1px solid ${C.line}`,
                borderRadius: big ? "18px" : "14px",
                overflow: "hidden",
            }}
        >
            {/* Card header - green letter tile + "Grupa X" + count. */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    padding: big ? "18px 22px" : dense ? "8px 14px" : "12px 16px",
                    background: C.surface,
                    borderBottom: `1px solid ${C.line}`,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: big ? "14px" : "10px", minWidth: 0 }}>
                    <div
                        style={{
                            width: big ? "44px" : "30px",
                            height: big ? "44px" : "30px",
                            flexShrink: 0,
                            borderRadius: big ? "12px" : "8px",
                            background: C.green,
                            color: C.white,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontFamily: F_HEAD,
                            fontSize: big ? "24px" : "16px",
                            fontWeight: 800,
                        }}
                    >
                        {g.name}
                    </div>
                    <span
                        style={{
                            fontFamily: F_HEAD,
                            fontSize: big ? "26px" : "16px",
                            fontWeight: 800,
                            letterSpacing: "-0.01em",
                            color: C.ink,
                        }}
                    >
                        Grupa {g.name}
                    </span>
                </div>
                {advance > 0 ? (
                    <span
                        style={{
                            fontFamily: F_MONO,
                            fontSize: big ? "12px" : "10px",
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            color: C.green,
                            background: C.greenWash,
                            padding: big ? "4px 11px" : "3px 9px",
                            borderRadius: "999px",
                            textTransform: "uppercase",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {advance} prolaze
                    </span>
                ) : null}
            </div>
            {/* Body - either the plain numbered team list (no results yet) or a
                compact standings table (once any group match has started). */}
            <div style={{ padding: big ? "12px 16px 18px" : dense ? "6px 10px 8px" : "8px 10px 12px" }}>
                {teams.length === 0 ? (
                    <div style={{ padding: big ? "14px 12px" : "10px 8px", fontSize: big ? "16px" : "13px", color: C.muted }}>
                        Nema ekipa
                    </div>
                ) : showStandings ? (
                    <StandingsTable teams={teams} big={big} advance={advance} dense={dense} />
                ) : (
                    teams.map((t, i) => (
                        <div
                            key={t.teamId}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: big ? "16px" : "12px",
                                minHeight: `${listRowMinH}px`,
                                boxSizing: "border-box",
                                padding: big ? "11px 12px" : "7px 8px",
                                borderRadius: big ? "10px" : "8px",
                                background: i % 2 === 0 ? C.zebra : "transparent",
                            }}
                        >
                            <span
                                style={{
                                    width: big ? "30px" : "22px",
                                    height: big ? "30px" : "22px",
                                    flexShrink: 0,
                                    borderRadius: big ? "8px" : "6px",
                                    border: `1px solid ${C.line}`,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontFamily: F_MONO,
                                    fontSize: big ? "15px" : "11px",
                                    fontWeight: 700,
                                    color: C.green,
                                }}
                            >
                                {i + 1}
                            </span>
                            <span
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    fontSize: `${listNameFont}px`,
                                    fontWeight: 600,
                                    color: C.ink,
                                    lineHeight: 1.25,
                                    overflowWrap: "break-word",
                                    display: "-webkit-box",
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: "vertical",
                                    overflow: "hidden",
                                }}
                            >
                                {t.teamName}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}

/* Compact standings table for the group cards (columns:
   #  EKIPA  UT  P  N  I  GR  BOD). Deliberately excludes the goals-for/against
   and form columns ("ostali detalji ne trebaju"). Rank + name align left, the
   numeric stats are right-aligned mono; GR is signed and colour-coded like the
   in-app table (green / red / muted), BOD is the bold points column. Column
   widths are fixed per `big` so the header labels and the data rows line up in
   both the multi-column grid and the single big card. */
function StandingsTable({ teams, big, advance = 0, dense }: { teams: GroupStandingRow[]; big?: boolean; advance?: number; dense?: boolean }) {
    const rankW = big ? 30 : 18
    const numW = big ? 32 : 20
    const grW = big ? 42 : 28
    const bodW = big ? 46 : 30
    const nameFont = big ? 18 : 13.5
    const numFont = big ? 15 : 12
    const headFont = big ? 11 : 9.5
    // Dense (combined "groups + best-placed" page) trims only the vertical
    // padding - the 2-line name rhythm stays so side-by-side cards keep aligned.
    const rowPadV = big ? 9 : dense ? 4 : 7
    const rowPadH = big ? 12 : 8
    // Fixed row rhythm: size every row for a TWO-line team name so cards
    // sitting side-by-side share identical row heights regardless of how long
    // any one name is. Single-line names centre in the same tall row.
    const nameLineH = 1.25
    const rowMinH = Math.ceil(nameFont * nameLineH * 2) + rowPadV * 2

    // Plain numeric columns (GR + BOD are rendered specially below).
    const numCols: { label: string; get: (r: GroupStandingRow) => number; w: number }[] = [
        { label: "UT", get: (r) => r.played, w: numW },
        { label: "P", get: (r) => r.won, w: numW },
        { label: "N", get: (r) => r.drawn, w: numW },
        { label: "I", get: (r) => r.lost, w: numW },
    ]

    const headCell = {
        fontFamily: F_MONO,
        fontSize: `${headFont}px`,
        fontWeight: 700,
        letterSpacing: "0.03em",
        color: C.muted,
        textTransform: "uppercase" as const,
        whiteSpace: "nowrap" as const,
    }
    const numCell = {
        fontFamily: F_MONO,
        fontSize: `${numFont}px`,
        fontVariantNumeric: "tabular-nums" as const,
        textAlign: "right" as const,
        whiteSpace: "nowrap" as const,
        flexShrink: 0,
    }

    return (
        <div>
            {/* Header row - shares the exact column widths with the data rows. */}
            <div style={{ display: "flex", alignItems: "center", padding: `0 ${rowPadH}px`, marginBottom: big ? "6px" : "4px" }}>
                <span style={{ width: `${rankW}px`, flexShrink: 0 }} />
                <span style={{ ...headCell, flex: 1, minWidth: 0, textAlign: "left" }}>EKIPA</span>
                {numCols.map((c) => (
                    <span key={c.label} style={{ ...headCell, width: `${c.w}px`, flexShrink: 0, textAlign: "right" }}>
                        {c.label}
                    </span>
                ))}
                <span style={{ ...headCell, width: `${grW}px`, flexShrink: 0, textAlign: "right" }}>GR</span>
                <span style={{ ...headCell, width: `${bodW}px`, flexShrink: 0, textAlign: "right" }}>BOD</span>
            </div>
            {/* Data rows. Qualifiers (top `advance`, only once the group is
                finished) get the green wash + left accent. While highlighting is
                active the OTHER rows drop the zebra striping entirely (plain
                white) so a greyish stripe can never read as "qualified" - the
                zebra only returns when no highlight is shown at all. */}
            {teams.map((t, i) => {
                const gd = t.goalDiff
                const grColor = gd > 0 ? C.win : gd < 0 ? C.live : C.muted
                const grText = gd > 0 ? `+${gd}` : String(gd)
                const qualifies = advance > 0 && i < advance
                const rowBg = qualifies
                    ? C.greenWash
                    : advance > 0
                        ? "transparent"
                        : i % 2 === 0
                            ? C.zebra
                            : "transparent"
                return (
                    <div
                        key={t.teamId}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            minHeight: `${rowMinH}px`,
                            boxSizing: "border-box",
                            padding: `${rowPadV}px ${rowPadH}px`,
                            borderRadius: big ? "10px" : "8px",
                            borderLeft: `3px solid ${qualifies ? C.greenMid : "transparent"}`,
                            background: rowBg,
                        }}
                    >
                        <span
                            style={{
                                width: `${rankW}px`,
                                flexShrink: 0,
                                fontFamily: F_MONO,
                                fontSize: `${numFont}px`,
                                fontWeight: 700,
                                color: C.green,
                            }}
                        >
                            {i + 1}
                        </span>
                        <span
                            style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: `${nameFont}px`,
                                fontWeight: 600,
                                color: C.ink,
                                lineHeight: nameLineH,
                                overflowWrap: "break-word",
                                paddingRight: "6px",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {t.teamName}
                        </span>
                        {numCols.map((c) => (
                            <span key={c.label} style={{ ...numCell, width: `${c.w}px`, fontWeight: 600, color: C.inkSoft }}>
                                {c.get(t)}
                            </span>
                        ))}
                        <span style={{ ...numCell, width: `${grW}px`, fontWeight: 700, color: grColor }}>{grText}</span>
                        <span style={{ ...numCell, width: `${bodW}px`, fontWeight: 800, color: C.ink }}>{t.points}</span>
                    </div>
                )
            })}
        </div>
    )
}

/** Split an array into fixed-size chunks (preserves order). */
function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
}

/** Single-group scope, page 1: the big group card alone - roomier now that the
 *  fixtures moved to their own page(s) below instead of crowding under it. */
function SingleGroupCardPage({ g, showStandings }: { g: Group; showStandings: boolean }) {
    return (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: "16px" }}>
            <div style={{ width: "74%", minWidth: 360, maxWidth: 540 }}>
                <GroupCard g={g} big standings={showStandings} />
            </div>
        </div>
    )
}

/** Single-group scope, matches page: a slice of that group's fixtures in the
 *  shared poster match-row format, under a "Utakmice · Grupa X" heading so the
 *  page reads unambiguously on its own. The heading repeats on every
 *  continuation page when the group has more matches than fit on one. */
function GroupMatchesSection({
    groupName,
    rows,
    compact,
}: {
    groupName: string
    rows: PosterMatchRow[]
    compact?: boolean
}) {
    return (
        <div>
            {/* Heading with a hairline rule (mirrors the schedule poster's day
                headings). */}
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    marginBottom: compact ? "8px" : "12px",
                }}
            >
                <span
                    style={{
                        fontFamily: F_MONO,
                        fontSize: "13px",
                        fontWeight: 800,
                        letterSpacing: "0.1em",
                        color: C.green,
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                    }}
                >
                    Utakmice · Grupa {groupName}
                </span>
                <span style={{ flex: 1, height: "1px", background: C.line }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: compact ? "5px" : "6px" }}>
                {rows.map((row, i) => (
                    <MatchRowPoster key={i} row={row} compact={compact} />
                ))}
            </div>
        </div>
    )
}

/** Single-group scope, combined ONE-page layout for small groups (≤ 4 teams,
 *  hence ≤ 6 matches): the big card with the fixtures ("Utakmice · Grupa X")
 *  directly beneath it - the pre-split layout. Larger groups keep the card and
 *  their fixtures on separate pages (see buildGroupsPages). */
function SingleGroupCombinedPage({
    g,
    showStandings,
    rows,
}: {
    g: Group
    showStandings: boolean
    rows: PosterMatchRow[]
}) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", paddingTop: "4px" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
                <div style={{ width: "82%", minWidth: 360, maxWidth: 560 }}>
                    <GroupCard g={g} big standings={showStandings} />
                </div>
            </div>
            {rows.length > 0 ? (
                <GroupMatchesSection groupName={g.name} rows={rows} compact />
            ) : null}
        </div>
    )
}

/** One page of the all-groups grid - up to 4 groups laid out roomily. A lone
 *  card (the last chunk of an odd count, or a 1-group tournament) is centred;
 *  2-4 cards share a 2-column grid (2×2 for 3-4). Cards get real width so team
 *  names never wrap letter-per-letter. */
function GroupsGrid({ groups, showStandings, dense }: { groups: Group[]; showStandings: boolean; dense?: boolean }) {
    if (groups.length === 1) {
        return (
            <div style={{ display: "flex", justifyContent: "center", paddingTop: dense ? "0" : "8px" }}>
                <div style={{ width: "64%", minWidth: 340, maxWidth: 520 }}>
                    <GroupCard g={groups[0]} standings={showStandings} dense={dense} />
                </div>
            </div>
        )
    }
    return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: dense ? "14px" : "22px", alignContent: "start" }}>
            {groups.map((g) => (
                <GroupCard key={g.id} g={g} standings={showStandings} dense={dense} />
            ))}
        </div>
    )
}

/** Build the group poster page bodies.
 *  Single-group scope → page 1 is the big group card alone; when the group has
 *  fixtures, they follow on their own page(s), paginated under the same
 *  rows-per-page budget as the schedule poster ("Utakmice · Grupa X" heading
 *  repeating on every continuation page).
 *  All-groups scope → chunks of ≤4 groups, one page each (≤4 total stays a
 *  single page). Empty draw → one placeholder page. */
function buildGroupsPages(groups: Group[], single: boolean): ReactNode[] {
    // Once ANY group match anywhere in the exported set has started (LIVE) or
    // finished, EVERY card switches to the standings table (consistency), even
    // if some groups still show all-zero rows.
    const showStandings = groups.some((g) =>
        (g.matches ?? []).some((m) => m.status === "LIVE" || m.status === "FINISHED"),
    )
    if (single && groups.length === 1) {
        const g = groups[0]
        const rows = groupMatchesToRows(g.matches)
        // A small group (≤ 4 teams → ≤ 6 matches) fits its card + fixtures on a
        // SINGLE page (the pre-split layout); larger groups split the card and
        // the fixtures onto separate pages so neither crowds the other.
        const teamCount = (g.standings ?? []).length
        if (teamCount <= 4) {
            return [<SingleGroupCombinedPage g={g} showStandings={showStandings} rows={rows} />]
        }
        const pages: ReactNode[] = [<SingleGroupCardPage g={g} showStandings={showStandings} />]
        if (rows.length > 0) {
            // Same per-page PIXEL budget as the schedule poster's continuation
            // pages; the repeating "Utakmice · Grupa X" heading costs one header.
            for (const pageRows of paginateGroupFixtureRows(rows)) {
                pages.push(<GroupMatchesSection groupName={g.name} rows={pageRows} />)
            }
        }
        return pages
    }
    if (groups.length === 0) {
        return [
            <div style={{ padding: "60px 0", textAlign: "center", color: C.muted, fontSize: "16px" }}>
                Nema grupa za prikaz.
            </div>,
        ]
    }
    return chunk(groups, 4).map((c) => <GroupsGrid groups={c} showStandings={showStandings} />)
}

/* Best "{advancePerGroup+1}. placed" cross-group table for the poster - the
   StandingsTable columns plus a GRUPA column (which group each team came from),
   the rank being the cross-group rank (not an in-group index). Qualifying rows
   (`qualifies`) get the green wash + a left accent, mirroring the in-app
   "najbolje plasirane" table; non-qualifying rows keep a transparent accent of
   the same width so the numeric columns stay aligned. Same fixed row rhythm,
   signed GR colouring and bold BOD as StandingsTable. Brand hex only. */
function BestPlacedTable({ rows, compact }: { rows: ThirdPlacedRow[]; compact?: boolean }) {
    const rankW = compact ? 22 : 30
    const numW = compact ? 26 : 32
    const grW = compact ? 34 : 42
    const bodW = compact ? 38 : 46
    const nameFont = compact ? 13.5 : 17
    const numFont = compact ? 12 : 15
    const headFont = compact ? 9.5 : 11
    const rowPadV = compact ? 6 : 9
    const rowPadH = compact ? 8 : 12
    const nameLineH = 1.25
    const rowMinH = Math.ceil(nameFont * nameLineH * 2) + rowPadV * 2

    const numCols: { label: string; get: (r: GroupStandingRow) => number; w: number }[] = [
        { label: "UT", get: (r) => r.played, w: numW },
        { label: "P", get: (r) => r.won, w: numW },
        { label: "N", get: (r) => r.drawn, w: numW },
        { label: "I", get: (r) => r.lost, w: numW },
    ]

    const headCell = {
        fontFamily: F_MONO,
        fontSize: `${headFont}px`,
        fontWeight: 700,
        letterSpacing: "0.03em",
        color: C.muted,
        textTransform: "uppercase" as const,
        whiteSpace: "nowrap" as const,
    }
    const numCell = {
        fontFamily: F_MONO,
        fontSize: `${numFont}px`,
        fontVariantNumeric: "tabular-nums" as const,
        textAlign: "right" as const,
        whiteSpace: "nowrap" as const,
        flexShrink: 0,
    }

    return (
        <div>
            {/* Header row - shares the exact column widths with the data rows. The
                left accent's 3px is absorbed by the row padding, so the header
                needs no extra offset. */}
            <div style={{ display: "flex", alignItems: "center", padding: `0 ${rowPadH}px`, marginBottom: "6px" }}>
                <span style={{ width: `${rankW}px`, flexShrink: 0 }} />
                <span style={{ ...headCell, flex: 1, minWidth: 0, textAlign: "left" }}>EKIPA</span>
                {numCols.map((c) => (
                    <span key={c.label} style={{ ...headCell, width: `${c.w}px`, flexShrink: 0, textAlign: "right" }}>
                        {c.label}
                    </span>
                ))}
                <span style={{ ...headCell, width: `${grW}px`, flexShrink: 0, textAlign: "right" }}>GR</span>
                <span style={{ ...headCell, width: `${bodW}px`, flexShrink: 0, textAlign: "right" }}>BOD</span>
            </div>
            {/* Data rows - qualifying ones washed green with a left accent. */}
            {rows.map((row) => {
                const t = row.standing
                const gd = t.goalDiff
                const grColor = gd > 0 ? C.win : gd < 0 ? C.live : C.muted
                const grText = gd > 0 ? `+${gd}` : String(gd)
                const q = row.qualifies
                return (
                    <div
                        key={t.teamId}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            minHeight: `${rowMinH}px`,
                            boxSizing: "border-box",
                            padding: `${rowPadV}px ${rowPadH}px`,
                            borderRadius: "10px",
                            borderLeft: `3px solid ${q ? C.greenMid : "transparent"}`,
                            background: q ? C.greenWash : "transparent",
                        }}
                    >
                        <span
                            style={{
                                width: `${rankW}px`,
                                flexShrink: 0,
                                fontFamily: F_MONO,
                                fontSize: `${numFont}px`,
                                fontWeight: 700,
                                color: C.green,
                            }}
                        >
                            {row.rank}
                        </span>
                        <span
                            style={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: `${nameFont}px`,
                                fontWeight: 600,
                                color: C.ink,
                                lineHeight: nameLineH,
                                overflowWrap: "break-word",
                                paddingRight: "6px",
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}
                        >
                            {t.teamName}
                        </span>
                        {numCols.map((c) => (
                            <span key={c.label} style={{ ...numCell, width: `${c.w}px`, fontWeight: 600, color: C.inkSoft }}>
                                {c.get(t)}
                            </span>
                        ))}
                        <span style={{ ...numCell, width: `${grW}px`, fontWeight: 700, color: grColor }}>{grText}</span>
                        <span style={{ ...numCell, width: `${bodW}px`, fontWeight: 800, color: C.ink }}>{t.points}</span>
                    </div>
                )
            })}
        </div>
    )
}

/** Poster page for the best "{advancePerGroup+1}. placed" cross-group table: a
 *  centred card (similar width to a single StandingsTable card page) with the
 *  "NAJBOLJE {place}. PLASIRANE" title + a "{bestThirdCount} prolaze dalje"
 *  subtitle, over the BestPlacedTable. Used either as its own standalone page or
 *  as the trailing page of the all-groups poster. */
/** The best-placed table as a self-contained bordered card (header + table).
 *  Shared by the standalone page and the inline "rides under the groups grid"
 *  layout; `compact` shrinks the chrome + table so it fits below the grid. */
function BestPlacedCard({ table, compact }: { table: ThirdPlacedTable; compact?: boolean }) {
    const place = table.advancePerGroup + 1
    return (
        <div style={{ background: C.white, border: `1px solid ${C.line}`, borderRadius: compact ? "14px" : "18px", overflow: "hidden" }}>
            {/* Card header - title + "{n} prolaze dalje" subtitle. */}
            <div style={{ padding: compact ? "12px 16px" : "18px 22px", background: C.surface, borderBottom: `1px solid ${C.line}` }}>
                <div
                    style={{
                        fontFamily: F_HEAD,
                        fontSize: compact ? "18px" : "24px",
                        fontWeight: 800,
                        letterSpacing: "-0.01em",
                        color: C.ink,
                    }}
                >
                    NAJBOLJE {place}. PLASIRANE
                </div>
            </div>
            <div style={{ padding: compact ? "8px 10px 12px" : "12px 16px 18px" }}>
                <BestPlacedTable rows={table.rows} compact={compact} />
            </div>
        </div>
    )
}

function BestPlacedTablePage({ table }: { table: ThirdPlacedTable }) {
    return (
        <div style={{ display: "flex", justifyContent: "center", paddingTop: "16px" }}>
            <div style={{ width: "82%", minWidth: 360, maxWidth: 560 }}>
                <BestPlacedCard table={table} />
            </div>
        </div>
    )
}

/** All-groups grid with the best-placed table riding underneath on the SAME
 *  page - used when both fit one A4 page (see fitsBestPlacedInline). */
function GroupsWithBestPlacedPage({
    groups,
    showStandings,
    table,
}: {
    groups: Group[]
    showStandings: boolean
    table: ThirdPlacedTable
}) {
    // Odd group count (1 or 3) leaves an EMPTY grid cell - the table slots into
    // it, spending no extra vertical space at all. Even counts stack it below.
    if (groups.length % 2 === 1) {
        return (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px", alignContent: "start" }}>
                {groups.map((g) => (
                    <GroupCard key={g.id} g={g} standings={showStandings} dense />
                ))}
                <BestPlacedCard table={table} compact />
            </div>
        )
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            <GroupsGrid groups={groups} showStandings={showStandings} dense />
            <BestPlacedCard table={table} compact />
        </div>
    )
}

/** Whether the all-groups grid + the best-placed table fit ONE portrait A4 page
 *  together (so the table need not spill onto its own page). Mirrors the DENSE
 *  combined layout (GroupsWithBestPlacedPage): with an ODD group count the table
 *  occupies the grid's empty cell (costs no extra height); with an even count it
 *  stacks below. Measured against the REAL page-1 body budget (1123 − 56 top −
 *  ~185 QR header/rule − ~86 footer ≈ 750, held a bit under). When unsure it
 *  returns false and the table keeps its own page - never clips. */
function fitsBestPlacedInline(groups: Group[], table: ThirdPlacedTable): boolean {
    // Only a single grid page can host the table (chunks of 4 → >4 groups paginate).
    if (groups.length === 0 || groups.length > 4) return false
    const maxTeams = Math.max(1, ...groups.map((g) => (g.standings ?? []).length))
    // Dense standings card: chrome (header + table head + trimmed paddings) plus
    // rows sized for a 2-line name (rowPadV 4 → ~42px each).
    const denseCardH = 88 + maxTeams * 42
    // Compact best-placed card: chrome (header + subtitle + table head) + rows.
    const tableH = 90 + table.rows.length * 46
    const PAGE1_BODY = 740
    if (groups.length % 2 === 1) {
        // Table rides in the empty cell: page height = sum of grid row heights,
        // where the last row is the taller of (group card, table card).
        const fullRows = Math.floor(groups.length / 2)
        const lastRowH = Math.max(denseCardH, tableH)
        const gridH = fullRows * denseCardH + lastRowH + fullRows * 14
        return gridH <= PAGE1_BODY
    }
    const gridRows = Math.ceil(groups.length / 2)
    const gridH = gridRows * denseCardH + (gridRows - 1) * 14
    return gridH + 18 + tableH <= PAGE1_BODY
}

/* ── Schedule poster ───────────────────────────────────────────────────── */

/** One day (or the "no fixed time" bucket) of schedule rows. A `matches` slice
 *  may be a partial section when a long day is split across pages. */
type ScheduleSection = { key: string; label: string; matches: ScheduledMatch[] }

/** Bucket the matches into day sections (kickoff order) + a trailing
 *  "Termin nije određen" section for the unscheduled ones. */
function buildScheduleSections(matches: ScheduledMatch[]): ScheduleSection[] {
    const scheduled = matches.filter((m) => m.kickoffAt)
    const unscheduled = matches.filter((m) => !m.kickoffAt)
    scheduled.sort((a, b) => new Date(a.kickoffAt!).getTime() - new Date(b.kickoffAt!).getTime())

    const dayOrder: string[] = []
    const byDay = new Map<string, ScheduledMatch[]>()
    for (const m of scheduled) {
        const k = dateKey(m.kickoffAt)
        if (!byDay.has(k)) {
            byDay.set(k, [])
            dayOrder.push(k)
        }
        byDay.get(k)!.push(m)
    }

    const sections: ScheduleSection[] = dayOrder.map((k) => ({
        key: k,
        label: dayHeaderLabel(k),
        matches: byDay.get(k)!,
    }))
    if (unscheduled.length > 0) {
        sections.push({ key: "none", label: "Termin nije određen", matches: unscheduled })
    }
    return sections
}

/* Pixel-height model for schedule pagination - each match row is costed by its
   REAL height, not a flat "unit", because team names that wrap to 2-3 lines make
   a row much taller than a one-liner (the old flat cost overflowed the body and
   clipped the last row(s) against the footer). SCHED_ROW_PX is a plain one-line
   row (15px name cell + 11px pads + border + the 6px inter-row gap); each extra
   wrapped line adds ~19px, and a decided-shootout row carries a second lead line
   so it costs >= 2 lines (see schedRowPx). SCHED_HEADER_PX covers a day-heading
   block + its 20px section gap. Page-1 body is smaller (the QR lockup makes its
   header ~185px tall); continuation pages carry only a compact one-line header.
   All values rounded up so the last row never clips or crams against the footer. */
const SCHED_ROW_PX = 52
const SCHED_HEADER_PX = 50
const SCHED_FIRST_PX = 760
const SCHED_REST_PX = 880

/** Conservative wrapped-line estimate for a team name in a poster row's name
 *  cell. `perLine` is the chars-per-line for that layout (24 for the day-
 *  sectioned schedule, where the stage pill narrows the cell; ~30 for the
 *  pill-less single-group fixtures list). Clamped to 1-3 lines. */
function estNameLines(s: string, perLine = 24): number {
    return Math.min(3, Math.max(1, Math.ceil(s.length / perLine)))
}

/** Real per-row pixel cost for the day-sectioned schedule poster. Resolves BOTH
 *  pairing names exactly like ScheduleSections / MatchRowPoster, takes the
 *  taller side's wrapped-line count, and forces >= 2 lines when the row shows a
 *  penalty second line (the renderer's showPens condition). A one-line row costs
 *  SCHED_ROW_PX (52); each extra line adds 19px (== 33 + 19*lines). */
function schedRowPx(m: ScheduledMatch): number {
    const t1 = pairingName(m.team1Name, m.slot1PredictedName, m.slot1Label)
    const t2 = pairingName(m.team2Name, m.slot2PredictedName, m.slot2Label)
    let lines = Math.max(estNameLines(t1), estNameLines(t2))
    const showResult = (m.status === "LIVE" || m.status === "FINISHED") && m.score1 != null && m.score2 != null
    if (showResult && m.penalties1 != null && m.penalties2 != null) lines = Math.max(lines, 2)
    return SCHED_ROW_PX + 19 * (lines - 1)
}

/** Per-row cost for the single-group fixtures list: no stage pill → wider name
 *  cells (~30 chars/line), otherwise the same MatchRowPoster and the same
 *  base/line model as schedRowPx. Group matches have no shootout, but the pens
 *  check mirrors the renderer for parity. */
function groupFixtureRowPx(row: PosterMatchRow): number {
    let lines = Math.max(estNameLines(row.t1, 30), estNameLines(row.t2, 30))
    const showResult = (row.status === "LIVE" || row.status === "FINISHED") && row.score1 != null && row.score2 != null
    if (showResult && row.penalties1 != null && row.penalties2 != null) lines = Math.max(lines, 2)
    // Multi-day group: the lead cell stacks day+date above HH:mm (stackDay in
    // MatchRowPoster) - a second lead line, so the row costs >= 2 lines too.
    if (!showResult && row.kickoffAt && row.showDay) lines = Math.max(lines, 2)
    return SCHED_ROW_PX + 19 * (lines - 1)
}

/** Split the single-group fixtures across pages under the schedule poster's
 *  continuation-page pixel budget (SCHED_REST_PX); the repeating "Utakmice ·
 *  Grupa X" heading costs one SCHED_HEADER_PX. Every page keeps >= 1 row. */
function paginateGroupFixtureRows(rows: PosterMatchRow[]): PosterMatchRow[][] {
    const pages: PosterMatchRow[][] = []
    let page: PosterMatchRow[] = []
    let usedPx = SCHED_HEADER_PX
    for (const row of rows) {
        const rowPx = groupFixtureRowPx(row)
        if (page.length > 0 && usedPx + rowPx > SCHED_REST_PX) {
            pages.push(page)
            page = []
            usedPx = SCHED_HEADER_PX
        }
        page.push(row)
        usedPx += rowPx
    }
    if (page.length > 0) pages.push(page)
    return pages
}

/** Split the day sections across pages under a per-page PIXEL budget. Page 1 gets
 *  the smaller `firstPx` (its tall QR header leaves less room); continuation
 *  pages get `restPx`. A day header is never left as the last thing on a page: a
 *  section only lands if its header AND at least one match fit, else it starts on
 *  the next page. Long days split across pages, each continuation repeating the
 *  day header. */
function paginateScheduleSections(
    sections: ScheduleSection[],
    firstPx = SCHED_FIRST_PX,
    restPx = SCHED_REST_PX,
): ScheduleSection[][] {
    const pages: ScheduleSection[][] = []
    let pageSecs: ScheduleSection[] = []
    let usedPx = 0
    // Page 1's budget is smaller; every page after the first uses restPx.
    let budgetPx = firstPx
    const flush = () => {
        if (pageSecs.length > 0) {
            pages.push(pageSecs)
            pageSecs = []
            usedPx = 0
            budgetPx = restPx
        }
    }
    for (const sec of sections) {
        let rest = sec.matches
        while (rest.length > 0) {
            const remainingPx = budgetPx - usedPx
            // Need room for the day header + at least the first (real-height)
            // match row; if it won't fit and the page already has content, start
            // this section (chunk) on a fresh page. A fresh page always keeps
            // >= 1 row below its header, so a day header is never orphaned.
            if (pageSecs.length > 0 && remainingPx < SCHED_HEADER_PX + schedRowPx(rest[0])) {
                flush()
                continue
            }
            // Walk the section's matches, accumulating each row's real pixel cost
            // until the budget is spent; always take at least one row.
            let take = 0
            let chunkPx = SCHED_HEADER_PX
            for (const m of rest) {
                const rowPx = schedRowPx(m)
                if (take > 0 && usedPx + chunkPx + rowPx > budgetPx) break
                chunkPx += rowPx
                take++
            }
            pageSecs.push({ key: sec.key, label: sec.label, matches: rest.slice(0, take) })
            usedPx += chunkPx
            rest = rest.slice(take)
            // Any remainder of this section continues on a fresh page.
            if (rest.length > 0) flush()
        }
    }
    flush()
    return pages
}

/** Render one page's worth of schedule sections (day heading + match rows). */
function ScheduleSections({ sections }: { sections: ScheduleSection[] }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {sections.map((sec, si) => (
                <div key={`${sec.key}-${si}`}>
                    {/* Day heading with a hairline rule. */}
                    <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "12px" }}>
                        <span
                            style={{
                                fontFamily: F_MONO,
                                fontSize: "13px",
                                fontWeight: 800,
                                letterSpacing: "0.1em",
                                color: C.green,
                                textTransform: "uppercase",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {sec.label}
                        </span>
                        <span style={{ flex: 1, height: "1px", background: C.line }} />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        {sec.matches.map((m) => (
                            <MatchRowPoster
                                key={m.matchId}
                                row={{
                                    kickoffAt: m.kickoffAt,
                                    stage: stageTag(m),
                                    t1: pairingName(m.team1Name, m.slot1PredictedName, m.slot1Label),
                                    t2: pairingName(m.team2Name, m.slot2PredictedName, m.slot2Label),
                                    score1: m.score1,
                                    score2: m.score2,
                                    penalties1: m.penalties1,
                                    penalties2: m.penalties2,
                                    winner:
                                        m.winnerTeamId == null
                                            ? null
                                            : m.winnerTeamId === m.team1Id
                                                ? 1
                                                : m.winnerTeamId === m.team2Id
                                                    ? 2
                                                    : null,
                                    status: m.status,
                                }}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}

/** Build the schedule poster page bodies - day sections paginated under the row
 *  budget. Empty schedule → one placeholder page. */
function buildSchedulePages(matches: ScheduledMatch[]): ReactNode[] {
    const sections = buildScheduleSections(matches)
    if (sections.length === 0) {
        return [
            <div style={{ padding: "60px 0", textAlign: "center", color: C.muted, fontSize: "16px" }}>
                Nema utakmica za prikaz.
            </div>,
        ]
    }
    return paginateScheduleSections(sections).map((secs) => <ScheduleSections sections={secs} />)
}

/* ── Bracket poster (two-sided vertical "Završnica") ────────────────────────
   The classic wall-poster layout on a PORTRAIT A3 sheet. Up to 16 teams: the
   left half of the draw flows inward from the far-left column, the right half
   flows inward from the far-right column (mirrored), and the FINALE (+ the
   3rd-place box) sits in the centre - all on one page. A bigger draw (R32) is
   split across TWO pages, one per bracket half (a full-width one-sided funnel),
   so the boxes stay large. Each round is one column that spreads its cards with
   space-around, so it reads centred against its feeders - a static pyramid
   without SVG connectors. Pairing text follows the schedule poster's precedence
   (real name → predicted → slot code → TBD); finished matches show the result
   (penalties in parens), the winner bolded.

   SIZING: the total column count picks a width tier (font shrinks as the bracket
   deepens); the busiest side column drives one shared card height so every
   column aligns. */

/** Per-tier sizing for the bracket-poster cards. */
type BracketTierStyle = {
    teamFont: number
    scoreFont: number
    penFont: number
    linePadV: number
    linePadH: number
    lineGap: number
    /** Vertical gap between cards in a column. */
    cardGap: number
    /** Horizontal gap between round columns. */
    colGap: number
    titleFont: number
    titleMb: number
    thirdLabelFont: number
    cardRadius: number
    lineH: number
}

/** Sizing for the two-sided vertical bracket, keyed on the TOTAL number of
 *  column slots on the page (left rounds + centre + right rounds). More columns
 *  → narrower columns → smaller font; the generous A3 height lets names wrap to
 *  2-3 lines regardless, so width is the binding constraint. Tuned for the A3
 *  sheet (≈1011px of content width), so even a 9-slot R32 keeps ~105px columns. */
function twoSidedTier(slots: number): BracketTierStyle {
    if (slots <= 3) {
        // 2-4 teams: one round per side (or final only) - very roomy.
        return { teamFont: 19, scoreFont: 20, penFont: 14, linePadV: 8, linePadH: 16, lineGap: 12, cardGap: 20, colGap: 20, titleFont: 14, titleMb: 12, thirdLabelFont: 12, cardRadius: 14, lineH: 1.22 }
    }
    if (slots <= 5) {
        // ~8 teams (QF + SF per side): comfortable.
        return { teamFont: 17, scoreFont: 18, penFont: 12, linePadV: 7, linePadH: 14, lineGap: 11, cardGap: 16, colGap: 16, titleFont: 13, titleMb: 11, thirdLabelFont: 12, cardRadius: 13, lineH: 1.2 }
    }
    if (slots <= 7) {
        // ~16 teams (R16 → osmina/ČF/PF per side): medium.
        return { teamFont: 14, scoreFont: 15, penFont: 10, linePadV: 6, linePadH: 11, lineGap: 9, cardGap: 12, colGap: 11, titleFont: 12, titleMb: 9, thirdLabelFont: 11, cardRadius: 12, lineH: 1.18 }
    }
    // ~32 teams (R32, 9 slots): dense but the A3 width keeps it legible.
    return { teamFont: 12, scoreFont: 12, penFont: 9, linePadV: 4, linePadH: 8, lineGap: 6, cardGap: 8, colGap: 7, titleFont: 11, titleMb: 7, thirdLabelFont: 10, cardRadius: 10, lineH: 1.16 }
}

/** Available px height for the two-sided bracket body on the A3 PORTRAIT sheet:
 *  page 1587 − top pad 56 − first-page header ≈ 210 (fixed px: name up to 2
 *  lines + organizer + meta + optional podium line) − green rule ≈ 43 − footer
 *  ≈ 89 ≈ 1189. Kept conservative (1150) so the busiest side column never clips
 *  against the footer even when a finished bracket adds the podium header line;
 *  extra slack just spreads the fixed-height cards out via space-around. */
const BRACKET_BODY_H = 1150

/** One team line inside a bracket-poster match card. Sizing is tier-driven and
 *  the name clamps to `nameLines` so dense first rounds fit the fixed card. */
function BracketTeamLine({
    name,
    score,
    pen,
    winner,
    t,
    nameLines,
    mirror = false,
}: {
    name: string
    score: number | null
    pen: number | null
    winner: boolean
    t: BracketTierStyle
    nameLines: number
    /** Right-side column: put the score on the LEFT and right-align the name,
     *  so the two halves of the bracket read as mirror images toward the centre. */
    mirror?: boolean
}) {
    return (
        <div style={{ display: "flex", flexDirection: mirror ? "row-reverse" : "row", alignItems: "center", gap: `${t.lineGap}px`, padding: `${t.linePadV}px ${t.linePadH}px` }}>
            <span
                style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: `${t.teamFont}px`,
                    fontWeight: winner ? 800 : 600,
                    color: winner ? C.ink : C.inkSoft,
                    lineHeight: t.lineH,
                    textAlign: mirror ? "right" : "left",
                    overflowWrap: "break-word",
                    display: "-webkit-box",
                    WebkitLineClamp: nameLines,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                }}
            >
                {name}
            </span>
            {score != null ? (
                <span
                    style={{
                        flexShrink: 0,
                        fontFamily: F_MONO,
                        fontSize: `${t.scoreFont}px`,
                        fontWeight: winner ? 800 : 600,
                        color: winner ? C.win : C.ink,
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                    }}
                >
                    {score}
                    {pen != null ? (
                        <span style={{ fontSize: `${t.penFont}px`, color: C.muted, fontWeight: 600 }}> ({pen})</span>
                    ) : null}
                </span>
            ) : null}
        </div>
    )
}

/** One bracket-poster match card (two team lines). Round cards are pinned to a
 *  shared `cardH` (derived from the busiest round) so every column fits the
 *  landscape page; the 3rd-place box grows for its own label. Kickoff times are
 *  deliberately omitted here - they crowd out the tree and live on the schedule
 *  poster instead - which keeps the card height predictable for the fit math. */
function BracketPosterCard({
    m,
    t,
    cardH,
    nameLines,
    final: isFinal,
    third: isThird,
    mirror = false,
}: {
    m: BracketMatch
    t: BracketTierStyle
    /** Fixed card height (px) - omitted for the 3rd-place box (natural height). */
    cardH: number
    nameLines: number
    final?: boolean
    third?: boolean
    /** Right-side column of the two-sided layout - mirrors each team line. */
    mirror?: boolean
}) {
    const finished = m.status === "FINISHED"
    const hasScore = m.score1 != null && m.score2 != null
    const hasPens = m.penalties1 != null && m.penalties2 != null
    const t1 = pairingName(m.team1Name, m.slot1PredictedName, m.slot1Label)
    const t2 = pairingName(m.team2Name, m.slot2PredictedName, m.slot2Label)
    const w1 = m.winnerTeamId != null && m.winnerTeamId === m.team1Id
    const w2 = m.winnerTeamId != null && m.winnerTeamId === m.team2Id
    const s1 = finished && hasScore ? m.score1 : null
    const s2 = finished && hasScore ? m.score2 : null
    return (
        <div
            style={{
                background: isFinal ? C.greenWash : C.white,
                border: `1px solid ${isFinal ? C.green : C.line}`,
                borderRadius: `${t.cardRadius}px`,
                overflow: "hidden",
                height: isThird ? undefined : `${cardH}px`,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
            }}
        >
            <BracketTeamLine name={t1} score={s1} pen={hasPens ? m.penalties1 : null} winner={w1} t={t} nameLines={nameLines} mirror={mirror} />
            <div style={{ height: "1px", background: C.line, margin: `0 ${t.linePadH}px` }} />
            <BracketTeamLine name={t2} score={s2} pen={hasPens ? m.penalties2 : null} winner={w2} t={t} nameLines={nameLines} mirror={mirror} />
            {isThird ? (
                <div
                    style={{
                        fontFamily: F_MONO,
                        fontSize: `${t.thirdLabelFont}px`,
                        fontWeight: 800,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: C.green,
                        background: C.greenWash,
                        padding: "5px 12px",
                        textAlign: "center",
                    }}
                >
                    Za 3. mjesto
                </div>
            ) : null}
        </div>
    )
}

/** Column heading (round name + hairline rule) shared by every bracket column.
 *  `accent` greens it for the central FINALE column. */
function BracketColumnTitle({ title, t, accent }: { title: string; t: BracketTierStyle; accent: boolean }) {
    return (
        <div style={{ marginBottom: `${t.titleMb}px` }}>
            <div
                style={{
                    fontFamily: F_MONO,
                    fontSize: `${t.titleFont}px`,
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    color: accent ? C.green : C.inkSoft,
                    textTransform: "uppercase",
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                }}
            >
                {title}
            </div>
            <div style={{ height: "2px", background: accent ? C.green : C.line, borderRadius: "2px", marginTop: "6px" }} />
        </div>
    )
}

/** One vertical round column (title + evenly-spread match cards). `mirror`
 *  right-aligns the cards for the right half of the two-sided layout. */
function BracketSideColumn({
    title,
    matches,
    t,
    cardH,
    nameLines,
    mirror,
}: {
    title: string
    matches: BracketMatch[]
    t: BracketTierStyle
    cardH: number
    nameLines: number
    mirror: boolean
}) {
    return (
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <BracketColumnTitle title={title} t={t} accent={false} />
            <div
                style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-around",
                    gap: `${t.cardGap}px`,
                }}
            >
                {matches.map((m) => (
                    <BracketPosterCard key={m.matchId} m={m} t={t} cardH={cardH} nameLines={nameLines} mirror={mirror} />
                ))}
            </div>
        </div>
    )
}

/** Split a round's matches into the LEFT (first) and RIGHT (second) halves of
 *  the two-sided bracket. */
function splitSides(matches: BracketMatch[]): { left: BracketMatch[]; right: BracketMatch[] } {
    const half = Math.ceil(matches.length / 2)
    return { left: matches.slice(0, half), right: matches.slice(half) }
}

/** Upper bound on a single card's height - keeps a sparse bracket (few matches
 *  per column) from blowing each card up to an absurd size on the tall A3 page. */
const BRACKET_MAX_CARD_H = 230

/** Two-sided vertical bracket - the "classic" wall-poster layout. The left half
 *  of the draw flows inward from the far left, the right half flows inward from
 *  the far right, and the final (+ the 3rd-place box) sits in the centre column.
 *  No SVG connectors: each column spreads its cards with space-around so a round
 *  reads centred against its feeders. Portrait A3; font/width scale with the
 *  total column count, card height with the busiest side column. */
function TwoSidedBracketBody({
    cols,
    titles,
    thirdPlace,
    bodyH = BRACKET_BODY_H,
}: {
    cols: BracketMatch[][]
    titles: string[]
    thirdPlace: BracketMatch | null
    bodyH?: number
}) {
    if (cols.length === 0) {
        return (
            <div style={{ padding: "40px 0", textAlign: "center", color: C.muted, fontSize: "16px" }}>
                Ljestvica još nije generirana.
            </div>
        )
    }

    const finalIdx = cols.length - 1
    const finalMatch = cols[finalIdx]?.[0] ?? null
    const nonFinal = finalIdx // rounds rendered on each side (final excluded)

    // Left/right descriptors for every non-final round (outermost round first).
    const leftCols: { title: string; matches: BracketMatch[] }[] = []
    const rightCols: { title: string; matches: BracketMatch[] }[] = []
    for (let r = 0; r < nonFinal; r++) {
        const { left, right } = splitSides(cols[r])
        leftCols.push({ title: titles[r] ?? "", matches: left })
        rightCols.push({ title: titles[r] ?? "", matches: right })
    }
    // The right side paints centre→outer, so reverse it for left-to-right flow.
    const rightRender = [...rightCols].reverse()

    // Total column slots (left rounds + centre + right rounds) → width tier.
    const totalSlots = 2 * nonFinal + 1
    const t = twoSidedTier(totalSlots)

    // The busiest side column (the outermost round's half) drives a shared card
    // height so every column aligns; the centre final reuses it too.
    const maxSide = nonFinal >= 1 ? Math.max(1, ...leftCols.map((c) => c.matches.length)) : 1
    const titleBlockH = t.titleMb + t.titleFont + 8
    const matchesRegionH = bodyH - titleBlockH
    const cardH = Math.max(
        30,
        Math.min(
            BRACKET_MAX_CARD_H,
            Math.floor((matchesRegionH - (maxSide - 1) * t.cardGap) / maxSide),
        ),
    )
    // Two team lines + a 1px divider share cardH; each line clamps to nameLines.
    const perTeamH = (cardH - 1) / 2
    const nameLines = Math.max(1, Math.min(3, Math.floor((perTeamH - t.linePadV * 2) / (t.teamFont * t.lineH))))

    return (
        <div style={{ display: "flex", gap: `${t.colGap}px`, alignItems: "stretch", height: "100%" }}>
            {leftCols.map((c, i) => (
                <BracketSideColumn key={`l${i}`} title={c.title} matches={c.matches} t={t} cardH={cardH} nameLines={nameLines} mirror={false} />
            ))}

            {/* Centre column: FINALE, with the 3rd-place box under it. Vertically
                centred so it lines up with the two innermost (polufinale) columns. */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <BracketColumnTitle title={titles[finalIdx] ?? "Finale"} t={t} accent />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: `${t.cardGap + 10}px` }}>
                    {finalMatch ? (
                        <BracketPosterCard m={finalMatch} t={t} cardH={cardH} nameLines={nameLines} final />
                    ) : null}
                    {thirdPlace ? (
                        <BracketPosterCard m={thirdPlace} t={t} cardH={cardH} nameLines={nameLines} third />
                    ) : null}
                </div>
            </div>

            {rightRender.map((c, i) => (
                <BracketSideColumn key={`r${i}`} title={c.title} matches={c.matches} t={t} cardH={cardH} nameLines={nameLines} mirror />
            ))}
        </div>
    )
}

/** One-sided bracket funnel: rounds as columns left→right, the final green in
 *  the right-most column, an optional 3rd-place box under it. Used for the
 *  two-page split of a big draw - each page carries ONE half of the bracket at
 *  full page width, so the boxes stay large. Sizing keys the width tier on the
 *  column count but tightens the vertical gap for a dense first round. */
function ColumnsBracketBody({
    cols,
    titles,
    thirdPlace,
    bodyH = BRACKET_BODY_H,
}: {
    cols: BracketMatch[][]
    titles: string[]
    thirdPlace: BracketMatch | null
    bodyH?: number
}) {
    if (cols.length === 0) {
        return (
            <div style={{ padding: "40px 0", textAlign: "center", color: C.muted, fontSize: "16px" }}>
                Ljestvica još nije generirana.
            </div>
        )
    }
    const lastIdx = cols.length - 1
    const t = twoSidedTier(cols.length)
    const maxMatches = Math.max(1, ...cols.map((c) => c.length))
    // A dense first column (many first-round matches) needs a tighter vertical
    // gap than the wide-column tier default (tuned for sparse columns).
    const cardGap = maxMatches >= 6 ? Math.min(t.cardGap, 8) : t.cardGap
    const titleBlockH = t.titleMb + t.titleFont + 8
    const thirdBlockH = thirdPlace ? 130 : 0
    const matchesRegionH = bodyH - titleBlockH - thirdBlockH
    const cardH = Math.max(
        30,
        Math.min(BRACKET_MAX_CARD_H, Math.floor((matchesRegionH - (maxMatches - 1) * cardGap) / maxMatches)),
    )
    const perTeamH = (cardH - 1) / 2
    const nameLines = Math.max(1, Math.min(3, Math.floor((perTeamH - t.linePadV * 2) / (t.teamFont * t.lineH))))
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px", height: "100%" }}>
            <div style={{ flex: 1, display: "flex", gap: `${t.colGap}px`, alignItems: "stretch" }}>
                {cols.map((matches, ci) => (
                    <div key={ci} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                        <BracketColumnTitle title={titles[ci] ?? ""} t={t} accent={ci === lastIdx} />
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: `${cardGap}px` }}>
                            {matches.map((m) => (
                                <BracketPosterCard key={m.matchId} m={m} t={t} cardH={cardH} nameLines={nameLines} final={ci === lastIdx} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            {thirdPlace ? (
                <div style={{ display: "flex", gap: `${t.colGap}px` }}>
                    {cols.map((_, ci) => (
                        <div key={ci} style={{ flex: 1, minWidth: 0 }}>
                            {ci === lastIdx ? (
                                <BracketPosterCard m={thirdPlace} t={t} cardH={cardH} nameLines={nameLines} third />
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

/** Final standings derived straight from the bracket - non-null only once the
 *  final is FINISHED with a winner. Third place comes from the 3rd-place match
 *  when that is decided too. */
function podiumFromBracket(
    cols: BracketMatch[][],
    thirdPlace: BracketMatch | null,
): { first: string; second: string | null; third: string | null } | null {
    if (cols.length === 0) return null
    const finalCol = cols[cols.length - 1]
    const final = finalCol.length === 1 ? finalCol[0] : null
    if (!final || final.status !== "FINISHED" || final.winnerTeamId == null) return null
    const firstIsT1 = final.winnerTeamId === final.team1Id
    const first = firstIsT1 ? final.team1Name : final.team2Name
    if (!first) return null
    const second = firstIsT1 ? final.team2Name : final.team1Name
    let third: string | null = null
    if (thirdPlace && thirdPlace.status === "FINISHED" && thirdPlace.winnerTeamId != null) {
        third =
            thirdPlace.winnerTeamId === thirdPlace.team1Id
                ? thirdPlace.team1Name
                : thirdPlace.team2Name
    }
    return { first, second, third }
}

/** Inline-SVG trophy (no emoji-font dependency - html-to-image safe). */
function TrophyIcon({ color, size }: { color: string; size: number }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} style={{ flexShrink: 0 }}>
            <path
                fill={color}
                d="M5 3h14v2h3v3c0 2.8-2.2 5-5 5h-.3A7 7 0 0 1 13 16.9V19h3v2H8v-2h3v-2.1A7 7 0 0 1 7.3 13H7c-2.8 0-5-2.2-5-5V5h3V3zm-1 4v1c0 1.7 1.3 3 3 3V7H4zm16 0h-3v4c1.7 0 3-1.3 3-3V7z"
            />
        </svg>
    )
}

/** 1./2./3. row with trophy icons - rendered in the poster HEADER (directly
 *  under the date•location line) once the tournament's final has been decided,
 *  so the bracket body below keeps its full height. */
function PodiumStrip({
    first,
    second,
    third,
}: {
    first: string
    second: string | null
    third: string | null
}) {
    const entries: Array<{ rank: string; name: string; color: string; big?: boolean }> = [
        { rank: "1.", name: first, color: "#d4a017", big: true },
    ]
    if (second) entries.push({ rank: "2.", name: second, color: "#98a0a6" })
    if (third) entries.push({ rank: "3.", name: third, color: "#b3763e" })
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
                flexWrap: "wrap",
                gap: "10px 28px",
            }}
        >
            {entries.map((e) => (
                <div key={e.rank} style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    <TrophyIcon color={e.color} size={e.big ? 24 : 19} />
                    <span
                        style={{
                            fontFamily: F_MONO,
                            fontSize: e.big ? "15px" : "13px",
                            fontWeight: 800,
                            color: e.color,
                        }}
                    >
                        {e.rank}
                    </span>
                    <span
                        style={{
                            fontFamily: F_HEAD,
                            fontSize: e.big ? "18px" : "15px",
                            fontWeight: 800,
                            color: C.ink,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: "260px",
                        }}
                    >
                        {e.name}
                    </span>
                </div>
            ))}
        </div>
    )
}

/** Podium for a bracket (or undefined when the final isn't decided) - consumed
 *  by ExportDialog, which renders it as the page-1 header's extra line so the
 *  bracket body below keeps its FULL height (no more squeezed boxes). */
function bracketPodium(bracket: Bracket | undefined) {
    const rounds = bracket?.rounds ?? []
    return podiumFromBracket(
        rounds.map((r) => r.matches),
        bracket?.thirdPlace ?? null,
    )
}

/** Bracket poster pages. A draw up to 16 teams (≤ 8 first-round matches) fits
 *  ONE two-sided vertical sheet. A bigger draw (R32: 16 first-round matches) is
 *  split across TWO pages - one per bracket half, each a full-width one-sided
 *  funnel ending in the final - so the boxes stay large instead of being crushed
 *  into 9 narrow columns. The final is shown on both halves; the 3rd-place box
 *  rides on the second page. */
function buildBracketPages(bracket: Bracket | undefined): ReactNode[] {
    const rounds = bracket?.rounds ?? []
    const cols = rounds.map((r) => r.matches)
    const titles = rounds.map((r) => r.title)
    const thirdPlace = bracket?.thirdPlace ?? null
    const firstRound = cols[0]?.length ?? 0

    if (cols.length < 2 || firstRound <= 8) {
        return [<TwoSidedBracketBody cols={cols} titles={titles} thirdPlace={thirdPlace} />]
    }

    const finalIdx = cols.length - 1
    const finalCol = cols[finalIdx]
    const finalTitle = titles[finalIdx] ?? "Finale"
    const leftCols: BracketMatch[][] = []
    const leftTitles: string[] = []
    const rightCols: BracketMatch[][] = []
    const rightTitles: string[] = []
    for (let r = 0; r < finalIdx; r++) {
        const { left, right } = splitSides(cols[r])
        leftCols.push(left)
        leftTitles.push(titles[r] ?? "")
        rightCols.push(right)
        rightTitles.push(titles[r] ?? "")
    }
    return [
        <ColumnsBracketBody cols={[...leftCols, finalCol]} titles={[...leftTitles, finalTitle]} thirdPlace={null} />,
        <ColumnsBracketBody cols={[...rightCols, finalCol]} titles={[...rightTitles, finalTitle]} thirdPlace={thirdPlace} />,
    ]
}

/* ── Match poster (portrait "Utakmica") ─────────────────────────────────────
   One match blown up to a poster: the standard page-1 header, then a match
   header block (stage badge · team1 vs team2 with the big result · kickoff),
   then the "TIJEK UTAKMICE" two-sided timeline mirrored from the public
   MatchLivePage (GoalscorersPanel). Events derive through deriveMatchTimeline -
   a faithful copy of the panel's derivation - so the poster always agrees with
   the page. Icons are recreated as inline SVG / coloured shapes (no emoji font
   dependency, which html-to-image can't render reliably). Paginated under the
   same budget pattern as the schedule poster; continuation pages repeat
   "TIJEK UTAKMICE · nastavak".
   ─────────────────────────────────────────────────────────────────────────── */

/** Everything the match poster needs - built by MatchLivePage from data it
 *  already has (no reimplementation of the page's derivation). */
export type MatchExportData = {
    tournamentUuid: string
    matchId: number
    /** Timeline sides - team1 = left, team2 = right (same as the app panel). */
    team1Id: number | null
    team2Id: number | null
    team1Name: string
    team2Name: string
    /** Regulation score - null when the match has not produced one yet. */
    score1: number | null
    score2: number | null
    /** Penalty-shootout total - null when there was none. */
    penalties1: number | null
    penalties2: number | null
    /** True while LIVE (drives the red accent + the UŽIVO pill). */
    isLive: boolean
    /** MatchStatus - "SCHEDULED" | "LIVE" | "FINISHED". */
    status: string
    /** Raw stage + group letter → the "Grupa X / Četvrtfinale" badge. */
    stage?: string | null
    groupName?: string | null
    kickoffAt: string | null
    /** Half length (min) - splits the timeline into 1./2. poluvrijeme. */
    halfLengthMin: number | null
}

/* Yellow-card hue (theme-independent literal, see file header). Red cards, own
   goals and missed penalties reuse the live red (C.live). */
const CARD_YELLOW = "#f2b807"

/** Small football marker - green for a (penalty) goal, red for an own goal.
 *  Inline SVG (mirrors the brand ball's centre pentagon) so no emoji font is
 *  needed at capture time. */
function BallGlyph({ color, size = 14 }: { color: string; size?: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", flexShrink: 0 }}>
            <circle cx="50" cy="50" r="45" fill="#ffffff" stroke={color} strokeWidth="7" />
            <path d="M50,34 L65.22,45.06 L59.41,62.94 L40.59,62.94 L34.78,45.06 Z" fill={color} />
        </svg>
    )
}

/** Coloured card square (yellow / red) - the poster stand-in for 🟨 / 🟥. */
function CardGlyph({ color }: { color: string }) {
    return <span style={{ display: "inline-block", width: "10px", height: "13px", background: color, borderRadius: "2px", flexShrink: 0 }} />
}

/** Missed-penalty cross (the poster stand-in for ❌). */
function CrossGlyph({ color, size = 12 }: { color: string; size?: number }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", flexShrink: 0 }}>
            <path d="M5 5 L19 19 M19 5 L5 19" stroke={color} strokeWidth="3.5" strokeLinecap="round" />
        </svg>
    )
}

/** Event icon nearest the timeline spine (mirrors TimelineEventLine's icons). */
function TimelineIcon({ type }: { type: MatchEventType }) {
    switch (type) {
        case "GOAL":
        case "PENALTY_GOAL":
            return <BallGlyph color={C.win} />
        case "OWN_GOAL":
            return <BallGlyph color={C.live} />
        case "YELLOW_CARD":
            return <CardGlyph color={CARD_YELLOW} />
        case "RED_CARD":
            return <CardGlyph color={C.live} />
        case "PENALTY_MISSED":
            return <CrossGlyph color={C.live} />
        default:
            return null
    }
}

/** Timeline display name + whether it is an unknown/placeholder (italic, muted)
 *  - a faithful copy of GoalscorersPanel.TimelineEventLine's name logic. */
function timelineName(e: MatchEventDto): { text: string; unknown: boolean } {
    const isPenGoal = e.type === "PENALTY_GOAL"
    const isPenMiss = e.type === "PENALTY_MISSED"
    if (e.type === "OWN_GOAL") {
        return e.playerName != null
            ? { text: `${e.playerName} (ag)`, unknown: false }
            : { text: "Autogol", unknown: true }
    }
    if (e.playerName != null) return { text: e.playerName, unknown: false }
    const text =
        e.type === "GOAL" || isPenGoal
            ? "Nepoznati strijelac"
            : e.type === "YELLOW_CARD" || e.type === "RED_CARD"
                ? "Nepoznati igrač"
                : isPenMiss
                    ? "(promašaj)"
                    : ""
    return { text, unknown: true }
}

/** One vertical-timeline section (1./2. poluvrijeme / Penali / headerless reg). */
type TimelineSection = { key: string; title: string; events: MatchEventDto[] }

/** Derive the poster timeline EXACTLY as GoalscorersPanel does, so the two
 *  never disagree: same team-side detection, same regulation/penalty split,
 *  same 1./2. poluvrijeme sectioning, same cumulative running score. */
function deriveMatchTimeline(
    events: MatchEventDto[],
    team1Id: number | null,
    team2Id: number | null,
    halfLengthMin: number | null | undefined,
): { sections: TimelineSection[]; scoreLabels: Map<number, string>; t1Id: number | null; t2Id: number | null } {
    let t1Id = team1Id
    let t2Id = team2Id
    if (t1Id == null || t2Id == null) {
        const distinct = Array.from(new Set(events.map((e) => e.teamId))).sort((a, b) => a - b)
        t1Id = distinct[0] ?? null
        t2Id = distinct[1] ?? null
    }

    const regulation = events
        .filter((e) => e.type === "GOAL" || e.type === "OWN_GOAL" || e.type === "YELLOW_CARD" || e.type === "RED_CARD")
        .sort((a, b) => a.minute - b.minute)
    const penalties = events.filter((e) => e.type === "PENALTY_GOAL" || e.type === "PENALTY_MISSED")

    const sections: TimelineSection[] = []
    const hl = halfLengthMin != null && halfLengthMin > 0 ? halfLengthMin : null
    if (regulation.length > 0) {
        if (hl != null) {
            const first = regulation.filter((e) => e.minute < hl)
            const second = regulation.filter((e) => e.minute >= hl)
            if (first.length) sections.push({ key: "h1", title: "1. poluvrijeme", events: first })
            if (second.length) sections.push({ key: "h2", title: "2. poluvrijeme", events: second })
        } else {
            sections.push({ key: "reg", title: "", events: regulation })
        }
    }
    if (penalties.length > 0) {
        sections.push({ key: "pen", title: "Penali", events: penalties })
    }

    // Running score for the goal chips - cumulative over the minute-sorted
    // regulation goals; only GOAL/OWN_GOAL move the score (cards don't).
    const scoreLabels = new Map<number, string>()
    let rs1 = 0
    let rs2 = 0
    for (const e of regulation) {
        if (e.type === "GOAL" || e.type === "OWN_GOAL") {
            if (e.teamId === t1Id) rs1++
            else rs2++
            scoreLabels.set(e.id, `${rs1} - ${rs2}`)
        }
    }
    return { sections, scoreLabels, t1Id, t2Id }
}

/** One event on the poster's centred spine: home (team1) branches left, away
 *  (team2) right, with the icon nearest the line and a running-score chip in
 *  the centre for goals (else a small ink dot). Mirrors TimelineEventLine. */
function TimelineLinePoster({ e, isLeft, scoreLabel }: { e: MatchEventDto; isLeft: boolean; scoreLabel: string | null }) {
    const isPenalty = e.type === "PENALTY_GOAL" || e.type === "PENALTY_MISSED"
    const { text, unknown } = timelineName(e)
    const nameBlock = (
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, alignItems: isLeft ? "flex-end" : "flex-start" }}>
            <span
                style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: unknown ? C.muted : C.ink,
                    fontStyle: unknown ? "italic" : undefined,
                    lineHeight: 1.25,
                    textAlign: isLeft ? "right" : "left",
                    overflowWrap: "anywhere",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                }}
            >
                {text}
            </span>
            {e.type === "GOAL" && e.assistPlayerName ? (
                <span style={{ fontSize: "10px", color: C.muted, lineHeight: 1.2, textAlign: isLeft ? "right" : "left" }}>
                    asist. {e.assistPlayerName}
                </span>
            ) : null}
        </div>
    )
    const minuteEl = !isPenalty ? (
        <span
            style={{
                fontFamily: F_MONO,
                fontSize: "11px",
                fontWeight: 700,
                color: C.inkSoft,
                whiteSpace: "nowrap",
                flexShrink: 0,
                fontVariantNumeric: "tabular-nums",
            }}
        >
            {`${e.minute}'`}
        </span>
    ) : null
    const icon = <TimelineIcon type={e.type} />
    const centre = scoreLabel ? (
        <span
            style={{
                fontFamily: F_MONO,
                fontSize: "11px",
                fontWeight: 800,
                color: C.green,
                background: C.greenWash,
                borderRadius: "5px",
                padding: "2px 7px",
                whiteSpace: "nowrap",
            }}
        >
            {scoreLabel}
        </span>
    ) : (
        <span style={{ width: "9px", height: "9px", borderRadius: "999px", background: C.ink }} />
    )
    return (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 74px minmax(0,1fr)", alignItems: "center", minHeight: "29px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "7px", paddingRight: "4px", minWidth: 0, overflow: "hidden" }}>
                {isLeft ? (
                    <>
                        {nameBlock}
                        {minuteEl}
                        {icon}
                    </>
                ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{centre}</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: "7px", paddingLeft: "4px", minWidth: 0, overflow: "hidden" }}>
                {!isLeft ? (
                    <>
                        {icon}
                        {minuteEl}
                        {nameBlock}
                    </>
                ) : null}
            </div>
        </div>
    )
}

/** Centred section header ("1./2. poluvrijeme" / "Penali") - a surface-coloured
 *  chip so it masks the dashed spine behind it. */
function TimelineSectionHeaderPoster({ title }: { title: string }) {
    return (
        <div style={{ display: "flex", justifyContent: "center", padding: "5px 0" }}>
            <span
                style={{
                    background: C.surface,
                    padding: "0 12px",
                    fontFamily: F_MONO,
                    fontSize: "11px",
                    fontWeight: 800,
                    letterSpacing: "0.08em",
                    color: C.inkSoft,
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                }}
            >
                {title}
            </span>
        </div>
    )
}

/** One page's worth of timeline sections drawn over a continuous dashed spine
 *  (the SofaScore-style centre line the app draws behind its timeline). */
function TimelineSpineSections({
    sections,
    scoreLabels,
    t1Id,
}: {
    sections: TimelineSection[]
    scoreLabels: Map<number, string>
    t1Id: number | null
}) {
    return (
        <div style={{ position: "relative" }}>
            <div
                style={{
                    position: "absolute",
                    top: "4px",
                    bottom: "4px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    borderLeft: `2px dashed ${C.line}`,
                    zIndex: 0,
                }}
            />
            <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column" }}>
                {sections.map((sec, si) => (
                    <div key={`${sec.key}-${si}`}>
                        {sec.title ? <TimelineSectionHeaderPoster title={sec.title} /> : null}
                        {sec.events.map((e) => (
                            <TimelineLinePoster key={e.id} e={e} isLeft={e.teamId === t1Id} scoreLabel={scoreLabels.get(e.id) ?? null} />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}

/** "TIJEK UTAKMICE" section label (exact match of the app's panel label);
 *  continuation pages append "· nastavak". */
function TijekHeading({ continued }: { continued?: boolean }) {
    return (
        <div style={{ textAlign: "center", marginBottom: "10px" }}>
            <span
                style={{
                    fontFamily: F_MONO,
                    fontSize: "12px",
                    fontWeight: 800,
                    letterSpacing: "0.12em",
                    color: C.muted,
                    textTransform: "uppercase",
                }}
            >
                {continued ? "TIJEK UTAKMICE · nastavak" : "TIJEK UTAKMICE"}
            </span>
        </div>
    )
}

/** The match header block under the standard page-1 furniture: stage badge,
 *  UŽIVO pill (LIVE), team1 vs team2 with the big result (red when LIVE) or a
 *  "vs" placeholder before the match, the penalty line, and the kickoff. */
/** The UŽIVO pill + stage badge shown in the poster HEADER, directly under the
 *  date•location line - moved out of the score block so the header carries the
 *  match's status/stage and the block below stays focused on the result. */
function MatchHeaderExtra({ match }: { match: MatchExportData }) {
    const badge = matchStageBadge(match.stage, match.groupName)
    if (!badge && !match.isLive) return null
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
            {match.isLive ? (
                <span
                    style={{
                        fontFamily: F_MONO,
                        fontSize: "11px",
                        fontWeight: 800,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: C.white,
                        background: C.live,
                        padding: "3px 11px",
                        borderRadius: "999px",
                    }}
                >
                    UŽIVO
                </span>
            ) : null}
            {badge ? (
                <span
                    style={{
                        fontFamily: F_MONO,
                        fontSize: "11px",
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: C.green,
                        background: C.greenWash,
                        padding: "4px 11px",
                        borderRadius: "999px",
                    }}
                >
                    {badge}
                </span>
            ) : null}
        </div>
    )
}

function MatchHeaderBlock({ match }: { match: MatchExportData }) {
    const finished = match.status === "FINISHED"
    const hasScore = match.score1 != null && match.score2 != null && (match.isLive || finished)
    const hasPens = match.penalties1 != null && match.penalties2 != null
    const kickoff = matchKickoffLine(match.kickoffAt)
    const nameStyle = { fontFamily: F_HEAD, fontSize: "20px", fontWeight: 800 as const, color: C.ink, lineHeight: 1.15, overflowWrap: "break-word" as const, minWidth: 0 }
    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "9px", marginBottom: "20px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "18px", width: "100%" }}>
                <span style={{ ...nameStyle, textAlign: "right" }}>{match.team1Name}</span>
                <span
                    style={{
                        fontFamily: F_MONO,
                        fontSize: hasScore ? "32px" : "18px",
                        fontWeight: 800,
                        color: hasScore ? (match.isLive ? C.live : C.ink) : C.muted,
                        whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                        lineHeight: 1,
                    }}
                >
                    {hasScore ? `${match.score1} : ${match.score2}` : "vs"}
                </span>
                <span style={{ ...nameStyle, textAlign: "left" }}>{match.team2Name}</span>
            </div>
            {hasPens ? (
                <span style={{ fontFamily: F_MONO, fontSize: "12px", fontWeight: 700, color: C.inkSoft, whiteSpace: "nowrap" }}>
                    ({match.penalties1} : {match.penalties2} penali)
                </span>
            ) : null}
            {kickoff ? <span style={{ fontSize: "12px", fontWeight: 600, color: C.inkSoft }}>{kickoff}</span> : null}
        </div>
    )
}

/* Row budgets for the match timeline (mirrors the schedule poster's per-page
   budget pattern). Page 1 shares its body with the match header block + the
   "TIJEK UTAKMICE" heading, so it takes fewer event rows; continuation pages get
   the fuller budget. A section
   header ("1./2. poluvrijeme" / "Penali") costs one row and never dangles as a
   page's last row (same rule as the schedule paginator). */
const MATCH_ROWS_FIRST = 13
const MATCH_ROWS_REST = 21

/** Split the timeline sections across pages under the row budget - the schedule
 *  poster's budget pattern applied to event rows: a titled section's header
 *  costs a row and never lands as a page's last row; a long half splits across
 *  pages, repeating its header. Page 1 uses the smaller (header-sharing) budget. */
function paginateTimeline(sections: TimelineSection[]): TimelineSection[][] {
    const pages: TimelineSection[][] = []
    let pageSecs: TimelineSection[] = []
    let used = 0
    let budget = MATCH_ROWS_FIRST
    const flush = () => {
        if (pageSecs.length > 0) {
            pages.push(pageSecs)
            pageSecs = []
            used = 0
            budget = MATCH_ROWS_REST
        }
    }
    for (const sec of sections) {
        const headerCost = sec.title ? 1 : 0
        let rest = sec.events
        while (rest.length > 0) {
            const remaining = budget - used
            // Need room for the header (when titled) + at least one event.
            if (remaining < headerCost + 1) {
                flush()
                continue
            }
            const take = Math.min(remaining - headerCost, rest.length)
            pageSecs.push({ key: sec.key, title: sec.title, events: rest.slice(0, take) })
            used += headerCost + take
            rest = rest.slice(take)
            // Any remainder of this section continues on a fresh page.
            if (rest.length > 0) flush()
        }
    }
    flush()
    return pages
}

/** Build the match poster page bodies: page 1 = match header + timeline start,
 *  continuation pages = the rest of the timeline. No events → the match header
 *  plus the app's own empty-state note. */
function buildMatchPages(match: MatchExportData | undefined, events: MatchEventDto[]): ReactNode[] {
    if (!match) {
        return [
            <div style={{ padding: "60px 0", textAlign: "center", color: C.muted, fontSize: "16px" }}>
                Nema podataka o utakmici.
            </div>,
        ]
    }
    const { sections, scoreLabels, t1Id } = deriveMatchTimeline(events, match.team1Id, match.team2Id, match.halfLengthMin)

    if (sections.length === 0) {
        // Same empty-state wording the page's GoalscorersPanel shows.
        const note =
            match.status === "FINISHED"
                ? "Prikazan samo krajnji rezultat bez strijelca."
                : match.status === "SCHEDULED"
                    ? "Utakmica još nije počela."
                    : "Još nema događaja."
        return [
            <div>
                <MatchHeaderBlock match={match} />
                <TijekHeading />
                <div style={{ padding: "24px 0", textAlign: "center", color: C.muted, fontSize: "13px" }}>{note}</div>
            </div>,
        ]
    }

    return paginateTimeline(sections).map((secs, i) => (
        <div>
            {i === 0 ? <MatchHeaderBlock match={match} /> : null}
            <TijekHeading continued={i > 0} />
            <TimelineSpineSections sections={secs} scoreLabels={scoreLabels} t1Id={t1Id} />
        </div>
    ))
}

/* ── capture helpers ───────────────────────────────────────────────────── */

/** Make sure the brand fonts are loaded before html-to-image reads them,
 *  otherwise the first export can snapshot a fallback font. */
async function ensureFonts() {
    try {
        const fonts = document.fonts
        if (!fonts) return
        await fonts.ready
        await Promise.all([
            fonts.load("800 42px 'Bricolage Grotesque'"),
            fonts.load("800 16px 'Bricolage Grotesque'"),
            fonts.load("700 13px 'JetBrains Mono'"),
            fonts.load("800 16px 'JetBrains Mono'"),
            fonts.load("600 15px 'Inter'"),
        ]).catch(() => undefined)
    } catch {
        /* best effort - fall through to capture regardless */
    }
}

function triggerDownload(dataUrl: string, filename: string) {
    const a = document.createElement("a")
    a.href = dataUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
}

/** Small pause so the browser doesn't swallow rapid back-to-back downloads
 *  (used between the per-page JPG saves). */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/* ── Top-scorers poster ("Najbolji strijelci") ──────────────────────────────
   Same page furniture as every sibling poster (the PosterPage shell supplies
   the tournament-name header, branded QR, watermark and footer). ONE portrait
   A4 page: a "NAJBOLJI STRIJELCI" heading over the TOP-10 list.

   Ranking is STANDARD COMPETITION ("1224") on `goals` (the Statistika section's
   ACTIVE-scope tally): tied players share a position and the next position
   skips (e.g. 7,7 -> 2,2, next is 4). The list is capped at 10 rows so it
   always fits a single sheet (see rankScorers). Top-3 are highlighted BY RANK
   (not by index) - a tie that puts 4+ players into ranks 1-3 highlights all of
   them - with the gold/silver/bronze medallion + a larger, bolder row.
   `goalsAll` is surfaced as a small "s grupama N" line only when it differs from
   `goals`, mirroring exactly what StatsSection's ScorerRow shows (which happens
   only when the scope isn't ALL).
   ─────────────────────────────────────────────────────────────────────────── */

/* Podium hues - mirror the inline gold/silver/bronze literals in PodiumStrip so
   the medallions read identically to the bracket poster's 1./2./3. strip. */
const SCORER_MEDAL = ["#d4a017", "#98a0a6", "#b3763e"]

/** A scorer paired with its precomputed standard-competition rank. */
type RankedScorer = { scorer: ScorerDto; rank: number }

/** Standard-competition ("1224") ranking of the top 10 by `goals` (desc). The
 *  caller's list is already goals-sorted (backend), but we re-sort defensively
 *  so the poster is correct regardless of input order. A hard 10-row cap (not
 *  "include everyone tied at the boundary") keeps the page a guaranteed single
 *  A4 sheet - ranks are computed over the displayed rows, so a player tied at
 *  the 10th boundary but sitting past index 10 is simply not shown. */
function rankScorers(scorers: ScorerDto[]): RankedScorer[] {
    const top = [...scorers].sort((a, b) => b.goals - a.goals).slice(0, 10)
    const ranked: RankedScorer[] = []
    for (let i = 0; i < top.length; i++) {
        const rank = i > 0 && top[i].goals === top[i - 1].goals ? ranked[i - 1].rank : i + 1
        ranked.push({ scorer: top[i], rank })
    }
    return ranked
}

/** One scorer row: rank medallion · player name + (muted) team · big goals.
 *  `rank <= 3` upgrades the row to the podium treatment (medal colour + a
 *  larger, bolder layout). */
function ScorerPosterRow({ scorer, rank }: RankedScorer) {
    const podium = rank <= 3
    const medal = podium ? SCORER_MEDAL[rank - 1] : null
    // Full-tournament tally shown only when it differs from the counted one -
    // identical gate to StatsSection.ScorerRow (true only when scope !== ALL).
    const showAll = scorer.goalsAll !== scorer.goals
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                padding: podium ? "11px 20px" : "9px 20px",
                background: C.white,
                border: `1px solid ${C.line}`,
                borderRadius: "12px",
            }}
        >
            {/* Rank medallion - podium ranks get the solid medal disc. */}
            <div
                style={{
                    width: podium ? "38px" : "32px",
                    height: podium ? "38px" : "32px",
                    borderRadius: "9999px",
                    background: medal ?? C.surface,
                    border: medal ? "none" : `1px solid ${C.line}`,
                    color: medal ? C.white : C.inkSoft,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: F_HEAD,
                    fontSize: podium ? "16px" : "14px",
                    fontWeight: 800,
                    flexShrink: 0,
                }}
            >
                {rank}
            </div>
            {/* Name + team. */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    style={{
                        fontFamily: F_HEAD,
                        fontSize: podium ? "19px" : "16px",
                        fontWeight: podium ? 800 : 700,
                        letterSpacing: "-0.01em",
                        color: C.ink,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                    }}
                >
                    {scorer.playerName}
                </div>
                {scorer.teamName ? (
                    <div
                        style={{
                            fontSize: podium ? "12.5px" : "12px",
                            fontWeight: 600,
                            color: C.muted,
                            marginTop: "2px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                        }}
                    >
                        {scorer.teamName}
                    </div>
                ) : null}
            </div>
            {/* Goals - big and bold, right-aligned (ball glyph mirrors the app). */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                    <BallGlyph color={C.win} size={podium ? 17 : 14} />
                    <span
                        style={{
                            fontFamily: F_HEAD,
                            fontSize: podium ? "27px" : "22px",
                            fontWeight: 800,
                            letterSpacing: "-0.02em",
                            lineHeight: 1,
                            color: C.ink,
                        }}
                    >
                        {scorer.goals}
                    </span>
                </div>
                {showAll ? (
                    <span
                        style={{
                            fontFamily: F_MONO,
                            fontSize: "10px",
                            fontWeight: 700,
                            color: C.muted,
                            marginTop: "3px",
                            whiteSpace: "nowrap",
                        }}
                    >
                        s grupama {scorer.goalsAll}
                    </span>
                ) : null}
            </div>
        </div>
    )
}

/** The top-scorers poster body - the "NAJBOLJI STRIJELCI" heading (mirrors the
 *  group poster's "Utakmice · Grupa X" heading treatment) over the ranked rows. */
function ScorersPosterBody({ scorers }: { scorers: ScorerDto[] }) {
    const ranked = rankScorers(scorers)
    return (
        <div>
            {/* Heading + hairline rule (same lockup as GroupMatchesSection). */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <span
                    style={{
                        fontFamily: F_MONO,
                        fontSize: "14px",
                        fontWeight: 800,
                        letterSpacing: "0.1em",
                        color: C.green,
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                    }}
                >
                    Najbolji strijelci
                </span>
                <span style={{ flex: 1, height: "1px", background: C.line }} />
            </div>
            {ranked.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {ranked.map(({ scorer, rank }) => (
                        <ScorerPosterRow key={scorer.playerId} scorer={scorer} rank={rank} />
                    ))}
                </div>
            ) : (
                <div style={{ fontFamily: F_BODY, fontSize: "15px", color: C.muted, paddingTop: "8px" }}>
                    Još nema postignutih golova.
                </div>
            )}
        </div>
    )
}

/** Top-scorers poster pages - always a single portrait A4 page (the top-10
 *  list fits comfortably). */
function buildScorersPages(scorers: ScorerDto[]): ReactNode[] {
    return [<ScorersPosterBody scorers={scorers} />]
}

/* ── Export dialog ─────────────────────────────────────────────────────── */

type ExportKind = "groups" | "schedule" | "bracket" | "match" | "scorers"

/** Schedule status-filter pills (second pill row). "upcoming" keeps everything
 *  that isn't FINISHED (SCHEDULED / LIVE / no status), "finished" only FINISHED. */
const STATUS_FILTERS: { id: "all" | "upcoming" | "finished"; label: string }[] = [
    { id: "all", label: "Sve" },
    { id: "upcoming", label: "Nadolazeće" },
    { id: "finished", label: "Završene" },
]

/** Groups poster "best-placed table" option (second pill row, all-groups scope
 *  only): plain groups, groups + the table page, or just the table page. */
type GroupsTableOption = "grupe" | "grupe-najbolji" | "samo-najbolji"

/** Scaled live preview of the poster + "Preuzmi PDF / JPG" actions. The poster
 *  is rendered once at full A4 size (absolutely positioned inside a scaled
 *  viewport) and that same node is snapshotted for the download - so what the
 *  user previews is exactly what they get. */
export function ExportDialog({
    open,
    onClose,
    kind,
    meta,
    groups,
    thirdTable,
    matches,
    bracket,
    match,
    scorers,
    initialScope,
}: {
    open: boolean
    onClose: () => void
    kind: ExportKind
    meta: ExportMeta
    /** Required for kind="groups". */
    groups?: Group[]
    /** Optional (kind="groups") - the "best {advancePerGroup+1}. placed"
     *  cross-group ranking. When present with bestThirdCount > 0 it unlocks the
     *  table pill row (add it as a trailing page, or export it standalone). */
    thirdTable?: ThirdPlacedTable | null
    /** Required for kind="schedule". */
    matches?: ScheduledMatch[]
    /** Required for kind="bracket" - the knockout rounds + 3rd-place fixture. */
    bracket?: Bracket
    /** Required for kind="match" - the single match blown up to a poster. Its
     *  events are fetched here (same endpoint the page's panel uses). */
    match?: MatchExportData
    /** Required for kind="scorers" - the tournament's top-scorers list (already
     *  the Statistika section's active-scope tally). Ranked on the poster with
     *  standard-competition ("1224") ranking and capped at the top 10. */
    scorers?: ScorerDto[]
    /** Scope to preselect on open (e.g. "g:5" for a single group); resets to
     *  it every time the dialog reopens. Defaults to "all". */
    initialScope?: string
}) {
    // Each rendered A4 page mounts its node here (index-aligned to pageBodies);
    // the download loop snapshots each one in turn.
    const pageRefs = useRef<(HTMLDivElement | null)[]>([])
    const [busy, setBusy] = useState<null | "pdf" | "jpg">(null)
    // Groups / schedule / match stay A4 portrait; the bracket uses the bigger A3
    // portrait sheet so its two-sided vertical layout gets roomy columns.
    const orientation: Orientation = kind === "bracket" ? "a3portrait" : "portrait"
    const page = PAGE_PX[orientation]
    // Export scope: "all" (whole poster) or one group / "ko" (završnica). The
    // selector filters the poster's content; it resets to initialScope on open.
    const [scope, setScope] = useState<string>(initialScope ?? "all")
    // Schedule-only status filter: "all" | "upcoming" (anything not finished) |
    // "finished". Combines with the scope; resets to "all" on open.
    const [statusFilter, setStatusFilter] = useState<"all" | "upcoming" | "finished">("all")
    // Groups-only "best {advancePerGroup+1}. placed" table option (all-groups
    // scope only): "grupe" (current behavior) | "grupe-najbolji" (groups pages +
    // the table as a trailing page) | "samo-najbolji" (just the table page).
    // Resets to "grupe" on open.
    const [tableOption, setTableOption] = useState<GroupsTableOption>("grupe")
    // Branded QR (club-logo PNG from the backend), fetched when the dialog
    // opens; capture is blocked until it settles so the poster is never
    // snapshotted mid-fetch. On failure it stays null and the poster omits it.
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
    const [qrLoading, setQrLoading] = useState(false)
    // Match poster only: the match events, fetched when the dialog opens (same
    // endpoint GoalscorersPanel uses, so the poster agrees with the page).
    // Capture is blocked until they settle so no page snapshots mid-fetch.
    const [matchEvents, setMatchEvents] = useState<MatchEventDto[]>([])
    const [matchEventsLoading, setMatchEventsLoading] = useState(false)

    // Preview column width - all posters are portrait, clipped inside the dialog.
    const PREVIEW_W = 430
    const scale = PREVIEW_W / page.w

    // Reset the scope + status filter + table option whenever the dialog (re)opens.
    useEffect(() => {
        if (open) {
            setScope(initialScope ?? "all")
            setStatusFilter("all")
            setTableOption("grupe")
        }
    }, [open, initialScope])

    // Fetch the branded QR (club logo baked in) when the dialog opens. The PNG
    // is same-origin (`/api/tournaments/<slugOrUuid>/qr.png`), read into a
    // data-URL so html-to-image stays taint-free and load-order-safe.
    useEffect(() => {
        if (!open) return
        const endpoint = qrEndpoint(meta.tournamentUrl)
        if (!endpoint) {
            setQrDataUrl(null)
            setQrLoading(false)
            return
        }
        let cancelled = false
        setQrLoading(true)
        setQrDataUrl(null)
        fetch(endpoint)
            .then((r) => {
                if (!r.ok) throw new Error(`QR ${r.status}`)
                return r.blob()
            })
            .then(
                (blob) =>
                    new Promise<string>((resolve, reject) => {
                        const fr = new FileReader()
                        fr.onload = () => resolve(fr.result as string)
                        fr.onerror = () => reject(fr.error)
                        fr.readAsDataURL(blob)
                    }),
            )
            .then((d) => {
                if (!cancelled) {
                    setQrDataUrl(d)
                    setQrLoading(false)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setQrDataUrl(null)
                    setQrLoading(false)
                }
            })
        return () => {
            cancelled = true
        }
    }, [open, meta.tournamentUrl])

    // Match poster: load the event log when the dialog opens. Depends on the
    // ids (not the `match` object) so a new object identity each render doesn't
    // refire the fetch.
    useEffect(() => {
        if (!open || kind !== "match" || !match) {
            setMatchEvents([])
            setMatchEventsLoading(false)
            return
        }
        let cancelled = false
        setMatchEventsLoading(true)
        setMatchEvents([])
        fetchMatchEvents(match.tournamentUuid, match.matchId)
            .then((evs) => {
                if (!cancelled) {
                    setMatchEvents(evs)
                    setMatchEventsLoading(false)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setMatchEvents([])
                    setMatchEventsLoading(false)
                }
            })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, kind, match?.tournamentUuid, match?.matchId])

    // Selectable scopes: all + one per group, plus "Završnica" for a schedule
    // that has any knockout match. The bracket poster has no scopes (one shape).
    const scopeOptions = useMemo<{ id: string; label: string }[]>(() => {
        if (kind === "bracket") {
            return [{ id: "all", label: "Završnica" }]
        }
        if (kind === "match") {
            // Single shape → the scope pill row stays hidden (no scope/status).
            return [{ id: "all", label: "Utakmica" }]
        }
        if (kind === "scorers") {
            // Single shape → the scope pill row stays hidden.
            return [{ id: "all", label: "Strijelci" }]
        }
        if (kind === "groups") {
            return [
                { id: "all", label: "Sve grupe" },
                ...(groups ?? []).map((g) => ({ id: `g:${g.id}`, label: `Grupa ${g.name}` })),
            ]
        }
        const names = [
            ...new Set(
                (matches ?? []).filter((m) => m.stage === "GROUP" && m.groupName).map((m) => m.groupName as string),
            ),
        ].sort((a, b) => a.localeCompare(b, "hr"))
        const hasKnockout = (matches ?? []).some((m) => m.stage !== "GROUP")
        return [
            { id: "all", label: "Cijeli raspored" },
            ...names.map((n) => ({ id: `grp:${n}`, label: `Grupa ${n}` })),
            ...(hasKnockout ? [{ id: "ko", label: "Završnica" }] : []),
        ]
    }, [kind, groups, matches])

    // Guard against a stale scope (data changed under it) - fall back to "all".
    const activeScope = scopeOptions.some((s) => s.id === scope) ? scope : "all"

    // Groups "best {advancePerGroup+1}. placed" table: available only for the
    // groups poster when the ranking carries qualifiers. The table pill row (and
    // its effect on the pages / filename) applies to the all-groups scope only -
    // a single-group scope ignores it (effTableOption falls back to "grupe").
    const bestPlace = thirdTable ? thirdTable.advancePerGroup + 1 : 0
    const tableEligible = kind === "groups" && !!thirdTable && thirdTable.bestThirdCount > 0
    const effTableOption: GroupsTableOption =
        tableEligible && activeScope === "all" ? tableOption : "grupe"

    // Resolve the active scope + status filter → paginated page bodies + the
    // filename suffixes. Each body renders into its own A4 PosterPage below.
    let pageBodies: ReactNode[]
    let scopeSuffix = ""
    let statusSuffix = ""
    // Set only for the standalone best-placed export - overrides the whole
    // baseName (`<slug>-najbolji-{place}`) instead of appending a suffix.
    let groupsStandaloneBase: string | null = null
    if (kind === "bracket") {
        pageBodies = buildBracketPages(bracket)
    } else if (kind === "match") {
        pageBodies = buildMatchPages(match, matchEvents)
    } else if (kind === "scorers") {
        pageBodies = buildScorersPages(scorers ?? [])
    } else if (kind === "groups") {
        const single = activeScope !== "all"
        const shown = single ? (groups ?? []).filter((g) => `g:${g.id}` === activeScope) : groups ?? []
        if (single && shown[0]) scopeSuffix = `-grupa-${slugify(shown[0].name)}`
        if (effTableOption === "samo-najbolji" && thirdTable) {
            // Standalone: just the best-placed table page (own filename below).
            pageBodies = [<BestPlacedTablePage table={thirdTable} />]
            groupsStandaloneBase = `${slugify(meta.tournamentName)}-najbolji-${bestPlace}`
        } else if (effTableOption === "grupe-najbolji" && thirdTable) {
            // All-groups + the best-placed table. When both fit one page (≤4
            // groups and the estimate clears the page budget) the table rides
            // UNDER the grid on the same page; otherwise it trails on its own
            // page. Either way the extra content rides the "-grupe" filename.
            if (!single && fitsBestPlacedInline(shown, thirdTable)) {
                const showStandings = shown.some((g) =>
                    (g.matches ?? []).some((m) => m.status === "LIVE" || m.status === "FINISHED"),
                )
                pageBodies = [
                    <GroupsWithBestPlacedPage groups={shown} showStandings={showStandings} table={thirdTable} />,
                ]
            } else {
                pageBodies = [...buildGroupsPages(shown, single), <BestPlacedTablePage table={thirdTable} />]
            }
        } else {
            pageBodies = buildGroupsPages(shown, single)
        }
    } else {
        const all = matches ?? []
        let shown = all
        if (activeScope.startsWith("grp:")) {
            const name = activeScope.slice(4)
            shown = all.filter((m) => m.stage === "GROUP" && m.groupName === name)
            scopeSuffix = `-grupa-${slugify(name)}`
        } else if (activeScope === "ko") {
            shown = all.filter((m) => m.stage !== "GROUP")
            scopeSuffix = "-zavrsnica"
        }
        // Status filter: FINISHED = završene; everything else (SCHEDULED / LIVE /
        // no status) = nadolazeće. Applied on top of the scope filter.
        if (statusFilter === "finished") {
            shown = shown.filter((m) => m.status === "FINISHED")
            statusSuffix = "-zavrsene"
        } else if (statusFilter === "upcoming") {
            shown = shown.filter((m) => m.status !== "FINISHED")
            statusSuffix = "-nadolazece"
        }
        pageBodies = buildSchedulePages(shown)
    }
    const pageCount = pageBodies.length

    const suffix = kind === "groups" ? "grupe" : kind === "bracket" ? "zavrsnica-bracket" : kind === "scorers" ? "strijelci" : "raspored"
    const baseName =
        kind === "match"
            ? `${slugify(meta.tournamentName)}-utakmica-${slugify(match?.team1Name ?? "")}-${slugify(match?.team2Name ?? "")}`
            : groupsStandaloneBase ?? `${slugify(meta.tournamentName)}-${suffix}${scopeSuffix}${statusSuffix}`
    const title =
        kind === "groups"
            ? "Preuzmi grupe"
            : kind === "bracket"
                ? "Preuzmi završnicu"
                : kind === "match"
                    ? "Preuzmi utakmicu"
                    : kind === "scorers"
                        ? "Preuzmi strijelce"
                        : "Preuzmi raspored"

    async function handleDownload(fmt: "pdf" | "jpg") {
        // The mounted page nodes, in order. Block capture while the QR is still
        // generating so no page is snapshotted without it (once it settles -
        // ready or failed - proceed).
        const nodes = pageRefs.current.slice(0, pageCount).filter((n): n is HTMLDivElement => n != null)
        if (nodes.length === 0 || busy || qrLoading || (kind === "match" && matchEventsLoading)) return
        setBusy(fmt)
        try {
            await ensureFonts()
            if (fmt === "jpg") {
                // One JPG when single-page, else one file per page (`-1`, `-2`, …)
                // downloaded sequentially with a small gap between clicks.
                for (let i = 0; i < nodes.length; i++) {
                    const url = await toJpeg(nodes[i], {
                        pixelRatio: 2,
                        quality: 0.96,
                        backgroundColor: C.surface,
                        cacheBust: true,
                    })
                    const name = nodes.length === 1 ? `${baseName}.jpg` : `${baseName}-${i + 1}.jpg`
                    triggerDownload(url, name)
                    if (i < nodes.length - 1) await delay(300)
                }
            } else {
                // One jsPDF doc, one A4 page per rendered page node. Every page
                // node is a fixed A4-aspect box, so the snapshot fills the page.
                // The bracket prints on A3 portrait (297mm wide); everything else
                // on A4 portrait (210mm). All are portrait-oriented sheets.
                const isA3 = orientation === "a3portrait"
                const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: isA3 ? "a3" : "a4" })
                const pageWmm = isA3 ? 297 : 210
                for (let i = 0; i < nodes.length; i++) {
                    if (i > 0) pdf.addPage()
                    const node = nodes[i]
                    const url = await toPng(node, {
                        pixelRatio: 2,
                        backgroundColor: C.surface,
                        cacheBust: true,
                    })
                    const imgHmm = pageWmm * (node.offsetHeight / node.offsetWidth)
                    pdf.addImage(url, "PNG", 0, 0, pageWmm, imgHmm, undefined, "FAST")
                }
                pdf.save(`${baseName}.pdf`)
            }
            showSuccess("Plakat spremljen", "Preuzimanje je pokrenuto.")
        } catch (e) {
            console.error("[TournamentExport] capture failed", e)
            showError("Izrada plakata nije uspjela", "Pokušaj ponovno.")
        } finally {
            setBusy(null)
        }
    }

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(e) => {
                if (!e.open && !busy) onClose()
            }}
            placement="center"
            size="lg"
            scrollBehavior="inside"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="540px">
                        <Dialog.Header>
                            <Flex justify="space-between" align="center" w="full" gap="3">
                                <Dialog.Title>{title}</Dialog.Title>
                                <Dialog.CloseTrigger asChild>
                                    <IconButton aria-label="Zatvori" size="sm" variant="ghost" disabled={!!busy}>
                                        <FiX />
                                    </IconButton>
                                </Dialog.CloseTrigger>
                            </Flex>
                        </Dialog.Header>
                        <Dialog.Body>
                            <Text fontSize="sm" color="fg.muted" mb="4">
                                Pregled plakata. Preuzmi kao PDF (A4) ili sliku (JPG) za dijeljenje.
                            </Text>
                            {/* Scope selector - pill row that filters the poster to
                                all / a single group / završnica. Hidden when there is
                                only one possible scope. */}
                            {scopeOptions.length > 1 && (
                                <Flex gap="2" wrap="wrap" justify="center" mb="3">
                                    {scopeOptions.map((s) => (
                                        <Button
                                            key={s.id}
                                            size="xs"
                                            rounded="full"
                                            variant={s.id === activeScope ? "solid" : "outline"}
                                            colorPalette="brand"
                                            disabled={!!busy}
                                            onClick={() => setScope(s.id)}
                                        >
                                            {s.label}
                                        </Button>
                                    ))}
                                </Flex>
                            )}
                            {/* Best-placed table option (groups only, all-groups
                                scope) - a second pill row mirroring the schedule's
                                "Prikaži:" row: a mono label, smaller ghost pills and
                                a hairline divider. Hidden for a single-group scope
                                (the table applies to the all-groups context only). */}
                            {tableEligible && activeScope === "all" && (
                                <Flex
                                    align="center"
                                    justify="center"
                                    gap="1.5"
                                    wrap="wrap"
                                    mb="4"
                                    pt="3"
                                    borderTopWidth={scopeOptions.length > 1 ? "1px" : "0"}
                                    borderColor="border"
                                >
                                    <Text
                                        as="span"
                                        fontFamily="mono"
                                        fontSize="10px"
                                        fontWeight={700}
                                        letterSpacing="0.12em"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                        mr="1"
                                    >
                                        Tablica:
                                    </Text>
                                    {([
                                        { id: "grupe", label: "Grupe" },
                                        { id: "grupe-najbolji", label: `Grupe + najbolji ${bestPlace}.` },
                                        { id: "samo-najbolji", label: `Samo najbolji ${bestPlace}.` },
                                    ] as { id: GroupsTableOption; label: string }[]).map((o) => (
                                        <Button
                                            key={o.id}
                                            size="xs"
                                            h="6"
                                            px="2.5"
                                            fontSize="11px"
                                            rounded="full"
                                            variant={o.id === tableOption ? "subtle" : "ghost"}
                                            colorPalette="brand"
                                            disabled={!!busy}
                                            onClick={() => setTableOption(o.id)}
                                        >
                                            {o.label}
                                        </Button>
                                    ))}
                                </Flex>
                            )}
                            {/* Status filter (schedule only) - a second pill row.
                                Set clearly apart from the scope row above: a mono
                                "PRIKAŽI:" label, lighter ghost pills (smaller than
                                the solid scope pills) and a hairline divider so the
                                two rows never read as one. */}
                            {kind === "schedule" && (
                                <Flex
                                    align="center"
                                    justify="center"
                                    gap="1.5"
                                    wrap="wrap"
                                    mb="4"
                                    pt="3"
                                    borderTopWidth={scopeOptions.length > 1 ? "1px" : "0"}
                                    borderColor="border"
                                >
                                    <Text
                                        as="span"
                                        fontFamily="mono"
                                        fontSize="10px"
                                        fontWeight={700}
                                        letterSpacing="0.12em"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                        mr="1"
                                    >
                                        Prikaži:
                                    </Text>
                                    {STATUS_FILTERS.map((s) => (
                                        <Button
                                            key={s.id}
                                            size="xs"
                                            h="6"
                                            px="2.5"
                                            fontSize="11px"
                                            rounded="full"
                                            variant={s.id === statusFilter ? "subtle" : "ghost"}
                                            colorPalette="brand"
                                            disabled={!!busy}
                                            onClick={() => setStatusFilter(s.id)}
                                        >
                                            {s.label}
                                        </Button>
                                    ))}
                                </Flex>
                            )}
                            {/* Scaled preview - every page is stacked vertically, each
                                the real full-size PosterPage node (absolutely
                                positioned + scaled) so the download captures exactly
                                what is previewed. */}
                            <Flex direction="column" align="center" gap="4">
                                {pageBodies.map((body, i) => (
                                    <Box
                                        key={i}
                                        position="relative"
                                        width={`${PREVIEW_W}px`}
                                        maxW="100%"
                                        height={`${page.h * scale}px`}
                                        overflow="hidden"
                                        borderWidth="1px"
                                        borderColor="border"
                                        rounded="lg"
                                        shadow="sm"
                                        css={{ background: C.surface }}
                                    >
                                        <Box
                                            position="absolute"
                                            top="0"
                                            left="0"
                                            style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}
                                        >
                                            <PosterPage
                                                meta={meta}
                                                qrDataUrl={qrDataUrl}
                                                nodeRef={(el) => {
                                                    pageRefs.current[i] = el
                                                }}
                                                orientation={orientation}
                                                pageIndex={i}
                                                pageCount={pageCount}
                                                headerExtra={(() => {
                                                    if (kind === "match" && match) {
                                                        return <MatchHeaderExtra match={match} />
                                                    }
                                                    if (kind === "bracket") {
                                                        const podium = bracketPodium(bracket)
                                                        return podium ? <PodiumStrip {...podium} /> : undefined
                                                    }
                                                    return undefined
                                                })()}
                                            >
                                                {body}
                                            </PosterPage>
                                        </Box>
                                    </Box>
                                ))}
                            </Flex>
                        </Dialog.Body>
                        <Dialog.Footer gap="3">
                            <Button
                                colorPalette="brand"
                                variant="solid"
                                loading={busy === "pdf"}
                                loadingText="Izrada…"
                                disabled={!!busy || qrLoading || (kind === "match" && matchEventsLoading)}
                                onClick={() => handleDownload("pdf")}
                            >
                                <FiDownload /> Preuzmi PDF
                            </Button>
                            <Button
                                colorPalette="brand"
                                variant="outline"
                                loading={busy === "jpg"}
                                loadingText="Izrada…"
                                disabled={!!busy || qrLoading || (kind === "match" && matchEventsLoading)}
                                onClick={() => handleDownload("jpg")}
                            >
                                <FiDownload /> Preuzmi JPG
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
