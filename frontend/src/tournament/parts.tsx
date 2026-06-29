import React from "react"
import { Badge, Box, Button, HStack, Input, Text, chakra, Field } from "@chakra-ui/react"
import { FiCheck, FiShare2 } from "react-icons/fi"

import type {
    TournamentDetails,
    CreateTournamentPayload,
    TournamentFormat,
} from "../types/tournaments"
import type { RoundDto, MatchDto } from "../types/round"

/* ──────────────────────────────────────────────────────────────────────────
   Tournament detail — shared bits.

   Small, tournament-specific helpers, types and components used across the
   redesigned Detalji / Ekipe / Ždrijeb sections and the shell.
   ────────────────────────────────────────────────────────────────────── */

/* ---------- Local UI types ---------- */
export type MatchLocal = MatchDto & {
    _score1?: string
    _score2?: string
    _dirty?: boolean
    _editing?: boolean // supports per-match "Uredi" mode
}

export type RoundLocal = Omit<RoundDto, "matches"> & {
    matches: MatchLocal[]
}

/** Section keys for the top-level section navigation. */
export type SectionKey =
    | "details"
    | "live"
    | "teams"
    | "bracket"
    | "raspored"
    | "stats"

/* ---------- Small formatting helpers ---------- */
export function formatDate(iso?: string | null) {
    if (!iso) return "—"
    const d = new Date(iso)
    return new Intl.DateTimeFormat("hr-HR", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(d)
}

export function formatTime(iso?: string | null) {
    if (!iso) return "—"
    const d = new Date(iso)
    return new Intl.DateTimeFormat("hr-HR", { hour: "2-digit", minute: "2-digit" }).format(d)
}

export function fmtMoney(n?: number | null) {
    if (typeof n !== "number" || !isFinite(n)) return "—"
    const s = n.toFixed(2)
    return (s.endsWith(".00") ? s.slice(0, -3) : s) + "€"
}

/* ---------- Status pill ---------- */
type StatusKind = "DRAFT" | "STARTED" | "FINISHED"

/**
 * Status pill for the tournament header. Maps the tournament status to a
 * coloured badge with a human label. DRAFT = neutral "Nacrt", STARTED =
 * brand-green "U tijeku", FINISHED = yellow "Završeno".
 */
export function StatusPill({ status }: { status?: string | null }) {
    const kind: StatusKind = status === "STARTED" || status === "IN_PROGRESS"
        ? "STARTED"
        : status === "FINISHED"
            ? "FINISHED"
            : "DRAFT"
    const cfg: Record<StatusKind, { label: string; palette: string }> = {
        DRAFT: { label: "Nacrt", palette: "gray" },
        STARTED: { label: "U tijeku", palette: "brand" },
        FINISHED: { label: "Završeno", palette: "yellow" },
    }
    const { label, palette } = cfg[kind]
    return (
        <Badge variant="solid" colorPalette={palette} size="md" rounded="full" px="3">
            {label}
        </Badge>
    )
}

/* ---------- Live badge ---------- */
/**
 * SofaScore-style pulsating "UŽIVO" badge. A small red pill with a gentle
 * CSS pulse animation — used on tournament cards and the tournament page
 * header whenever a tournament has a match in progress. The keyframes are
 * injected once on first render via a module-level <style> tag so the
 * animation works regardless of Chakra's theme setup.
 */
let liveBadgeKeyframesInjected = false
function ensureLiveBadgeKeyframes() {
    if (liveBadgeKeyframesInjected) return
    if (typeof document === "undefined") return
    liveBadgeKeyframesInjected = true
    const style = document.createElement("style")
    style.setAttribute("data-live-badge", "true")
    style.textContent = `
@keyframes ntLiveDotPulse {
  0%   { transform: scale(0.85); opacity: 1; }
  70%  { transform: scale(1.6); opacity: 0; }
  100% { transform: scale(1.6); opacity: 0; }
}
@keyframes ntLivePillPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(229, 62, 62, 0.45); }
  50%      { box-shadow: 0 0 0 5px rgba(229, 62, 62, 0); }
}`
    document.head.appendChild(style)
}

export function LiveBadge({
    size = "sm",
}: {
    size?: "xs" | "sm"
}) {
    ensureLiveBadgeKeyframes()
    const small = size === "xs"
    return (
        <HStack
            as="span"
            gap={small ? "1" : "1.5"}
            bg="#E53E3E"
            color="white"
            px={small ? "1.5" : "2"}
            py={small ? "0.5" : "1"}
            rounded="full"
            fontSize={small ? "2xs" : "xs"}
            fontWeight="bold"
            letterSpacing="wide"
            lineHeight="1"
            flexShrink={0}
            css={{ animation: "ntLivePillPulse 2s ease-in-out infinite" }}
        >
            <Box
                as="span"
                position="relative"
                w={small ? "1.5" : "2"}
                h={small ? "1.5" : "2"}
                flexShrink={0}
            >
                <Box
                    as="span"
                    position="absolute"
                    inset="0"
                    rounded="full"
                    bg="white"
                    css={{ animation: "ntLiveDotPulse 1.6s ease-out infinite" }}
                />
                <Box
                    as="span"
                    position="absolute"
                    inset="0"
                    rounded="full"
                    bg="white"
                />
            </Box>
            <chakra.span as="span">UŽIVO</chakra.span>
        </HStack>
    )
}

/* ---------- Team avatar ---------- */
/** Avatar with initials, used in team cards and dialogs. */
export function TeamAvatar({ name, eliminated }: { name: string; eliminated?: boolean }) {
    const initials =
        (name || "?")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((s) => s[0]?.toUpperCase())
            .join("") || "?"
    return (
        <Box
            w="34px"
            h="34px"
            rounded="full"
            bg={eliminated ? "gray.muted" : "brand.subtle"}
            color={eliminated ? "fg.muted" : "brand.fg"}
            display="flex"
            alignItems="center"
            justifyContent="center"
            fontWeight="semibold"
            fontSize="xs"
            flexShrink={0}
        >
            {initials}
        </Box>
    )
}

/* ---------- Share button ---------- */
/**
 * Share button — uses the native Web Share sheet (mobile gets the OS's
 * full app picker). On desktop browsers without `navigator.share`, falls
 * back to copying the link to clipboard and briefly showing "Kopirano!".
 */
export function ShareButton({
    url,
    title,
    size = "sm",
}: {
    url: string
    title: string
    size?: "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl"
}) {
    const [copied, setCopied] = React.useState(false)

    async function onShare() {
        if (typeof navigator !== "undefined" && (navigator as any).share) {
            try {
                await (navigator as any).share({ title, url })
            } catch {
                /* user cancelled — no-op */
            }
            return
        }
        try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        } catch {
            window.prompt("Kopiraj link:", url)
        }
    }

    return (
        <Button size={size} variant="outline" onClick={onShare}>
            {copied ? <FiCheck /> : <FiShare2 />}
            {copied ? "Kopirano!" : "Podijeli"}
        </Button>
    )
}

/* ---------- DetailTile (read-mode info tile) ---------- */
/**
 * Compact bordered "tile" for a single piece of tournament info — tiny
 * uppercase muted label on top, prominent value below. Designed to fit
 * several per row in a responsive grid.
 */
export function DetailTile({
    icon,
    label,
    value,
    span,
}: {
    icon?: React.ReactNode
    label: string
    value: React.ReactNode
    /** Responsive grid column span (e.g. {{ md: "span 2", lg: "span 3" }}). */
    span?: any
}) {
    return (
        <Box
            borderWidth="1px"
            borderColor="border"
            rounded="xl"
            px="4"
            py="3"
            bg="bg.panel"
            gridColumn={span}
            minW="0"
        >
            <HStack mb="1.5" gap="1.5">
                {icon && (
                    <Box color="fg.muted" display="flex" alignItems="center">
                        {icon}
                    </Box>
                )}
                <Text
                    fontSize="2xs"
                    fontWeight="semibold"
                    color="fg.muted"
                    letterSpacing="wider"
                    textTransform="uppercase"
                >
                    {label}
                </Text>
            </HStack>
            <Box fontSize="md" fontWeight="medium">
                {value}
            </Box>
        </Box>
    )
}

/* ---------- SuffixInput (edit-form helper) ---------- */
/** Input with a fixed unit suffix shown inside the input on the right. */
export function SuffixInput({
    value,
    onChange,
    placeholder,
    suffix,
    inputMode = "decimal",
    disabled,
}: {
    value: string
    onChange: (v: string) => void
    placeholder?: string
    suffix: string
    inputMode?: "decimal" | "numeric" | "text"
    disabled?: boolean
}) {
    return (
        <Box position="relative" w="full">
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                inputMode={inputMode}
                pr="9"
                disabled={disabled}
            />
            <Box
                position="absolute"
                right="3"
                top="50%"
                style={{ transform: "translateY(-50%)" }}
                color="fg.muted"
                fontSize="sm"
                pointerEvents="none"
            >
                {suffix}
            </Box>
        </Box>
    )
}

/**
 * Two-line "€/ekipa → €/igrač" helper shown under price inputs on the
 * edit form. Renders nothing if the input doesn't parse to a finite number.
 */
export function EditPerTeamHint({ value }: { value: string }) {
    const n = (() => {
        const cleaned = (value ?? "").replace(/[ €]/g, "").replace(",", ".")
        const x = parseFloat(cleaned)
        return Number.isFinite(x) ? x : NaN
    })()
    if (!Number.isFinite(n)) return null
    const fmt = (x: number) => {
        const f = x.toFixed(2)
        return f.endsWith(".00") ? f.slice(0, -3) : f
    }
    return (
        <Field.HelperText>
            {fmt(n)}€<chakra.span color="fg.muted">/ekipa</chakra.span>{" "}
            • {fmt(n / 2)}€<chakra.span color="fg.muted">/igrač</chakra.span>
        </Field.HelperText>
    )
}

/* ---------- Phone helpers (mirror CreateTournamentPage) ---------- */
/** Calling-code options for the phone country selector. */
export const PHONE_COUNTRIES: Array<{ value: string; label: string }> = [
    { value: "+385", label: "🇭🇷 +385" },
    { value: "+386", label: "🇸🇮 +386" },
    { value: "+43", label: "🇦🇹 +43" },
    { value: "+49", label: "🇩🇪 +49" },
    { value: "+387", label: "🇧🇦 +387" },
    { value: "+381", label: "🇷🇸 +381" },
]

/** Strip everything except digits + spaces from a phone string. */
export function sanitizePhone(raw: string): string {
    return raw.replace(/[^\d\s]/g, "")
}

/**
 * Split a stored "{country} {rest}" phone into country + rest. If the
 * stored value doesn't start with a known code we leave the rest verbatim
 * and default the country to +385.
 */
export function parsePhone(stored: string | null | undefined): { country: string; rest: string } {
    const s = (stored ?? "").trim()
    if (!s) return { country: "+385", rest: "" }
    for (const c of PHONE_COUNTRIES) {
        if (s.startsWith(c.value)) {
            return { country: c.value, rest: s.slice(c.value.length).trim() }
        }
    }
    return { country: "+385", rest: s }
}

/* ---------- Edit-form helpers ---------- */
const pad2 = (n: number) => String(n).padStart(2, "0")

export function isoToDate(iso?: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
export function isoToTime(iso?: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
export function toLocalOffsetIso(dateStr: string, timeStr: string): string | null {
    if (!dateStr || !timeStr) return null
    const [y, m, d] = dateStr.split("-").map(Number)
    const [hh, mm] = timeStr.split(":").map(Number)
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0)
    const tz = -dt.getTimezoneOffset()
    const sign = tz >= 0 ? "+" : "-"
    const hhOff = String(Math.floor(Math.abs(tz) / 60)).padStart(2, "0")
    const mmOff = String(Math.abs(tz) % 60).padStart(2, "0")
    return (
        `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}` +
        `T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}:00${sign}${hhOff}:${mmOff}`
    )
}
export function sanitizeMoney(raw: string): string {
    let s = raw.replace(/-/g, "").replace(/[^\d.,]/g, "").replace(",", ".")
    if (s.startsWith(".")) s = "0" + s
    const parts = s.split(".")
    if (parts.length > 2) s = parts[0] + "." + parts.slice(1).join("")
    return s
}
export function sanitizeInt(raw: string): string {
    return raw.replace(/[^\d]/g, "")
}
function moneyToNumber(s?: string): number | null {
    if (!s) return null
    const n = parseFloat(s.replace(",", "."))
    return Number.isFinite(n) ? n : null
}
function numberToMoneyStr(n?: number | null): string {
    if (typeof n !== "number" || !isFinite(n)) return ""
    const s = n.toFixed(2)
    return s.endsWith(".00") ? s.slice(0, -3) : s
}

export type EditForm = {
    name: string
    location: string
    details: string
    startDate: string
    startTime: string
    maxTeams: string
    entryPrice: string
    contactName: string
    contactPhoneCountry: string
    contactPhone: string
    gameSystem: string
    websiteUrl: string
    // Format (editable while no fixtures exist yet). Group count / advancement
    // are chosen at draw time, not here.
    format: TournamentFormat
    // Percent/fixed toggle removed — always FIXED. Each place: amount + note.
    rewardType: "FIXED" | "PERCENTAGE"
    rewardFirst: string
    rewardFirstNote: string
    rewardSecond: string
    rewardSecondNote: string
    rewardThird: string
    rewardThirdNote: string
    rewardFourth: string
    rewardFourthNote: string
}

export function buildEditForm(t: TournamentDetails): EditForm {
    const phone = parsePhone(t.contactPhone)
    return {
        name: t.name ?? "",
        location: t.location ?? "",
        details: t.details ?? "",
        startDate: isoToDate(t.startAt),
        startTime: isoToTime(t.startAt),
        maxTeams: typeof t.maxTeams === "number" ? String(t.maxTeams) : "",
        entryPrice: numberToMoneyStr(t.entryPrice),
        contactName: t.contactName ?? "",
        contactPhoneCountry: phone.country,
        contactPhone: phone.rest,
        gameSystem: t.gameSystem ?? "",
        websiteUrl: t.websiteUrl ?? "",
        format: t.format ?? "GROUPS_KNOCKOUT",
        rewardType: "FIXED",
        rewardFirst: numberToMoneyStr(t.rewardFirst),
        rewardFirstNote: t.rewardFirstNote ?? "",
        rewardSecond: numberToMoneyStr(t.rewardSecond),
        rewardSecondNote: t.rewardSecondNote ?? "",
        rewardThird: numberToMoneyStr(t.rewardThird),
        rewardThirdNote: t.rewardThirdNote ?? "",
        rewardFourth: numberToMoneyStr(t.rewardFourth),
        rewardFourthNote: t.rewardFourthNote ?? "",
    }
}

export function editFormToPayload(f: EditForm): CreateTournamentPayload {
    const maxTeams = parseInt(f.maxTeams || "0", 10)
    // Empty field means "no cap" — pass null through. Backend treats null
    // as an open-entry tournament; the UI hides the X/Y counter in that case.
    const maxTeamsSafe: number | null =
        Number.isFinite(maxTeams) && maxTeams >= 2 ? maxTeams : null
    const entry = moneyToNumber(f.entryPrice) ?? 0

    return {
        name: f.name.trim(),
        location: f.location.trim() || null,
        details: f.details.trim() || null,
        startAt: toLocalOffsetIso(f.startDate, f.startTime),
        maxTeams: maxTeamsSafe,
        format: f.format,
        // Group count / advance / bracket fill are draw-time config; the
        // backend ignores these on update, so null here is a no-op.
        groupCount: null,
        advancePerGroup: null,
        bracketFill: null,
        entryPrice: entry,
        contactName: f.contactName.trim() || null,
        contactPhone: f.contactPhone.trim()
            ? `${f.contactPhoneCountry} ${f.contactPhone.trim()}`
            : null,
        gameSystem: f.gameSystem.trim() || null,
        websiteUrl: f.websiteUrl.trim() || null,
        rewardType: "FIXED",
        rewardFirst: moneyToNumber(f.rewardFirst),
        rewardFirstNote: f.rewardFirstNote.trim() || null,
        rewardSecond: moneyToNumber(f.rewardSecond),
        rewardSecondNote: f.rewardSecondNote.trim() || null,
        rewardThird: moneyToNumber(f.rewardThird),
        rewardThirdNote: f.rewardThirdNote.trim() || null,
        rewardFourth: moneyToNumber(f.rewardFourth),
        rewardFourthNote: f.rewardFourthNote.trim() || null,
    } as CreateTournamentPayload
}
