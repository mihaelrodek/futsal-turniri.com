import { useEffect, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Dialog,
    Heading,
    HStack,
    IconButton,
    Input,
    Text,
    VStack,
    chakra,
} from "@chakra-ui/react"
import { FiAward, FiCheckCircle, FiX } from "react-icons/fi"

import type { TeamShort } from "../types/teams"
import type { UserTeamPreset } from "../api/userTeamPresets"
import type { ScheduledMatch } from "../types/schedule"
import type { PlayerDto } from "../types/players"
import { fetchPlayers } from "../api/players"
import { fetchScorers } from "../api/stats"
import { TeamAvatar } from "./parts"

/** Knockout stage → Croatian label for the match-history rows. */
const STAGE_LABEL: Record<string, string> = {
    ROUND_OF_32: "1/16 finala",
    ROUND_OF_16: "Osmina finala",
    QUARTERFINAL: "Četvrtfinale",
    SEMIFINAL: "Polufinale",
    FINAL: "Finale",
    THIRD_PLACE: "Za 3. mjesto",
}

/** Croatian plural for the goal-count suffix: 1 gol, 2-4 gola, else golova. */
function golLabel(n: number): string {
    const mod10 = n % 10
    const mod100 = n % 100
    if (mod10 === 1 && mod100 !== 11) return "gol"
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "gola"
    return "golova"
}

/* ──────────────────────────────────────────────────────────────────────────
   Tournament detail - dialogs.

   The modals used by the redesigned tournament page: the self-register
   team dialog, the per-team match-history dialog, and the
   delete-tournament + delete-team confirms.
   ────────────────────────────────────────────────────────────────────── */

/* ---------- Self-register team dialog ---------- */
export function SelfRegisterDialog({
    open,
    onClose,
    presets,
    teams,
    userUid,
    name,
    onNameChange,
    error,
    submitting,
    onSubmit,
}: {
    open: boolean
    onClose: () => void
    presets: UserTeamPreset[]
    teams: TeamShort[]
    userUid: string | null | undefined
    name: string
    onNameChange: (v: string) => void
    error: string | null
    submitting: boolean
    onSubmit: () => void
}) {
    return (
        <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) onClose() }}>
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="md">
                    <Dialog.Header py="3" px="4" borderBottomWidth="1px" borderColor="border">
                        <Heading size="sm">Prijavi ekipu za turnir</Heading>
                    </Dialog.Header>
                    <Dialog.Body py="4" px="4">
                        <VStack align="stretch" gap="3">
                            {(() => {
                                // Hide presets the current user has already submitted to
                                // *this* tournament (case-insensitive).
                                const alreadyRegisteredNames = new Set(
                                    teams
                                        .filter((p) => userUid && p.submittedByUid === userUid)
                                        .map((p) => p.name?.trim().toLowerCase())
                                        .filter(Boolean) as string[],
                                )
                                const available = presets.filter(
                                    (p) => !alreadyRegisteredNames.has(p.name.trim().toLowerCase()),
                                )
                                if (available.length === 0) return null
                                return (
                                    <Box>
                                        <Text fontSize="xs" color="fg.muted" mb="1.5" fontWeight="medium">
                                            Tvoje spremljene ekipe
                                        </Text>
                                        <HStack gap="1.5" wrap="wrap">
                                            {available.map((p) => (
                                                <Button
                                                    key={p.uuid}
                                                    size="xs"
                                                    variant={name === p.name ? "solid" : "outline"}
                                                    colorPalette={name === p.name ? "brand" : "gray"}
                                                    onClick={() => onNameChange(p.name)}
                                                >
                                                    {p.name}
                                                </Button>
                                            ))}
                                        </HStack>
                                    </Box>
                                )
                            })()}

                            <Box>
                                <Text fontSize="xs" color="fg.muted" mb="1.5" fontWeight="medium">
                                    Ime ekipe
                                </Text>
                                <Input
                                    autoFocus
                                    placeholder="npr. Marko & Pero"
                                    value={name}
                                    onChange={(e) => onNameChange(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault()
                                            onSubmit()
                                        }
                                    }}
                                />
                            </Box>

                            <Text fontSize="xs" color="fg.muted">
                                Ekipa će biti označena <chakra.b color="yellow.fg">žuto</chakra.b> dok je organizator ne potvrdi.
                            </Text>

                            {error && (
                                <Box borderWidth="1px" borderColor="red.muted" bg="red.subtle" rounded="md" p="2">
                                    <Text fontSize="sm" color="red.fg">{error}</Text>
                                </Box>
                            )}
                        </VStack>
                    </Dialog.Body>
                    <Dialog.Footer py="3" px="4" borderTopWidth="1px" borderColor="border">
                        <HStack justify="flex-end" gap="2">
                            <Button variant="ghost" onClick={onClose} disabled={submitting}>
                                Odustani
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette="brand"
                                loading={submitting}
                                disabled={!name.trim() || submitting}
                                onClick={onSubmit}
                            >
                                Prijavi se
                            </Button>
                        </HStack>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    )
}

/* ---------- Team info / match-history dialog ---------- */
export function TeamInfoDialog({
    uuid,
    teamId,
    teams,
    matches,
    onClose,
    onSelectMatch,
}: {
    /** Tournament uuid - needed to lazily load the roster + scorer tallies. */
    uuid: string
    teamId: number | null
    teams: TeamShort[]
    /** Every match of the tournament (group + knockout), in play order. */
    matches: ScheduledMatch[]
    onClose: () => void
    /** Open a match (its timeline modal) from a history row. */
    onSelectMatch?: (m: ScheduledMatch) => void
}) {
    // Roster + per-player goal tallies for the "Igrači" section. Fetched
    // lazily: only while a team is open (teamId !== null). Reset on close so
    // reopening another team never flashes the previous roster.
    const [players, setPlayers] = useState<PlayerDto[]>([])
    const [goalsByPlayerId, setGoalsByPlayerId] = useState<Record<number, number>>({})
    const [playersLoading, setPlayersLoading] = useState(false)

    useEffect(() => {
        if (teamId === null) {
            setPlayers([])
            setGoalsByPlayerId({})
            setPlayersLoading(false)
            return
        }
        if (!uuid) return
        let cancelled = false
        setPlayersLoading(true)
        Promise.all([fetchPlayers(uuid, teamId), fetchScorers(uuid)])
            .then(([roster, scorers]) => {
                if (cancelled) return
                setPlayers(roster)
                // playerId → full-tournament goal tally (groups + knockout).
                const byId: Record<number, number> = {}
                for (const s of scorers) byId[s.playerId] = s.goalsAll
                setGoalsByPlayerId(byId)
            })
            .catch(() => {
                if (cancelled) return
                setPlayers([])
                setGoalsByPlayerId({})
            })
            .finally(() => {
                if (!cancelled) setPlayersLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [uuid, teamId])

    return (
        <Dialog.Root open={teamId !== null} onOpenChange={(e) => { if (!e.open) onClose() }}>
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="md">
                    {(() => {
                        const team = teams.find((p) => p.id === teamId)
                        if (!team) return null

                        type Played = {
                            key: number
                            raw: ScheduledMatch
                            stageLabel: string
                            opponentName: string | null
                            myScore: number | null
                            oppScore: number | null
                            penInfo: string | null
                            isFinished: boolean
                            isLive: boolean
                            isBye: boolean
                            result: "win" | "loss" | "draw" | null
                        }

                        const played: Played[] = matches
                            .filter((m) => m.team1Id === team.id || m.team2Id === team.id)
                            .map((m) => {
                                const meIs1 = m.team1Id === team.id
                                const oppId = meIs1 ? m.team2Id : m.team1Id
                                const oppName = meIs1 ? m.team2Name : m.team1Name
                                const myScore = meIs1 ? m.score1 : m.score2
                                const oppScore = meIs1 ? m.score2 : m.score1
                                const myPen = meIs1 ? m.penalties1 : m.penalties2
                                const oppPen = meIs1 ? m.penalties2 : m.penalties1
                                const isFinished = m.status === "FINISHED"
                                const isLive = m.status === "LIVE"
                                const isBye = oppId == null
                                let result: "win" | "loss" | "draw" | null = null
                                if (isFinished && !isBye) {
                                    if (m.winnerTeamId != null) {
                                        result = m.winnerTeamId === team.id ? "win" : "loss"
                                    } else if (myScore != null && oppScore != null) {
                                        result = myScore > oppScore ? "win" : myScore < oppScore ? "loss" : "draw"
                                    }
                                }
                                const penInfo =
                                    myPen != null && oppPen != null ? `(${myPen}:${oppPen} pen)` : null
                                const stageLabel =
                                    m.stage === "GROUP"
                                        ? m.groupName ? `Grupa ${m.groupName}` : "Grupa"
                                        : STAGE_LABEL[m.stage] ?? m.stage
                                return {
                                    key: m.matchId,
                                    raw: m,
                                    stageLabel,
                                    opponentName: oppName,
                                    myScore,
                                    oppScore,
                                    penInfo,
                                    isFinished,
                                    isLive,
                                    isBye,
                                    result,
                                }
                            })

                        const finishedReal = played.filter((x) => x.isFinished && !x.isBye)
                        const wins = finishedReal.filter((x) => x.result === "win").length
                        const draws = finishedReal.filter((x) => x.result === "draw").length
                        const losses = finishedReal.filter((x) => x.result === "loss").length

                        return (
                            <>
                                <Dialog.Header py="3" px="4" borderBottomWidth="1px" borderColor="border">
                                    {/* `w="full"` matters: Dialog.Header is itself a
                                        flex container, so without it this HStack
                                        shrinks to its content width and the close
                                        button ends up mid-header instead of pinned
                                        to the top-right corner. `ml="auto"` on the
                                        button is the belt-and-braces. */}
                                    <HStack gap="3" align="center" w="full">
                                        <TeamAvatar name={team.name} eliminated={team.isEliminated} />
                                        <Box flex="1" minW="0">
                                            <Text fontWeight="semibold" lineHeight="short">{team.name || "-"}</Text>
                                            <Text fontSize="xs" color="fg.muted">Povijest mečeva</Text>
                                        </Box>
                                        <IconButton
                                            aria-label="Zatvori"
                                            size="sm"
                                            variant="ghost"
                                            onClick={onClose}
                                            ml="auto"
                                            flexShrink={0}
                                        >
                                            <FiX />
                                        </IconButton>
                                    </HStack>
                                </Dialog.Header>
                                <Dialog.Body py="4" px="4">
                                    {/* Igrači - roster + each player's goal tally in
                                    this tournament (full count, groups + knockout). */}
                                    <Box mb="4">
                                        <Text
                                            fontSize="2xs"
                                            fontWeight="semibold"
                                            color="fg.muted"
                                            letterSpacing="wider"
                                            textTransform="uppercase"
                                            mb="2"
                                        >
                                            Igrači
                                        </Text>
                                        {playersLoading ? (
                                            <Text fontSize="sm" color="fg.muted">Učitavanje…</Text>
                                        ) : players.length === 0 ? (
                                            <Text fontSize="sm" color="fg.muted">Nema igrača na popisu.</Text>
                                        ) : (
                                            <VStack align="stretch" gap="0.5" maxH="220px" overflowY="auto">
                                                {[...players]
                                                    .map((p) => ({ p, goals: goalsByPlayerId[p.id] ?? 0 }))
                                                    .sort(
                                                        (a, b) =>
                                                            b.goals - a.goals ||
                                                            a.p.name.localeCompare(b.p.name, "hr"),
                                                    )
                                                    .map(({ p, goals }) => (
                                                        <HStack key={p.id} gap="2.5" py="1">
                                                            <Box
                                                                w="24px"
                                                                h="24px"
                                                                rounded="md"
                                                                flexShrink={0}
                                                                display="flex"
                                                                alignItems="center"
                                                                justifyContent="center"
                                                                fontFamily="mono"
                                                                fontSize="xs"
                                                                fontWeight="semibold"
                                                                bg={p.number != null ? "bg.surfaceTint" : "transparent"}
                                                                color={p.number != null ? "fg" : "fg.muted"}
                                                                borderWidth={p.number != null ? "0" : "1px"}
                                                                borderStyle="dashed"
                                                                borderColor="border"
                                                            >
                                                                {p.number != null ? p.number : "-"}
                                                            </Box>
                                                            <Text
                                                                fontSize="sm"
                                                                fontWeight="medium"
                                                                flex="1"
                                                                minW="0"
                                                                overflow="hidden"
                                                                textOverflow="ellipsis"
                                                                whiteSpace="nowrap"
                                                            >
                                                                {p.name}
                                                                {p.captain ? (
                                                                    <Text as="span" fontSize="2xs" color="fg.muted" ml="1.5">
                                                                        (C)
                                                                    </Text>
                                                                ) : null}
                                                            </Text>
                                                            <HStack gap="1" flexShrink={0} align="baseline">
                                                                <Text fontSize="sm" fontWeight="semibold">{goals}</Text>
                                                                <Text fontSize="xs" color="fg.muted">{golLabel(goals)}</Text>
                                                            </HStack>
                                                        </HStack>
                                                    ))}
                                            </VStack>
                                        )}
                                    </Box>

                                    {/* Stat summary */}
                                    <HStack gap="6" mb="4" wrap="wrap">
                                        <Box>
                                            <Text fontSize="xs" color="fg.muted">Odigrano</Text>
                                            <Text fontSize="xl" fontWeight="semibold">{finishedReal.length}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontSize="xs" color="fg.muted">Pobjede</Text>
                                            <Text fontSize="xl" fontWeight="semibold" color="green.fg">{wins}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontSize="xs" color="fg.muted">Neriješeno</Text>
                                            <Text fontSize="xl" fontWeight="semibold" color="fg.muted">{draws}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontSize="xs" color="fg.muted">Porazi</Text>
                                            <Text fontSize="xl" fontWeight="semibold" color="red.fg">{losses}</Text>
                                        </Box>
                                    </HStack>

                                    {played.length === 0 ? (
                                        <Box
                                            borderWidth="1px"
                                            borderColor="border"
                                            borderStyle="dashed"
                                            rounded="md"
                                            py="8"
                                            px="4"
                                            textAlign="center"
                                        >
                                            <Text color="fg.muted" fontSize="sm">
                                                Ekipa još nema nijedan meč u rasporedu.
                                            </Text>
                                        </Box>
                                    ) : (
                                        <VStack align="stretch" gap="2">
                                            {played.map((x) => (
                                                <Box
                                                    key={x.key}
                                                    borderWidth="1px"
                                                    borderColor="border"
                                                    rounded="md"
                                                    p="2.5"
                                                    bg={
                                                        x.isBye
                                                            ? "brand.subtle"
                                                            : x.isLive
                                                                ? "yellow.subtle"
                                                                : !x.isFinished
                                                                    ? "bg.surfaceTint"
                                                                    : x.result === "win"
                                                                        ? "green.subtle"
                                                                        : x.result === "loss"
                                                                            ? "red.subtle"
                                                                            : "bg.surfaceTint"
                                                    }
                                                    onClick={
                                                        !x.isBye && onSelectMatch
                                                            ? () => onSelectMatch(x.raw)
                                                            : undefined
                                                    }
                                                    cursor={!x.isBye && onSelectMatch ? "pointer" : undefined}
                                                    role={!x.isBye && onSelectMatch ? "button" : undefined}
                                                    title={!x.isBye && onSelectMatch ? "Prikaži utakmicu" : undefined}
                                                    transition="border-color 0.12s, background 0.12s"
                                                    _hover={
                                                        !x.isBye && onSelectMatch
                                                            ? { borderColor: "brand.solid" }
                                                            : undefined
                                                    }
                                                >
                                                    <HStack justify="space-between" gap="2" wrap="wrap">
                                                        <HStack gap="2" minW="0" flex="1">
                                                            <Badge variant="solid" colorPalette="gray" size="sm" flexShrink={0}>
                                                                {x.stageLabel}
                                                            </Badge>
                                                            <Text
                                                                fontWeight="medium"
                                                                overflow="hidden"
                                                                textOverflow="ellipsis"
                                                                whiteSpace="nowrap"
                                                                minW="0"
                                                            >
                                                                {x.isBye ? "Slobodan prolaz" : `vs ${x.opponentName ?? "-"}`}
                                                            </Text>
                                                        </HStack>
                                                        <HStack gap="2" flexShrink={0}>
                                                            {!x.isBye && (x.isFinished || x.isLive) && (
                                                                <Text fontWeight="semibold" fontSize="sm">
                                                                    {x.myScore ?? "-"} : {x.oppScore ?? "-"}
                                                                    {x.penInfo ? (
                                                                        <Text as="span" fontSize="xs" color="fg.muted" ml="1">
                                                                            {x.penInfo}
                                                                        </Text>
                                                                    ) : null}
                                                                </Text>
                                                            )}
                                                            {/* ONE badge shape for every outcome:
                                                                a fixed min-width + centred content, so
                                                                Pobjeda / Poraz / Neriješeno / Uživo /
                                                                Zakazano / Prošao all render as
                                                                identically sized chips instead of
                                                                ragged, label-length-driven boxes. */}
                                                            {(() => {
                                                                const badge = x.isBye
                                                                    ? { label: "Prošao", palette: "brand", icon: <FiCheckCircle size={11} /> }
                                                                    : x.isLive
                                                                        ? { label: "Uživo", palette: "yellow", icon: null }
                                                                        : !x.isFinished
                                                                            ? { label: "Zakazano", palette: "gray", icon: null }
                                                                            : x.result === "win"
                                                                                ? { label: "Pobjeda", palette: "green", icon: <FiAward size={11} /> }
                                                                                : x.result === "loss"
                                                                                    ? { label: "Poraz", palette: "red", icon: null }
                                                                                    : { label: "Neriješeno", palette: "gray", icon: null }
                                                                return (
                                                                    <Badge
                                                                        variant="solid"
                                                                        colorPalette={badge.palette}
                                                                        size="sm"
                                                                        minW="104px"
                                                                        justifyContent="center"
                                                                        flexShrink={0}
                                                                    >
                                                                        <HStack gap="1" justify="center">
                                                                            {badge.icon}
                                                                            {badge.label}
                                                                        </HStack>
                                                                    </Badge>
                                                                )
                                                            })()}
                                                        </HStack>
                                                    </HStack>
                                                </Box>
                                            ))}
                                        </VStack>
                                    )}
                                </Dialog.Body>
                            </>
                        )
                    })()}
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    )
}

/* ---------- Delete-tournament confirm (admin only) ---------- */
export function DeleteTournamentDialog({
    open,
    tournamentName,
    deleting,
    onClose,
    onConfirm,
}: {
    open: boolean
    tournamentName?: string | null
    deleting: boolean
    onClose: () => void
    onConfirm: () => void
}) {
    return (
        <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open && !deleting) onClose() }}>
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="sm">
                    <Dialog.Header>Obriši turnir?</Dialog.Header>
                    <Dialog.Body>
                        <Text>
                            Obrisati turnir{" "}
                            <chakra.b>{tournamentName}</chakra.b>?
                            Turnir više neće biti vidljiv u pretrazi, na karti, kalendaru ni u
                            profilima igrača. Ova radnja se ne poništava kroz aplikaciju.
                        </Text>
                    </Dialog.Body>
                    <Dialog.Footer>
                        <Button variant="ghost" onClick={onClose} disabled={deleting}>
                            Odustani
                        </Button>
                        <Button
                            variant="solid"
                            colorPalette="red"
                            loading={deleting}
                            onClick={onConfirm}
                        >
                            Da, obriši
                        </Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    )
}

/* ---------- Delete-team confirm ---------- */
export function DeleteTeamDialog({
    team,
    deleting,
    onClose,
    onConfirm,
}: {
    team: TeamShort | null
    deleting: boolean
    onClose: () => void
    onConfirm: () => void
}) {
    return (
        <Dialog.Root open={!!team} onOpenChange={(e) => { if (!e.open && !deleting) onClose() }}>
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="sm">
                    <Dialog.Header>Ukloni ekipu?</Dialog.Header>
                    <Dialog.Body>
                        <Text>
                            Stvarno ukloniti ekipu
                            {" "}<chakra.b>{team?.name}</chakra.b>
                            {" "}iz turnira? Ova radnja se ne može poništiti.
                        </Text>
                    </Dialog.Body>
                    <Dialog.Footer>
                        <Button variant="ghost" onClick={onClose} disabled={deleting}>
                            Ne
                        </Button>
                        <Button
                            variant="solid"
                            colorPalette="red"
                            loading={deleting}
                            onClick={onConfirm}
                        >
                            Da, ukloni
                        </Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    )
}
