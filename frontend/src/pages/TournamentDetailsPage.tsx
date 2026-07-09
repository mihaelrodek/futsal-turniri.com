import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    Box,
    Button,
    chakra,
    Flex,
    HStack,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { registerLocale } from "react-datepicker"
import { hr } from "date-fns/locale"
import "react-datepicker/dist/react-datepicker.css"
import "../datepicker.css"
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { FiEdit2, FiMaximize2, FiShare2 } from "react-icons/fi"
import { PageTitle, PillTabBar, type StatusKind } from "../ui/pitch"
import TournamentNotificationBell from "../components/TournamentNotificationBell"
import TournamentResults from "../components/TournamentResults"
import { showError, showSuccess } from "../toaster"

import type { TournamentDetails } from "../types/tournaments"
import type { TeamShort } from "../types/teams"

import {
    fetchTournamentDetails,
    fetchRosterLocked,
    fetchTournamentTeams,
    replaceTeams,
    updateTournament,
    uploadTournamentPoster,
    deleteTournamentPoster,
    approveTeam,
    deleteTeam,
    deleteTournament,
    finishTournament,
    selfRegisterTeam,
    featureTournament,
    unfeatureTournament,
    hideTournament,
    unhideTournament,
} from "../api/tournaments"
import NotFoundView from "../components/NotFoundView"
import { fetchSchedule } from "../api/schedule"
import type { ScheduledMatch } from "../types/schedule"
import { listPresets } from "../api/userTeamPresets"
import type { UserTeamPreset } from "../api/userTeamPresets"
import { listTeamRequestsForTournament } from "../api/teamRequests"
import type { TeamRequest } from "../api/teamRequests"
import { useAuth } from "../auth/AuthContext"
import { useDocumentHead } from "../hooks/useDocumentHead"
import GroupsTab from "../components/GroupsTab"
import BracketTab from "../components/BracketTab"
import ScheduleTab from "../components/ScheduleTab"
import { MatchTimelineModal } from "../components/liveMatch"
import ActiveMatchOverview from "../components/ActiveMatchOverview"
import { fetchLiveMatches, type LiveMatch } from "../api/live"
import { useLiveSocket } from "../hooks/useLiveSocket"
import { usePolling } from "../hooks/usePolling"

import {
    buildEditForm,
    editFormToPayload,
    toLocalOffsetIso,
} from "../tournament/parts"
import type { EditForm, SectionKey } from "../tournament/parts"
import OverviewSection from "../tournament/OverviewSection"
import { POSTER_ACCEPT, POSTER_MAX_MB } from "../tournament/OverviewSection"
import TeamsSection from "../tournament/TeamsSection"
import LiveControlTab from "../components/LiveControlTab"
import StatsSection from "../tournament/StatsSection"
import {
    DeleteTeamDialog,
    DeleteTournamentDialog,
    SelfRegisterDialog,
    TeamInfoDialog,
} from "../tournament/dialogs"

/* ──────────────────────────────────────────────────────────────────────────
   TournamentDetailsPage - the shell.

   Route component for /turniri/:uuid. Owns the shared state (tournament,
   teams, team-requests, auth, refreshAll) and the section navigation.

   Layout:
     • a slim always-visible header (name + status + UŽIVO badge),
     • the top-level section nav (Detalji · Ekipe · Ždrijeb · Raspored),
     • the active section's content below it.

   The Detalji tab is one cohesive card holding the full tournament
   details (poster, meta, rewards, contact, extras) plus the organizer
   edit form. The Ždrijeb tab hosts the Grupe / Eliminacija sub-tabs.
   ────────────────────────────────────────────────────────────────────── */

// Register the Croatian locale once for the calendar UI used by the edit form.
registerLocale("hr", hr)

/** Sub-tabs inside the Ždrijeb tab. */
type DrawSubKey = "grupe" | "eliminacija"

/** Compact header action button - icon always shown; label collapses on
 *  small screens to keep the cluster on one row next to the title. */
function HeaderAction({
    icon,
    label,
    onClick,
    danger,
}: {
    icon: React.ReactNode
    label: string
    onClick: () => void
    danger?: boolean
}) {
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            title={label}
            aria-label={label}
            display="inline-flex"
            alignItems="center"
            gap="2"
            bg="bg.panel"
            color={danger ? "accent.red" : "fg.ink"}
            borderWidth="1px"
            borderColor={danger ? "rgba(220,38,38,0.3)" : "border"}
            px={{ base: "2.5", md: "3.5" }}
            py="2"
            rounded="full"
            fontWeight={600}
            fontSize="13px"
            cursor="pointer"
            transition="background 150ms"
            _hover={{ bg: "bg.surfaceTint" }}
        >
            {icon}
            <chakra.span display={{ base: "none", lg: "inline" }}>{label}</chakra.span>
        </chakra.button>
    )
}

export default function TournamentDetailsPage() {
    const { uuid } = useParams<{ uuid: string }>()
    const navigate = useNavigate()
    const location = useLocation()
    const { user, isAdmin, loading: authLoading } = useAuth()

    /* ---------- Core state ---------- */
    const [loading, setLoading] = useState(true)
    // Kept for state-tracking (set on fetch failure); the render shows the
    // friendly NotFoundView rather than the raw axios message.
    const [, setError] = useState<string | null>(null)
    const [t, setT] = useState<TournamentDetails | null>(null)
    const [teams, setTeams] = useState<TeamShort[]>([])
    // Live matches of THIS tournament - powers the small "active match"
    // overview below the tabs (same slot as the end-of-tournament results).
    const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([])
    // True once the draw (groups / bracket) has been generated - locks the
    // roster so teams can no longer be added or removed. Refetched on the
    // Ekipe tab so a fresh draw on another tab is reflected immediately.
    const [rosterLocked, setRosterLocked] = useState(false)

    /* ---------- Active-tab persistence ----------
     * Mirror `section` + `drawSub` into the URL query string so a hard
     * refresh, a shared link, or a "back" from a child route lands the
     * user on the same tab they were viewing.
     *
     *   /turniri/foo                            → details (default)
     *   /turniri/foo?tab=teams                  → ekipe
     *   /turniri/foo?tab=bracket&sub=eliminacija → ždrijeb / eliminacija
     *
     * Initial state is read from the URL (once, at mount). Updates are
     * pushed back via `setSearchParams({ replace: true })` so they don't
     * stack history entries - clicking tabs feels like a panel switch,
     * not a navigation. */
    const [searchParams, setSearchParams] = useSearchParams()
    const SECTION_KEYS: SectionKey[] = ["details", "live", "teams", "bracket", "raspored", "stats"]
    const DRAW_SUB_KEYS: DrawSubKey[] = ["grupe", "eliminacija"]
    const initialSection = ((): SectionKey => {
        const t = searchParams.get("tab")
        return (t && (SECTION_KEYS as string[]).includes(t)) ? (t as SectionKey) : "details"
    })()
    const initialDrawSub = ((): DrawSubKey => {
        const s = searchParams.get("sub")
        return (s && (DRAW_SUB_KEYS as string[]).includes(s)) ? (s as DrawSubKey) : "grupe"
    })()
    // ?match=<id> - set when arriving from a "Nadolazeće utakmice" click on
    // /uzivo so the Raspored tab can scroll to + highlight that match.
    const focusMatchId = ((): number | null => {
        const m = searchParams.get("match")
        const n = m ? Number(m) : NaN
        return Number.isFinite(n) ? n : null
    })()
    const [section, setSection] = useState<SectionKey>(initialSection)
    const [drawSub, setDrawSub] = useState<DrawSubKey>(initialDrawSub)
    // Whether the URL explicitly named a tab at mount. If so we respect it and
    // never auto-switch to the draw below (a shared ?tab= link wins).
    const hadExplicitTabRef = useRef(searchParams.get("tab") != null)
    const defaultedTabRef = useRef(false)

    // Write the active tab(s) back to the URL whenever they change. The
    // `details` default is encoded as "no `tab` param" so the canonical
    // share URL stays clean. The `sub` param is only meaningful inside
    // the bracket section, so it's stripped from the URL whenever the
    // user navigates away from "bracket".
    useEffect(() => {
        const next = new URLSearchParams(searchParams)
        if (section === "details") next.delete("tab")
        else next.set("tab", section)
        if (section === "bracket" && drawSub !== "grupe") {
            next.set("sub", drawSub)
        } else {
            next.delete("sub")
        }
        // Only call setSearchParams if the serialised form actually
        // changes - re-setting to the same string triggers a re-render
        // loop in some react-router builds.
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [section, drawSub])

    // Once a tournament has begun (STARTED or FINISHED), default to the Ždrijeb
    // (draw/bracket) tab when it opens - that's where the action is. Runs once,
    // after the tournament loads, and only when the URL didn't request a tab.
    useEffect(() => {
        if (!t || defaultedTabRef.current) return
        defaultedTabRef.current = true
        if (!hadExplicitTabRef.current && (t.status === "STARTED" || t.status === "FINISHED")) {
            setSection("bracket")
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t])

    // Keep this tournament's live matches fresh for the "active match" overview.
    // Polled (paused while the tab is hidden) + instant WebSocket refetch; both
    // are disabled once the tournament is FINISHED (nothing left to be live).
    const loadLiveMatches = useCallback(() => {
        fetchLiveMatches()
            .then((all) => setLiveMatches(all.filter((m) => m.tournamentUuid === t?.uuid)))
            .catch(() => { /* silent - the overview just stays hidden */ })
    }, [t?.uuid])
    const liveOverviewEnabled = !!t && t.status !== "FINISHED"
    usePolling(loadLiveMatches, 8000, liveOverviewEnabled)
    useLiveSocket((msg) => {
        if (msg.tournamentUuid && t?.uuid && msg.tournamentUuid !== t.uuid) return
        loadLiveMatches()
    }, liveOverviewEnabled)

    // Keep the roster-lock flag current: fetch on mount and whenever the user
    // opens the Ekipe tab, so a draw generated on the Ždrijeb tab immediately
    // disables adding/removing teams.
    useEffect(() => {
        if (!uuid) return
        if (section !== "teams") return
        let cancelled = false
        fetchRosterLocked(uuid)
            .then((locked) => { if (!cancelled) setRosterLocked(locked) })
            .catch(() => { /* leave previous value on transient failure */ })
        return () => { cancelled = true }
    }, [uuid, section])

    /* ---------- Dialog / confirm state ---------- */
    const [pendingDeleteTeam, setPendingDeleteTeam] = useState<TeamShort | null>(null)
    const [deletingTeam, setDeletingTeam] = useState(false)
    const [deleteTournamentOpen, setDeleteTournamentOpen] = useState(false)
    const [deletingTournament, setDeletingTournament] = useState(false)
    const [infoTeamId, setInfoTeamId] = useState<number | null>(null)
    /** All tournament matches (group + knockout), loaded for the team-info
     *  history dialog. Fetched lazily when a team's info is opened. */
    const [infoMatches, setInfoMatches] = useState<ScheduledMatch[]>([])
    /** Match whose read-only timeline modal is open (from a history row). */
    const [historyMatch, setHistoryMatch] = useState<ScheduledMatch | null>(null)

    // Load the full match list for the team-info history dialog the moment a
    // team's info is opened (lazy - most visits never open it).
    useEffect(() => {
        if (!uuid || infoTeamId == null) return
        let cancelled = false
        fetchSchedule(uuid)
            .then((s) => { if (!cancelled) setInfoMatches(s.matches) })
            .catch(() => { /* leave previous - dialog shows the empty state */ })
        return () => { cancelled = true }
    }, [uuid, infoTeamId])

    /* ---------- Details edit mode ---------- */
    const [editingDetails, setEditingDetails] = useState(false)
    const [editForm, setEditForm] = useState<EditForm | null>(null)
    const [editPickedCoords, setEditPickedCoords] = useState<{ lat: number; lng: number } | null>(null)
    const [savingDetails, setSavingDetails] = useState(false)

    /* ---------- Poster edit state ---------- */
    const [posterFile, setPosterFile] = useState<File | null>(null)
    const [posterPreviewUrl, setPosterPreviewUrl] = useState<string | null>(null)
    const [posterRemove, setPosterRemove] = useState(false)
    const [posterUploadErr, setPosterUploadErr] = useState<string | null>(null)

    function handlePosterPick(file: File) {
        setPosterUploadErr(null)
        if (!POSTER_ACCEPT.includes(file.type as any)) {
            setPosterUploadErr("Dozvoljeno: JPG, PNG ili WEBP.")
            return
        }
        if (file.size > POSTER_MAX_MB * 1024 * 1024) {
            setPosterUploadErr(`Maksimalna veličina je ${POSTER_MAX_MB} MB.`)
            return
        }
        if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl)
        setPosterFile(file)
        setPosterPreviewUrl(URL.createObjectURL(file))
        setPosterRemove(false)
    }
    function clearPosterPick() {
        if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl)
        setPosterFile(null)
        setPosterPreviewUrl(null)
        setPosterUploadErr(null)
    }
    function markPosterForRemoval() {
        clearPosterPick()
        setPosterRemove(true)
    }
    // Clean up object URLs on unmount so we don't leak blob memory.
    useEffect(() => {
        return () => {
            if (posterPreviewUrl) URL.revokeObjectURL(posterPreviewUrl)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    /* ---------- Team-requests ---------- */
    const [teamRequests, setTeamRequests] = useState<TeamRequest[]>([])
    const [teamRequestsCollapsed, setTeamRequestsCollapsed] = useState(false)

    /* ---------- Self-register dialog ---------- */
    const [selfRegOpen, setSelfRegOpen] = useState(false)
    const [presets, setPresets] = useState<UserTeamPreset[]>([])
    const [selfRegName, setSelfRegName] = useState("")
    const [selfRegSubmitting, setSelfRegSubmitting] = useState(false)
    const [selfRegError, setSelfRegError] = useState<string | null>(null)

    useEffect(() => {
        if (!selfRegOpen || !user) return
        listPresets()
            .then((list) => setPresets(list))
            .catch(() => setPresets([]))
    }, [selfRegOpen, user])

    /* ──────────────────────────────────────────────────────────────────────
       SEO meta + JSON-LD
       ────────────────────────────────────────────────────────────────────── */
    const headTitle = t?.name
        ? `${t.name}${t.location ? `, ${t.location}` : ""} - futsal-turniri.com`
        : "Turnir - futsal-turniri.com"
    const headDesc = (() => {
        const raw = t?.details?.trim()
        const start = t?.startAt ? new Date(t.startAt).toLocaleDateString("hr-HR") : null
        if (raw) return raw.length > 160 ? raw.slice(0, 157) + "…" : raw
        if (t?.name) {
            const parts: string[] = [`Futsal turnir ${t.name}`]
            if (t.location) parts.push(`u ${t.location}`)
            if (start) parts.push(`- ${start}`)
            return parts.join(" ")
        }
        return undefined
    })()
    const canonicalUrl = t?.slug
        ? `https://futsal-turniri.com/turniri/${t.slug}`
        : uuid
            ? `https://futsal-turniri.com/turniri/${uuid}`
            : undefined

    const jsonLd = useMemo(() => {
        if (!t || !canonicalUrl) return undefined
        const items: object[] = []

        const event: Record<string, unknown> = {
            "@context": "https://schema.org",
            "@type": "Event",
            name: t.name,
            url: canonicalUrl,
            inLanguage: "hr",
            eventStatus: "https://schema.org/EventScheduled",
            eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        }
        if (headDesc) event.description = headDesc
        if (t.startAt) {
            event.startDate = t.startAt
            const end = new Date(new Date(t.startAt).getTime() + 6 * 60 * 60 * 1000)
            event.endDate = end.toISOString()
        }
        if (t.location) {
            event.location = {
                "@type": "Place",
                name: t.location,
                address: {
                    "@type": "PostalAddress",
                    addressLocality: t.location,
                    addressCountry: "HR",
                },
            }
        } else {
            event.location = {
                "@type": "Place",
                name: "Hrvatska",
                address: { "@type": "PostalAddress", addressCountry: "HR" },
            }
        }
        if (t.bannerUrl) event.image = [t.bannerUrl]
        if (t.createdByName) {
            event.organizer = { "@type": "Person", name: t.createdByName }
        }
        const entryPrice = t.entryPrice ?? 0
        const startInFuture = !t.startAt || new Date(t.startAt).getTime() > Date.now()
        if (startInFuture && entryPrice > 0) {
            event.offers = {
                "@type": "Offer",
                url: canonicalUrl,
                price: String(entryPrice),
                priceCurrency: "EUR",
                availability: "https://schema.org/InStock",
                validFrom: new Date().toISOString(),
            }
        }
        items.push(event)

        items.push({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
                {
                    "@type": "ListItem",
                    position: 1,
                    name: "Turniri",
                    item: "https://futsal-turniri.com/turniri",
                },
                {
                    "@type": "ListItem",
                    position: 2,
                    name: t.name,
                    item: canonicalUrl,
                },
            ],
        })

        return items
    }, [t, canonicalUrl, headDesc])

    useDocumentHead({
        title: headTitle,
        description: headDesc,
        ogTitle: t?.name ?? undefined,
        ogDescription: headDesc,
        // For finished tournaments we prefer the server-generated 1200x630
        // share card (podium + status badge) over the user-uploaded banner
        // - it composes better in WhatsApp / Discord previews and adds
        // free context to the link. Falls back to the banner for live /
        // draft tournaments where the podium card would be empty.
        ogImage:
            t?.status === "FINISHED" && t?.winnerName
                ? `https://futsal-turniri.com/api/tournaments/${t.slug ?? t.uuid}/share-image.png`
                : t?.bannerUrl ?? undefined,
        ogType: "article",
        canonical: canonicalUrl,
        jsonLd,
    })

    /* ──────────────────────────────────────────────────────────────────────
       Data loading
       ────────────────────────────────────────────────────────────────────── */
    async function refreshAll() {
        if (!uuid) return
        const [details, teamList, prList] = await Promise.all([
            fetchTournamentDetails(uuid),
            fetchTournamentTeams(uuid),
            listTeamRequestsForTournament(uuid).catch(() => [] as TeamRequest[]),
        ])
        setT(details)
        setTeams(teamList)
        setTeamRequests(prList)
    }

    useEffect(() => {
        if (authLoading) return
        let cancelled = false
        ;(async () => {
            try {
                setLoading(true)
                setError(null)
                if (!uuid) throw new Error("Missing tournament id")
                await refreshAll()
            } catch (e: any) {
                if (!cancelled) setError(e?.message ?? "Failed to load tournament")
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [uuid, authLoading, user?.uid])

    // Keep the draw sub-tab valid for the tournament's format - a
    // KNOCKOUT_ONLY tournament has no group stage, so it always shows
    // the Eliminacija sub-tab.
    useEffect(() => {
        if (t && t.format !== "GROUPS_KNOCKOUT" && drawSub !== "eliminacija") {
            setDrawSub("eliminacija")
        }
    }, [t, drawSub])

    /* ──────────────────────────────────────────────────────────────────────
       Derived values
       ────────────────────────────────────────────────────────────────────── */
    // organizer = admin OR creator.
    const canEdit = !!t && (isAdmin || (!!user?.uid && user.uid === t.createdByUid))

    /* ──────────────────────────────────────────────────────────────────────
       Details edit handlers
       ────────────────────────────────────────────────────────────────────── */
    const editMissingRequired = useMemo(() => {
        if (!editForm) return []
        const missing: string[] = []
        if (!editForm.name.trim()) missing.push("Ime")
        if (!editForm.location.trim()) missing.push("Lokacija")
        if (!editForm.startDate) missing.push("Datum")
        if (!editForm.startTime) missing.push("Vrijeme")
        if (
            !editForm.rewardFirst.trim() ||
            !editForm.rewardSecond.trim() ||
            !editForm.rewardThird.trim()
        ) {
            missing.push("Nagrade")
        }
        return missing
    }, [
        editForm?.name,
        editForm?.location,
        editForm?.startDate,
        editForm?.startTime,
        editForm?.rewardFirst,
        editForm?.rewardSecond,
        editForm?.rewardThird,
    ])

    const editStartInPast = useMemo(() => {
        if (!editForm?.startDate || !editForm?.startTime) return false
        const iso = toLocalOffsetIso(editForm.startDate, editForm.startTime)
        if (!iso) return false
        return new Date(iso).getTime() < Date.now()
    }, [editForm?.startDate, editForm?.startTime])

    function enterDetailsEdit() {
        if (!t) return
        setEditForm(buildEditForm(t))
        // Seed the map picker with the SAVED coordinates so the existing
        // location shows up as a marker right away (the picker centers and
        // zooms onto a non-null value); null only when never geocoded.
        setEditPickedCoords(
            t.latitude != null && t.longitude != null
                ? { lat: t.latitude, lng: t.longitude }
                : null,
        )
        setEditingDetails(true)
    }
    function cancelDetailsEdit() {
        setEditForm(null)
        setEditPickedCoords(null)
        setEditingDetails(false)
        clearPosterPick()
        setPosterRemove(false)
        setPosterUploadErr(null)
    }
    async function saveDetailsEdit() {
        if (!uuid || !editForm) return
        if (editMissingRequired.length > 0) {
            showError(
                "Nedostaju obavezna polja",
                editMissingRequired.join(", "),
            )
            return
        }
        if (editStartInPast) {
            showError(
                "Neispravan datum",
                "Datum i vrijeme turnira ne mogu biti u prošlosti.",
            )
            return
        }
        try {
            setSavingDetails(true)
            let updated = await updateTournament(uuid, editFormToPayload(editForm))
            if (posterFile) {
                updated = await uploadTournamentPoster(uuid, posterFile)
            } else if (posterRemove) {
                updated = await deleteTournamentPoster(uuid)
            }
            setT(updated)
            setEditingDetails(false)
            setEditForm(null)
            clearPosterPick()
            setPosterRemove(false)
        } catch (e: any) {
            showError(
                "Greška pri spremanju",
                String(e?.response?.data ?? e?.message ?? "Neuspješno spremanje izmjena."),
            )
        } finally {
            setSavingDetails(false)
        }
    }
    function patchEdit<K extends keyof EditForm>(key: K, value: EditForm[K]) {
        setEditForm((f) => (f ? { ...f, [key]: value } : f))
    }

    /* ──────────────────────────────────────────────────────────────────────
       Teams: local editing
       ────────────────────────────────────────────────────────────────────── */
    // Add a team and persist it immediately (PUT). No more "Spremi
    // promjene" - the team lands on the backend with a sensible default
    // name and is returned so the UI can open it straight into edit mode
    // for renaming.
    async function addTeam(): Promise<TeamShort | null> {
        if (!uuid) return null
        if (savingTeamsRef.current) return null
        if (teams.some((p) => !p.name || p.name.trim() === "")) {
            showError("Neispravan unos", "Ime ekipe ne smije biti prazno.")
            return null
        }
        const defaultName = `Ekipa ${teams.length + 1}`
        savingTeamsRef.current = true
        try {
            const prevIds = new Set(teams.filter((p) => p.id > 0).map((p) => p.id))
            const saved = await replaceTeams(uuid, [
                ...buildTeamsPayload(),
                { name: defaultName, isEliminated: false },
            ])
            setTeams(saved)
            return saved.find((p) => !prevIds.has(p.id)) ?? saved[saved.length - 1] ?? null
        } catch {
            return null
        } finally {
            savingTeamsRef.current = false
        }
    }
    // Bulk-add teams: append every pasted name in one replaceTeams save.
    async function bulkAddTeams(names: string[]): Promise<void> {
        if (!uuid || names.length === 0) return
        if (savingTeamsRef.current) return
        if (teams.some((p) => !p.name || p.name.trim() === "")) {
            showError("Neispravan unos", "Ime ekipe ne smije biti prazno.")
            return
        }
        savingTeamsRef.current = true
        try {
            const saved = await replaceTeams(uuid, [
                ...buildTeamsPayload(),
                ...names.map((name) => ({ name, isEliminated: false })),
            ])
            setTeams(saved)
            showSuccess("Ekipe su uvezene.", `Dodano ${names.length} ekipa.`)
        } catch {
            /* error toasted by the http interceptor */
        } finally {
            savingTeamsRef.current = false
        }
    }
    function changeTeamName(id: number, name: string) {
        setTeams((ps) => ps.map((p) => (p.id === id ? { ...p, name } : p)))
    }
    function removeTeam(id: number) {
        setTeams((ps) => ps.filter((p) => p.id !== id))
    }

    // Mark the tournament finished (organizer, once the final decided a winner).
    const [finishingTournament, setFinishingTournament] = useState(false)
    async function runFinishTournament() {
        if (!uuid) return
        try {
            setFinishingTournament(true)
            setT(await finishTournament(uuid))
        } catch {
            /* error toasted by the http interceptor */
        } finally {
            setFinishingTournament(false)
        }
    }

    // Single-flight guard for the team-list bulk save.
    const savingTeamsRef = useRef(false)

    function buildTeamsPayload() {
        return teams.map((p) => ({
            id: p.id > 0 ? p.id : undefined,
            name: p.name,
            isEliminated: !!p.isEliminated,
        }))
    }

    function onTeamNameBlur(p: TeamShort) {
        if (!p.name.trim()) {
            // Empty name on a still-local row → drop it. On a persisted row
            // → don't overwrite the saved name with an empty string.
            if (p.id <= 0) removeTeam(p.id)
            return
        }
        if (savingTeamsRef.current) return
        if (!uuid) return
        if (teams.some((q) => !q.name || q.name.trim() === "")) {
            return
        }
        savingTeamsRef.current = true
        ;(async () => {
            try {
                const saved = await replaceTeams(uuid, buildTeamsPayload())
                setTeams(saved)
            } catch {
                /* error toast already surfaced by axios interceptor */
            } finally {
                savingTeamsRef.current = false
            }
        })()
    }

    async function onApproveTeam(p: TeamShort) {
        if (!uuid) return
        try {
            const updated = await approveTeam(uuid, p.id)
            setTeams((ps) => ps.map((x) => (x.id === updated.id ? updated : x)))
        } catch (err: any) {
            showError(
                "Greška",
                String(err?.response?.data ?? err?.message ?? "Neuspjelo odobravanje ekipe."),
            )
        }
    }

    async function submitSelfRegister() {
        if (!uuid) return
        const name = selfRegName.trim()
        if (!name) {
            setSelfRegError("Unesi ime ekipe.")
            return
        }
        try {
            setSelfRegSubmitting(true)
            setSelfRegError(null)
            const created = await selfRegisterTeam(uuid, name)
            setTeams((ps) => [...ps, created])
            setSelfRegOpen(false)
            setSelfRegName("")
        } catch (e: any) {
            const data = e?.response?.data
            const code = typeof data === "string" ? data : ""
            if (code === "TOURNAMENT_ALREADY_STARTED") {
                setSelfRegError("Turnir je već započeo.")
            } else if (code === "ALREADY_REGISTERED") {
                setSelfRegError("Već si prijavio ekipu s tim imenom.")
            } else {
                setSelfRegError(data ?? e?.message ?? "Greška pri prijavi.")
            }
        } finally {
            setSelfRegSubmitting(false)
        }
    }

    function onSelfRegisterClick() {
        if (!user) {
            navigate("/prijava", {
                state: { from: `${location.pathname}${location.search}` },
            })
            return
        }
        setSelfRegOpen(true)
    }

    /* ──────────────────────────────────────────────────────────────────────
       Render
       ────────────────────────────────────────────────────────────────────── */
    // Top-level section nav.
    const sections: Array<{ key: SectionKey; label: string }> = [
        { key: "details", label: "Detalji" },
        // "Zapisnik" - organizer/admin only: run whatever match is on now.
        ...(canEdit ? [{ key: "live" as SectionKey, label: "Zapisnik" }] : []),
        { key: "teams", label: "Ekipe" },
        { key: "bracket", label: "Ždrijeb" },
        { key: "raspored", label: "Raspored" },
        { key: "stats", label: "Statistika" },
    ]

    const shareUrl = typeof window !== "undefined" ? window.location.href : ""

    if (loading) {
        return (
            <Flex direction="column" align="center" justify="center" gap="3" py="20">
                <Spinner size="lg" color="pitch.500" />
                <Text fontSize="sm" color="fg.muted">Učitavanje…</Text>
            </Flex>
        )
    }

    if (!t) {
        // Friendly branded panel instead of the raw axios error string
        // ("Request failed with status code 404") - this is what a visitor
        // sees when opening a link to a deleted tournament or a dead slug.
        return (
            <NotFoundView
                title="Turnir nije pronađen"
                description="Turnir je možda obrisan ili je adresa netočna. Pogledaj aktualne turnire na popisu."
            />
        )
    }

    const hasGroupStage = t.format === "GROUPS_KNOCKOUT"

    // Map backend status to the Pitch StatusChip's discrete kinds.
    //
    // A live match in progress and a plain STARTED tournament now read the
    // same: a red pulsing "U tijeku" chip. We no longer split out a separate
    // "UŽIVO" state so the header stays stable between individual matches.
    //
    // "Nacrt" (draft) is deliberately NOT surfaced as a chip - it added
    // visual noise on every newly-created tournament and the header now
    // carries the action buttons instead. We only show a chip for the
    // meaningful running / finished states.
    const isRunning = t.liveMatch || t.status === "STARTED" || t.status === "IN_PROGRESS"
    const statusKind: StatusKind | null = isRunning
        ? "live"
        : t.status === "FINISHED"
            ? "finished"
            : null
    const statusLabel = isRunning
        ? "U tijeku"
        : t.status === "FINISHED"
            ? "Završeno"
            : null

    /** Top-right header actions: edit, share, fullscreen + bell. */
    const headerActions = (
        <HStack gap="2" wrap="wrap" justify="flex-end">
            {/* "Uredi" only appears on the Detalji tab - otherwise it would
                open the edit form (which lives in the details view) "in the
                background" while another tab is showing. */}
            {canEdit && t.status !== "FINISHED" && !editingDetails && section === "details" && (
                <HeaderAction
                    icon={<FiEdit2 size={15} />}
                    label="Uredi"
                    onClick={enterDetailsEdit}
                />
            )}
            <HeaderAction
                icon={<FiShare2 size={15} />}
                label="Podijeli"
                onClick={async () => {
                    if (typeof navigator !== "undefined" && (navigator as any).share) {
                        try {
                            await (navigator as any).share({ title: t.name, url: shareUrl })
                        } catch {
                            /* user cancelled */
                        }
                        return
                    }
                    try {
                        await navigator.clipboard.writeText(shareUrl)
                        showSuccess("Kopirano", "Link je u clipboardu.")
                    } catch {
                        window.prompt("Kopiraj link:", shareUrl)
                    }
                }}
            />
            <HeaderAction
                icon={<FiMaximize2 size={15} />}
                label="Turnir mode"
                onClick={() =>
                    window.open(`/turniri/${t.slug ?? t.uuid}/fullscreen`, "_blank", "noopener")
                }
            />
            <TournamentNotificationBell uuid={t.uuid} />
        </HStack>
    )

    const sectionLabels = sections.map((s) => s.label) as Array<typeof sections[number]["label"]>
    const activeLabel = sections.find((s) => s.key === section)?.label ?? "Detalji"

    return (
        <VStack
            align="stretch"
            gap="2"
            // Hidden tournament (visible only to creator/admin) - the whole
            // page is desaturated so it's unmistakably "not public", plus the
            // banner below spells it out.
            css={t.hidden ? { filter: "grayscale(0.55)" } : undefined}
        >
            {t.hidden && (
                <HStack
                    bg="bg.muted"
                    borderWidth="1px"
                    borderColor="border.emphasized"
                    borderStyle="dashed"
                    rounded="lg"
                    px="4"
                    py="2.5"
                    gap="2.5"
                >
                    <Text fontSize="16px" lineHeight="1">🔒</Text>
                    <Text fontSize="sm" color="fg.soft" fontWeight={600}>
                        Turnir nije javno vidljiv - vide ga samo organizator i administratori.
                    </Text>
                </HStack>
            )}
            {/* Back is now an arrow button inside the header action cluster
                (top-right), so the standalone "Natrag na popis" link is
                gone - frees up the vertical space above the title. */}
            <PageTitle
                title={t.name}
                status={statusKind ?? undefined}
                statusLabel={statusLabel ?? undefined}
                action={headerActions}
            />

            {/* ── Section nav - pill tab bar ──────────────────────────── */}
            <PillTabBar
                tabs={sectionLabels}
                active={activeLabel}
                onChange={(label) => {
                    const next = sections.find((s) => s.label === label)
                    if (next) setSection(next.key)
                }}
            />

            {/* Golden "Rezultati turnira" - pinned at the very top (right below
                the tabs) once the tournament is over: either explicitly FINISHED
                or the champion has been decided (the final set winnerName). Shown
                to everyone, on every tab. */}
            {(t.status === "FINISHED" || !!t.winnerName) && (
                <TournamentResults
                    t={t}
                    canEdit={canEdit}
                    onSaved={(updated) => setT(updated)}
                    onFinish={
                        canEdit && t.status !== "FINISHED"
                            ? runFinishTournament
                            : undefined
                    }
                    finishing={finishingTournament}
                />
            )}

            {/* Small "active match" overview - same slot as the results panel,
                shown while a game is in progress so anyone opening the
                tournament sees there's a match live right now. Tapping it opens
                that match's own live page. */}
            {liveMatches.length > 0 && (
                <ActiveMatchOverview matches={liveMatches} uuidOrSlug={t.slug ?? t.uuid} />
            )}

            {/* ===== ACTIVE SECTION ===== */}
            <Box>
                {section === "details" && (
                    <OverviewSection
                        t={t}
                        canEdit={canEdit}
                        isAdmin={isAdmin}
                        shareUrl={shareUrl}
                        teamCount={teams.length}
                        tournamentStarted={
                            (t.status as string) === "STARTED" ||
                            (t.status as string) === "IN_PROGRESS" ||
                            t.status === "FINISHED"
                        }
                        editingDetails={editingDetails}
                        editForm={editForm}
                        enterEdit={enterDetailsEdit}
                        cancelEdit={cancelDetailsEdit}
                        saveEdit={saveDetailsEdit}
                        savingDetails={savingDetails}
                        patchEdit={patchEdit}
                        editMissingRequired={editMissingRequired}
                        editStartInPast={editStartInPast}
                        onDeleteTournament={() => setDeleteTournamentOpen(true)}
                        onToggleFeature={async () => {
                            // Admin-only feature toggle. Backend roundtrip
                            // either sets or clears `featured_at`; on success
                            // we re-fetch the details so `t.featuredAt`
                            // reflects the new state and the button label
                            // flips on the next render.
                            if (!uuid) return
                            try {
                                if (t.featuredAt) {
                                    await unfeatureTournament(uuid)
                                } else {
                                    await featureTournament(uuid)
                                }
                                setT(await fetchTournamentDetails(uuid))
                            } catch {
                                // Error toasted by the http interceptor.
                            }
                        }}
                        onToggleHidden={async () => {
                            // Admin-only visibility toggle - same refetch
                            // pattern as the feature toggle above.
                            if (!uuid) return
                            try {
                                if (t.hidden) {
                                    await unhideTournament(uuid)
                                } else {
                                    await hideTournament(uuid)
                                }
                                setT(await fetchTournamentDetails(uuid))
                            } catch {
                                // Error toasted by the http interceptor.
                            }
                        }}
                        posterFile={posterFile}
                        posterPreviewUrl={posterPreviewUrl}
                        posterRemove={posterRemove}
                        posterUploadErr={posterUploadErr}
                        handlePosterPick={handlePosterPick}
                        clearPosterPick={clearPosterPick}
                        markPosterForRemoval={markPosterForRemoval}
                        editPickedCoords={editPickedCoords}
                        setEditPickedCoords={setEditPickedCoords}
                    />
                )}

                {section === "live" && canEdit && <LiveControlTab uuid={t.uuid} />}

                {section === "teams" && (
                    <TeamsSection
                        t={t}
                        uuid={uuid ?? ""}
                        teams={teams}
                        teamRequests={teamRequests}
                        canEdit={canEdit}
                        userUid={user?.uid}
                        tournamentAlready={
                            (t.status as string) === "STARTED" ||
                            (t.status as string) === "IN_PROGRESS" ||
                            t.status === "FINISHED"
                        }
                        drawGenerated={rosterLocked}
                        teamRequestsCollapsed={teamRequestsCollapsed}
                        setTeamRequestsCollapsed={setTeamRequestsCollapsed}
                        addTeam={addTeam}
                        onBulkAddTeams={bulkAddTeams}
                        changeTeamName={changeTeamName}
                        onTeamNameBlur={onTeamNameBlur}
                        removeTeam={removeTeam}
                        requestDeleteTeam={setPendingDeleteTeam}
                        onApproveTeam={onApproveTeam}
                        openTeamInfo={setInfoTeamId}
                        onSelfRegisterClick={onSelfRegisterClick}
                        onPodiumUpdated={setT}
                    />
                )}

                {section === "bracket" && (
                    <VStack align="stretch" gap="4">
                        {/* Ždrijeb sub-tabs - only shown when the format has a
                            group stage. KNOCKOUT_ONLY jumps straight to the
                            bracket with no sub-tab bar. */}
                        {hasGroupStage && (
                            <Box
                                overflowX="auto"
                                css={{
                                    scrollbarWidth: "none",
                                    "&::-webkit-scrollbar": { display: "none" },
                                }}
                            >
                                <HStack
                                    gap="2"
                                    p="1"
                                    bg="bg.muted"
                                    borderWidth="1px"
                                    borderColor="border"
                                    rounded="lg"
                                    w="max-content"
                                    minW="full"
                                >
                                    {([
                                        { key: "grupe" as DrawSubKey, label: "Grupe" },
                                        { key: "eliminacija" as DrawSubKey, label: "Eliminacija" },
                                    ]).map((s) => {
                                        const active = drawSub === s.key
                                        return (
                                            <Button
                                                key={s.key}
                                                size="sm"
                                                variant={active ? "solid" : "ghost"}
                                                colorPalette={active ? "brand" : "gray"}
                                                rounded="md"
                                                flex="1"
                                                onClick={() => setDrawSub(s.key)}
                                            >
                                                {s.label}
                                            </Button>
                                        )
                                    })}
                                </HStack>
                            </Box>
                        )}

                        {(() => {
                            // Once the tournament has started (status moved
                            // past DRAFT), destructive draw/regenerate
                            // actions inside Ždrijeb / Grupe get hidden -
                            // re-running them would wipe live scores.
                            const tournamentStarted =
                                (t.status as string) === "STARTED" ||
                                (t.status as string) === "IN_PROGRESS" ||
                                t.status === "FINISHED"
                            return hasGroupStage && drawSub === "grupe" ? (
                                <GroupsTab
                                    uuid={t.uuid}
                                    advancePerGroup={t.advancePerGroup}
                                    groupCount={t.groupCount}
                                    bestThirdCount={t.bestThirdCount}
                                    teams={teams}
                                    canEdit={canEdit}
                                    tournamentStarted={tournamentStarted}
                                    onGoToSchedule={() => setSection("raspored")}
                                />
                            ) : (
                                <BracketTab
                                    uuid={t.uuid}
                                    canEdit={canEdit}
                                    tournamentStarted={tournamentStarted}
                                    tournamentName={t.name}
                                    format={t.format}
                                />
                            )
                        })()}
                    </VStack>
                )}

                {section === "raspored" && (
                    <ScheduleTab
                        uuid={t.uuid}
                        canEdit={canEdit}
                        tournamentName={t.name}
                        tournamentLocation={t.location}
                        tournamentSlug={t.slug}
                        focusMatchId={focusMatchId}
                        format={t.format}
                        startAt={t.startAt}
                    />
                )}

                {section === "stats" && <StatsSection uuid={t.uuid} />}
            </Box>

            {/* ===== Dialogs ===== */}
            <SelfRegisterDialog
                open={selfRegOpen}
                onClose={() => {
                    setSelfRegOpen(false)
                    setSelfRegError(null)
                    setSelfRegName("")
                }}
                presets={presets}
                teams={teams}
                userUid={user?.uid}
                name={selfRegName}
                onNameChange={setSelfRegName}
                error={selfRegError}
                submitting={selfRegSubmitting}
                onSubmit={submitSelfRegister}
            />

            <TeamInfoDialog
                teamId={infoTeamId}
                teams={teams}
                matches={infoMatches}
                onClose={() => setInfoTeamId(null)}
                onSelectMatch={(m) => {
                    setInfoTeamId(null)
                    setHistoryMatch(m)
                }}
            />

            {historyMatch && uuid && (
                <MatchTimelineModal
                    uuid={uuid}
                    match={historyMatch}
                    onClose={() => setHistoryMatch(null)}
                />
            )}

            <DeleteTournamentDialog
                open={deleteTournamentOpen}
                tournamentName={t.name}
                deleting={deletingTournament}
                onClose={() => setDeleteTournamentOpen(false)}
                onConfirm={async () => {
                    if (!uuid) return
                    try {
                        setDeletingTournament(true)
                        await deleteTournament(uuid)
                        navigate("/turniri", { replace: true })
                    } catch (err: any) {
                        showError(
                            "Greška pri brisanju",
                            String(err?.response?.data ?? err?.message ?? "Turnir nije obrisan."),
                        )
                    } finally {
                        setDeletingTournament(false)
                        setDeleteTournamentOpen(false)
                    }
                }}
            />

            <DeleteTeamDialog
                team={pendingDeleteTeam}
                deleting={deletingTeam}
                onClose={() => setPendingDeleteTeam(null)}
                onConfirm={async () => {
                    if (!pendingDeleteTeam || !uuid) return
                    try {
                        setDeletingTeam(true)
                        await deleteTeam(uuid, pendingDeleteTeam.id)
                        setTeams((ps) => ps.filter((x) => x.id !== pendingDeleteTeam.id))
                        setPendingDeleteTeam(null)
                    } catch (err: any) {
                        showError(
                            "Greška pri brisanju",
                            String(err?.response?.data ?? err?.message ?? "Ekipa nije obrisana."),
                        )
                    } finally {
                        setDeletingTeam(false)
                    }
                }}
            />
        </VStack>
    )
}
