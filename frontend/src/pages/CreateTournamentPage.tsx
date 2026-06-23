import React, { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
    Box,
    Button,
    Card,
    chakra,
    Field,
    Flex,
    HStack,
    IconButton,
    Input,
    NativeSelect,
    RadioGroup,
    Text,
    Textarea,
    VStack,
} from "@chakra-ui/react"
import {
    FiGift,
    FiGrid,
    FiImage,
    FiInfo,
    FiPhone,
    FiX,
} from "react-icons/fi"
import DatePicker, { registerLocale } from "react-datepicker"
import { hr } from "date-fns/locale"
import "react-datepicker/dist/react-datepicker.css"
import "../datepicker.css"

import { createTournament } from "../api/createTournament"
import { LocationAutocomplete } from "../components/LocationAutocomplete"
import LocationMapPicker from "../components/LocationMapPicker"
import { getProfile } from "../api/userMe"
import { useAuth } from "../auth/AuthContext"
import { showError } from "../toaster"
import type { BracketFill, CreateTournamentPayload, RewardType, TournamentFormat } from "../types/tournaments"

// Register the Croatian locale once for the calendar UI (month/day names,
// week-starts-Monday, etc.). The format itself is forced via the dateFormat
// prop on each DatePicker so it never falls back to the OS region.
registerLocale("hr", hr)

// ---------- UI-only types ----------
type RewardsMode = "fixed" | "percentage"

type FormState = {
    name: string
    location: string
    details: string
    posterUrl?: string
    startDate: string
    startTime: string
    entryPrice: string
    maxTeams: string
    format: TournamentFormat
    groupCount: string
    advancePerGroup: string
    bracketFill: BracketFill
    rewardsMode: RewardsMode
    fixed: { first: string; second: string; third: string }
    percent: { first: string; second: string; third: string }
    contactName: string
    contactPhoneCountry: string
    contactPhone: string
    selectedOptions: string[]
}

/** Calling-code options for the phone country selector. */
const PHONE_COUNTRIES: Array<{ value: string; label: string }> = [
    { value: "+385", label: "🇭🇷 +385" },
    { value: "+386", label: "🇸🇮 +386" },
    { value: "+43",  label: "🇦🇹 +43" },
    { value: "+49",  label: "🇩🇪 +49" },
    { value: "+387", label: "🇧🇦 +387" },
    { value: "+381", label: "🇷🇸 +381" },
]

// ---------- helpers ----------
const pad = (n: number) => String(n).padStart(2, "0")
const defaultDate = () => {
    const d = new Date()
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const defaultTime = () => {
    const d = new Date()
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const toNumber = (v: string) => {
    const cleaned = v.replace(/[ €]/g, "").replace(",", ".")
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : NaN
}
const formatMoney = (n: number) => {
    if (!Number.isFinite(n)) return ""
    const f = n.toFixed(2)
    return f.endsWith(".00") ? f.slice(0, -3) : f
}
const sanitizeMoneyInput = (raw: string) => {
    let s = raw.replace(/-/g, "").replace(/[^\d.,]/g, "").replace(",", ".")
    if (s.startsWith(".")) s = "0" + s
    const parts = s.split(".")
    if (parts.length > 2) s = parts[0] + "." + parts.slice(1).join("")
    return s
}
const sanitizeInt = (raw: string) => raw.replace(/[^\d]/g, "")
/**
 * Strip everything except digits + spaces from a phone string. We keep spaces
 * so users can type "91 234 5678" for readability; the country code is held in
 * a separate select, so a leading "+" or country digits aren't expected here.
 */
const sanitizePhone = (raw: string) => raw.replace(/[^\d\s]/g, "")

// local date+time → OffsetDateTime string (e.g. 2025-11-02T19:00:00+01:00)
function toLocalOffsetIso(dateStr: string, timeStr: string): string | null {
    if (!dateStr || !timeStr) return null
    const [y, m, d] = dateStr.split("-").map(Number)
    const [hh, mm] = timeStr.split(":").map(Number)
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0)
    const tz = -dt.getTimezoneOffset()
    const sign = tz >= 0 ? "+" : "-"
    const hhOff = String(Math.floor(Math.abs(tz) / 60)).padStart(2, "0")
    const mmOff = String(Math.abs(tz) % 60).padStart(2, "0")
    return (
        `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` +
        `T${pad(dt.getHours())}:${pad(dt.getMinutes())}:00${sign}${hhOff}:${mmOff}`
    )
}

// map UI enums → backend enums
const mapRewardType = (v: RewardsMode): RewardType =>
    v === "fixed" ? "FIXED" : "PERCENTAGE"

// money "30" / "30.50" → number | null
const toMoney = (s?: string) => {
    if (!s) return null
    const n = parseFloat(s.replace(",", "."))
    return Number.isFinite(n) ? n : null
}

// ---------- small UI primitives ----------

/** A bordered, titled section card. Tight body padding for dense forms. */
function SectionCard({
                         icon,
                         title,
                         description,
                         children,
                     }: {
    icon?: React.ReactNode
    title: string
    description?: string
    children: React.ReactNode
}) {
    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Header pb="2" pt="4" px={{ base: "4", md: "5" }}>
                <HStack gap="2.5" align="center">
                    {icon && (
                        <Box color="blue.500" display="flex" alignItems="center">
                            {icon}
                        </Box>
                    )}
                    <Card.Title fontSize="md">{title}</Card.Title>
                </HStack>
                {description && (
                    <Card.Description fontSize="sm" color="fg.muted" mt="1">
                        {description}
                    </Card.Description>
                )}
            </Card.Header>
            <Card.Body pt="3" pb="4" px={{ base: "4", md: "5" }}>
                {children}
            </Card.Body>
        </Card.Root>
    )
}

/** Input with a fixed-width currency / unit suffix, looks like one field. */
function SuffixInput({
                         value,
                         onChange,
                         placeholder,
                         suffix,
                         inputMode = "decimal",
                     }: {
    value: string
    onChange: (v: string) => void
    placeholder?: string
    suffix: string
    inputMode?: "decimal" | "numeric" | "text"
}) {
    return (
        <HStack gap="0" position="relative" w="full">
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                inputMode={inputMode}
                pr="9"
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
        </HStack>
    )
}

/** Inline placeholder used in the step-4 Pregled card when a value is
 *  missing. Visual: same colour as helper text, italic for "absence". */
function Muted({ children }: { children: React.ReactNode }) {
    return (
        <chakra.span color="fg.muted" fontStyle="italic" fontWeight={400}>
            {children}
        </chakra.span>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   FormatSketch — a lightweight SVG diagram of how the chosen competition
   format flows, shown on the Format step so the organiser gets an at-a-
   glance picture before filling in group/bracket numbers.

   · GROUPS_KNOCKOUT: two group boxes feeding an arrow into a small bracket.
   · KNOCKOUT_ONLY:   a single elimination bracket, no groups.
   ────────────────────────────────────────────────────────────────────── */
function FormatSketch({ format }: { format: TournamentFormat }) {
    const stroke = "var(--chakra-colors-pitch-500)"
    const faint = "var(--chakra-colors-border-emphasized)"
    const ink = "var(--chakra-colors-fg-muted)"

    return (
        <Box
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            p="4"
        >
            <Text
                fontFamily="mono"
                fontSize="10px"
                fontWeight={800}
                letterSpacing="0.15em"
                color="fg.muted"
                mb="3"
            >
                {format === "GROUPS_KNOCKOUT"
                    ? "SKICA · GRUPE → ELIMINACIJA"
                    : "SKICA · ELIMINACIJA"}
            </Text>

            {format === "GROUPS_KNOCKOUT" ? (
                <chakra.svg
                    viewBox="0 0 360 130"
                    width="100%"
                    height="auto"
                    maxW="420px"
                    css={{ display: "block" }}
                >
                    {/* Group A */}
                    <rect x="2" y="6" width="92" height="50" rx="8" fill="none" stroke={faint} strokeWidth="1.5" />
                    <text x="10" y="20" fontSize="9" fontWeight="700" fill={ink}>GRUPA A</text>
                    <line x1="10" y1="30" x2="86" y2="30" stroke={faint} strokeWidth="1" />
                    <line x1="10" y1="40" x2="86" y2="40" stroke={faint} strokeWidth="1" />
                    <line x1="10" y1="50" x2="86" y2="50" stroke={faint} strokeWidth="1" />
                    {/* Group B */}
                    <rect x="2" y="72" width="92" height="50" rx="8" fill="none" stroke={faint} strokeWidth="1.5" />
                    <text x="10" y="86" fontSize="9" fontWeight="700" fill={ink}>GRUPA B</text>
                    <line x1="10" y1="96" x2="86" y2="96" stroke={faint} strokeWidth="1" />
                    <line x1="10" y1="106" x2="86" y2="106" stroke={faint} strokeWidth="1" />
                    <line x1="10" y1="116" x2="86" y2="116" stroke={faint} strokeWidth="1" />

                    {/* Arrow → */}
                    <line x1="100" y1="64" x2="132" y2="64" stroke={stroke} strokeWidth="2" />
                    <path d="M132 64 l-7 -4 v8 z" fill={stroke} />
                    <text x="100" y="56" fontSize="8" fontWeight="700" fill={stroke}>prolaze</text>

                    {/* Bracket — semis → final */}
                    {/* SF1 */}
                    <rect x="146" y="20" width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    {/* SF2 */}
                    <rect x="146" y="86" width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    {/* connectors to final */}
                    <path d="M220 28 H240 V61 H260" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M220 94 H240 V67 H260" fill="none" stroke={stroke} strokeWidth="1.5" />
                    {/* Final */}
                    <rect x="260" y="54" width="84" height="20" rx="5" fill="none" stroke={stroke} strokeWidth="2" />
                    <text x="302" y="68" fontSize="9" fontWeight="800" fill={stroke} textAnchor="middle">FINALE</text>
                </chakra.svg>
            ) : (
                <chakra.svg
                    viewBox="0 0 360 130"
                    width="100%"
                    height="auto"
                    maxW="420px"
                    css={{ display: "block" }}
                >
                    {/* Quarterfinals (4) */}
                    {[10, 38, 80, 108].map((y, i) => (
                        <rect key={i} x="2" y={y} width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    ))}
                    {/* QF → SF connectors */}
                    <path d="M76 18 H92 V40 H110" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M76 46 H92 V40" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M76 88 H92 V110 H110" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M76 116 H92 V110" fill="none" stroke={stroke} strokeWidth="1.5" />
                    {/* Semifinals (2) */}
                    <rect x="110" y="32" width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    <rect x="110" y="102" width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    {/* SF → final connectors */}
                    <path d="M184 40 H206 V65 H228" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M184 110 H206 V73 H228" fill="none" stroke={stroke} strokeWidth="1.5" />
                    {/* Final */}
                    <rect x="228" y="55" width="92" height="22" rx="5" fill="none" stroke={stroke} strokeWidth="2" />
                    <text x="274" y="70" fontSize="9" fontWeight="800" fill={stroke} textAnchor="middle">FINALE</text>
                </chakra.svg>
            )}

            <Text fontSize="xs" color="fg.muted" mt="3">
                {format === "GROUPS_KNOCKOUT"
                    ? "Ekipe se prvo bore u grupama; najbolji iz svake grupe prolaze u eliminacijsku ljestvicu do finala."
                    : "Sve ekipe idu izravno u eliminacijsku ljestvicu — poraz znači ispadanje, sve do finala."}
            </Text>
        </Box>
    )
}

// ---------- page ----------
export default function CreateTournamentPage() {
    const navigate = useNavigate()

    const [form, setForm] = useState<FormState>({
        name: "",
        location: "",
        details: "",
        posterUrl: "",
        startDate: defaultDate(),
        startTime: defaultTime(),
        entryPrice: "30",
        maxTeams: "",
        format: "GROUPS_KNOCKOUT",
        groupCount: "4",
        advancePerGroup: "2",
        bracketFill: "BYES",
        rewardsMode: "fixed",
        fixed: { first: "", second: "", third: "" },
        percent: { first: "", second: "", third: "" },
        contactName: "",
        contactPhoneCountry: "+385",
        contactPhone: "",
        selectedOptions: [],
    })

    // Latitude/longitude tracked separately from `form` because they
    // exist purely to drive the map picker's marker — they're not sent
    // to the backend (the server forward-geocodes form.location on
    // create, and the picker fills that string with a Nominatim
    // display_name so the result lines up). Set from either picking a
    // suggestion in LocationAutocomplete or clicking the map in
    // LocationMapPicker.
    const [pickedCoords, setPickedCoords] = useState<{ lat: number; lng: number } | null>(null)

    // Prefill contact fields ("Kontakt organizatora") from the logged-in
    // user's Firebase displayName + saved phone. Most organisers run
    // multiple tournaments and were typing the same name + phone every
    // time. We only write to a field if it's still empty, so anything
    // the user has already started editing is preserved if the profile
    // fetch resolves after they touched the field. The fetch is
    // tagged `silent` because a failure here is a soft degrade — the
    // form is still fully usable, the user just types manually.
    const { user } = useAuth()
    useEffect(() => {
        if (!user?.uid) return
        let cancelled = false
        ;(async () => {
            try {
                const profile = await getProfile()
                if (cancelled) return
                setForm((prev) => {
                    // Build the patch only for fields the user hasn't
                    // touched yet — never overwrite their input.
                    const patch: Partial<FormState> = {}
                    const fallbackName =
                        (profile.displayName?.trim() || user.displayName?.trim()) ?? ""
                    if (!prev.contactName && fallbackName) patch.contactName = fallbackName
                    if (!prev.contactPhone && profile.phone) patch.contactPhone = profile.phone
                    // phoneCountry has a non-empty default ("+385"); only
                    // overwrite if the profile carries one, since the
                    // saved country code is the authoritative choice.
                    if (profile.phoneCountry) patch.contactPhoneCountry = profile.phoneCountry
                    if (Object.keys(patch).length === 0) return prev
                    return { ...prev, ...patch }
                })
            } catch {
                /* Anonymous, network glitch, or no profile yet — fine
                   to leave the contact block blank and let the user
                   fill it in by hand. */
            }
        })()
        return () => { cancelled = true }
    }, [user?.uid])

    // Suggested number of groups — aim for groups of ~4 teams. The organiser
    // can override the "Broj grupa" field; this just powers the "Primijeni"
    // hint shown beneath it.
    const suggestedGroups = useMemo(() => {
        const n = parseInt(form.maxTeams || "0", 10)
        if (!Number.isFinite(n) || n < 4) return 2
        return Math.max(2, Math.ceil(n / 4))
    }, [form.maxTeams])

    // Human-readable preview of the chosen group/knockout structure.
    const formatPreview = useMemo(() => {
        if (form.format === "KNOCKOUT_ONLY") return null
        const teams = parseInt(form.maxTeams || "0", 10) || 0
        const groups = parseInt(form.groupCount || "0", 10) || 0
        const adv = parseInt(form.advancePerGroup || "0", 10) || 0
        if (groups < 2 || adv < 1) return null
        const qualifiers = groups * adv
        let sizes = ""
        if (teams >= groups) {
            const per = Math.floor(teams / groups)
            const rem = teams % groups
            sizes =
                rem === 0
                    ? ` (po ${per})`
                    : ` (${rem}×${per + 1} + ${groups - rem}×${per})`
        }
        return `${teams || "?"} ekipa → ${groups} grupa${sizes}, prolazi ${adv} `
            + `iz svake → ${qualifiers} ekipa u eliminaciji`
    }, [form.format, form.maxTeams, form.groupCount, form.advancePerGroup])

    // required-field summary for the sticky bar
    const missingRequired = useMemo(() => {
        const missing: string[] = []
        if (!form.name.trim()) missing.push("Ime")
        if (!form.location.trim()) missing.push("Lokacija")
        if (!form.startDate) missing.push("Datum")
        if (!form.startTime) missing.push("Vrijeme")
        const r = form.rewardsMode === "fixed" ? form.fixed : form.percent
        if (!r.first.trim() || !r.second.trim() || !r.third.trim()) missing.push("Nagrade")
        return missing
    }, [
        form.name,
        form.location,
        form.startDate,
        form.startTime,
        form.rewardsMode,
        form.fixed,
        form.percent,
    ])

    /**
     * True iff the user has picked a start moment in the past. Same idea as
     * the {@code min} attribute on the input, but re-evaluated on every
     * render so a slow form-fill can't slip behind "now". Used by submit to
     * block creation outright.
     */
    const startInPast = useMemo(() => {
        if (!form.startDate || !form.startTime) return false
        const iso = toLocalOffsetIso(form.startDate, form.startTime)
        if (!iso) return false
        return new Date(iso).getTime() < Date.now()
    }, [form.startDate, form.startTime])

    const onChange = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm((f) => ({ ...f, [key]: value }))
    const onNested =
        <P extends "fixed" | "percent", K extends keyof FormState[P]>(part: P, key: K, value: string) =>
            setForm((f) => ({ ...f, [part]: { ...f[part], [key]: value } }))

    const handleMoneyChange = (key: "entryPrice", value: string) =>
        onChange(key, sanitizeMoneyInput(value) as any)

    const handleMaxTeamsChange = (value: string) => onChange("maxTeams", sanitizeInt(value))

    const [posterFile, setPosterFile] = useState<File | null>(null)
    const [posterPreviewUrl, setPosterPreviewUrl] = useState<string | null>(null)

    // poster validations
    const MAX_MB = 5
    const ACCEPT = ["image/jpeg", "image/png", "image/webp"]
    const [uploadErr, setUploadErr] = useState<string | null>(null)

    async function handlePosterSelect(file: File) {
        setUploadErr(null)

        if (!ACCEPT.includes(file.type)) {
            setUploadErr("Dozvoljeno: JPG, PNG ili WEBP.")
            return
        }
        if (file.size > MAX_MB * 1024 * 1024) {
            setUploadErr(`Maksimalna veličina je ${MAX_MB} MB.`)
            return
        }

        if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl)

        setPosterFile(file)
        setPosterPreviewUrl(URL.createObjectURL(file))
        onChange("posterUrl", "")
    }

    function clearPoster() {
        if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl)
        setPosterFile(null)
        setPosterPreviewUrl(null)
        onChange("posterUrl", "")
    }

    const [submitting, setSubmitting] = useState(false)

    /* ── v3 Wizard step state ──
       Replaces the previous single-scroll layout. SectionCards are
       gated on `step` so only the active step's fields render. Step 4
       is a read-only Pregled (summary) + submit. Submit is intentionally
       only available on step 4 — prevents accidental publish from
       earlier steps where validation hasn't been completed yet. */
    const WIZARD_STEPS = ["Osnovno", "Format", "Nagrade", "Pregled"] as const
    type WizardStep = 1 | 2 | 3 | 4
    const [step, setStep] = useState<WizardStep>(1)
    const goNext = () => setStep((s) => (s < 4 ? ((s + 1) as WizardStep) : s))
    const goPrev = () => setStep((s) => (s > 1 ? ((s - 1) as WizardStep) : s))

    const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault()

        // Block past dates outright. The {@code min} attribute on the input
        // already prevents picking earlier than now, but a slow form-fill
        // can drift behind, and clients can bypass the attribute anyway.
        if (startInPast) {
            showError(
                "Neispravan datum",
                "Datum i vrijeme turnira ne mogu biti u prošlosti.",
            )
            return
        }

        // maxTeams is optional — when blank or unparseable, ship null
        // so the backend treats it as "no cap" rather than defaulting to
        // an arbitrary 16-team ceiling.
        const parsedMaxTeams = parseInt(form.maxTeams || "0", 10)
        const maxTeamsSafe: number | null =
            Number.isFinite(parsedMaxTeams) && parsedMaxTeams >= 2 ? parsedMaxTeams : null

        const entrySafe = toMoney(form.entryPrice)

        const payload: CreateTournamentPayload = {
            name: form.name.trim(),
            location: form.location.trim() || null,
            details: form.details.trim() || null,
            startAt: toLocalOffsetIso(form.startDate, form.startTime),

            bannerUrl: form.posterUrl?.trim() || null,

            maxTeams: maxTeamsSafe,

            format: form.format,
            groupCount:
                form.format === "GROUPS_KNOCKOUT"
                    ? (parseInt(form.groupCount || "0", 10) || null)
                    : null,
            advancePerGroup:
                form.format === "GROUPS_KNOCKOUT"
                    ? (parseInt(form.advancePerGroup || "0", 10) || null)
                    : null,
            bracketFill: form.format === "GROUPS_KNOCKOUT" ? form.bracketFill : null,

            entryPrice: Number.isFinite(entrySafe as number) ? (entrySafe as number) : 0,

            contactName: form.contactName.trim() || null,
            contactPhone: form.contactPhone.trim()
                ? `${form.contactPhoneCountry} ${form.contactPhone.trim()}`
                : null,

            rewardType: mapRewardType(form.rewardsMode),
            rewardFirst:
                form.rewardsMode === "fixed"
                    ? toMoney(form.fixed.first)
                    : toMoney(form.percent.first),
            rewardSecond:
                form.rewardsMode === "fixed"
                    ? toMoney(form.fixed.second)
                    : toMoney(form.percent.second),
            rewardThird:
                form.rewardsMode === "fixed"
                    ? toMoney(form.fixed.third)
                    : toMoney(form.percent.third),

            status: "DRAFT",
        } as CreateTournamentPayload

        try {
            setSubmitting(true)
            const created = await createTournament(payload, posterFile)
            navigate(`/turniri/${created.slug ?? created.uuid}`)
        } catch (err: any) {
            console.error(err)
            showError(
                "Greška pri spremanju",
                err?.message ?? "Turnir nije spremljen. Pokušaj ponovno.",
            )
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <chakra.form onSubmit={handleSubmit}>
            {/* Sticky step indicator — stays pinned just under the top nav
                while the form scrolls, like the nav bar itself. The wrapper
                is a full-bleed bg.canvas band (negative margins cancel the
                page Container's horizontal padding) so scrolling content
                never peeks around the panel's rounded corners. `top` sits a
                touch under the nav height so the two overlap with no gap;
                zIndex is below the nav (1000) but above page content. */}
            <Box
                position="sticky"
                top={{ base: "52px", md: "60px" }}
                zIndex={900}
                bg="bg.canvas"
                mx={{ base: "-4", md: "-6" }}
                px={{ base: "4", md: "6" }}
                pt="3"
                pb="1"
                mb={{ base: 2, md: 3 }}
            >
                <Box
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border"
                    rounded="xl"
                    px={{ base: "3", md: "4" }}
                    py="2.5"
                    css={{ boxShadow: "0 4px 16px rgba(14,31,21,0.06)" }}
                >
                    <HStack
                        gap="1"
                        justify={{ base: "center", md: "space-between" }}
                        wrap="wrap"
                    >
                    {WIZARD_STEPS.map((s, i) => {
                        const n = (i + 1) as WizardStep
                        const isActive = n === step
                        const isDone = n < step
                        return (
                            <Box
                                key={s}
                                as="button"
                                onClick={() => setStep(n)}
                                display="flex"
                                alignItems="center"
                                gap="2"
                                px="3"
                                py="1.5"
                                rounded="full"
                                cursor="pointer"
                                bg={
                                    isActive
                                        ? "pitch.500"
                                        : isDone
                                        ? "pitch.50"
                                        : "transparent"
                                }
                                color={
                                    isActive
                                        ? "white"
                                        : isDone
                                        ? "pitch.500"
                                        : "fg.muted"
                                }
                                fontSize="13px"
                                fontWeight={700}
                            >
                                <Box
                                    fontFamily="mono"
                                    fontSize="10px"
                                    bg={
                                        isActive
                                            ? "rgba(255,255,255,0.2)"
                                            : isDone
                                            ? "pitch.500"
                                            : "bg.surfaceTint"
                                    }
                                    color={
                                        isActive
                                            ? "white"
                                            : isDone
                                            ? "white"
                                            : "fg.ink"
                                    }
                                    w="18px"
                                    h="18px"
                                    rounded="full"
                                    display="grid"
                                    css={{ placeItems: "center" }}
                                >
                                    {isDone ? "✓" : n}
                                </Box>
                                <Box display={{ base: "none", sm: "block" }}>{s}</Box>
                            </Box>
                        )
                    })}
                    </HStack>
                </Box>
            </Box>
            <VStack align="stretch" gap="4">
                {/* ===================== Card 1: Basic info + poster ===================== */}
                {step === 1 && (
                <SectionCard
                    icon={<FiInfo />}
                    title="Osnovne informacije"
                >
                    <VStack align="stretch" gap="4">
                        {/* Row 1 — three short fields side-by-side on desktop,
                            stacked on mobile. Order is product-driven: organisers
                            think "what's the tournament called", "when is it",
                            "how many teams" — putting all three in one row keeps
                            that mental flow in a single visual scan. */}
                        <Box
                            display="grid"
                            gridTemplateColumns={{ base: "1fr", md: "2fr 2fr 1fr 1fr" }}
                            gap="4"
                        >
                            <Field.Root required>
                                <Field.Label>
                                    Ime turnira <Field.RequiredIndicator />
                                </Field.Label>
                                <Input
                                    placeholder="npr. Futsal open"
                                    value={form.name}
                                    onChange={(e) => onChange("name", e.target.value)}
                                />
                            </Field.Root>

                            <Field.Root required>
                                <Field.Label>
                                    Datum i vrijeme <Field.RequiredIndicator />
                                </Field.Label>
                                {/* react-datepicker with HR locale + forced
                                    dateFormat. This combo guarantees the visible
                                    format is dd/MM/yyyy and 24h regardless of
                                    OS region (which is what broke the native
                                    datetime-local input). State still stores
                                    ISO date + HH:mm so the backend payload is
                                    unchanged. */}
                                <Box className="futsal-datepicker-wrap" w="full">
                                    <DatePicker
                                        selected={
                                            form.startDate && form.startTime
                                                ? new Date(
                                                      `${form.startDate}T${form.startTime}:00`,
                                                  )
                                                : null
                                        }
                                        onChange={(d) => {
                                            if (!d) {
                                                onChange("startDate", "")
                                                onChange("startTime", "")
                                                return
                                            }
                                            const yyyy = d.getFullYear()
                                            const mm = pad(d.getMonth() + 1)
                                            const dd = pad(d.getDate())
                                            const hh = pad(d.getHours())
                                            const mi = pad(d.getMinutes())
                                            onChange("startDate", `${yyyy}-${mm}-${dd}`)
                                            onChange("startTime", `${hh}:${mi}`)
                                        }}
                                        showTimeSelect
                                        timeIntervals={15}
                                        timeFormat="HH:mm"
                                        timeCaption="Vrijeme"
                                        dateFormat="dd/MM/yyyy HH:mm"
                                        locale="hr"
                                        minDate={new Date()}
                                        placeholderText="DD/MM/GGGG HH:MM"
                                        // Stretch the underlying <input> to fill the
                                        // field width — the library renders a tiny
                                        // input by default.
                                        wrapperClassName="futsal-datepicker-input-wrap"
                                        className="futsal-datepicker-input"
                                        popperPlacement="bottom-start"
                                    />
                                </Box>
                            </Field.Root>
                            <Field.Root>
                                <Field.Label>Maks. ekipa</Field.Label>
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={2}
                                    placeholder="npr. 32 (može ostati prazno)"
                                    value={form.maxTeams}
                                    onChange={(e) => handleMaxTeamsChange(e.target.value)}
                                />
                            </Field.Root>
                            <Field.Root>
                                <Field.Label>Kotizacija</Field.Label>
                                <SuffixInput
                                    value={form.entryPrice}
                                    onChange={(v) => handleMoneyChange("entryPrice", v)}
                                    placeholder="30"
                                    suffix="€"
                                />
                            </Field.Root>
                        </Box>

                        {/* Row 2 — two columns on desktop:
                              · LEFT  : Detalji, then Kontakt (Ime + Telefon)
                              · RIGHT : Lokacija field, then the map below it
                            On mobile everything stacks in a sensible reading
                            order via `order`: Lokacija → Map → Detalji →
                            Kontakt (the right column floats above the left). */}
                        <Box
                            display="grid"
                            gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }}
                            gap="4"
                            alignItems="start"
                        >
                            {/* RIGHT column — Lokacija above the map */}
                            <VStack
                                align="stretch"
                                gap="4"
                                gridColumn={{ md: "2" }}
                                order={{ base: 0, md: 1 }}
                            >
                                <Field.Root required>
                                    <Field.Label>
                                        Lokacija <Field.RequiredIndicator />
                                    </Field.Label>
                                    <LocationAutocomplete
                                        value={form.location}
                                        onChange={(v) => onChange("location", v)}
                                        onPickSuggestion={(s) => {
                                            setPickedCoords({ lat: s.latitude, lng: s.longitude })
                                        }}
                                        placeholder="Unesi lokaciju ili izaberi na karti"
                                    />
                                </Field.Root>
                                <LocationMapPicker
                                    value={pickedCoords}
                                    onPick={(p) => {
                                        onChange("location", p.displayName)
                                        setPickedCoords({ lat: p.lat, lng: p.lng })
                                    }}
                                    height={{ base: "260px", md: "300px" }}
                                    minH={{ base: "260px", md: "300px" }}
                                />
                            </VStack>

                            {/* LEFT column — Detalji, then Kontakt */}
                            <VStack
                                align="stretch"
                                gap="4"
                                gridColumn={{ md: "1" }}
                                gridRow={{ md: "1" }}
                                order={{ base: 1, md: 0 }}
                            >
                                <Field.Root>
                                    <Field.Label>Detalji</Field.Label>
                                    <Textarea
                                        rows={3}
                                        placeholder="Dodatne informacije - pravila, parking, hrana, piće..."
                                        value={form.details}
                                        onChange={(e) => onChange("details", e.target.value)}
                                    />
                                </Field.Root>

                                {/* Kontakt organizatora — Ime + Telefon on
                                    one compact row (label row above) so the
                                    left column stays short and the poster can
                                    sit higher, killing the whitespace next to
                                    the tall map. */}
                                <Box>
                                    <HStack gap="2" mb="1.5" fontSize="sm" fontWeight="medium">
                                        <FiPhone />
                                        <Text>
                                            Kontakt{" "}
                                            <chakra.span color="fg.muted" fontWeight="normal">
                                                (ime i telefon)
                                            </chakra.span>
                                        </Text>
                                    </HStack>
                                    <Box
                                        display="grid"
                                        gridTemplateColumns={{ base: "1fr", sm: "1fr 1fr" }}
                                        gap="2"
                                    >
                                        <Input
                                            placeholder="Ime organizatora"
                                            value={form.contactName}
                                            onChange={(e) => onChange("contactName", e.target.value)}
                                        />
                                        <HStack gap="2">
                                            <NativeSelect.Root size="md" w="100px" flexShrink={0}>
                                                <NativeSelect.Field
                                                    value={form.contactPhoneCountry}
                                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                                        onChange("contactPhoneCountry", e.target.value)
                                                    }
                                                >
                                                    {PHONE_COUNTRIES.map((c) => (
                                                        <option key={c.value} value={c.value}>
                                                            {c.label}
                                                        </option>
                                                    ))}
                                                </NativeSelect.Field>
                                            </NativeSelect.Root>
                                            <Input
                                                flex="1"
                                                inputMode="numeric"
                                                pattern="[0-9 ]*"
                                                placeholder="91 234 5678"
                                                value={form.contactPhone}
                                                onChange={(e) => onChange("contactPhone", sanitizePhone(e.target.value))}
                                            />
                                        </HStack>
                                    </Box>
                                </Box>

                                {/* Poster picker — moved into the left column
                                    (below Kontakt) so it fills the space
                                    beside the tall map instead of leaving a
                                    big gap under the form. */}
                                <Box>
                                    <HStack gap="2" mb="2" fontSize="sm" fontWeight="medium">
                                        <FiImage />
                                        <Text>
                                            Plakat <chakra.span color="fg.muted" fontWeight="normal">(opcionalno)</chakra.span>
                                        </Text>
                                    </HStack>

                                    <HStack
                                        align="center"
                                        gap="3"
                                        wrap="wrap"
                                        justify={{ base: "center", sm: "flex-start" }}
                                    >
                                {(posterPreviewUrl || form.posterUrl) ? (
                                    <Box
                                        position="relative"
                                        borderWidth="1px"
                                        rounded="md"
                                        overflow="hidden"
                                        w="120px"
                                        h="120px"
                                    >
                                        <img
                                            src={posterPreviewUrl || form.posterUrl!}
                                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                        />
                                        <IconButton
                                            type="button"
                                            aria-label="Ukloni plakat"
                                            size="2xs"
                                            variant="solid"
                                            colorPalette="red"
                                            position="absolute"
                                            top="1"
                                            right="1"
                                            onClick={clearPoster}
                                        >
                                            <FiX />
                                        </IconButton>
                                    </Box>
                                ) : (
                                    <Box
                                        w="120px"
                                        h="120px"
                                        borderWidth="1px"
                                        borderStyle="dashed"
                                        borderColor="border.subtle"
                                        rounded="md"
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                        color="fg.muted"
                                    >
                                        <FiImage size={28} />
                                    </Box>
                                )}

                                <VStack
                                    align={{ base: "center", md: "start" }}
                                    gap="1"
                                    flex="1"
                                    minW="200px"
                                >
                                    <Button
                                        as="label"
                                        variant="outline"
                                        colorPalette="pitch"
                                        size="sm"
                                        cursor="pointer"
                                    >
                                        {posterFile ? "Promijeni sliku" : "Odaberi sliku"}
                                        <input
                                            type="file"
                                            accept={ACCEPT.join(",")}
                                            style={{ display: "none" }}
                                            onChange={(e) => {
                                                const f = e.target.files?.[0]
                                                if (f) handlePosterSelect(f)
                                            }}
                                        />
                                    </Button>
                                    {uploadErr ? (
                                        <Text color="red.600" fontSize="xs">{uploadErr}</Text>
                                    ) : (
                                        <Text color="fg.muted" fontSize="xs">
                                            PNG, JPG ili WEBP, do {MAX_MB} MB.
                                        </Text>
                                    )}
                                </VStack>
                                    </HStack>
                                </Box>
                            </VStack>
                        </Box>
                    </VStack>
                </SectionCard>

                )}
                {/* ===================== Card 2: Format ===================== */}
                {step === 2 && (
                <SectionCard
                    icon={<FiGrid />}
                    title="Format natjecanja"
                    description="Odaberi kako je turnir strukturiran."
                >
                    <VStack align="stretch" gap="4">
                        <Field.Root>
                            <Field.Label>Format</Field.Label>
                            <RadioGroup.Root
                                value={form.format}
                                onValueChange={(v) =>
                                    onChange("format", (typeof v === "string" ? v : (v as any)?.value) as TournamentFormat)
                                }
                            >
                                <HStack gap="6" wrap="wrap" rowGap="2">
                                    <RadioGroup.Item value="GROUPS_KNOCKOUT">
                                        <RadioGroup.ItemHiddenInput />
                                        <RadioGroup.ItemIndicator />
                                        <RadioGroup.ItemText>Grupe + eliminacija</RadioGroup.ItemText>
                                    </RadioGroup.Item>
                                    <RadioGroup.Item value="KNOCKOUT_ONLY">
                                        <RadioGroup.ItemHiddenInput />
                                        <RadioGroup.ItemIndicator />
                                        <RadioGroup.ItemText>Samo eliminacija</RadioGroup.ItemText>
                                    </RadioGroup.Item>
                                </HStack>
                            </RadioGroup.Root>
                        </Field.Root>

                        {/* Visual sketch of the chosen format so the
                            organiser sees roughly how the competition flows
                            before filling in the numbers. */}
                        <FormatSketch format={form.format} />

                        {form.format === "GROUPS_KNOCKOUT" && (
                            <>
                                <Box
                                    display="grid"
                                    gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }}
                                    gap="4"
                                >
                                    <Field.Root>
                                        <Field.Label>Broj grupa</Field.Label>
                                        <Input
                                            type="number"
                                            inputMode="numeric"
                                            min={2}
                                            value={form.groupCount}
                                            onChange={(e) => onChange("groupCount", sanitizeInt(e.target.value))}
                                        />
                                        <Field.HelperText>
                                            Prijedlog za {form.maxTeams || "?"} ekipa: {suggestedGroups}{" "}
                                            <chakra.button
                                                type="button"
                                                color="blue.500"
                                                textDecoration="underline"
                                                cursor="pointer"
                                                onClick={() => onChange("groupCount", String(suggestedGroups))}
                                            >
                                                Primijeni
                                            </chakra.button>
                                        </Field.HelperText>
                                    </Field.Root>
                                    <Field.Root>
                                        <Field.Label>Ekipa prolazi iz grupe</Field.Label>
                                        <Input
                                            type="number"
                                            inputMode="numeric"
                                            min={1}
                                            value={form.advancePerGroup}
                                            onChange={(e) => onChange("advancePerGroup", sanitizeInt(e.target.value))}
                                        />
                                    </Field.Root>
                                </Box>

                                <Field.Root>
                                    <Field.Label>Popunjavanje eliminacijske ljestvice</Field.Label>
                                    <RadioGroup.Root
                                        value={form.bracketFill}
                                        onValueChange={(v) =>
                                            onChange("bracketFill", (typeof v === "string" ? v : (v as any)?.value) as BracketFill)
                                        }
                                    >
                                        <VStack align="stretch" gap="2">
                                            <RadioGroup.Item value="BYES">
                                                <RadioGroup.ItemHiddenInput />
                                                <RadioGroup.ItemIndicator />
                                                <RadioGroup.ItemText>
                                                    Slobodan prolaz — najbolje ekipe preskaču prvo kolo kad broj ekipa nije potpun
                                                </RadioGroup.ItemText>
                                            </RadioGroup.Item>
                                            <RadioGroup.Item value="WILDCARDS">
                                                <RadioGroup.ItemHiddenInput />
                                                <RadioGroup.ItemIndicator />
                                                <RadioGroup.ItemText>
                                                    Najbolji trećeplasirani — dodatne ekipe popunjavaju ljestvicu
                                                </RadioGroup.ItemText>
                                            </RadioGroup.Item>
                                        </VStack>
                                    </RadioGroup.Root>
                                </Field.Root>

                                {formatPreview && (
                                    <Box
                                        fontSize="sm"
                                        color="fg.muted"
                                        bg="bg.subtle"
                                        rounded="md"
                                        px="3"
                                        py="2"
                                    >
                                        {formatPreview}
                                    </Box>
                                )}
                            </>
                        )}

                        {form.format === "KNOCKOUT_ONLY" && (
                            <Box fontSize="sm" color="fg.muted">
                                Sve prijavljene ekipe idu izravno u eliminacijsku ljestvicu, bez grupne faze.
                            </Box>
                        )}
                    </VStack>
                </SectionCard>
                )}
                {/* Kotizacija was a separate card on step 2 — it's now an
                    inline field in the basic-info row on step 1 so the user
                    sees price next to teams/date in a single scan. The
                    per-team / per-player hint underneath was also dropped
                    on product request (organisers found it noisy when
                    the field is empty or set to 0). */}
                {/* ===================== Card 4: Rewards ===================== */}
                {step === 3 && (
                <SectionCard
                    icon={<FiGift />}
                    title="Nagrade"
                >
                    <VStack align="stretch" gap="4">
                        <RadioGroup.Root
                            value={form.rewardsMode}
                            onValueChange={(v) =>
                                onChange("rewardsMode", (typeof v === "string" ? v : (v as any)?.value) as RewardsMode)
                            }
                        >
                            <HStack gap="6" wrap="wrap" rowGap="2">
                                <RadioGroup.Item value="fixed">
                                    <RadioGroup.ItemHiddenInput />
                                    <RadioGroup.ItemIndicator />
                                    <RadioGroup.ItemText>Fixne nagrade (€)</RadioGroup.ItemText>
                                </RadioGroup.Item>
                                <RadioGroup.Item value="percentage">
                                    <RadioGroup.ItemHiddenInput />
                                    <RadioGroup.ItemIndicator />
                                    <RadioGroup.ItemText>Postotak fonda (%)</RadioGroup.ItemText>
                                </RadioGroup.Item>
                            </HStack>
                        </RadioGroup.Root>

                        {form.rewardsMode === "fixed" ? (
                            <Box
                                display="grid"
                                gridTemplateColumns={{ base: "1fr", md: "1fr 1fr 1fr" }}
                                gap="4"
                            >
                                <Field.Root required>
                                    <Field.Label>1. mjesto <Field.RequiredIndicator /></Field.Label>
                                    <SuffixInput
                                        value={form.fixed.first}
                                        onChange={(v) => onNested("fixed", "first", sanitizeMoneyInput(v))}
                                        placeholder="npr. 200"
                                        suffix="€"
                                    />
                                </Field.Root>
                                <Field.Root required>
                                    <Field.Label>2. mjesto <Field.RequiredIndicator /></Field.Label>
                                    <SuffixInput
                                        value={form.fixed.second}
                                        onChange={(v) => onNested("fixed", "second", sanitizeMoneyInput(v))}
                                        placeholder="npr. 120"
                                        suffix="€"
                                    />
                                </Field.Root>
                                <Field.Root required>
                                    <Field.Label>3. mjesto <Field.RequiredIndicator /></Field.Label>
                                    <SuffixInput
                                        value={form.fixed.third}
                                        onChange={(v) => onNested("fixed", "third", sanitizeMoneyInput(v))}
                                        placeholder="npr. 60"
                                        suffix="€"
                                    />
                                </Field.Root>
                            </Box>
                        ) : (
                            <>
                                <Box
                                    display="grid"
                                    gridTemplateColumns={{ base: "1fr", md: "1fr 1fr 1fr" }}
                                    gap="4"
                                >
                                    <Field.Root required>
                                        <Field.Label>1. mjesto <Field.RequiredIndicator /></Field.Label>
                                        <SuffixInput
                                            value={form.percent.first}
                                            onChange={(v) => onNested("percent", "first", sanitizeMoneyInput(v))}
                                            placeholder="npr. 50"
                                            suffix="%"
                                        />
                                    </Field.Root>
                                    <Field.Root required>
                                        <Field.Label>2. mjesto <Field.RequiredIndicator /></Field.Label>
                                        <SuffixInput
                                            value={form.percent.second}
                                            onChange={(v) => onNested("percent", "second", sanitizeMoneyInput(v))}
                                            placeholder="npr. 30"
                                            suffix="%"
                                        />
                                    </Field.Root>
                                    <Field.Root required>
                                        <Field.Label>3. mjesto <Field.RequiredIndicator /></Field.Label>
                                        <SuffixInput
                                            value={form.percent.third}
                                            onChange={(v) => onNested("percent", "third", sanitizeMoneyInput(v))}
                                            placeholder="npr. 20"
                                            suffix="%"
                                        />
                                    </Field.Root>
                                </Box>
                            </>
                        )}
                    </VStack>
                </SectionCard>
                )}

                {/* ===================== Step 4 — Pregled =====================
                     Card-style summary. Mirrors how a finished tournament
                     looks in the public list: poster preview on the left,
                     headline + meta on the right, a compact 2-column
                     attribute grid below, then the publish-readiness
                     ribbon. Lets the organiser sanity-check the shape of
                     the listing before they ship it. */}
                {step === 4 && (() => {
                    const fmtPrice = (s: string) => {
                        const n = toNumber(s)
                        return n != null && n > 0 ? `${formatMoney(n)} €` : "Besplatno"
                    }
                    const rewards = form.rewardsMode === "fixed" ? form.fixed : form.percent
                    const rewardSuffix = form.rewardsMode === "fixed" ? "€" : "%"
                    const fmtReward = (s: string) => {
                        const n = toNumber(s)
                        return n != null && n > 0 ? `${n} ${rewardSuffix}` : "—"
                    }
                    const dateStr = form.startDate
                        ? `${form.startDate} · ${form.startTime || "00:00"}`
                        : null
                    const formatStr =
                        form.format === "GROUPS_KNOCKOUT"
                            ? `Grupe + eliminacija (${form.groupCount || "?"} grupe, prolazi ${form.advancePerGroup || "?"})`
                            : "Samo eliminacija"
                    const posterSrc = posterPreviewUrl || form.posterUrl || null
                    const phoneStr = form.contactPhone.trim()
                        ? `${form.contactPhoneCountry} ${form.contactPhone.trim()}`
                        : null

                    const attrs: Array<{ label: string; value: React.ReactNode }> = [
                        { label: "Lokacija", value: form.location || <Muted>— nije uneseno</Muted> },
                        { label: "Maks. ekipa", value: form.maxTeams || <Muted>Bez ograničenja</Muted> },
                        { label: "Format", value: formatStr },
                        { label: "Kotizacija", value: fmtPrice(form.entryPrice) },
                        {
                            label: "Nagrade",
                            value: `${fmtReward(rewards.first)} / ${fmtReward(rewards.second)} / ${fmtReward(rewards.third)}`,
                        },
                        {
                            label: "Kontakt",
                            value: form.contactName || phoneStr
                                ? [form.contactName, phoneStr].filter(Boolean).join(" · ")
                                : <Muted>— nije uneseno</Muted>,
                        },
                    ]

                    return (
                        <VStack align="stretch" gap="3">
                            {/* Header strip — kicker + title row */}
                            <HStack
                                justify="space-between"
                                gap="3"
                                fontFamily="mono"
                                fontSize="11px"
                                fontWeight={800}
                                letterSpacing="0.15em"
                                color="pitch.600"
                            >
                                <Box>PREGLED · KAKO ĆE IZGLEDATI</Box>
                                {missingRequired.length === 0 ? (
                                    <Box color="pitch.500">✓ SPREMNO</Box>
                                ) : (
                                    <Box color="accent.red">
                                        NEDOSTAJE {missingRequired.length}
                                    </Box>
                                )}
                            </HStack>

                            {/* Card mock — poster + headline */}
                            <Box
                                bg="bg.panel"
                                borderWidth="1px"
                                borderColor="border.emphasized"
                                rounded="xl"
                                shadow="sm"
                                overflow="hidden"
                            >
                                <Flex direction={{ base: "column", md: "row" }} gap="0">
                                    {/* Poster — left rail on desktop, top on mobile */}
                                    <Box
                                        w={{ base: "100%", md: "200px" }}
                                        h={{ base: "180px", md: "auto" }}
                                        minH={{ md: "200px" }}
                                        bg="bg.subtle"
                                        position="relative"
                                        flexShrink={0}
                                        display="grid"
                                        css={{
                                            placeItems: "center",
                                            ...(posterSrc
                                                ? {
                                                      backgroundImage: `url(${posterSrc})`,
                                                      backgroundSize: "cover",
                                                      backgroundPosition: "center",
                                                  }
                                                : {}),
                                        }}
                                    >
                                        {!posterSrc && (
                                            <Box color="fg.muted" fontSize="xs">
                                                Bez plakata
                                            </Box>
                                        )}
                                    </Box>

                                    {/* Right column — name + date row + attributes */}
                                    <VStack
                                        align="stretch"
                                        gap="3"
                                        p={{ base: "4", md: "5" }}
                                        flex="1"
                                        minW="0"
                                    >
                                        <Box>
                                            <Box
                                                fontFamily="mono"
                                                fontSize="10px"
                                                fontWeight={800}
                                                letterSpacing="0.2em"
                                                color="fg.muted"
                                                mb="1"
                                            >
                                                {dateStr ?? "DATUM — NIJE UNESEN"}
                                            </Box>
                                            <Box
                                                fontFamily="heading"
                                                fontSize={{ base: "22px", md: "26px" }}
                                                fontWeight={800}
                                                lineHeight={1.15}
                                                letterSpacing="-0.01em"
                                                color="fg.ink"
                                            >
                                                {form.name || <Muted>Bez naziva</Muted>}
                                            </Box>
                                        </Box>

                                        {/* Attribute grid — 2 cols desktop, 1 mobile */}
                                        <Box
                                            display="grid"
                                            gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }}
                                            columnGap="6"
                                            rowGap="2.5"
                                        >
                                            {attrs.map((a) => (
                                                <Flex
                                                    key={a.label}
                                                    direction="column"
                                                    gap="0.5"
                                                    minW="0"
                                                >
                                                    <Box
                                                        fontFamily="mono"
                                                        fontSize="10px"
                                                        letterSpacing="0.15em"
                                                        fontWeight={700}
                                                        color="fg.muted"
                                                    >
                                                        {a.label.toUpperCase()}
                                                    </Box>
                                                    <Box
                                                        fontSize="13px"
                                                        fontWeight={500}
                                                        color="fg.ink"
                                                        truncate
                                                    >
                                                        {a.value}
                                                    </Box>
                                                </Flex>
                                            ))}
                                        </Box>

                                        {form.details.trim() && (
                                            <Box
                                                pt="2"
                                                borderTopWidth="1px"
                                                borderColor="border.subtle"
                                                fontSize="13px"
                                                color="fg.ink"
                                                css={{ whiteSpace: "pre-wrap" }}
                                            >
                                                {form.details}
                                            </Box>
                                        )}
                                    </VStack>
                                </Flex>
                            </Box>

                            {/* Publish-ready / missing ribbon */}
                            {missingRequired.length === 0 ? (
                                <Box
                                    p="3"
                                    bg="pitch.50"
                                    color="pitch.600"
                                    rounded="lg"
                                    borderWidth="1px"
                                    borderColor="pitch.500"
                                    fontSize="13px"
                                    fontWeight={600}
                                >
                                    ✓ Sve je spremno za objavu.
                                </Box>
                            ) : (
                                <Box
                                    p="3"
                                    bg="rgba(220,38,38,0.08)"
                                    color="accent.red"
                                    rounded="lg"
                                    borderWidth="1px"
                                    borderColor="accent.red"
                                    fontSize="13px"
                                    fontWeight={600}
                                >
                                    Nedostaje: {missingRequired.join(", ")}
                                </Box>
                            )}
                        </VStack>
                    )
                })()}

                {/* spacer so the sticky bar doesn't cover the last card on short pages */}
                <Box h="2" />
            </VStack>

            {/* ===================== Sticky action bar =====================
                 The buttons sit inside a self-contained "control capsule"
                 (solid panel + border + shadow, rounded) centred at the
                 bottom of the viewport. Earlier they floated bare over the
                 page and visually tangled with the text behind them; the
                 capsule gives a clean opaque surface so both actions read
                 clearly without a full-width white band.

                 Bottom offsets clear the chrome that owns the bottom edge:
                 the mobile bottom nav (≈92px) and the web-only sticky
                 footer (≈52px) on desktop. */}
            <Box
                position="sticky"
                bottom={{
                    base: "calc(92px + env(safe-area-inset-bottom, 0px))",
                    md: "64px",
                }}
                mt="4"
                py="2"
                zIndex={950}
                display="flex"
                justifyContent="center"
                pointerEvents="none"
            >
                <HStack
                    gap="2"
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border.emphasized"
                    rounded="full"
                    p="1.5"
                    css={{
                        pointerEvents: "auto",
                        boxShadow: "0 8px 28px rgba(14,31,21,0.16)",
                    }}
                >
                    {step > 1 && (
                        <Button
                            type="button"
                            variant="outline"
                            bg="bg.panel"
                            rounded="full"
                            px="5"
                            onClick={goPrev}
                            disabled={submitting}
                        >
                            ← Natrag
                        </Button>
                    )}
                    {step < 4 && (
                        <Button
                            type="button"
                            variant="solid"
                            colorPalette="pitch"
                            rounded="full"
                            px="6"
                            onClick={goNext}
                        >
                            Dalje →
                        </Button>
                    )}
                    {step === 4 && (
                        <Button
                            type="submit"
                            variant="solid"
                            colorPalette="pitch"
                            rounded="full"
                            px="6"
                            loading={submitting}
                            disabled={missingRequired.length > 0 || submitting}
                        >
                            Objavi turnir
                        </Button>
                    )}
                </HStack>
            </Box>
        </chakra.form>
    )
}
