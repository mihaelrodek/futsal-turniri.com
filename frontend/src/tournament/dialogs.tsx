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
    Textarea,
    VStack,
    chakra,
} from "@chakra-ui/react"
import { FiEdit3, FiX } from "react-icons/fi"

import type { TeamShort } from "../types/teams"
import type { UserTeamPreset } from "../api/userTeamPresets"
import type { ScheduledMatch } from "../types/schedule"
import type { PlayerDto } from "../types/players"
import { fetchPlayers } from "../api/players"
import { isAxiosError } from "axios"
import TeamRegistrationForm from "../components/TeamRegistrationForm"
import {
    registerTeamAsUser,
    submitPublicRegistration,
    type TeamRegistrationInput,
} from "../api/teamRegistration"
import { fetchScorers } from "../api/stats"
import { useTranslation } from "../i18n"
import { TeamAvatar } from "./parts"

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
    onOpenFull,
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
    /** Opens the full registration form (roster, kit, C/GK). Omit to hide the
     *  switch entirely. */
    onOpenFull?: () => void
}) {
    const t = useTranslation()
    return (
        <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) onClose() }}>
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="md">
                    <Dialog.Header py="3" px="4" borderBottomWidth="1px" borderColor="border">
                        <Heading size="sm">{t.tournamentSection.dialogs.selfRegister.title}</Heading>
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
                                            {t.tournamentSection.dialogs.selfRegister.savedTeamsLabel}
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
                                    {t.tournamentSection.dialogs.selfRegister.teamNameLabel}
                                </Text>
                                <Input
                                    autoFocus
                                    placeholder={t.tournamentSection.dialogs.selfRegister.teamNamePlaceholder}
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
                                {t.tournamentSection.dialogs.selfRegister.pendingNoticePrefix}{" "}
                                <chakra.b color="yellow.fg">{t.tournamentSection.dialogs.selfRegister.pendingNoticeHighlight}</chakra.b>{" "}
                                {t.tournamentSection.dialogs.selfRegister.pendingNoticeSuffix}
                            </Text>

                            {/* The quick path above is a name and nothing else,
                                which is the right default - most people sign up
                                first and fill the squad in later. This is the
                                door to the same form the shared link opens. */}
                            {onOpenFull && (
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    colorPalette="pitch"
                                    alignSelf="flex-start"
                                    disabled={submitting}
                                    onClick={onOpenFull}
                                >
                                    <FiEdit3 /> {t.tournamentSection.dialogs.selfRegister.fullFormAction}
                                </Button>
                            )}

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
                                {t.common.cancel}
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette="brand"
                                loading={submitting}
                                disabled={!name.trim() || submitting}
                                onClick={onSubmit}
                            >
                                {t.tournamentSection.dialogs.selfRegister.submit}
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
    /** Open a match details page from a history row. */
    onSelectMatch?: (m: ScheduledMatch) => void
}) {
    const t = useTranslation()
    const teamInfoT = t.tournamentSection.dialogs.teamInfo
    /** Knockout stage → label for the match-history rows. */
    const STAGE_LABEL: Record<string, string> = {
        ROUND_OF_32: teamInfoT.stageLabels.ROUND_OF_32,
        ROUND_OF_16: teamInfoT.stageLabels.ROUND_OF_16,
        QUARTERFINAL: teamInfoT.stageLabels.QUARTERFINAL,
        SEMIFINAL: teamInfoT.stageLabels.SEMIFINAL,
        FINAL: teamInfoT.stageLabels.FINAL,
        THIRD_PLACE: teamInfoT.stageLabels.THIRD_PLACE,
    }
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
                                    myPen != null && oppPen != null ? teamInfoT.penScore(myPen, oppPen) : null
                                const stageLabel =
                                    m.stage === "GROUP"
                                        ? m.groupName ? teamInfoT.stageLabels.groupNamed(m.groupName) : teamInfoT.stageLabels.group
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
                                            <Text fontSize="xs" color="fg.muted">{teamInfoT.matchHistorySubtitle}</Text>
                                        </Box>
                                        <IconButton
                                            aria-label={t.common.close}
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
                                            {teamInfoT.playersLabel}
                                        </Text>
                                        {playersLoading ? (
                                            <Text fontSize="sm" color="fg.muted">{t.common.loading}</Text>
                                        ) : players.length === 0 ? (
                                            <Text fontSize="sm" color="fg.muted">{teamInfoT.noPlayers}</Text>
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
                                                                {p.goalkeeper ? (
                                                                    <Text as="span" fontSize="2xs" color="fg.muted" ml="1.5">
                                                                        (GK)
                                                                    </Text>
                                                                ) : null}
                                                                {p.captain ? (
                                                                    <Text as="span" fontSize="2xs" color="fg.muted" ml="1.5">
                                                                        (C)
                                                                    </Text>
                                                                ) : null}
                                                            </Text>
                                                            <HStack gap="1" flexShrink={0} align="baseline">
                                                                <Text fontSize="sm" fontWeight="semibold">{goals}</Text>
                                                                <Text fontSize="xs" color="fg.muted">{teamInfoT.golLabel(goals)}</Text>
                                                            </HStack>
                                                        </HStack>
                                                    ))}
                                            </VStack>
                                        )}
                                    </Box>

                                    {/* Stat summary */}
                                    <HStack gap="6" mb="4" wrap="wrap">
                                        <Box>
                                            <Text fontSize="xs" color="fg.muted">{teamInfoT.statPlayed}</Text>
                                            <Text fontSize="xl" fontWeight="semibold">{finishedReal.length}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontSize="xs" color="fg.muted">{teamInfoT.statWins}</Text>
                                            <Text fontSize="xl" fontWeight="semibold" color="green.fg">{wins}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontSize="xs" color="fg.muted">{teamInfoT.statDraws}</Text>
                                            <Text fontSize="xl" fontWeight="semibold" color="fg.muted">{draws}</Text>
                                        </Box>
                                        <Box>
                                            <Text fontSize="xs" color="fg.muted">{teamInfoT.statLosses}</Text>
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
                                                {teamInfoT.noMatchesYet}
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
                                                    title={!x.isBye && onSelectMatch ? teamInfoT.showMatchTitle : undefined}
                                                    transition="border-color 0.12s, background 0.12s"
                                                    _hover={
                                                        !x.isBye && onSelectMatch
                                                            ? { borderColor: "brand.solid" }
                                                            : undefined
                                                    }
                                                >
                                                    <Box
                                                        display="grid"
                                                        gridTemplateColumns={{
                                                            base: "112px minmax(0, 1fr) auto 44px",
                                                            sm: "124px minmax(0, 1fr) auto 50px",
                                                        }}
                                                        alignItems="center"
                                                        gap={{ base: "2", sm: "2.5" }}
                                                    >
                                                        <Badge
                                                            variant="solid"
                                                            colorPalette="gray"
                                                            size="sm"
                                                            w="full"
                                                            justifyContent="center"
                                                            overflow="hidden"
                                                        >
                                                            <Text as="span" truncate>
                                                                {x.stageLabel}
                                                            </Text>
                                                        </Badge>
                                                        <Text
                                                            fontWeight="medium"
                                                            overflow="hidden"
                                                            textOverflow="ellipsis"
                                                            whiteSpace="nowrap"
                                                            minW="0"
                                                        >
                                                            {x.isBye ? teamInfoT.byeLabel : `vs ${x.opponentName ?? "-"}`}
                                                        </Text>
                                                        <Box textAlign="center" minW={{ base: "42px", sm: "52px" }}>
                                                            {!x.isBye && (x.isFinished || x.isLive) ? (
                                                                <>
                                                                    <Text fontWeight="semibold" fontSize="sm" lineHeight="1.1" whiteSpace="nowrap">
                                                                        {x.myScore ?? "-"} : {x.oppScore ?? "-"}
                                                                    </Text>
                                                                    {x.penInfo ? (
                                                                        <Text fontSize="2xs" color="fg.muted" fontWeight="semibold" lineHeight="1.1" mt="0.5" whiteSpace="nowrap">
                                                                            {x.penInfo}
                                                                        </Text>
                                                                    ) : null}
                                                                </>
                                                            ) : (
                                                                <Text fontWeight="semibold" fontSize="sm" color="fg.muted">-</Text>
                                                            )}
                                                        </Box>
                                                        {/* Compact, fixed-width status keeps every row aligned:
                                                            W/L/D for finished matches, with short labels for the
                                                            non-result states. */}
                                                        {(() => {
                                                            const badge = x.isBye
                                                                ? { label: "BYE", palette: "brand" }
                                                                : x.isLive
                                                                    ? { label: "LIVE", palette: "yellow" }
                                                                    : !x.isFinished
                                                                        ? { label: "—", palette: "gray" }
                                                                        : x.result === "win"
                                                                            ? { label: "W", palette: "green" }
                                                                            : x.result === "loss"
                                                                                ? { label: "L", palette: "red" }
                                                                                : { label: "D", palette: "gray" }
                                                            return (
                                                                <Badge
                                                                    variant="solid"
                                                                    colorPalette={badge.palette}
                                                                    size="sm"
                                                                    w="full"
                                                                    minH="28px"
                                                                    justifyContent="center"
                                                                    flexShrink={0}
                                                                >
                                                                    {badge.label}
                                                                </Badge>
                                                            )
                                                        })()}
                                                    </Box>
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
/* ---------- Delete-tournament request (two-step delete) ----------
   Deletion is a REQUEST, not a direct delete: the organizer gives a
   mandatory reason, the tournament is archived (drops out of public
   listings) and a platform admin must confirm the final deletion. For
   platform admins the same dialog finalizes immediately - they ARE the
   confirming authority - so the copy and the confirm label switch. */
export function DeleteTournamentDialog({
    open,
    tournamentName,
    isAdmin,
    deleting,
    onClose,
    onConfirm,
}: {
    open: boolean
    tournamentName?: string | null
    /** Platform admin (role `admin`) - their confirm finalizes immediately. */
    isAdmin: boolean
    deleting: boolean
    onClose: () => void
    /** Called with the trimmed, non-empty reason. */
    onConfirm: (reason: string) => void
}) {
    const t = useTranslation()
    const dt = t.tournamentSection.dialogs.deleteTournament
    const [reason, setReason] = useState("")
    // Fresh textarea on every open - a cancelled attempt's reason must not
    // linger into the next one.
    useEffect(() => {
        if (open) setReason("")
    }, [open])
    const trimmed = reason.trim()
    return (
        <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open && !deleting) onClose() }}>
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="md">
                    <Dialog.Header py="3" px="4" borderBottomWidth="1px" borderColor="border">
                        <Heading size="sm">{isAdmin ? dt.adminTitle : dt.title}</Heading>
                    </Dialog.Header>
                    <Dialog.Body py="4" px="4">
                        <VStack align="stretch" gap="3">
                            <Text fontSize="sm">
                                {dt.bodyPrefix}{" "}
                                <chakra.b>{tournamentName}</chakra.b>{" "}
                                {isAdmin ? dt.adminBody : dt.requestBody}
                            </Text>
                            <Box>
                                <Text fontSize="xs" color="fg.muted" mb="1.5" fontWeight="medium">
                                    {dt.reasonLabel}
                                </Text>
                                <Textarea
                                    autoFocus
                                    rows={3}
                                    placeholder={dt.reasonPlaceholder}
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                />
                                <Text fontSize="xs" color="fg.muted" mt="1">
                                    {dt.reasonRequired}
                                </Text>
                            </Box>
                        </VStack>
                    </Dialog.Body>
                    <Dialog.Footer>
                        <Button variant="ghost" onClick={onClose} disabled={deleting}>
                            {t.common.cancel}
                        </Button>
                        <Button
                            variant="solid"
                            colorPalette="red"
                            loading={deleting}
                            disabled={trimmed.length === 0}
                            onClick={() => onConfirm(trimmed)}
                        >
                            {isAdmin ? dt.confirmAdmin : dt.confirmRequest}
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
    const t = useTranslation()
    const dt = t.tournamentSection.dialogs.deleteTeam
    return (
        <Dialog.Root open={!!team} onOpenChange={(e) => { if (!e.open && !deleting) onClose() }}>
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="sm">
                    <Dialog.Header>{dt.title}</Dialog.Header>
                    <Dialog.Body>
                        <Text>
                            {dt.bodyPrefix}
                            {" "}<chakra.b>{team?.name}</chakra.b>
                            {" "}{dt.bodySuffix}
                        </Text>
                    </Dialog.Body>
                    <Dialog.Footer>
                        <Button variant="ghost" onClick={onClose} disabled={deleting}>
                            {dt.no}
                        </Button>
                        <Button
                            variant="solid"
                            colorPalette="red"
                            loading={deleting}
                            onClick={onConfirm}
                        >
                            {dt.confirm}
                        </Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    )
}

/* ---------- Full registration form, in a dialog ----------
   The same component the shared link renders, for a signed-in user who wants
   to enter the roster and kit straight away instead of just a name. Contact
   fields are optional here: the account is the identity.
   ────────────────────────────────────────────────────────────────────── */
export function TeamRegistrationDialog({
    open,
    uuid,
    signedIn,
    onClose,
    onRegistered,
}: {
    open: boolean
    uuid: string
    /** Drives BOTH the endpoint and whether the contact fields are required.
     *  A signed-in submission carries an account the organizer can reach;
     *  an anonymous one has to leave a phone or e-mail behind. */
    signedIn: boolean
    onClose: () => void
    /** Called after a successful submit so the caller can refresh the team
     *  list - the new team shows up there as pending. */
    onRegistered: (teamName: string) => void
}) {
    const t = useTranslation()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(payload: TeamRegistrationInput) {
        if (busy) return
        setError(null)
        try {
            setBusy(true)
            const res = signedIn
                ? await registerTeamAsUser(uuid, payload)
                : await submitPublicRegistration(uuid, payload)
            onRegistered(res.teamName)
            onClose()
        } catch (err) {
            const errors = t.pages.teamRegistration.errors
            const code = isAxiosError(err) && typeof err.response?.data === "string"
                ? err.response.data
                : null
            setError(code && code in errors ? errors[code as keyof typeof errors] : errors.generic)
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open) onClose() }}>
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="2xl">
                    <Dialog.Header py="3" px="4" borderBottomWidth="1px" borderColor="border">
                        <Heading size="sm">{t.tournamentSection.dialogs.selfRegister.fullFormTitle}</Heading>
                    </Dialog.Header>
                    <Dialog.Body py="4" px="4" maxH="70vh" overflowY="auto">
                        <TeamRegistrationForm
                            // Mandatory even for a signed-in submitter: the
                            // organizer needs a phone/e-mail they can act on
                            // without first digging through a profile page.
                            requireContact
                            busy={busy}
                            errorText={error}
                            submitLabel={t.tournamentSection.dialogs.selfRegister.submit}
                            onSubmit={submit}
                        />
                    </Dialog.Body>
                    <Dialog.Footer py="3" px="4" borderTopWidth="1px" borderColor="border">
                        <Button variant="ghost" onClick={onClose} disabled={busy}>
                            {t.common.cancel}
                        </Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    )
}
