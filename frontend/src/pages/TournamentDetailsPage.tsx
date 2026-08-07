import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    Box,
    Button,
    chakra,
    Flex,
    Heading,
    HStack,
    IconButton,
    Menu,
    Portal,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { registerLocale } from "react-datepicker"
import { hr } from "date-fns/locale"
import "react-datepicker/dist/react-datepicker.css"
import "../datepicker.css"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { qk } from "../queryClient"
import {
    FiBarChart2,
    FiCalendar,
    FiClipboard,
    FiEdit2,
    FiGitMerge,
    FiInfo,
    FiMaximize2,
    FiMoreHorizontal,
    FiPlayCircle,
    FiShare2,
    FiTrash2,
    FiUsers,
} from "react-icons/fi"
import { HINT_RING_SHADOW, PillTabBar, StatusChip, type StatusKind } from "../ui/pitch"
import { ConfirmDialog } from "../ui/primitives"
import TournamentNotificationBell from "../components/TournamentNotificationBell"
import TournamentResults from "../components/TournamentResults"
import { showError, showSuccess } from "../toaster"

import type { TournamentDetails } from "../types/tournaments"
import type { TeamShort } from "../types/teams"

import {
    fetchTournamentDetails,
    fetchTournamentAccess,
    fetchRosterLocked,
    fetchTournamentTeams,
    replaceTeams,
    updateTournament,
    uploadTournamentPoster,
    deleteTournamentPoster,
    approveTeam,
    deleteTeam,
    finishTournament,
    requestTournamentDeletion,
    selfRegisterTeam,
} from "../api/tournaments"
import { useTranslation } from "../i18n"
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
import ActiveMatchOverview from "../components/ActiveMatchOverview"
import { fetchLiveMatches, type LiveMatch } from "../api/live"
import { fetchStreamBanner, readStreamBannerHint, type StreamBanner } from "../api/streamBanner"
import { useLiveSocket } from "../hooks/useLiveSocket"
import { usePolling } from "../hooks/usePolling"

import {
    buildEditForm,
    editFormToPayload,
} from "../tournament/parts"
import type { EditForm, SectionKey } from "../tournament/parts"
import OverviewSection from "../tournament/OverviewSection"
import { POSTER_ACCEPT, POSTER_MAX_MB } from "../tournament/OverviewSection"
import TeamsSection from "../tournament/TeamsSection"
import DemoSection from "../tournament/DemoSection"
import LiveControlTab from "../components/LiveControlTab"
import StatsSection from "../tournament/StatsSection"
import {
    DeleteTeamDialog,
    DeleteTournamentDialog,
    SelfRegisterDialog,
    TeamInfoDialog,
    TeamRegistrationDialog,
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

/** Icon per section for the desktop sidebar nav. */
const SECTION_ICONS: Record<SectionKey, React.ReactNode> = {
    demo: <FiPlayCircle size={15} />,
    details: <FiInfo size={15} />,
    live: <FiClipboard size={15} />,
    teams: <FiUsers size={15} />,
    bracket: <FiGitMerge size={15} />,
    raspored: <FiCalendar size={15} />,
    stats: <FiBarChart2 size={15} />,
}

/** One desktop-sidebar navigation row. The active item is a solid pitch-green
 *  pill; inactive rows are muted text with a subtle hover fill. */
function SidebarNavItem({
    icon,
    label,
    active,
    hint,
    onClick,
}: {
    icon?: React.ReactNode
    label: string
    active: boolean
    /** Pulsing highlight ring around the whole row - the demo walkthrough
     *  uses it to point at the real tab matching the current demo step. */
    hint?: boolean
    onClick: () => void
}) {
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            position="relative"
            display="flex"
            alignItems="center"
            gap="2.5"
            w="full"
            textAlign="left"
            pl="3"
            pr="3"
            py="2"
            rounded="lg"
            fontSize="14px"
            fontWeight={active ? 700 : 600}
            bg={active ? "pitch.500" : "transparent"}
            color={active ? "white" : "fg.soft"}
            cursor="pointer"
            transition="background 120ms"
            _hover={{ bg: active ? "pitch.500" : "bg.surfaceTint" }}
        >
            {icon}
            {label}
            {hint && (
                <Box
                    position="absolute"
                    inset="0"
                    rounded="lg"
                    pointerEvents="none"
                    css={{
                        boxShadow: HINT_RING_SHADOW,
                        animation: "pitchPulse 1.2s ease-in-out infinite",
                    }}
                />
            )}
        </chakra.button>
    )
}

/** The "on deck" match: the LIVE one if any, else the earliest-kickoff
 *  SCHEDULED one. A match whose kickoff time has already passed but hasn't
 *  been recorded yet still counts as on deck (it stays the earliest SCHEDULED),
 *  so a late 13:00 game is preferred over a 14:00 one. Mirrors the schedule /
 *  bracket "na redu" logic. */
function pickOnDeckMatch(matches: ScheduledMatch[]): ScheduledMatch | null {
    const live = matches.find((m) => m.status === "LIVE")
    if (live) return live
    return (
        matches
            .filter((m) => m.status === "SCHEDULED")
            .sort((a, b) => {
                const ka = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.POSITIVE_INFINITY
                const kb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.POSITIVE_INFINITY
                return ka - kb
            })[0] ?? null
    )
}

export default function TournamentDetailsPage() {
    const t18n = useTranslation()
    const { uuid } = useParams<{ uuid: string }>()
    const navigate = useNavigate()
    const { user, isAdmin, loading: authLoading } = useAuth()

    const queryClient = useQueryClient()
    // Seed the detail from the react-query cache so opening a tournament that
    // was prefetched (card hover / press) or recently viewed paints INSTANTLY -
    // no spinner, no cold refetch. First-ever open has no cache → normal load.
    const cachedT = uuid ? queryClient.getQueryData<TournamentDetails>(qk.tournamentDetails(uuid)) : undefined

    /* ---------- Core state ---------- */
    const [loading, setLoading] = useState(!cachedT)
    // Kept for state-tracking (set on fetch failure); the render shows the
    // friendly NotFoundView rather than the raw axios message.
    const [, setError] = useState<string | null>(null)
    const [t, setT] = useState<TournamentDetails | null>(cachedT ?? null)
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
    const SECTION_KEYS: SectionKey[] = ["demo", "details", "live", "teams", "bracket", "raspored", "stats"]
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
    const [section, setSection] = useState<SectionKey>(() => {
        // No explicit ?tab= and the (cached) tournament has already begun →
        // open Ždrijeb IMMEDIATELY, on the very first paint. The effect below
        // does the same for cold opens (content is behind the spinner there,
        // so it can't flash), but with a cache-seeded `t` it used to paint
        // Detalji for a frame and then flip - visible jank on every open.
        if (
            searchParams.get("tab") == null &&
            cachedT &&
            (cachedT.status === "STARTED" || cachedT.status === "FINISHED")
        ) {
            return "bracket"
        }
        return initialSection
    })
    const [drawSub, setDrawSub] = useState<DrawSubKey>(initialDrawSub)
    // Set by the bracket's position-save step: opens the knockout-times dialog
    // once when the Raspored tab mounts (cleared as soon as ScheduleTab consumes
    // it) so the organizer confirms only the završnica kickoffs.
    const [knockoutTimesRequest, setKnockoutTimesRequest] = useState(false)
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

    // Resolve which Ždrijeb sub-tab to open from what's being played right
    // now: pull the cached schedule, pick the on-deck match (the LIVE one,
    // else the earliest-kickoff SCHEDULED one) and open Eliminacija when it's
    // a knockout game, otherwise Grupe. On any fetch failure the current
    // sub-tab is left untouched. Only meaningful for GROUPS_KNOCKOUT -
    // KNOCKOUT_ONLY is pinned to Eliminacija by the format effect below.
    const resolveDrawSub = useCallback((noneOnDeck: DrawSubKey = "grupe") => {
        if (!uuid) return
        queryClient
            .fetchQuery({ queryKey: qk.schedule(uuid), queryFn: () => fetchSchedule(uuid), staleTime: 15_000 })
            .then((s) => {
                const onDeck = pickOnDeckMatch(s.matches)
                // No LIVE/SCHEDULED match at all → nothing left to default to
                // Grupe for; a finished tournament should land on Eliminacija
                // (the caller passes "eliminacija" for that case).
                setDrawSub(onDeck ? (onDeck.stage !== "GROUP" ? "eliminacija" : "grupe") : noneOnDeck)
            })
            .catch(() => { /* leave the current sub-tab on a fetch failure */ })
    }, [uuid, queryClient])

    // Once a tournament has begun (STARTED or FINISHED), default to the Ždrijeb
    // (draw/bracket) tab when it opens - that's where the action is. Runs once,
    // after the tournament loads, and only when the URL didn't request a tab.
    useEffect(() => {
        if (!t || defaultedTabRef.current) return
        defaultedTabRef.current = true
        if (hadExplicitTabRef.current) return
        if (t.status !== "STARTED" && t.status !== "FINISHED") return
        setSection("bracket")
        // For a GROUPS_KNOCKOUT tournament, also pick the draw sub-tab that
        // matches what's being played right now (Grupe vs Eliminacija) - or,
        // once the tournament is FINISHED and nothing is left on deck,
        // Eliminacija (→ Finale, per BracketTab's own finished-bracket focus)
        // rather than defaulting back to Grupe. KNOCKOUT_ONLY is already
        // pinned to Eliminacija by the format effect below. Uses the cached
        // schedule so it's cheap.
        if (uuid && t.format === "GROUPS_KNOCKOUT") {
            resolveDrawSub(t.status === "FINISHED" ? "eliminacija" : "grupe")
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t])

    // Keep this tournament's live matches fresh for the "active match" overview.
    // Polled (paused while the tab is hidden) + instant WebSocket refetch; both
    // are disabled once the tournament is FINISHED (nothing left to be live).
    const loadLiveMatches = useCallback(() => {
        fetchLiveMatches()
            .then((all) => {
                // Share the full live list so /uzivo + nav badges stay warm.
                queryClient.setQueryData(qk.liveMatches, all)
                setLiveMatches(all.filter((m) => m.tournamentUuid === t?.uuid))
            })
            .catch(() => { /* silent - the overview just stays hidden */ })
    }, [t?.uuid, queryClient])
    const liveOverviewEnabled = !!t && t.status !== "FINISHED"
    usePolling(loadLiveMatches, 8000, liveOverviewEnabled)
    useLiveSocket((msg) => {
        if (msg.tournamentUuid && t?.uuid && msg.tournamentUuid !== t.uuid) return
        loadLiveMatches()
    }, liveOverviewEnabled)

    // Global stream-banner state (one active stream app-wide), polled so the
    // sidebar's "Live stream" shortcut appears the moment a broadcast for THIS
    // tournament goes live. Seeded from the cached hint for an instant paint.
    const [streamBanner, setStreamBanner] = useState<StreamBanner | null>(() => readStreamBannerHint())
    const loadStreamBanner = useCallback(() => {
        fetchStreamBanner().then(setStreamBanner).catch(() => { /* keep last known */ })
    }, [])
    usePolling(loadStreamBanner, 30000, liveOverviewEnabled)
    // This tournament is being streamed right now (state STREAMING and the
    // banner is linked to it) - drives the pulsing "Live stream" sidebar item.
    const streamLiveForThis =
        !!t && streamBanner?.state === "STREAMING" && streamBanner?.tournamentUuid === t.uuid

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
    // Two-step tournament deletion: the dialog collects a mandatory reason;
    // organizers only REQUEST (archive), platform admins finalize immediately.
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [deletingTournament, setDeletingTournament] = useState(false)
    const [infoTeamId, setInfoTeamId] = useState<number | null>(null)
    /** All tournament matches (group + knockout), loaded for the team-info
     *  history dialog. Fetched lazily when a team's info is opened. */
    const [infoMatches, setInfoMatches] = useState<ScheduledMatch[]>([])
    // Load the full match list for the team-info history dialog the moment a
    // team's info is opened (lazy - most visits never open it).
    useEffect(() => {
        if (!uuid || infoTeamId == null) return
        let cancelled = false
        // Reuse the schedule the tabs already cached instead of a fresh fetch.
        queryClient
            .fetchQuery({ queryKey: qk.schedule(uuid), queryFn: () => fetchSchedule(uuid), staleTime: 15_000 })
            .then((s) => { if (!cancelled) setInfoMatches(s.matches) })
            .catch(() => { /* leave previous - dialog shows the empty state */ })
        return () => { cancelled = true }
    }, [uuid, infoTeamId, queryClient])

    /* ---------- Details edit mode ---------- */
    const [editingDetails, setEditingDetails] = useState(false)
    const [editForm, setEditForm] = useState<EditForm | null>(null)
    const [editPickedCoords, setEditPickedCoords] = useState<{ lat: number; lng: number } | null>(null)
    const [savingDetails, setSavingDetails] = useState(false)
    // Snapshot taken when the edit form opens - compared against current
    // state to tell a genuinely untouched edit from one with unsaved changes.
    const originalEditFormJsonRef = useRef<string | null>(null)
    const originalEditCoordsRef = useRef<{ lat: number; lng: number } | null>(null)
    // Section the user tried to switch to while the edit form was dirty -
    // set instead of navigating, and resolved by the confirm dialog below.
    const [pendingSectionLeave, setPendingSectionLeave] = useState<SectionKey | null>(null)

    /* ---------- Demo walkthrough state ---------- */
    // Reported up by DemoSection: `active` means a demo run is in progress
    // (guards tab switches behind a confirm, like the dirty-edit guard),
    // `highlightTab` is the real tab matching the current demo step - both
    // navs pulse a dot on that item.
    const [demoState, setDemoState] = useState<{ active: boolean; highlightTab: SectionKey | null }>({
        active: false,
        highlightTab: null,
    })
    // Section the user tried to switch to while the demo was running -
    // set instead of navigating, and resolved by its own confirm dialog.
    const [pendingDemoLeave, setPendingDemoLeave] = useState<SectionKey | null>(null)
    // Leaving the demo tab (confirmed leave, deep link, back button) must
    // drop the demo state, or a stale `active` guard / highlight would
    // survive until the tab is next opened.
    useEffect(() => {
        if (section !== "demo") {
            setDemoState({ active: false, highlightTab: null })
        }
    }, [section])

    // Tournament SETTINGS (format, name, location, ...) have no realtime push
    // of their own - only live-match events do (see useLiveSocket above). An
    // already-open tab that isn't the one making the edit would otherwise show
    // a stale format/name until the page is reloaded. Skipped while THIS tab
    // has its own unsaved edit open (`editingDetails`), so a background poll
    // can never clobber in-progress local changes.
    const refreshTournamentDetails = useCallback(() => {
        if (!uuid) return
        fetchTournamentDetails(uuid)
            .then(setT)
            .catch(() => { /* transient failure - keep last known */ })
    }, [uuid])
    usePolling(refreshTournamentDetails, 30000, liveOverviewEnabled && !editingDetails)

    /* ---------- Poster edit state ---------- */
    const [posterFile, setPosterFile] = useState<File | null>(null)
    const [posterPreviewUrl, setPosterPreviewUrl] = useState<string | null>(null)
    const [posterRemove, setPosterRemove] = useState(false)
    const [posterUploadErr, setPosterUploadErr] = useState<string | null>(null)

    function handlePosterPick(file: File) {
        setPosterUploadErr(null)
        if (!POSTER_ACCEPT.includes(file.type as any)) {
            setPosterUploadErr(t18n.pages.tournamentDetailsPage.posterErrors.invalidType)
            return
        }
        if (file.size > POSTER_MAX_MB * 1024 * 1024) {
            setPosterUploadErr(t18n.pages.tournamentDetailsPage.posterErrors.tooLarge(POSTER_MAX_MB))
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
    const [fullRegOpen, setFullRegOpen] = useState(false)
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
        // Prefer the organizer-set public name (udruga, klub… - an
        // Organization) over the creator's account name (a Person).
        const organizerDisplay = t.organizerName?.trim() || t.createdByName
        if (organizerDisplay) {
            event.organizer = {
                "@type": t.organizerName?.trim() ? "Organization" : "Person",
                name: organizerDisplay,
            }
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
    // `useCache` (mount only): pull the tournament detail through the
    // react-query cache so a prefetched / recently-viewed tournament resolves
    // instantly. Explicit refreshes (post-mutation) pass nothing → always fresh.
    async function refreshAll(useCache = false) {
        if (!uuid) return
        const detailsP = useCache
            ? queryClient.fetchQuery({
                  queryKey: qk.tournamentDetails(uuid),
                  queryFn: () => fetchTournamentDetails(uuid),
                  staleTime: 30_000,
              })
            : fetchTournamentDetails(uuid)
        const [details, teamList, prList] = await Promise.all([
            detailsP,
            fetchTournamentTeams(uuid),
            listTeamRequestsForTournament(uuid).catch(() => [] as TeamRequest[]),
        ])
        setT(details)
        setTeams(teamList)
        setTeamRequests(prList)
    }

    // Opening a tournament (or switching to another one) always starts at the
    // top - React Router keeps the previous page's window scroll, so a deep
    // scroll on the list page used to carry over into the details view.
    useEffect(() => {
        window.scrollTo(0, 0)
    }, [uuid])

    useEffect(() => {
        if (authLoading) return
        let cancelled = false
        ;(async () => {
            try {
                if (!uuid) throw new Error("Missing tournament id")
                // Only show the full-page spinner on a cold open (no cached
                // copy). With a cache hit the page is already painted from the
                // seed above and just revalidates quietly in the background.
                if (!queryClient.getQueryData(qk.tournamentDetails(uuid))) setLoading(true)
                setError(null)
                await refreshAll(true)
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

    // Mirror every local tournament update into the react-query cache so the
    // next open (or a card prefetch) reflects edits instead of a stale snapshot.
    useEffect(() => {
        if (t && uuid) queryClient.setQueryData(qk.tournamentDetails(uuid), t)
    }, [t, uuid, queryClient])

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
    // Granted co-editors aren't visible in the details payload, so ask the
    // backend whether THIS caller may manage. Owner/admin are still resolved
    // locally (instant, no flicker); this only ADDS edit rights for a granted
    // editor once the small check returns.
    const [canManageAccess, setCanManageAccess] = useState(false)
    useEffect(() => {
        if (!uuid || !user?.uid) { setCanManageAccess(false); return }
        let cancelled = false
        fetchTournamentAccess(uuid)
            .then((a) => { if (!cancelled) setCanManageAccess(a.canManage) })
            .catch(() => { if (!cancelled) setCanManageAccess(false) })
        return () => { cancelled = true }
    }, [uuid, user?.uid])

    // organizer = admin OR creator OR granted co-editor.
    const canEdit = !!t && (isAdmin || (!!user?.uid && user.uid === t.createdByUid) || canManageAccess)

    // A FINISHED tournament is locked for everyone except admins: organizers keep
    // read access but every editing entry point is hidden behind a "contact an
    // admin to unlock" notice. Threaded into the draw / schedule / live tabs.
    const finishedLocked = !!t && t.status === "FINISHED" && !isAdmin

    /* ──────────────────────────────────────────────────────────────────────
       Details edit handlers
       ────────────────────────────────────────────────────────────────────── */
    const editMissingRequired = useMemo(() => {
        if (!editForm) return []
        const missing: string[] = []
        if (!editForm.name.trim()) missing.push(t18n.pages.tournamentDetailsPage.editValidation.name)
        if (!editForm.location.trim()) missing.push(t18n.pages.tournamentDetailsPage.editValidation.location)
        if (!editForm.startDate) missing.push(t18n.pages.tournamentDetailsPage.editValidation.date)
        if (!editForm.startTime) missing.push(t18n.pages.tournamentDetailsPage.editValidation.time)
        if (!editForm.gameSystem.trim()) missing.push(t18n.pages.tournamentDetailsPage.editValidation.gameSystem)
        if (
            !editForm.rewardFirst.trim() ||
            !editForm.rewardSecond.trim() ||
            !editForm.rewardThird.trim()
        ) {
            missing.push(t18n.pages.tournamentDetailsPage.editValidation.rewards)
        }
        return missing
    }, [
        editForm?.name,
        editForm?.location,
        editForm?.startDate,
        editForm?.startTime,
        editForm?.gameSystem,
        editForm?.rewardFirst,
        editForm?.rewardSecond,
        editForm?.rewardThird,
    ])

    function enterDetailsEdit() {
        if (!t) return
        const form = buildEditForm(t)
        setEditForm(form)
        originalEditFormJsonRef.current = JSON.stringify(form)
        // Seed the map picker with the SAVED coordinates so the existing
        // location shows up as a marker right away (the picker centers and
        // zooms onto a non-null value); null only when never geocoded.
        const coords =
            t.latitude != null && t.longitude != null
                ? { lat: t.latitude, lng: t.longitude }
                : null
        setEditPickedCoords(coords)
        originalEditCoordsRef.current = coords
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
    /** Whether the open edit form has anything an accidental tab-switch or
     *  page close would silently throw away - compared against the snapshot
     *  taken when the form was opened, not against the tournament as saved. */
    function isDetailsEditDirty() {
        if (!editingDetails) return false
        if (posterFile != null || posterRemove) return true
        if (JSON.stringify(editForm) !== originalEditFormJsonRef.current) return true
        const orig = originalEditCoordsRef.current
        if ((orig?.lat ?? null) !== (editPickedCoords?.lat ?? null)) return true
        if ((orig?.lng ?? null) !== (editPickedCoords?.lng ?? null)) return true
        return false
    }
    /** Guarded entry point for every section/tab switch (sidebar, pill tab
     *  bar, "go to schedule" shortcuts). Editing details is the only tab with
     *  its own unsaved local state, so leaving it while dirty needs a
     *  confirmation instead of silently abandoning the edit "in the
     *  background" (it used to just disable the Uredi button forever). */
    function requestSectionChange(key: SectionKey) {
        if (key === section) return
        // A running demo is the demo tab's "unsaved state": leaving it
        // mid-run needs the same kind of confirmation as a dirty edit.
        // (key === section already returned, so key !== "demo" here.)
        if (section === "demo" && demoState.active) {
            setPendingDemoLeave(key)
            return
        }
        if (editingDetails) {
            if (isDetailsEditDirty()) {
                setPendingSectionLeave(key)
                return
            }
            cancelDetailsEdit()
        }
        if (key === "bracket" && section !== "bracket" && hasGroupStage) {
            resolveDrawSub()
        }
        setSection(key)
    }
    /** Closing the tab/window bypasses requestSectionChange entirely - this
     *  is the only hook point for that, hence the native (unstyleable)
     *  confirmation prompt rather than the ConfirmDialog used elsewhere. */
    useEffect(() => {
        function handleBeforeUnload(e: BeforeUnloadEvent) {
            if (!isDetailsEditDirty()) return
            e.preventDefault()
            e.returnValue = ""
        }
        window.addEventListener("beforeunload", handleBeforeUnload)
        return () => window.removeEventListener("beforeunload", handleBeforeUnload)
    }, [editingDetails, editForm, editPickedCoords, posterFile, posterRemove])
    async function saveDetailsEdit() {
        if (!uuid || !editForm) return
        if (editMissingRequired.length > 0) {
            showError(
                t18n.pages.tournamentDetailsPage.editValidation.missingFieldsTitle,
                editMissingRequired.join(", "),
            )
            return
        }
        // Past start dates are allowed on edit too (backfilling past events).
        try {
            setSavingDetails(true)
            // Send the map pin only when the user actually re-pinned (it
            // differs from the stored coords) - editPickedCoords is pre-filled
            // from the tournament on edit-open, and echoing that back would
            // win server-side and block re-geocoding of an edited location
            // text. A real pin wins even when the text is unchanged.
            const pin =
                editPickedCoords != null &&
                (editPickedCoords.lat !== t?.latitude || editPickedCoords.lng !== t?.longitude)
                    ? editPickedCoords
                    : null
            let updated = await updateTournament(uuid, {
                ...editFormToPayload(editForm),
                ...(pin ? { latitude: pin.lat, longitude: pin.lng } : {}),
            })
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
                t18n.pages.tournamentDetailsPage.editValidation.saveErrorTitle,
                String(e?.response?.data ?? e?.message ?? t18n.pages.tournamentDetailsPage.editValidation.saveErrorFallback),
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
            showError(
                t18n.pages.tournamentDetailsPage.teams.invalidNameTitle,
                t18n.pages.tournamentDetailsPage.teams.invalidNameMessage,
            )
            return null
        }
        const defaultName = t18n.pages.tournamentDetailsPage.teams.defaultName(teams.length + 1)
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
            showError(
                t18n.pages.tournamentDetailsPage.teams.invalidNameTitle,
                t18n.pages.tournamentDetailsPage.teams.invalidNameMessage,
            )
            return
        }
        savingTeamsRef.current = true
        try {
            const saved = await replaceTeams(uuid, [
                ...buildTeamsPayload(),
                ...names.map((name) => ({ name, isEliminated: false })),
            ])
            setTeams(saved)
            showSuccess(
                t18n.pages.tournamentDetailsPage.teams.bulkImportSuccessTitle,
                t18n.pages.tournamentDetailsPage.teams.bulkImportSuccessMessage(names.length),
            )
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

    /**
     * Confirm handler of the delete dialog. One endpoint, two outcomes:
     * a platform admin's confirm finalizes immediately (`finalized: true`,
     * navigate away - the tournament 404s from now on), while an organizer's
     * only files the request (tournament archived, admin must confirm) so we
     * stay on the page and re-pull the details to show the pending banner.
     */
    async function confirmDeleteTournament(reason: string) {
        if (!uuid) return
        const dt = t18n.tournamentSection.dialogs.deleteTournament
        try {
            setDeletingTournament(true)
            const { finalized } = await requestTournamentDeletion(uuid, reason)
            setDeleteDialogOpen(false)
            if (finalized) {
                showSuccess(dt.deletedToastTitle, dt.deletedToastMessage)
                navigate("/turniri")
            } else {
                showSuccess(dt.requestedToastTitle, dt.requestedToastMessage)
                refreshTournamentDetails()
            }
        } catch (e: any) {
            if (e?.response?.status === 409) {
                showError(dt.errorTitle, dt.alreadyRequested)
            } else {
                showError(
                    dt.errorTitle,
                    String(e?.response?.data ?? e?.message ?? ""),
                )
            }
        } finally {
            setDeletingTournament(false)
        }
    }

    // Single-flight guard for the team-list bulk save.
    const savingTeamsRef = useRef(false)

    /* The Zapisnik console pins a scoreboard of its own, and it has to land
       directly UNDER whatever this page already pins - the NavBar plus (below
       lg) the sticky title/tab bar. That bar's height is not a constant: the
       title wraps to a second row for long names, and it is display:none from
       lg up. So it's measured instead of guessed; a hidden element reports 0,
       which correctly leaves just the NavBar. */
    const stickyBarRef = useRef<HTMLDivElement | null>(null)
    const [stickyBarH, setStickyBarH] = useState(0)
    useEffect(() => {
        const el = stickyBarRef.current
        if (!el) return
        setStickyBarH(el.offsetHeight)
        if (typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver(() => setStickyBarH(el.offsetHeight))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    // NavBar heights, same numbers the bar above uses for its own `top`.
    const consoleStickyTop = {
        base: `calc(52px + ${stickyBarH}px)`,
        md: `calc(56px + ${stickyBarH}px)`,
    }

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
                // Error toast already surfaced by the axios interceptor (e.g.
                // 409 on a duplicate name). Re-pull the persisted list so the
                // optimistic (possibly duplicate) rename doesn't linger in
                // local state as if it had saved.
                try {
                    setTeams(await fetchTournamentTeams(uuid))
                } catch {
                    /* best effort - keep the optimistic state if this also fails */
                }
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
                t18n.pages.tournamentDetailsPage.teams.approveErrorTitle,
                String(err?.response?.data ?? err?.message ?? t18n.pages.tournamentDetailsPage.teams.approveErrorFallback),
            )
        }
    }

    async function submitSelfRegister() {
        if (!uuid) return
        const name = selfRegName.trim()
        if (!name) {
            setSelfRegError(t18n.pages.tournamentDetailsPage.selfRegister.emptyName)
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
                setSelfRegError(t18n.pages.tournamentDetailsPage.selfRegister.alreadyStarted)
            } else if (code === "ALREADY_REGISTERED") {
                setSelfRegError(t18n.pages.tournamentDetailsPage.selfRegister.alreadyRegistered)
            } else {
                setSelfRegError(data ?? e?.message ?? t18n.pages.tournamentDetailsPage.selfRegister.genericError)
            }
        } finally {
            setSelfRegSubmitting(false)
        }
    }

    function onSelfRegisterClick() {
        // Not signed in - straight to the full form rather than to /prijava.
        // Sending a club contact to a sign-up screen is precisely what makes
        // them give up; the form works without an account and the entry lands
        // pending either way.
        if (!user) {
            setFullRegOpen(true)
            return
        }
        setSelfRegOpen(true)
    }

    /* ──────────────────────────────────────────────────────────────────────
       Render
       ────────────────────────────────────────────────────────────────────── */
    // Top-level section nav.
    const sections: Array<{ key: SectionKey; label: string }> = [
        // "Demo" - organizer/admin only.
        ...(canEdit ? [{ key: "demo" as SectionKey, label: t18n.pages.tournamentDetailsPage.sections.demo }] : []),
        { key: "details", label: t18n.pages.tournamentDetailsPage.sections.details },
        // "Zapisnik" - organizer/admin only: run whatever match is on now.
        ...(canEdit ? [{ key: "live" as SectionKey, label: t18n.pages.tournamentDetailsPage.sections.live }] : []),
        { key: "teams", label: t18n.pages.tournamentDetailsPage.sections.teams },
        { key: "bracket", label: t18n.pages.tournamentDetailsPage.sections.bracket },
        { key: "raspored", label: t18n.pages.tournamentDetailsPage.sections.schedule },
        { key: "stats", label: t18n.pages.tournamentDetailsPage.sections.stats },
    ]

    const shareUrl = typeof window !== "undefined" ? window.location.href : ""

    if (loading) {
        return (
            <Flex direction="column" align="center" justify="center" gap="3" py="20">
                <Spinner size="lg" color="pitch.500" />
                <Text fontSize="sm" color="fg.muted">{t18n.common.loading}</Text>
            </Flex>
        )
    }

    if (!t) {
        // Friendly branded panel instead of the raw axios error string
        // ("Request failed with status code 404") - this is what a visitor
        // sees when opening a link to a deleted tournament or a dead slug.
        return (
            <NotFoundView
                title={t18n.pages.tournamentDetailsPage.notFound.title}
                description={t18n.pages.tournamentDetailsPage.notFound.description}
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
        ? t18n.tournamentSection.parts.statusStarted
        : t.status === "FINISHED"
            ? t18n.tournamentSection.parts.statusFinished
            : null

    /** Share the tournament page - the native share sheet where available,
     *  clipboard fallback elsewhere. Used by both the mobile header actions
     *  and the desktop sidebar. */
    const shareTournament = async () => {
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
            showSuccess(
                t18n.pages.tournamentDetailsPage.copyLinkTitle,
                t18n.pages.tournamentDetailsPage.copyLinkMessage,
            )
        } catch {
            window.prompt(t18n.tournamentSection.parts.shareCopyPrompt, shareUrl)
        }
    }

    /** Open the fullscreen "Turnir mode" display in a new tab. */
    const openTournamentMode = () =>
        window.open(`/turniri/${t.slug ?? t.uuid}/fullscreen`, "_blank", "noopener")

    // "Uredi" only appears on the Detalji tab - otherwise it would open the
    // edit form (which lives in the details view) "in the background" while
    // another tab is showing.
    // `finishedLocked`, NOT a raw status check: the finish lock is meant for
    // organizers only, so an admin must keep the "Uredi" entry point on a
    // FINISHED tournament - that's the whole point of "administrator otključava".
    const showEditAction =
        canEdit && !finishedLocked && !editingDetails && section === "details"

    // Steps the mobile title font down for long names so the whole name still
    // fits the 2-row clamp in the narrow (~55%) title column of the compact
    // bar instead of being cut off with an ellipsis.
    const nameLen = t.name.length

    /** Mobile overflow menu - the four round action buttons (uredi, podijeli,
     *  turnir mode, obavijesti) used to occupy a whole row of their own under
     *  the title. They are rarely tapped, so they now collapse into this one
     *  "⋯" trigger and the row disappears. Desktop keeps the icon toolbar in
     *  the sidebar. */
    const overflowMenu = (
        <Menu.Root positioning={{ placement: "bottom-end" }}>
            <Menu.Trigger asChild>
                <IconButton
                    aria-label={t18n.pages.tournamentDetailsPage.moreOptionsAria}
                    title={t18n.pages.tournamentDetailsPage.moreOptionsAria}
                    size="sm"
                    variant="outline"
                    rounded="full"
                    flexShrink={0}
                >
                    <FiMoreHorizontal size={17} />
                </IconButton>
            </Menu.Trigger>
            {/* Portalled (like every other menu in the app): the positioner
                would otherwise stay inside the sticky bar, which is its own
                stacking / containing context - the popup then never gets its
                computed offset and lands on top of the title. */}
            <Portal>
                <Menu.Positioner>
                    <Menu.Content
                        minW="210px"
                        rounded="lg"
                        borderWidth="1px"
                        borderColor="border"
                        bg="bg.panel"
                        shadow="lg"
                        py="1"
                    >
                        {showEditAction && (
                            <Menu.Item value="edit" onSelect={enterDetailsEdit}>
                                <FiEdit2 size={15} /> {t18n.common.edit}
                            </Menu.Item>
                        )}
                        <Menu.Item value="share" onSelect={shareTournament}>
                            <FiShare2 size={15} /> {t18n.common.share}
                        </Menu.Item>
                        <Menu.Item value="fullscreen" onSelect={openTournamentMode}>
                            <FiMaximize2 size={15} /> {t18n.pages.tournamentDetailsPage.fullscreenModeLabel}
                        </Menu.Item>
                        <TournamentNotificationBell uuid={t.uuid} asMenuItem />
                        {/* Mobile entry point of the two-step deletion - the
                            desktop sidebar carries the labeled Obriši button. */}
                        {canEdit && (!isAdmin ? !t.archivedAt : true) && (
                            <Menu.Item value="delete" onSelect={() => setDeleteDialogOpen(true)}>
                                <FiTrash2 size={15} /> {t18n.common.delete}
                            </Menu.Item>
                        )}
                    </Menu.Content>
                </Menu.Positioner>
            </Portal>
        </Menu.Root>
    )

    /** Compact Grupe / Eliminacija sub-tab pills for the Ždrijeb section.
     *  Passed into GroupsTab / BracketTab via the `subTabs` prop so they
     *  render it inline next to their own action rows - on both mobile and
     *  desktop - instead of a separate full-width bar above the content. */
    const drawSubPills = (
        <HStack
            gap="1"
            p="1"
            bg="bg.muted"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            w="max-content"
        >
            {([
                { key: "grupe" as DrawSubKey, label: t18n.pages.tournamentDetailsPage.drawGroupsLabel },
                { key: "eliminacija" as DrawSubKey, label: t18n.pages.tournamentDetailsPage.drawKnockoutLabel },
            ]).map((s) => {
                const active = drawSub === s.key
                return (
                    <Button
                        key={s.key}
                        size="sm"
                        variant={active ? "solid" : "ghost"}
                        colorPalette={active ? "brand" : "gray"}
                        rounded="md"
                        onClick={() => setDrawSub(s.key)}
                    >
                        {s.label}
                    </Button>
                )
            })}
        </HStack>
    )

    const sectionLabels = sections.map((s) => s.label) as Array<typeof sections[number]["label"]>
    const activeLabel = sections.find((s) => s.key === section)?.label ?? t18n.pages.tournamentDetailsPage.sections.details

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
                        {t18n.pages.tournamentDetailsPage.hiddenNotice}
                    </Text>
                </HStack>
            )}
            {/* Pending-deletion banner - the tournament is archived (dropped
                from public listings) and awaits the platform admin's confirm.
                Shown to the organizer/admin only; a visitor with a direct link
                just sees the normal page. */}
            {canEdit && !!t.archivedAt && (
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
                    <Text fontSize="16px" lineHeight="1">🗑️</Text>
                    <Text fontSize="sm" color="fg.soft" fontWeight={600}>
                        {t18n.pages.tournamentDetailsPage.deleteRequestedNotice}
                    </Text>
                </HStack>
            )}
            {/* ── Mobile / tablet shell (base → lg): ONE compact sticky bar.
                Row 1 = title (up to 2 rows, font steps down by length so the
                full name shows) + status chip + "⋯" overflow menu; row 2 = the
                pill tab bar. Everything the old header spread over three bands
                (big title / chip / four round action buttons / tabs) now fits
                in ~100px, and it stays pinned under the NavBar for the whole
                page so switching tabs never needs a scroll back up. No back
                button - the bottom nav and browser back cover that.

                Sticky lives on THIS box, whose parent is the page-tall outer
                VStack; a sticky child INSIDE it would unpin the moment this
                short box scrolled past (same trap as the desktop sidebar).
                Hidden on lg+, where the sidebar carries all of it. */}
            <Box
                ref={stickyBarRef}
                display={{ base: "block", lg: "none" }}
                position="sticky"
                // Right under the sticky NavBar: 53px in its mobile layout,
                // 57px from md up where it switches to the desktop grid. The
                // 1px tuck hides sub-pixel gaps that let content peek through.
                top={{ base: "52px", md: "56px" }}
                zIndex={100}
                bg="bg.canvas"
                // The Container's top padding (py 5 base / 7 md) used to sit
                // ABOVE this bar, so cards scrolled visibly through that white
                // strip until the bar reached its sticky offset - a flicker on
                // every scroll start. The negative margin pulls the bar's
                // painted white up to the NavBar's bottom edge and the enlarged
                // padding puts the title back exactly where it was, so the
                // whole white band is sticky from scroll 0 and nothing ever
                // slides through it. Skipped for hidden tournaments, where the
                // 🔒 banner occupies the space above.
                mt={t.hidden ? undefined : { base: "-20px", md: "-28px" }}
                pt={t.hidden ? "2" : { base: "28px", md: "36px" }}
                pb="1"
            >
                <Flex align="center" gap="2.5" mb="2">
                    <Heading
                        as="h1"
                        flex="1"
                        minW="0"
                        fontFamily="heading"
                        fontSize={
                            nameLen > 52
                                ? { base: "14px", md: "17px" }
                                : nameLen > 38
                                    ? { base: "15px", md: "19px" }
                                    : nameLen > 24
                                        ? { base: "17px", md: "21px" }
                                        : { base: "19px", md: "23px" }
                        }
                        fontWeight={800}
                        letterSpacing="-0.02em"
                        lineHeight={1.2}
                        color="fg.ink"
                        lineClamp={2}
                    >
                        {t.name}
                    </Heading>
                    {statusKind && statusLabel ? (
                        <Box flexShrink={0}>
                            <StatusChip status={statusKind} label={statusLabel} size="md" />
                        </Box>
                    ) : null}
                    {overflowMenu}
                </Flex>

                <PillTabBar
                    tabs={sectionLabels}
                    active={activeLabel}
                    onChange={(label) => {
                        const next = sections.find((s) => s.label === label)
                        if (next) requestSectionChange(next.key)
                    }}
                    hint={
                        section === "demo" && demoState.highlightTab
                            ? sections.find((x) => x.key === demoState.highlightTab)?.label
                            : undefined
                    }
                    padding="4px"
                    mb="0"
                />
            </Box>

            {/* ── Desktop shell (lg+): FIXED sidebar left, content right. ── */}
            <Flex align="flex-start" gap={{ base: "0", lg: "5" }}>
                {/* Flow placeholder - reserves the 230px column in the layout;
                    the actual sidebar inside is position:FIXED (not sticky!) so
                    it can NEVER move with the page scroll. Sticky proved
                    un-pinnable here: it is bound by its parent's bottom edge,
                    and on short tabs (Zapisnik, Detalji) that boundary dragged
                    the column for most of the scroll range. Fixed is bound only
                    by the viewport. With left/right auto a fixed box keeps its
                    static horizontal position, so it stays exactly in this
                    reserved column and re-centres with the Container on resize. */}
                <Box w="230px" flexShrink={0} display={{ base: "none", lg: "block" }}>
                <Flex
                    direction="column"
                    w="230px"
                    position="fixed"
                    // Aligned with the CONTENT column's resting top edge: sticky
                    // NavBar (~57px) + the app Container's md py (28px) = 85px.
                    // Since the column is fixed it sits here permanently - level
                    // with the first card of every tab at scroll 0, and simply
                    // staying put while the content scrolls past.
                    top="85px"
                    // Viewport-bound height; anything taller (menu + live card +
                    // a results card with all the individual awards) scrolls
                    // INSIDE the column. The scrollbar is a slim themed sliver
                    // rather than fully hidden: hidden, there was no hint that
                    // the tail (MVP) was even reachable. `overscrollBehavior
                    // contain` keeps a wheel gesture that reaches the column's
                    // end from spilling into the page scroll.
                    bottom="12px"
                    overflowY="auto"
                    css={{
                        scrollbarWidth: "thin",
                        scrollbarColor: "var(--chakra-colors-border-emphasized) transparent",
                        "&::-webkit-scrollbar": { width: "6px" },
                        "&::-webkit-scrollbar-track": { background: "transparent" },
                        "&::-webkit-scrollbar-thumb": {
                            background: "var(--chakra-colors-border-emphasized)",
                            borderRadius: "999px",
                        },
                        overscrollBehavior: "contain",
                    }}
                    gap="2.5"
                    pb="1"
                >
                    {/* NOTE: every card below carries flexShrink={0}. Without it
                        flexbox SHRINKS the children to fit the fixed column
                        instead of overflowing it - the results card got squashed,
                        its tail (najbolji strijelac / MVP) was clipped, and since
                        nothing overflowed there was nothing to scroll either. */}
                    {/* Menu card - the primary nav panel: title, status chip,
                        live-stream shortcut, section nav and the actions toolbar.
                        The fixed / scroll props live on the wrapper above; this
                        keeps the chrome. The live-match and results cards are
                        SIBLINGS below, outside this box. */}
                    <Flex
                        direction="column"
                        flexShrink={0}
                        bg="bg.panel"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="2xl"
                        p="3"
                        gap="0.5"
                    >
                        <Text fontSize="15px" fontWeight={800} lineHeight="1.3" px="1.5" pt="1">
                            {t.name}
                        </Text>
                        {/* The status chip is hidden while a live stream is on - the
                            pulsing "Live stream" item below already signals the live
                            state, so "U tijeku" would just be a duplicate. */}
                        {statusKind && statusLabel && !streamLiveForThis ? (
                            <Flex justify="center" pt="1.5" pb="2.5">
                                <StatusChip status={statusKind} label={statusLabel} size="md" />
                            </Flex>
                        ) : (
                            <Box pb="1.5" />
                        )}
                        {/* Live-stream shortcut - only while a broadcast for THIS
                            tournament is running. A red, pulsing item pinned above
                            the sections that jumps to the public live view (same
                            destination as the home page's "Gledaj uživo"). */}
                        {streamLiveForThis && (
                            <chakra.button
                                type="button"
                                onClick={() => navigate(`/turniri/${t.slug ?? t.uuid}/uzivo`)}
                                display="flex"
                                alignItems="center"
                                gap="2.5"
                                w="full"
                                textAlign="left"
                                pl="3"
                                pr="3"
                                py="2"
                                mb="0.5"
                                rounded="lg"
                                fontSize="14px"
                                fontWeight={700}
                                bg="accent.red"
                                color="white"
                                cursor="pointer"
                                // Same expanding red-ring throb as the "U tijeku"
                                // StatusChip (livePillPulse, defined in index.html).
                                css={{ animation: "livePillPulse 1.6s ease-out infinite" }}
                                _hover={{ bg: "#b91c1c" }}
                            >
                                <Box
                                    w="8px"
                                    h="8px"
                                    rounded="full"
                                    bg="white"
                                    flexShrink={0}
                                    css={{ animation: "pitchPulse 1.6s infinite" }}
                                />
                                {t18n.pages.tournamentDetailsPage.liveStreamSidebarLabel}
                            </chakra.button>
                        )}
                        {sections.map((s) => (
                            <SidebarNavItem
                                key={s.key}
                                icon={SECTION_ICONS[s.key]}
                                label={s.label}
                                active={section === s.key}
                                hint={section === "demo" && demoState.highlightTab === s.key}
                                onClick={() => requestSectionChange(s.key)}
                            />
                        ))}
                        {/* Actions under a divider at the menu card's tail.
                            Organizer/admin (canEdit) get a FIRST row of two
                            labeled buttons - Uredi + Obriši - then everyone
                            shares the SECOND row: the icon-only toolbar
                            (share, turnir mode, notifications). Viewers see
                            only the icon row, exactly as before. */}
                        <Box borderTopWidth="1px" borderColor="border" mt="2" pt="3">
                            {canEdit && (
                                <Flex gap="2" mb="2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        flex="1"
                                        onClick={() => {
                                            // The edit form lives in the Detalji
                                            // view - jump there first, then open it.
                                            setSection("details")
                                            enterDetailsEdit()
                                        }}
                                        // Same admin carve-out as `showEditAction`
                                        // above - see the comment there.
                                        disabled={finishedLocked || editingDetails}
                                        title={
                                            finishedLocked
                                                ? t18n.pages.tournamentDetailsPage.finishedLockedNotice
                                                : t18n.common.edit
                                        }
                                    >
                                        <FiEdit2 size={15} /> {t18n.common.edit}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        colorPalette="red"
                                        flex="1"
                                        onClick={() => setDeleteDialogOpen(true)}
                                        // A pending request can't be re-filed;
                                        // the admin can still finalize from here.
                                        disabled={!isAdmin && !!t.archivedAt}
                                        title={
                                            !isAdmin && t.archivedAt
                                                ? t18n.pages.tournamentDetailsPage.deleteRequestedNotice
                                                : t18n.common.delete
                                        }
                                    >
                                        <FiTrash2 size={15} /> {t18n.common.delete}
                                    </Button>
                                </Flex>
                            )}
                            <Flex gap="1" align="center">
                                <Box flex="1" display="flex" justifyContent="center">
                                    <IconButton
                                        aria-label={t18n.common.share}
                                        title={t18n.common.share}
                                        onClick={shareTournament}
                                        size="sm"
                                        variant="outline"
                                        rounded="full"
                                    >
                                        <FiShare2 size={16} />
                                    </IconButton>
                                </Box>
                                <Box flex="1" display="flex" justifyContent="center">
                                    <IconButton
                                        aria-label={t18n.pages.tournamentDetailsPage.fullscreenModeLabel}
                                        title={t18n.pages.tournamentDetailsPage.fullscreenModeLabel}
                                        onClick={openTournamentMode}
                                        size="sm"
                                        variant="outline"
                                        rounded="full"
                                    >
                                        <FiMaximize2 size={16} />
                                    </IconButton>
                                </Box>
                                <Box flex="1" display="flex" justifyContent="center">
                                    <TournamentNotificationBell uuid={t.uuid} />
                                </Box>
                            </Flex>
                        </Box>

                    </Flex>

                    {/* Live-match overview - its OWN card BELOW the menu card
                        (outside the white box), right after the actions toolbar.
                        The mobile header still shows the full-width card up top.
                        Renders only inside the lg-only sidebar. */}
                    {liveMatches.length > 0 && (
                        <Box
                            flexShrink={0}
                            bg="bg.panel"
                            borderWidth="1px"
                            borderColor="border"
                            rounded="2xl"
                            p="2.5"
                        >
                            <ActiveMatchOverview
                                matches={liveMatches}
                                uuidOrSlug={t.slug ?? t.uuid}
                                compact
                            />
                        </Box>
                    )}

                    {/* Results card - once the tournament is over the golden podium
                        + individual awards live HERE as their OWN card under the
                        menu card (still inside the fixed column). The organizer
                        keeps the award editor + "Završi turnir" inside the compact
                        card. It carries its own golden border, so it stands alone. */}
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
                            compact
                        />
                    )}
                </Flex>
                </Box>

                <VStack flex="1" minW="0" align="stretch" gap="2">
            {/* Golden "Rezultati turnira" band - once the tournament is over:
                either explicitly FINISHED or the champion has been decided (the
                final set winnerName). MOBILE / TABLET ONLY now: on lg+ the results
                move into the sidebar as a compact card (below the nav). Here the
                full band keeps its onFinish so organizers can finish on mobile.
                Shown ONLY on the Detalji tab - repeated above every tab it ate
                a full screen of podium before the actual tab content - and in
                the COMPACT variant (slim rows like the desktop sidebar card):
                the full band's huge podium tiles filled the whole phone screen
                before any tab content appeared. */}
            <Box display={{ base: "block", lg: "none" }}>
                {section === "details" && (t.status === "FINISHED" || !!t.winnerName) && (
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
                        compact
                    />
                )}
            </Box>

            {/* Small "active match" overview - same slot as the results panel,
                shown while a game is in progress so anyone opening the
                tournament sees there's a match live right now. Tapping it opens
                that match's own live page. Mobile / tablet only: on lg+ the
                live card moves into the sidebar (a compact variant, below the
                actions toolbar) so it doesn't duplicate here. */}
            {liveMatches.length > 0 && (
                <Box display={{ base: "block", lg: "none" }}>
                    <ActiveMatchOverview matches={liveMatches} uuidOrSlug={t.slug ?? t.uuid} />
                </Box>
            )}

            {/* ===== ACTIVE SECTION ===== */}
            <Box>
                {section === "demo" && canEdit && (
                    <DemoSection format={t.format ?? null} tournamentId={t.uuid} onStateChange={setDemoState} />
                )}

                {section === "details" && (
                    <OverviewSection
                        t={t}
                        canEdit={canEdit}
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


                {section === "live" && canEdit && (
                    <LiveControlTab
                        uuid={t.uuid}
                        finishedLocked={finishedLocked}
                        standaloneHref={`/turniri/${t.slug ?? t.uuid}/zapisnik`}
                        stickyTop={consoleStickyTop}
                    />
                )}

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
                        onTeamUpdated={(updated) =>
                            setTeams((ps) =>
                                ps.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)),
                            )
                        }
                        // Only organizers see the Demo tab, so only they can be
                        // sent there.
                        onTryDemo={canEdit ? () => requestSectionChange("demo") : undefined}
                    />
                )}

                {section === "bracket" && (
                    <VStack align="stretch" gap="4">
                        {/* The Grupe / Eliminacija sub-tabs no longer live in a
                            full-width bar here - they're handed to GroupsTab /
                            BracketTab via `subTabs` (drawSubPills) so each tab
                            renders them inline next to its own action row. */}
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
                                    finishedLocked={finishedLocked}
                                    tournamentStarted={tournamentStarted}
                                    subTabs={hasGroupStage ? drawSubPills : undefined}
                                    onSelectTeam={setInfoTeamId}
                                    onGoToSchedule={() => requestSectionChange("raspored")}
                                    exportMeta={{
                                        tournamentName: t.name,
                                        organizerName: t.organizerName ?? t.createdByName ?? null,
                                        location: t.location,
                                        startAt: t.startAt,
                                        tournamentUrl: `${window.location.origin}/turniri/${t.slug ?? t.uuid}`,
                                    }}
                                />
                            ) : (
                                <BracketTab
                                    uuid={t.uuid}
                                    canEdit={canEdit}
                                    finishedLocked={finishedLocked}
                                    tournamentStarted={tournamentStarted}
                                    tournamentName={t.name}
                                    format={t.format}
                                    subTabs={hasGroupStage ? drawSubPills : undefined}
                                    onGoToSchedule={(openPlanner) => {
                                        if (openPlanner) setKnockoutTimesRequest(true)
                                        requestSectionChange("raspored")
                                    }}
                                    exportMeta={{
                                        tournamentName: t.name,
                                        organizerName: t.organizerName ?? t.createdByName ?? null,
                                        location: t.location,
                                        startAt: t.startAt,
                                        tournamentUrl: `${window.location.origin}/turniri/${t.slug ?? t.uuid}`,
                                    }}
                                />
                            )
                        })()}
                    </VStack>
                )}

                {section === "raspored" && (
                    <ScheduleTab
                        uuid={t.uuid}
                        canEdit={canEdit}
                        finishedLocked={finishedLocked}
                        tournamentName={t.name}
                        tournamentLocation={t.location}
                        tournamentSlug={t.slug}
                        focusMatchId={focusMatchId}
                        format={t.format}
                        startAt={t.startAt}
                        autoOpenKnockoutTimes={knockoutTimesRequest}
                        onAutoOpenKnockoutTimesConsumed={() => setKnockoutTimesRequest(false)}
                        exportMeta={{
                            tournamentName: t.name,
                            organizerName: t.organizerName ?? t.createdByName ?? null,
                            location: t.location,
                            startAt: t.startAt,
                            tournamentUrl: `${window.location.origin}/turniri/${t.slug ?? t.uuid}`,
                        }}
                    />
                )}

                {section === "stats" && (
                    <StatsSection
                        uuid={t.uuid}
                        canEdit={canEdit}
                        format={t.format}
                        scorerScope={t.scorerScope}
                        onTournamentChanged={(updated) => setT(updated)}
                        exportMeta={{
                            tournamentName: t.name,
                            organizerName: t.organizerName ?? t.createdByName ?? null,
                            location: t.location,
                            startAt: t.startAt,
                            tournamentUrl: `${window.location.origin}/turniri/${t.slug ?? t.uuid}`,
                        }}
                    />
                )}
            </Box>
                </VStack>
            </Flex>

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
                onOpenFull={() => {
                    setSelfRegOpen(false)
                    setSelfRegError(null)
                    setFullRegOpen(true)
                }}
            />

            {/* The full form (roster, kit, C/GK) - same component the shared
                registration link renders. Lands pending, exactly like the
                quick path above. */}
            <TeamRegistrationDialog
                open={fullRegOpen}
                uuid={uuid ?? ""}
                signedIn={!!user}
                onClose={() => setFullRegOpen(false)}
                onRegistered={() => {
                    setSelfRegName("")
                    void refreshAll()
                }}
            />

            <TeamInfoDialog
                uuid={uuid ?? ""}
                teamId={infoTeamId}
                teams={teams}
                matches={infoMatches}
                onClose={() => setInfoTeamId(null)}
                onSelectMatch={(m) => {
                    setInfoTeamId(null)
                    navigate(`/turniri/${t?.slug ?? uuid}/utakmica/${m.matchId}`)
                }}
            />


            <DeleteTournamentDialog
                open={deleteDialogOpen}
                tournamentName={t.name}
                isAdmin={isAdmin}
                deleting={deletingTournament}
                onClose={() => setDeleteDialogOpen(false)}
                onConfirm={confirmDeleteTournament}
            />

            <ConfirmDialog
                open={pendingSectionLeave != null}
                title={t18n.pages.tournamentDetailsPage.discardEditTitle}
                description={t18n.pages.tournamentDetailsPage.discardEditDescription}
                confirmLabel={t18n.pages.tournamentDetailsPage.discardEditConfirm}
                danger
                onClose={() => setPendingSectionLeave(null)}
                onConfirm={() => {
                    const next = pendingSectionLeave
                    setPendingSectionLeave(null)
                    if (!next) return
                    cancelDetailsEdit()
                    if (next === "bracket" && section !== "bracket" && hasGroupStage) {
                        resolveDrawSub()
                    }
                    setSection(next)
                }}
            />

            {/* Leaving the demo tab mid-run - same pattern as the dirty-edit
                guard above. The run really is lost: DemoSection unmounts
                with the section switch and deliberately keeps no run state,
                so the demo starts over next time (only the "already
                completed this" marker is durable). */}
            <ConfirmDialog
                open={pendingDemoLeave != null}
                title={t18n.pages.tournamentDetailsPage.demoTab.leaveConfirm.title}
                description={t18n.pages.tournamentDetailsPage.demoTab.leaveConfirm.description}
                confirmLabel={t18n.pages.tournamentDetailsPage.demoTab.leaveConfirm.confirmButton}
                cancelLabel={t18n.pages.tournamentDetailsPage.demoTab.leaveConfirm.cancelButton}
                danger
                onClose={() => setPendingDemoLeave(null)}
                onConfirm={() => {
                    const next = pendingDemoLeave
                    setPendingDemoLeave(null)
                    if (!next) return
                    setDemoState({ active: false, highlightTab: null })
                    if (next === "bracket" && section !== "bracket" && hasGroupStage) {
                        resolveDrawSub()
                    }
                    setSection(next)
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
                            t18n.pages.tournamentDetailsPage.teams.deleteErrorTitle,
                            String(err?.response?.data ?? err?.message ?? t18n.pages.tournamentDetailsPage.teams.deleteErrorFallback),
                        )
                    } finally {
                        setDeletingTeam(false)
                    }
                }}
            />
        </VStack>
    )
}
