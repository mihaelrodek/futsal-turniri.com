import { useCallback, useEffect, useMemo, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Grid,
    HStack,
    IconButton,
    Input,
    Menu,
    Portal,
    Spinner,
    Text,
    VStack,
    chakra,
} from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import {
    FiArrowLeft,
    FiCheck,
    FiChevronDown,
    FiChevronRight,
    FiEdit2,
    FiInfo,
    FiPlus,
    FiTrash2,
    FiUser,
    FiUserPlus,
    FiUsers,
} from "react-icons/fi"
import { FaTrophy } from "react-icons/fa"

import type { TournamentDetails } from "../types/tournaments"
import type { TeamShort } from "../types/teams"
import { setTeamJerseyColor, setTeamShortsColor, type TeamKit } from "../api/tournaments"
import { KitSwatch } from "../components/jersey"
import { queryClient } from "../queryClient"
import type { TeamRequest } from "../api/teamRequests"
import type { PlayerDto } from "../types/players"
import {
    createPlayer,
    deletePlayer,
    fetchPlayers,
    fetchTeamPlayerCounts,
    updatePlayer,
} from "../api/players"
import PlayerNameAutocomplete from "../components/PlayerNameAutocomplete"
import { BulkImportDialog } from "../components/BulkImportDialog"
import { EmptyState, Panel } from "../ui/primitives"
import { showError, showSuccess } from "../toaster"
import { TeamAvatar } from "./parts"

/* "Ekipe" section - team management as a master-detail.
   LEFT pane = the full list of teams (rename / approve / remove
   controls on each row, plus a "Dodaj ekipu" / "Spremi promjene" toolbar
   above the list). Clicking a team opens, on the RIGHT pane, that team's
   player roster. The right pane is players-only. On mobile the panes
   stack. Preserved: self-register dialog, partner-requests panel,
   approving pending teams, the podium editor on FINISHED. */

/** Croatian count word for a roster size: "1 igrač" / "N igrača". */
/** Metallic podium colours - same values as TournamentResults, so the trophy
 *  next to a team card matches the results card in the sidebar. */
const PODIUM_GOLD = "#f5c842"
const PODIUM_SILVER = "#c0c5cc"
const PODIUM_BRONZE = "#cd8654"

function playersWord(n: number): string {
    return n === 1 ? "igrač" : "igrača"
}

/* ── Jersey colours ─────────────────────────────────────────────────────
   Preset kit palette the organizer picks from (free-hex isn't needed -
   futsal kits come in a dozen colours). Stored as lowercase #rrggbb. */
const JERSEY_COLORS: { hex: string; label: string }[] = [
    { hex: "#f8fafc", label: "Bijela" },
    { hex: "#111827", label: "Crna" },
    { hex: "#dc2626", label: "Crvena" },
    { hex: "#7a1d2b", label: "Bordo" },
    { hex: "#f97316", label: "Narančasta" },
    { hex: "#facc15", label: "Žuta" },
    { hex: "#16a34a", label: "Zelena" },
    { hex: "#0ea5e9", label: "Svijetloplava" },
    { hex: "#2563eb", label: "Plava" },
    { hex: "#1e3a8a", label: "Tamnoplava" },
    { hex: "#7c3aed", label: "Ljubičasta" },
    { hex: "#ec4899", label: "Roza" },
    { hex: "#6b7280", label: "Siva" },
]

/** "Dres" picker - a menu of preset kit swatches. Persists immediately via
 *  its own endpoint (the teams-list save deliberately ignores the colour). */
function JerseyColorPicker({
    uuid,
    team,
    onTeamUpdated,
}: {
    uuid: string
    team: TeamShort
    onTeamUpdated: (updated: TeamShort) => void
}) {
    const [busy, setBusy] = useState(false)

    async function applyColor(kind: "jersey" | "shorts", hex: string | null) {
        if (busy) return
        setBusy(true)
        try {
            const updated = kind === "jersey"
                ? await setTeamJerseyColor(uuid, team.id, hex)
                : await setTeamShortsColor(uuid, team.id, hex)
            onTeamUpdated(updated)
            // Kit chips are cached per tournament (qk.teamColors) and read all
            // over the live UI (tijek utakmice, scorebug, rosters). Patch every
            // cached variant (a consumer may have keyed by uuid OR slug) for an
            // instant update, then invalidate so each refetches the authoritative
            // map. Prefix ["teamColors"] matches all qk.teamColors(...) queries.
            queryClient.setQueriesData<Record<string, TeamKit>>(
                { queryKey: ["teamColors"] },
                (old) => {
                    if (!old) return old
                    const id = String(team.id)
                    const prev = old[id] ?? { jersey: null, shorts: null }
                    const kit: TeamKit = { ...prev, [kind]: hex }
                    const next = { ...old }
                    // Backend omits teams with no colour at all - mirror that.
                    if (!kit.jersey && !kit.shorts) delete next[id]
                    else next[id] = kit
                    return next
                },
            )
            queryClient.invalidateQueries({ queryKey: ["teamColors"] })
        } catch {
            // Error toasted by the http interceptor.
        } finally {
            setBusy(false)
        }
    }

    return (
        <Menu.Root positioning={{ placement: "bottom-start" }} closeOnSelect={false}>
            <Menu.Trigger asChild>
                <chakra.button
                    type="button"
                    display="inline-flex"
                    alignItems="center"
                    gap="1.5"
                    px="2.5"
                    py="1"
                    rounded="full"
                    borderWidth="1px"
                    borderColor="border"
                    bg="bg.panel"
                    cursor="pointer"
                    _hover={{ borderColor: "border.emphasized" }}
                    title="Boje dresa i hlača"
                    aria-label="Boje dresa i hlača"
                    opacity={busy ? 0.6 : 1}
                >
                    {team.jerseyColor || team.shortsColor ? (
                        // Both kit colours as two adjacent, clearly bordered
                        // chips (dres + hlače) instead of the old tiny split
                        // speck. Each has an adaptive `border.emphasized` outline
                        // so white/black kits stay visible on either panel.
                        <HStack gap="1" flexShrink={0}>
                            {team.jerseyColor && (
                                <Box
                                    w="16px"
                                    h="16px"
                                    rounded="sm"
                                    bg={team.jerseyColor}
                                    borderWidth="1px"
                                    borderColor="border.emphasized"
                                    title="Dres"
                                />
                            )}
                            {team.shortsColor && (
                                <Box
                                    w="16px"
                                    h="16px"
                                    rounded="sm"
                                    bg={team.shortsColor}
                                    borderWidth="1px"
                                    borderColor="border.emphasized"
                                    title="Hlače"
                                />
                            )}
                        </HStack>
                    ) : (
                        <Box
                            w="16px"
                            h="16px"
                            rounded="sm"
                            borderWidth="1px"
                            borderStyle="dashed"
                            borderColor="border.emphasized"
                            flexShrink={0}
                        />
                    )}
                    <Text fontSize="xs" fontWeight={600} color="fg.muted">
                        Boje
                    </Text>
                    <Box color="fg.muted" display="inline-flex"><FiChevronDown size={12} /></Box>
                </chakra.button>
            </Menu.Trigger>
            <Portal>
                <Menu.Positioner>
                    <Menu.Content p="2">
                        <ColorRow
                            label="Boja dresa"
                            selected={team.jerseyColor}
                            onPick={(hex) => applyColor("jersey", hex)}
                        />
                        <Box h="2" />
                        <ColorRow
                            label="Boja hlača"
                            selected={team.shortsColor}
                            onPick={(hex) => applyColor("shorts", hex)}
                        />
                    </Menu.Content>
                </Menu.Positioner>
            </Portal>
        </Menu.Root>
    )
}

/** One labelled row of preset kit swatches (+ "Ukloni") inside the colour menu.
 *  Used twice - for the jersey (dres) and the shorts (hlače). */
function ColorRow({
    label,
    selected,
    onPick,
}: {
    label: string
    selected?: string | null
    onPick: (hex: string | null) => void
}) {
    return (
        <>
            <Text fontSize="xs" color="fg.muted" fontWeight={600} px="1" pb="1.5">
                {label}
            </Text>
            <Grid templateColumns="repeat(5, 1fr)" gap="1.5" px="1" pb="1.5">
                {JERSEY_COLORS.map((c) => (
                    <Menu.Item
                        key={c.hex}
                        // Values must be unique across the whole menu, so scope by row.
                        value={`${label}-${c.hex}`}
                        onClick={() => onPick(c.hex)}
                        p="1"
                        minW="0"
                        justifyContent="center"
                        title={c.label}
                        aria-label={c.label}
                    >
                        <Box
                            w="22px"
                            h="22px"
                            rounded="md"
                            bg={c.hex}
                            borderWidth={selected === c.hex ? "2px" : "1px"}
                            borderColor={selected === c.hex ? "brand.solid" : "blackAlpha.300"}
                        />
                    </Menu.Item>
                ))}
            </Grid>
            {selected && (
                <Menu.Item value={`${label}-none`} onClick={() => onPick(null)} fontSize="xs">
                    Ukloni
                </Menu.Item>
            )}
        </>
    )
}

type TeamsSectionProps = {
    t: TournamentDetails
    uuid: string
    teams: TeamShort[]
    teamRequests: TeamRequest[]
    canEdit: boolean
    userUid: string | null | undefined
    tournamentAlready: boolean
    /** True once the draw (groups / bracket) is generated - locks the roster
     *  so teams can no longer be added or removed. */
    drawGenerated: boolean
    teamRequestsCollapsed: boolean
    setTeamRequestsCollapsed: (fn: (v: boolean) => boolean) => void
    /** Adds a team (persists immediately via PUT) and resolves to the
     *  newly-created team so the list can open it straight into edit mode. */
    addTeam: () => Promise<TeamShort | null>
    /** Bulk-adds several teams at once (one name per pasted line). */
    onBulkAddTeams: (names: string[]) => Promise<void>
    changeTeamName: (id: number, name: string) => void
    onTeamNameBlur: (p: TeamShort) => void
    removeTeam: (id: number) => void
    requestDeleteTeam: (p: TeamShort) => void
    onApproveTeam: (p: TeamShort) => void
    openTeamInfo: (id: number) => void
    onSelfRegisterClick: () => void
    /** Merge a single refreshed team (e.g. after a jersey-colour change)
     *  into the page-level teams state. */
    onTeamUpdated: (updated: TeamShort) => void
}

export default function TeamsSection(props: TeamsSectionProps) {
    const {
        t,
        uuid,
        teams,
        teamRequests,
        canEdit,
        userUid,
        tournamentAlready,
        drawGenerated,
        teamRequestsCollapsed,
        setTeamRequestsCollapsed,
        addTeam,
        onBulkAddTeams,
        changeTeamName,
        onTeamNameBlur,
        removeTeam,
        requestDeleteTeam,
        onApproveTeam,
        openTeamInfo,
        onSelfRegisterClick,
        onTeamUpdated,
    } = props

    const [bulkTeamsOpen, setBulkTeamsOpen] = useState(false)

    const tournamentLocked = t?.status === "FINISHED"
    const activeTeams = teams.filter((p) => !p.isEliminated)
    const eliminatedTeams = teams.filter((p) => p.isEliminated)

    // Podium derivation (FINISHED tournaments only)
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase()
    const winnerName = t?.winnerName ?? null
    const secondName = t?.secondPlaceName ?? null
    const thirdName = t?.thirdPlaceName ?? null
    const findByName = (n: string | null) =>
        n ? teams.find((p) => norm(p.name) === norm(n)) ?? null : null
    const winnerTeam = t?.status === "FINISHED" ? findByName(winnerName) : null
    const secondTeam = t?.status === "FINISHED" ? findByName(secondName) : null
    const thirdTeam = t?.status === "FINISHED" ? findByName(thirdName) : null
    const podiumIds = new Set<number>(
        [winnerTeam, secondTeam, thirdTeam]
            .filter((p): p is TeamShort => !!p && typeof p.id === "number")
            .map((p) => p.id as number),
    )
    const displayActiveTeams: TeamShort[] = [
        ...(winnerTeam ? [winnerTeam] : []),
        ...(secondTeam && secondTeam.id !== winnerTeam?.id ? [secondTeam] : []),
        ...(thirdTeam && thirdTeam.id !== winnerTeam?.id && thirdTeam.id !== secondTeam?.id ? [thirdTeam] : []),
        ...activeTeams.filter((p) => !podiumIds.has(p.id as number)),
    ]
    const displayEliminatedTeams: TeamShort[] = eliminatedTeams.filter(
        (p) => !podiumIds.has(p.id as number),
    )
    const capacity = typeof t.maxTeams === "number" ? t.maxTeams : null
    const atCapacity = capacity != null && teams.length >= capacity
    const overCapacity = capacity != null && teams.length > capacity
    const userAlreadyRegistered =
        !!userUid && teams.some((p) => p.submittedByUid === userUid)
    // Self-register flow is intentionally hidden from the UI for now -
    // the backend side of "a regular user adds their own team to a
    // tournament" needs more work (rate-limit, anti-spam, organiser
    // approval flow). All the client-side wiring (dialog, presets,
    // mutations) is kept intact so we can flip this back to `true`
    // without rebuilding the flow once the backend lands.
    const showSelfRegisterButton = false

    // Organiser add-team actions (Uvezi više / Dodaj ekipu) - available only
    // while registration is still open (not started / locked / drawn). Kept in
    // one flag so the actions row below the list can be hidden wholesale.
    const canAddTeams = !tournamentLocked && !tournamentAlready && !drawGenerated && canEdit
    const showTeamActions = showSelfRegisterButton || canAddTeams

    // Master-detail selection
    const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)

    useEffect(() => {
        if (selectedTeamId == null) return
        if (!teams.some((p) => p.id === selectedTeamId)) {
            setSelectedTeamId(null)
        }
    }, [teams, selectedTeamId])

    // Roster size per team (teamId → count) for the list rows. One request.
    // Refetched when the team set changes and whenever the user returns to the
    // list (selectedTeamId → null) so it reflects roster edits made in the
    // right pane. Purely a display nice-to-have - failures are swallowed.
    const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({})
    useEffect(() => {
        let cancelled = false
        fetchTeamPlayerCounts(uuid)
            .then((c) => { if (!cancelled) setPlayerCounts(c) })
            .catch(() => { /* silent */ })
        return () => { cancelled = true }
    }, [uuid, teams.length, selectedTeamId])

    const selectedTeam = useMemo(
        () => teams.find((p) => p.id === selectedTeamId) ?? null,
        [teams, selectedTeamId],
    )

    // "Dodaj ekipu" persists immediately and then opens the new team so it's
    // ready to rename (RosterPanel mounts in edit mode before the tournament
    // starts - see its `editMode` default).
    const handleAddTeam = useCallback(async () => {
        const created = await addTeam()
        if (created && typeof created.id === "number" && created.id > 0) {
            setSelectedTeamId(created.id)
        }
    }, [addTeam])

    const openRequests = teamRequests.filter((r) => r.status === "OPEN")

    /* ---------- One team row in the LEFT list ---------- */
    function renderTeamRow(p: TeamShort, eliminated: boolean) {
        const hasServerId = typeof p.id === "number" && p.id > 0
        const isPending = !!p.pendingApproval
        const selected = p.id === selectedTeamId
        const playerCount = playerCounts[String(p.id)] ?? 0

        const isWinnerTeam =
            t?.status === "FINISHED" &&
            !!t?.winnerName &&
            !!p.name &&
            t.winnerName.trim().toLowerCase() === p.name.trim().toLowerCase()
        const isSecondPlaceTeam =
            !isWinnerTeam &&
            t?.status === "FINISHED" &&
            !!secondName &&
            !!p.name &&
            norm(p.name) === norm(secondName)
        const isThirdPlaceTeam =
            !isWinnerTeam &&
            !isSecondPlaceTeam &&
            t?.status === "FINISHED" &&
            !!thirdName &&
            !!p.name &&
            norm(p.name) === norm(thirdName)
        const isPodiumTeam = isWinnerTeam || isSecondPlaceTeam || isThirdPlaceTeam

        // Podium cards get a subtle metallic TINT rather than a *.subtle palette
        // token. yellow/gray/orange.subtle flip into muddy brown / near-black in
        // dark mode, so the gold/silver/bronze identity is lost. color-mix keeps
        // a fixed metal hue blended into whatever the panel token currently is,
        // so the tint tracks the theme (light/dark) yet stays recognisably
        // metallic. Applied via `css` below because it's a raw CSS value.
        // Selection (brand) still wins, exactly as in the original precedence.
        const podiumTint =
            isWinnerTeam ? `color-mix(in srgb, ${PODIUM_GOLD} 14%, var(--chakra-colors-bg-panel))`
            : isSecondPlaceTeam ? `color-mix(in srgb, ${PODIUM_SILVER} 14%, var(--chakra-colors-bg-panel))`
            : isThirdPlaceTeam ? `color-mix(in srgb, ${PODIUM_BRONZE} 14%, var(--chakra-colors-bg-panel))`
            : null
        const showPodiumTint = !selected && podiumTint != null

        return (
            <Box
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                    if (hasServerId) setSelectedTeamId(p.id)
                }}
                onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && hasServerId) {
                        e.preventDefault()
                        setSelectedTeamId(p.id)
                    }
                }}
                cursor={hasServerId ? "pointer" : "default"}
                borderWidth={selected || isPodiumTeam || isPending ? "2px" : "1px"}
                borderColor={
                    selected ? "brand.solid"
                    // Fixed metallic hexes, NOT palette tokens: yellow/gray/
                    // orange.solid flip into muddy brown / near-black in dark
                    // mode, erasing the podium's gold/silver/bronze identity.
                    // The constants read identically in both themes.
                    : isWinnerTeam ? PODIUM_GOLD
                    : isSecondPlaceTeam ? PODIUM_SILVER
                    : isThirdPlaceTeam ? PODIUM_BRONZE
                    : isPending ? "yellow.solid"
                    : "border"
                }
                rounded="xl"
                p="3"
                bg={
                    selected ? "brand.subtle"
                    // Podium tint comes from `css` (color-mix) below, so the
                    // token-based bg is skipped for the three podium cards.
                    : showPodiumTint ? undefined
                    : isPending ? "yellow.subtle"
                    : eliminated ? "bg.subtle"
                    : "bg.panel"
                }
                css={showPodiumTint ? { background: podiumTint } : undefined}
                opacity={!isPodiumTeam && eliminated ? 0.85 : 1}
                display="flex"
                flexDirection="column"
                gap="2"
                transition="border-color 0.12s, background 0.12s"
            >
                <HStack gap="2" align="center">
                    <TeamAvatar name={p.name} eliminated={eliminated && !isPodiumTeam} />
                    {/* Podium: the same TROPHY for all three places, in the
                        metallic gold / silver / bronze used by the results
                        card - not a medal, per design feedback. */}
                    {isWinnerTeam && (
                        <Box color={PODIUM_GOLD} flexShrink={0} title="1. mjesto">
                            <FaTrophy size={20} />
                        </Box>
                    )}
                    {isSecondPlaceTeam && (
                        <Box color={PODIUM_SILVER} flexShrink={0} title="2. mjesto">
                            <FaTrophy size={20} />
                        </Box>
                    )}
                    {isThirdPlaceTeam && (
                        <Box color={PODIUM_BRONZE} flexShrink={0} title="3. mjesto">
                            <FaTrophy size={20} />
                        </Box>
                    )}
                    <Box flex="1" minW="0">
                        {/* Team names are READ-ONLY in the master list.
                            Renaming moved into the RosterPanel under the
                            Uredi toggle so an accidental tap on the row
                            never edits a name; the row only navigates
                            into the team's detail. */}
                        <HStack gap="1.5" align="center" minW="0">
                            {/* Kit chip (dres + hlače) - "kraj svake ekipe". */}
                            <KitSwatch jersey={p.jerseyColor} shorts={p.shortsColor} />
                            <Text
                                fontSize="sm"
                                fontWeight={isPodiumTeam ? "bold" : "medium"}
                                // fg.ink for ALL places: metallic name text on a
                                // metallic tint is illegible in dark mode. The
                                // trophy icon (PODIUM_* coloured) + metal border
                                // carry the gold/silver/bronze identity instead.
                                color="fg.ink"
                                truncate
                            >
                                {p.name?.trim() ? p.name : "Bez imena"}
                            </Text>
                        </HStack>
                        {/* Roster size at a glance - hidden when a team has no
                            players yet (0 shows nothing, per request). */}
                        {playerCount > 0 && (
                            <Text fontSize="2xs" color="fg.muted" fontWeight={600} lineHeight="1.3">
                                {playerCount} {playersWord(playerCount)}
                            </Text>
                        )}
                    </Box>
                    {hasServerId && (
                        <Box color={selected ? "brand.fg" : "fg.muted"} flexShrink={0} aria-hidden>
                            <FiChevronRight />
                        </Box>
                    )}
                    <IconButton
                        aria-label="Povijest mečeva"
                        size="xs"
                        variant="ghost"
                        onClick={(e) => {
                            e.stopPropagation()
                            openTeamInfo(p.id)
                        }}
                        disabled={!hasServerId}
                        title="Povijest mečeva"
                        flexShrink={0}
                    >
                        <FiInfo />
                    </IconButton>
                </HStack>

                <Text fontSize="xs" color="fg.muted" pl="10" minH="1.25em" lineHeight="1.25em">
                    {p.submittedBySlug ? (
                        <>
                            Prijavio:{" "}
                            <RouterLink
                                to={`/profil/${p.submittedBySlug}`}
                                onClick={(e) => e.stopPropagation()}
                                style={{ color: "var(--chakra-colors-brand-fg)", fontWeight: 500 }}
                            >
                                {p.submittedByName || p.submittedBySlug}
                            </RouterLink>
                        </>
                    ) : (
                        <chakra.span aria-hidden>&nbsp;</chakra.span>
                    )}
                </Text>

                <HStack gap="2" wrap="wrap" justify="space-between" mt="auto">
                    <HStack gap="1.5" wrap="wrap">
                        {isPending && (
                            <Badge variant="solid" colorPalette="yellow">
                                Čeka odobrenje
                            </Badge>
                        )}
                        {/* Podium teams never show "Eliminiran": 2nd/3rd are
                            technically eliminated, but the badge both read
                            oddly next to a trophy and made those cards taller
                            than the winner's. */}
                        {eliminated && !isPodiumTeam && (
                            <Badge variant="subtle" colorPalette="gray">Eliminiran</Badge>
                        )}
                    </HStack>

                    <HStack gap="1.5">
                        {isPending && canEdit && (
                            <Button
                                size="xs"
                                variant="solid"
                                colorPalette="green"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onApproveTeam(p)
                                }}
                            >
                                <FiCheck /> Odobri
                            </Button>
                        )}
                        {/* Team delete also moved into the RosterPanel
                             under the Uredi toggle so it can't be
                             triggered with a stray tap on a tournament
                             that already has match data. Left list rows
                             are now strictly navigational. */}
                    </HStack>
                </HStack>
            </Box>
        )
    }

    /* ---------- The LEFT list (teams) ---------- */
    const teamListPane = (
        <VStack align="stretch" gap="4">
            {/* The team list LEADS this column - no leading actions row - so the
                first team card top-aligns with the sidebar nav and the roster
                pane (both start at the very top). The add-team actions and the
                team count sit BELOW the list instead. */}
            {teams.length === 0 ? (
                <Panel>
                    <EmptyState
                        icon={FiUser}
                        title="Još nema ekipa"
                        description={
                            canEdit
                                ? 'Dodaj prvu ekipu klikom na "Dodaj ekipu" ispod.'
                                : "Organizator još nije dodao ekipe."
                        }
                    />
                </Panel>
            ) : (
                <>
                    <Box>
                        <VStack align="stretch" gap="2">
                            {displayActiveTeams.map((p) => renderTeamRow(p, p.isEliminated))}
                        </VStack>
                    </Box>

                    {displayEliminatedTeams.length > 0 && (
                        <Box>
                            <HStack mb="2" gap="2" align="center">
                                <Text fontSize="2xs" color="fg.muted" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase">
                                    Eliminirani
                                </Text>
                                <Text fontSize="xs" color="fg.muted">({displayEliminatedTeams.length})</Text>
                            </HStack>
                            <VStack align="stretch" gap="2">
                                {displayEliminatedTeams.map((p) => renderTeamRow(p, true))}
                            </VStack>
                        </Box>
                    )}
                </>
            )}

            {/* Registration / add-team actions, right-aligned. Kept BELOW the
                list (they used to lead the column, which pushed the first team
                card down and misaligned this column against the sidebar and the
                roster pane). Hidden once registration freezes. */}
            {showTeamActions && (
                <HStack justify="flex-end" align="center" gap="2" wrap="wrap">
                    <HStack gap="2" wrap="wrap">
                        {showSelfRegisterButton && (
                            <Button
                                size="sm"
                                variant="solid"
                                colorPalette="brand"
                                onClick={onSelfRegisterClick}
                            >
                                <FiPlus />
                                {userAlreadyRegistered
                                    ? "Prijavi još jednu ekipu"
                                    : "Prijavi ekipu za turnir"}
                            </Button>
                        )}
                        {/* Once the tournament has started, registration is
                             frozen - the button is hidden entirely. Adding a
                             team persists immediately (PUT) and opens it for
                             renaming, so there's no separate "Spremi promjene". */}
                        {canAddTeams && (
                            <>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    colorPalette="brand"
                                    onClick={() => setBulkTeamsOpen(true)}
                                    disabled={atCapacity}
                                    title="Uvezi više ekipa odjednom"
                                >
                                    <FiPlus /> Uvezi više
                                </Button>
                                <Button
                                    size="sm"
                                    variant="solid"
                                    colorPalette="brand"
                                    onClick={handleAddTeam}
                                    disabled={atCapacity}
                                    title={
                                        atCapacity
                                            ? `Maksimalan broj ekipa (${capacity})`
                                            : "Dodaj novu ekipu"
                                    }
                                >
                                    <FiPlus /> Dodaj ekipu
                                </Button>
                            </>
                        )}
                    </HStack>
                </HStack>
            )}

            {/* Team count - pinned at the very bottom of the column. */}
            {teams.length > 0 && (
                <HStack justify="flex-end" gap="2" align="baseline" pt="1">
                    <Text fontSize="13px" color="fg.muted">
                        {capacity != null
                            ? `${teams.length} / ${capacity}`
                            : `${teams.length} ekipa`}
                    </Text>
                    {overCapacity && (
                        <Badge variant="subtle" colorPalette="red">
                            +{teams.length - capacity!} preko
                        </Badge>
                    )}
                </HStack>
            )}
        </VStack>
    )

    /* ---------- The RIGHT pane (roster) ---------- */
    const rosterPane = selectedTeam ? (
        <RosterPanel
            key={selectedTeam.id}
            uuid={uuid}
            team={selectedTeam}
            canEdit={canEdit}
            onTeamUpdated={onTeamUpdated}
            /* Renaming + deleting a team is only safe before any
               match using it has been played. After tournamentAlready
               flips we keep the panel read-only for those two
               actions even inside edit mode. */
            canEditTeamName={canEdit && !tournamentAlready && !tournamentLocked}
            tournamentStarted={tournamentAlready || tournamentLocked || drawGenerated}
            onBack={() => setSelectedTeamId(null)}
            onRenameTeam={(next) => changeTeamName(selectedTeam.id, next)}
            onCommitRename={() => onTeamNameBlur(selectedTeam)}
            onDeleteTeam={() => {
                if (selectedTeam.id <= 0) {
                    removeTeam(selectedTeam.id)
                    return
                }
                requestDeleteTeam(selectedTeam)
            }}
        />
    ) : (
        <Panel h="full" display="flex" alignItems="center" justifyContent="center" minH="320px">
            <EmptyState
                icon={FiUsers}
                title="Odaberi ekipu"
                description="Klikni ekipu s lijeve strane da vidiš i urediš njezin sastav igrača."
            />
        </Panel>
    )

    return (
        <VStack align="stretch" gap="5">
            {/* Bulk team import - one team name per line. */}
            <BulkImportDialog
                open={bulkTeamsOpen}
                onClose={() => setBulkTeamsOpen(false)}
                title="Uvezi ekipe"
                description="Zalijepi ekipe - jedna ekipa u svaki red. Sve iz liste dodaju se odjednom."
                placeholder={"Ekipa 1\nEkipa 2\nEkipa 3"}
                submitLabel="Uvezi ekipe"
                onSubmit={async (lines) => { await onBulkAddTeams(lines) }}
            />

            {!tournamentAlready && openRequests.length > 0 && (
                <Panel bg="brand.subtle" borderColor="brand.emphasized" p={{ base: "4", md: "5" }}>
                    <HStack justify="space-between" align="center" mb={teamRequestsCollapsed ? "0" : "3"}>
                        <HStack gap="2" align="center">
                            <Box color="brand.fg"><FiUserPlus /></Box>
                            <Text fontWeight="semibold" fontSize="sm">
                                Zahtjevi za partnera
                            </Text>
                            <Badge variant="solid" colorPalette="brand" size="sm">
                                {openRequests.length}
                            </Badge>
                        </HStack>
                        <IconButton
                            aria-label={teamRequestsCollapsed ? "Proširi" : "Sažmi"}
                            size="xs"
                            variant="ghost"
                            onClick={() => setTeamRequestsCollapsed((v) => !v)}
                        >
                            {teamRequestsCollapsed ? <FiChevronRight /> : <FiChevronDown />}
                        </IconButton>
                    </HStack>
                    {!teamRequestsCollapsed && (
                        <Box
                            display="grid"
                            gridTemplateColumns={{ base: "1fr", md: "1fr 1fr", lg: "1fr 1fr 1fr" }}
                            gap="2"
                        >
                            {openRequests.map((r) => (
                                <Box
                                    key={r.uuid}
                                    borderWidth="1px"
                                    borderColor="border"
                                    rounded="lg"
                                    bg="bg.panel"
                                    p="2.5"
                                    display="flex"
                                    flexDirection="column"
                                    gap="1"
                                >
                                    <HStack gap="2" align="center">
                                        <TeamAvatar name={r.playerName} />
                                        <Text
                                            fontWeight="semibold"
                                            fontSize="sm"
                                            flex="1"
                                            minW="0"
                                            overflow="hidden"
                                            textOverflow="ellipsis"
                                            whiteSpace="nowrap"
                                        >
                                            {r.playerName}
                                        </Text>
                                    </HStack>
                                    {r.phone && (
                                        <chakra.a
                                            href={`tel:${r.phone.replace(/\s+/g, "")}`}
                                            fontSize="xs"
                                            color="brand.fg"
                                            fontWeight="medium"
                                            display="flex"
                                            alignItems="center"
                                            gap="1.5"
                                            _hover={{ textDecoration: "underline" }}
                                        >
                                            <FiUserPlus size={11} /> {r.phone}
                                        </chakra.a>
                                    )}
                                    {r.note && (
                                        <Text fontSize="xs" color="fg.muted">
                                            {r.note}
                                        </Text>
                                    )}
                                </Box>
                            ))}
                        </Box>
                    )}
                </Panel>
            )}

            {/* Master-detail: desktop = two panes; mobile = one at a time. */}
            <Box
                display={{ base: "none", lg: "grid" }}
                gridTemplateColumns="minmax(0, 1.1fr) minmax(0, 1.4fr)"
                gap="5"
                alignItems="start"
            >
                <Box>{teamListPane}</Box>
                <Box position="sticky" top="4">{rosterPane}</Box>
            </Box>

            <Box display={{ base: "block", lg: "none" }}>
                {selectedTeam ? rosterPane : teamListPane}
            </Box>
        </VStack>
    )
}

/* RosterPanel - the RIGHT pane: a single team's player roster.
   Loads players on mount, supports add / edit / delete and "make
   captain". All destructive / mutating affordances (edit, delete,
   captain toggle, team-name rename) are hidden by default and only
   surfaced once the organiser flips into edit mode via the "Uredi"
   toggle next to "Dodaj igrača". Default reads as a clean roster
   list so a typical view doesn't look like a form. */
function RosterPanel({
    uuid,
    team,
    canEdit,
    canEditTeamName,
    tournamentStarted,
    onBack,
    onRenameTeam,
    onCommitRename,
    onDeleteTeam,
    onTeamUpdated,
}: {
    uuid: string
    team: TeamShort
    canEdit: boolean
    /** Merge a refreshed team (jersey colour, …) into the parent list. */
    onTeamUpdated: (updated: TeamShort) => void
    /** When false (tournament has started), the team-name input is
     *  hidden even inside edit mode - renaming a team mid-tournament
     *  would corrupt match-history references. */
    canEditTeamName: boolean
    /** Once the tournament has started, per-player edit / delete /
     *  captain controls are hidden by default and only surfaced after
     *  the organiser presses "Uredi". Before start the controls stay
     *  inline - there's no risk of corrupting match data yet, and
     *  rapid roster editing during signup is the expected flow. */
    tournamentStarted: boolean
    onBack: () => void
    /** Local optimistic rename - parent flushes via replaceTeams. */
    onRenameTeam: (next: string) => void
    /** Persist the current local name to the backend (replaceTeams).
     *  Fired on the rename input's blur so the user doesn't have to
     *  press a separate save button after typing. */
    onCommitRename: () => void
    /** Open the delete-team confirm dialog. The parent owns the
     *  confirmation flow (DeleteTeamDialog), this just signals intent. */
    onDeleteTeam: () => void
}) {
    // Master toggle. Two distinct gates depend on it:
    //   1. Team-name input + team-delete trash (always - these are the
    //      destructive team-level actions the user wants hidden by
    //      default no matter when).
    //   2. Per-player edit/delete/captain - ONLY when the tournament
    //      has started. Before start these stay inline because rapid
    //      roster editing is normal during signup.
    // Before the tournament starts, a selected team opens straight into edit
    // mode (rename + roster editing immediately available). Once it has
    // started/finished, it opens read-only and the organiser presses "Uredi"
    // to rename.
    const [editMode, setEditMode] = useState(!tournamentStarted)
    // Whether per-player action icons should be visible right now.
    const showPlayerActions = canEdit && (!tournamentStarted || editMode)
    const [players, setPlayers] = useState<PlayerDto[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [adding, setAdding] = useState(false)
    const [newName, setNewName] = useState("")
    const [newNumber, setNewNumber] = useState("")
    const [savingNew, setSavingNew] = useState(false)
    const [bulkOpen, setBulkOpen] = useState(false)

    const [editingId, setEditingId] = useState<number | null>(null)
    const [editName, setEditName] = useState("")
    const [editNumber, setEditNumber] = useState("")
    const [savingEdit, setSavingEdit] = useState(false)

    const [busyId, setBusyId] = useState<number | null>(null)

    const load = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const list = await fetchPlayers(uuid, team.id)
            setPlayers(list)
        } catch (e: any) {
            setError(e?.response?.data ?? e?.message ?? "Neuspješno učitavanje sastava.")
        } finally {
            setLoading(false)
        }
    }, [uuid, team.id])

    useEffect(() => {
        load()
    }, [load])

    function parseNumber(raw: string): number | null {
        const cleaned = raw.replace(/[^\d]/g, "")
        if (cleaned === "") return null
        const n = Number(cleaned)
        return Number.isFinite(n) ? n : null
    }

    async function submitNew() {
        const name = newName.trim()
        if (!name) return
        try {
            setSavingNew(true)
            const created = await createPlayer(uuid, team.id, {
                name,
                number: parseNumber(newNumber),
            })
            setPlayers((ps) => [...ps, created])
            setNewName("")
            setNewNumber("")
            setAdding(false)
        } catch {
            /* toaster surfaces the error */
        } finally {
            setSavingNew(false)
        }
    }

    /** Parse one pasted roster line: "IME PREZIME" or "IME PREZIME, 10"
     *  (the jersey number after a comma is optional). Names are uppercased
     *  to match how the roster stores them. */
    function parsePlayerLine(line: string): { name: string; number: number | null } | null {
        const ci = line.indexOf(",")
        const namePart = ci >= 0 ? line.slice(0, ci) : line
        const numPart = ci >= 0 ? line.slice(ci + 1) : ""
        const name = namePart.trim().toUpperCase()
        if (!name) return null
        return { name, number: parseNumber(numPart) }
    }

    // Bulk import: create each parsed player (silent, so it's one summary toast
    // instead of one per player). Resilient - a single failed row doesn't abort
    // the rest.
    async function submitBulkPlayers(lines: string[]) {
        const parsed = lines
            .map(parsePlayerLine)
            .filter((p): p is { name: string; number: number | null } => p != null)
        if (parsed.length === 0) return
        const created: PlayerDto[] = []
        let failed = 0
        for (const p of parsed) {
            try {
                created.push(await createPlayer(uuid, team.id, p, { silent: true }))
            } catch {
                failed++
            }
        }
        if (created.length > 0) setPlayers((ps) => [...ps, ...created])
        if (failed > 0) {
            showError("Djelomičan uvoz", `Dodano ${created.length}, neuspješno ${failed}.`)
        } else {
            showSuccess("Igrači su uvezeni.", `Dodano ${created.length} igrača.`)
        }
    }

    function startEdit(p: PlayerDto) {
        setEditingId(p.id)
        setEditName(p.name)
        setEditNumber(p.number != null ? String(p.number) : "")
    }
    function cancelEdit() {
        setEditingId(null)
        setEditName("")
        setEditNumber("")
    }
    async function submitEdit(p: PlayerDto) {
        const name = editName.trim()
        if (!name) return
        try {
            setSavingEdit(true)
            const updated = await updatePlayer(uuid, team.id, p.id, {
                name,
                number: parseNumber(editNumber),
                captain: p.captain,
            })
            setPlayers((ps) => ps.map((x) => (x.id === p.id ? updated : x)))
            cancelEdit()
        } catch {
            /* toaster surfaces the error */
        } finally {
            setSavingEdit(false)
        }
    }

    async function makeCaptain(p: PlayerDto) {
        if (p.captain) return
        try {
            setBusyId(p.id)
            const updated = await updatePlayer(uuid, team.id, p.id, {
                name: p.name,
                number: p.number,
                captain: true,
            })
            // Exactly one captain - clear the flag on everyone else locally.
            setPlayers((ps) =>
                ps.map((x) =>
                    x.id === updated.id ? updated : { ...x, captain: false },
                ),
            )
        } catch {
            /* toaster surfaces the error */
        } finally {
            setBusyId(null)
        }
    }

    async function removePlayer(p: PlayerDto) {
        if (!confirm(`Ukloniti igrača ${p.name} iz sastava?`)) return
        try {
            setBusyId(p.id)
            await deletePlayer(uuid, team.id, p.id)
            setPlayers((ps) => ps.filter((x) => x.id !== p.id))
        } catch {
            /* toaster surfaces the error */
        } finally {
            setBusyId(null)
        }
    }

    return (
        <Panel p={{ base: "4", md: "5" }}>
            <VStack align="stretch" gap="4">
                {/* Two stacked rows so the title never collides with the
                    action buttons in the now-narrower content column:
                    Row 1 is the (wrapping, never-truncated) team name with
                    the roster size beneath it; Row 2 is a wrapping button
                    row that always sits below the title. */}
                <VStack align="stretch" gap="3">
                    {/* Row 1: back button + avatar + team name + roster size. */}
                    <HStack gap="3" align="flex-start" minW="0">
                        <IconButton
                            aria-label="Natrag na ekipe"
                            size="sm"
                            variant="ghost"
                            display={{ base: "inline-flex", lg: "none" }}
                            onClick={onBack}
                        >
                            <FiArrowLeft />
                        </IconButton>
                        <TeamAvatar name={team.name} eliminated={team.isEliminated} />
                        <Box minW="0" flex="1">
                            {editMode ? (
                                /* Inline rename - surfaced whenever the
                                   organiser opens edit mode, regardless of
                                   whether the tournament has already
                                   started. (Team DELETE stays gated on
                                   `canEditTeamName` below because it's
                                   destructive - renaming just updates the
                                   display label and backend match rows
                                   keep their own denormalised name on
                                   already-played fixtures.) Blur flushes
                                   the new name via the parent's
                                   replaceTeams. */
                                <Input
                                    size="sm"
                                    variant="flushed"
                                    value={team.name ?? ""}
                                    onChange={(e) => onRenameTeam(e.target.value)}
                                    onBlur={onCommitRename}
                                    placeholder="Ime ekipe"
                                    fontWeight="semibold"
                                />
                            ) : (
                                <HStack gap="2" align="flex-start" minW="0">
                                    {/* Kit chip enlarged to a clearly legible
                                        size with an adaptive `border.emphasized`
                                        outline + rounded corners, so a white kit
                                        stays visible on the light panel and a
                                        black kit on the dark one (was a tiny
                                        speck before). */}
                                    <Box pt="0.5" flexShrink={0}>
                                        <KitSwatch
                                            jersey={team.jerseyColor}
                                            shorts={team.shortsColor}
                                            size={20}
                                            borderColor="border.emphasized"
                                            rounded="md"
                                        />
                                    </Box>
                                    {/* Full team name - wraps instead of
                                        truncating so nothing is hidden in the
                                        narrower desktop column. */}
                                    <Text fontWeight="semibold" lineHeight="short" wordBreak="break-word">
                                        {team.name || "-"}
                                    </Text>
                                </HStack>
                            )}
                            <Text fontSize="xs" color="fg.muted" mt="0.5">
                                Sastav igrača · {players.length}
                            </Text>
                        </Box>
                    </HStack>

                    {/* Row 2: wrapping action row. Colour picker, edit toggle,
                        delete (edit mode only), bulk import and add player -
                        each keeps its exact handler/appearance, just laid out
                        in a row that can wrap under the title. */}
                    {canEdit && (
                        <HStack gap="2" wrap="wrap">
                            {/* Jersey-colour picker - organizer only. Its own
                                endpoint, so it works regardless of edit mode
                                and never races the teams-list save. */}
                            <JerseyColorPicker
                                uuid={uuid}
                                team={team}
                                onTeamUpdated={onTeamUpdated}
                            />
                            {/* Uredi / Gotovo toggle. Hidden while the
                                 "add player" form is open so the action
                                 surface stays focused on confirming the
                                 new player. */}
                            {!adding && (
                                <Button
                                    size="sm"
                                    variant={editMode ? "solid" : "outline"}
                                    colorPalette={editMode ? "brand" : "gray"}
                                    onClick={() => setEditMode((v) => !v)}
                                >
                                    {editMode ? (
                                        <>
                                            <FiCheck /> Gotovo
                                        </>
                                    ) : (
                                        <>
                                            <FiEdit2 /> Uredi
                                        </>
                                    )}
                                </Button>
                            )}
                            {/* Team delete sits inside edit mode so it
                                 can't be triggered by accident. */}
                            {editMode && canEditTeamName && (
                                <IconButton
                                    aria-label="Obriši ekipu"
                                    size="sm"
                                    variant="outline"
                                    colorPalette="red"
                                    onClick={onDeleteTeam}
                                    title="Obriši ekipu"
                                >
                                    <FiTrash2 />
                                </IconButton>
                            )}
                            {!adding && (
                                <>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        colorPalette="brand"
                                        onClick={() => setBulkOpen(true)}
                                        title="Uvezi više igrača odjednom"
                                    >
                                        <FiPlus /> Uvezi više
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="solid"
                                        colorPalette="brand"
                                        onClick={() => setAdding(true)}
                                    >
                                        <FiPlus /> Dodaj igrača
                                    </Button>
                                </>
                            )}
                        </HStack>
                    )}
                </VStack>

                {/* Bulk player import - one player per line, optional ", broj". */}
                <BulkImportDialog
                    open={bulkOpen}
                    onClose={() => setBulkOpen(false)}
                    title="Uvezi igrače"
                    description={
                        "Zalijepi igrače - jedan igrač u svaki red. Iza imena i prezimena " +
                        "možeš (ali ne moraš) dodati broj dresa, odvojen zarezom."
                    }
                    placeholder={"Ivan Horvat, 7\nMarko Marić, 10\nLuka Novak"}
                    submitLabel="Uvezi igrače"
                    onSubmit={submitBulkPlayers}
                />

                {canEdit && adding && (
                    <Box
                        borderWidth="1px"
                        borderColor="brand.emphasized"
                        bg="brand.subtle"
                        rounded="xl"
                        p="3"
                    >
                        <VStack align="stretch" gap="2">
                            <HStack gap="2" wrap="wrap" align="flex-start">
                                {/* Autocomplete of existing players - picking
                                    one reuses that name so the same person's
                                    goals aggregate on the all-time scorer
                                    list. Typing a new full name adds a new
                                    player. Names are uppercased. */}
                                <PlayerNameAutocomplete
                                    value={newName}
                                    onChange={setNewName}
                                    onEnter={submitNew}
                                    autoFocus
                                />
                                <Input
                                    size="sm"
                                    w="100px"
                                    inputMode="numeric"
                                    placeholder="Broj"
                                    value={newNumber}
                                    onChange={(e) =>
                                        setNewNumber(e.target.value.replace(/[^\d]/g, ""))
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault()
                                            submitNew()
                                        }
                                    }}
                                />
                            </HStack>
                            <HStack gap="2" justify="flex-end">
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => {
                                        setAdding(false)
                                        setNewName("")
                                        setNewNumber("")
                                    }}
                                    disabled={savingNew}
                                >
                                    Odustani
                                </Button>
                                <Button
                                    size="xs"
                                    variant="solid"
                                    colorPalette="brand"
                                    onClick={submitNew}
                                    loading={savingNew}
                                    disabled={!newName.trim() || savingNew}
                                >
                                    <FiCheck /> Dodaj
                                </Button>
                            </HStack>
                        </VStack>
                    </Box>
                )}

                {loading ? (
                    <VStack gap="2" py="8" align="center">
                        <Spinner size="md" color="brand.solid" />
                        <Text fontSize="sm" color="fg.muted">Učitavanje sastava…</Text>
                    </VStack>
                ) : error ? (
                    <Box
                        borderWidth="1px"
                        borderColor="red.muted"
                        bg="red.subtle"
                        rounded="md"
                        p="3"
                    >
                        <Text fontSize="sm" color="red.fg">{error}</Text>
                        <Button size="xs" variant="outline" mt="2" onClick={load}>
                            Pokušaj ponovno
                        </Button>
                    </Box>
                ) : players.length === 0 ? (
                    <EmptyState
                        icon={FiUsers}
                        title="Sastav je prazan"
                        description={
                            canEdit
                                ? 'Dodaj prvog igrača klikom na "Dodaj igrača".'
                                : "Organizator još nije unio igrače za ovu ekipu."
                        }
                    />
                ) : (
                    <VStack align="stretch" gap="2">
                        {players.map((p) => {
                            const isEditing = editingId === p.id
                            const busy = busyId === p.id
                            if (isEditing) {
                                return (
                                    <Box
                                        key={p.id}
                                        borderWidth="1px"
                                        borderColor="brand.emphasized"
                                        bg="brand.subtle"
                                        rounded="xl"
                                        p="3"
                                    >
                                        <VStack align="stretch" gap="2">
                                            <HStack gap="2" wrap="wrap">
                                                <Input
                                                    size="sm"
                                                    autoFocus
                                                    flex="1"
                                                    minW="160px"
                                                    placeholder="Ime igrača"
                                                    value={editName}
                                                    onChange={(e) => setEditName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                            e.preventDefault()
                                                            submitEdit(p)
                                                        }
                                                    }}
                                                />
                                                <Input
                                                    size="sm"
                                                    w="100px"
                                                    inputMode="numeric"
                                                    placeholder="Broj"
                                                    value={editNumber}
                                                    onChange={(e) =>
                                                        setEditNumber(
                                                            e.target.value.replace(/[^\d]/g, ""),
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                            e.preventDefault()
                                                            submitEdit(p)
                                                        }
                                                    }}
                                                />
                                            </HStack>
                                            <HStack gap="2" justify="flex-end">
                                                <Button
                                                    size="xs"
                                                    variant="ghost"
                                                    onClick={cancelEdit}
                                                    disabled={savingEdit}
                                                >
                                                    Odustani
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    variant="solid"
                                                    colorPalette="brand"
                                                    onClick={() => submitEdit(p)}
                                                    loading={savingEdit}
                                                    disabled={!editName.trim() || savingEdit}
                                                >
                                                    <FiCheck /> Spremi
                                                </Button>
                                            </HStack>
                                        </VStack>
                                    </Box>
                                )
                            }
                            return (
                                <HStack
                                    key={p.id}
                                    borderWidth="1px"
                                    borderColor={p.captain ? "brand.emphasized" : "border"}
                                    bg={p.captain ? "brand.subtle" : "bg.panel"}
                                    rounded="xl"
                                    px="3"
                                    py="2.5"
                                    gap="3"
                                >
                                    <Box
                                        boxSize="8"
                                        rounded="lg"
                                        bg="bg.muted"
                                        color="fg.muted"
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                        fontWeight="bold"
                                        fontSize="sm"
                                        flexShrink={0}
                                    >
                                        {p.number != null ? p.number : "-"}
                                    </Box>

                                    <Text fontWeight="medium" flex="1" minW="0" truncate>
                                        {p.name}
                                    </Text>

                                    {p.captain && (
                                        <Badge variant="solid" colorPalette="brand" title="Kapetan">
                                            K
                                        </Badge>
                                    )}

                                    {/* Before the tournament starts, the
                                         action icons live inline so signup-
                                         time roster edits are quick. Once
                                         a match is played, they hide and
                                         only return after the organiser
                                         explicitly presses "Uredi" - same
                                         opt-in pattern as the team-name +
                                         team-delete affordances. */}
                                    {showPlayerActions && (
                                        <HStack gap="1" flexShrink={0}>
                                            {!p.captain && (
                                                <Button
                                                    size="2xs"
                                                    variant="outline"
                                                    onClick={() => makeCaptain(p)}
                                                    loading={busy}
                                                    title="Postavi za kapetana"
                                                >
                                                    Kapetan
                                                </Button>
                                            )}
                                            <IconButton
                                                aria-label="Uredi igrača"
                                                size="2xs"
                                                variant="ghost"
                                                onClick={() => startEdit(p)}
                                                disabled={busy}
                                                title="Uredi igrača"
                                            >
                                                <FiEdit2 />
                                            </IconButton>
                                            <IconButton
                                                aria-label="Ukloni igrača"
                                                size="2xs"
                                                variant="ghost"
                                                colorPalette="red"
                                                onClick={() => removePlayer(p)}
                                                loading={busy}
                                                title="Ukloni igrača"
                                            >
                                                <FiTrash2 />
                                            </IconButton>
                                        </HStack>
                                    )}
                                </HStack>
                            )
                        })}
                    </VStack>
                )}
            </VStack>
        </Panel>
    )
}
