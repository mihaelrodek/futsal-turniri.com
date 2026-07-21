import { useState } from "react"
import { Box, Button, Flex, HStack, Input, NativeSelect, Text, VStack } from "@chakra-ui/react"
import { FaTrophy, FaMedal, FaShieldAlt, FaStar, FaFutbol } from "react-icons/fa"
import { FiEdit2 } from "react-icons/fi"
import {
    fetchAwardSuggestions,
    fetchTournamentTeams,
    saveAwards,
    type AwardPlayerOption,
    type AwardSuggestions,
} from "../api/tournaments"
import { fetchPlayers } from "../api/players"
import type { TournamentDetails } from "../types/tournaments"
import { showError } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   TournamentResults - the golden "Rezultati turnira" panel shown below the
   tabs once a tournament is FINISHED, visible to everyone.

   Read mode (all): podium (1./2./3. mjesto) + the three individual awards
   (najbolji strijelac / MVP / najbolji vratar) as medal cards, when set.

   Edit mode (organizer/admin): pick each award from a dropdown of the
   tournament's registered players. The scorer is pre-selected to the top
   scorer; the goalkeeper hint names the recommended team (furthest run +
   fewest conceded) so the organizer knows whose keeper to pick.
   ────────────────────────────────────────────────────────────────────── */

const GOLD = "#f5c842"
const SILVER = "#c0c5cc"
const BRONZE = "#cd8654"

type PodiumSlot = { place: 1 | 2 | 3; label: string; color: string; name?: string | null }

export default function TournamentResults({
    t,
    canEdit,
    onSaved,
    onFinish,
    finishing = false,
    compact = false,
}: {
    t: TournamentDetails
    canEdit: boolean
    onSaved: (updated: TournamentDetails) => void
    /** Organizer action to mark the tournament FINISHED. Provided only when it
     *  isn't finished yet (the final has decided a champion). */
    onFinish?: () => void
    finishing?: boolean
    /** Slim sidebar variant: a read-only podium summary (winner / 2. / 3.) that
     *  still exposes the organizer's award editor + finish action. Hides the big
     *  awards grid and helper text. Default false → the full golden band. */
    compact?: boolean
}) {
    const [editing, setEditing] = useState(false)
    const [sug, setSug] = useState<AwardSuggestions | null>(null)
    /** All players of the tournament, for the award dropdowns. Loaded from the
     *  rosters (existing endpoints) so it works regardless of the suggestions. */
    const [players, setPlayers] = useState<AwardPlayerOption[]>([])
    const [scorer, setScorer] = useState("")
    const [mvp, setMvp] = useState("")
    const [gk, setGk] = useState("")
    const [saving, setSaving] = useState(false)

    const podium: PodiumSlot[] = [
        { place: 1, label: "Pobjednik", color: GOLD, name: t.winnerName },
        { place: 2, label: "2. mjesto", color: SILVER, name: t.secondPlaceName },
        { place: 3, label: "3. mjesto", color: BRONZE, name: t.thirdPlaceName },
    ]
    const shownPodium = podium.filter((p) => p.name && p.name.trim())
    const hasAwards = !!(t.bestScorerName || t.bestPlayerName || t.bestGoalkeeperName)

    // The three individual awards, same fields/icons the wide band uses below.
    // Rendered as slim rows in the compact card - each only when its name is set.
    const individualAwards: {
        key: string
        icon: typeof FaStar
        color: string
        label: string
        name?: string | null
    }[] = [
        { key: "scorer", icon: FaFutbol, color: GOLD, label: "Najbolji strijelac", name: t.bestScorerName },
        { key: "mvp", icon: FaStar, color: SILVER, label: "MVP", name: t.bestPlayerName },
        { key: "gk", icon: FaShieldAlt, color: BRONZE, label: "Najbolji vratar", name: t.bestGoalkeeperName },
    ]
    const shownAwards = individualAwards.filter((a) => a.name && a.name.trim())

    // Nothing to show and can't edit → render nothing (parent already gates on
    // FINISHED). The organizer always sees it so they can fill it in.
    if (shownPodium.length === 0 && !hasAwards && !canEdit) return null

    async function enterEdit() {
        setScorer(t.bestScorerName ?? "")
        setMvp(t.bestPlayerName ?? "")
        setGk(t.bestGoalkeeperName ?? "")
        setEditing(true)

        // Dropdown source: the tournament's rosters via the existing per-team
        // player endpoints. Independent of the awards-suggestions endpoint, so
        // the list shows even if suggestions fail / the backend is stale.
        try {
            const teams = await fetchTournamentTeams(t.uuid)
            const rosters = await Promise.all(
                teams.map((tm) =>
                    fetchPlayers(t.uuid, tm.id)
                        .then((ps) => ps.map((p) => ({ name: p.name, teamName: tm.name ?? null })))
                        .catch(() => [] as AwardPlayerOption[]),
                ),
            )
            setPlayers(rosters.flat())
        } catch {
            /* leave empty → the picker falls back to a free-text input */
        }

        // Suggestions: defaults for scorer + MVP, and the goalkeeper team hint.
        try {
            const s = await fetchAwardSuggestions(t.uuid)
            setSug(s)
            // Default each award to the suggested player, but only fill EMPTY
            // fields so a previously saved pick is never clobbered. The GK has
            // no player suggestion (only a team hint) - the organizer picks it.
            if (!t.bestScorerName && s.bestScorer?.name) setScorer(s.bestScorer.name)
            if (!t.bestPlayerName && s.bestPlayer?.name) setMvp(s.bestPlayer.name)
        } catch {
            /* suggestions are optional - silent */
        }
    }

    async function save() {
        try {
            setSaving(true)
            const updated = await saveAwards(t.uuid, {
                bestScorerName: scorer.trim() || null,
                bestPlayerName: mvp.trim() || null,
                bestGoalkeeperName: gk.trim() || null,
            })
            onSaved(updated)
            setEditing(false)
        } catch (e: any) {
            showError("Greška", String(e?.response?.data ?? e?.message ?? "Spremanje nije uspjelo."))
        } finally {
            setSaving(false)
        }
    }

    // The award-editing form (dropdowns + save/cancel). Extracted so the full
    // golden band and the compact sidebar card drive the SAME organizer flow -
    // enterEdit() flips `editing` and both render this identical picker.
    const editingForm = (
        <VStack align="stretch" gap={compact ? "3" : "4"}>
            <Text fontSize={compact ? "11px" : "sm"} color="fg.muted">
                Odaberi nagrade od prijavljenih igrača. Strijelac je predložen
                automatski; za vratara je predložena ekipa s najboljom obranom.
            </Text>

            <AwardPicker
                icon={FaFutbol}
                color={GOLD}
                label="Najbolji strijelac"
                value={scorer}
                onChange={setScorer}
                players={players}
                compact={compact}
                hint={
                    sug?.bestScorer?.name
                        ? `Prijedlog: ${sug.bestScorer.name} (${sug.bestScorer.goals} gol${sug.bestScorer.goals === 1 ? "" : "ova"})`
                        : undefined
                }
            />
            <AwardPicker
                icon={FaStar}
                color={SILVER}
                label="MVP (najbolji igrač)"
                value={mvp}
                onChange={setMvp}
                players={players}
                compact={compact}
            />
            <AwardPicker
                icon={FaShieldAlt}
                color={BRONZE}
                label="Najbolji vratar"
                value={gk}
                onChange={setGk}
                players={players}
                compact={compact}
                hint={
                    sug?.bestGoalkeeperTeam?.teamName
                        ? `Preporuka: ekipa ${sug.bestGoalkeeperTeam.teamName}` +
                          (sug.bestGoalkeeperTeam.reachedStage
                              ? ` (${sug.bestGoalkeeperTeam.reachedStage}, ${sug.bestGoalkeeperTeam.goalsConceded} primljenih)`
                              : "") +
                          " - odaberi njihovog vratara"
                        : undefined
                }
            />

            {/* Compact card: stack the actions full-width so nothing overflows
                the ~230px sidebar. The wide golden band keeps them side-by-side. */}
            {compact ? (
                <VStack align="stretch" gap="1.5">
                    <Button
                        variant="solid"
                        colorPalette="pitch"
                        size="xs"
                        w="full"
                        onClick={save}
                        loading={saving}
                    >
                        Spremi nagrade
                    </Button>
                    <Button
                        variant="ghost"
                        size="xs"
                        w="full"
                        onClick={() => setEditing(false)}
                        disabled={saving}
                    >
                        Odustani
                    </Button>
                </VStack>
            ) : (
                <HStack justify="flex-end" gap="2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(false)}
                        disabled={saving}
                    >
                        Odustani
                    </Button>
                    <Button
                        variant="solid"
                        colorPalette="pitch"
                        size="sm"
                        onClick={save}
                        loading={saving}
                    >
                        Spremi nagrade
                    </Button>
                </HStack>
            )}
        </VStack>
    )

    /* ── Compact sidebar card ──────────────────────────────────────────────
       A slim, celebratory-tinted summary that lives below the desktop nav.
       Shows only the podium (winner / 2. / 3.) as tight rows. The organizer
       keeps the SAME award editor (enterEdit → editingForm) plus, before the
       tournament is marked finished, the "Završi turnir" action - so no
       desktop functionality is lost when the full band is hidden on lg+. */
    if (compact) {
        return (
            <Box
                rounded="2xl"
                borderWidth="1px"
                overflow="hidden"
                css={{
                    borderColor: "color-mix(in srgb, #f5c842 45%, transparent)",
                    background:
                        "linear-gradient(135deg, rgba(245,200,66,0.14), rgba(245,200,66,0.03)), var(--chakra-colors-bg-panel)",
                }}
            >
                <HStack
                    gap="2"
                    px="3"
                    py="2"
                    borderBottomWidth="1px"
                    css={{ borderColor: "color-mix(in srgb, #f5c842 30%, transparent)" }}
                >
                    <Box color={GOLD}>
                        <FaTrophy size={14} />
                    </Box>
                    <Text
                        fontFamily="heading"
                        fontWeight={800}
                        fontSize="13px"
                        letterSpacing="-0.01em"
                        color="fg.ink"
                    >
                        Rezultati
                    </Text>
                </HStack>

                {editing ? (
                    <Box px="3" py="2.5">
                        {editingForm}
                    </Box>
                ) : (
                    <VStack align="stretch" gap="2" px="3" py="2.5">
                        {shownPodium.map((p) => (
                            <HStack key={p.place} gap="2.5" align="center">
                                <Flex
                                    w="28px"
                                    h="28px"
                                    rounded="full"
                                    align="center"
                                    justify="center"
                                    flexShrink={0}
                                    css={{ background: `${p.color}22` }}
                                    color={p.color}
                                >
                                    {p.place === 1 ? <FaTrophy size={14} /> : <FaMedal size={14} />}
                                </Flex>
                                <Box minW="0">
                                    <Text
                                        fontFamily="mono"
                                        fontSize="9px"
                                        fontWeight={800}
                                        letterSpacing="0.08em"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                        lineHeight="1.2"
                                    >
                                        {p.label}
                                    </Text>
                                    <Text
                                        fontSize="13px"
                                        fontWeight={700}
                                        color="fg.ink"
                                        lineClamp={2}
                                        lineHeight="1.25"
                                    >
                                        {p.name}
                                    </Text>
                                </Box>
                            </HStack>
                        ))}

                        {/* Individual awards (strijelac / MVP / vratar) below the
                            podium - same slim row treatment; each renders only when
                            its name is set. A hairline splits them from the podium. */}
                        {shownPodium.length > 0 && shownAwards.length > 0 && (
                            <Box borderTopWidth="1px" borderColor="border" my="0.5" />
                        )}
                        {shownAwards.map((a) => (
                            <HStack key={a.key} gap="2.5" align="center">
                                <Flex
                                    w="28px"
                                    h="28px"
                                    rounded="full"
                                    align="center"
                                    justify="center"
                                    flexShrink={0}
                                    css={{ background: `${a.color}22` }}
                                    color={a.color}
                                >
                                    <a.icon size={13} />
                                </Flex>
                                <Box minW="0">
                                    <Text
                                        fontFamily="mono"
                                        fontSize="9px"
                                        fontWeight={800}
                                        letterSpacing="0.08em"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                        lineHeight="1.2"
                                    >
                                        {a.label}
                                    </Text>
                                    <Text
                                        fontSize="13px"
                                        fontWeight={700}
                                        color="fg.ink"
                                        lineClamp={2}
                                        lineHeight="1.25"
                                    >
                                        {a.name}
                                    </Text>
                                </Box>
                            </HStack>
                        ))}

                        {/* Organizer actions - the ONLY way to reach the award
                            editor / finish flow on desktop now that the full band
                            is mobile-only. enterEdit() opens the same picker. */}
                        {canEdit && (
                            <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="gray"
                                justifyContent="flex-start"
                                px="1"
                                onClick={enterEdit}
                            >
                                <FiEdit2 /> {hasAwards ? "Uredi nagrade" : "Dodijeli nagrade"}
                            </Button>
                        )}
                        {onFinish && (
                            <Button
                                size="xs"
                                variant="solid"
                                colorPalette="pitch"
                                loading={finishing}
                                onClick={onFinish}
                            >
                                <FaTrophy /> Završi turnir
                            </Button>
                        )}
                    </VStack>
                )}
            </Box>
        )
    }

    return (
        <Box
            rounded="2xl"
            borderWidth="1px"
            overflow="hidden"
            css={{
                borderColor: "color-mix(in srgb, #f5c842 45%, transparent)",
                background:
                    "linear-gradient(135deg, rgba(245,200,66,0.14), rgba(245,200,66,0.03)), var(--chakra-colors-bg-panel)",
            }}
            shadow="sm"
        >
            {/* Header */}
            <Flex
                align="center"
                justify="space-between"
                gap="3"
                px={{ base: "4", md: "5" }}
                py="3"
                borderBottomWidth="1px"
                css={{ borderColor: "color-mix(in srgb, #f5c842 30%, transparent)" }}
            >
                <HStack gap="2.5">
                    <Box color={GOLD}>
                        <FaTrophy size={20} />
                    </Box>
                    <Text
                        fontFamily="heading"
                        fontWeight={800}
                        fontSize={{ base: "lg", md: "xl" }}
                        letterSpacing="-0.01em"
                        color="fg.ink"
                    >
                        Rezultati turnira
                    </Text>
                </HStack>
                {canEdit && !editing && (
                    <HStack gap="2" flexShrink={0}>
                        <Button size="xs" variant="outline" onClick={enterEdit}>
                            <FiEdit2 /> {hasAwards ? "Uredi nagrade" : "Dodijeli nagrade"}
                        </Button>
                        {/* Only before the tournament is marked finished. */}
                        {onFinish && (
                            <Button
                                size="xs"
                                variant="solid"
                                colorPalette="pitch"
                                loading={finishing}
                                onClick={onFinish}
                            >
                                <FaTrophy /> Završi turnir
                            </Button>
                        )}
                    </HStack>
                )}
            </Flex>

            <VStack align="stretch" gap="5" px={{ base: "4", md: "5" }} py="4">
                {/* Podium */}
                {shownPodium.length > 0 && (
                    <Flex gap="3" wrap="wrap">
                        {shownPodium.map((p) => (
                            <Flex
                                key={p.place}
                                align="center"
                                gap="3"
                                px="4"
                                py="3"
                                rounded="xl"
                                borderWidth="1px"
                                borderColor="border"
                                bg="bg.panel"
                                flex="1"
                                minW="200px"
                            >
                                <Flex
                                    w="44px"
                                    h="44px"
                                    rounded="full"
                                    align="center"
                                    justify="center"
                                    flexShrink={0}
                                    css={{ background: `${p.color}22` }}
                                    color={p.color}
                                >
                                    {p.place === 1 ? <FaTrophy size={20} /> : <FaMedal size={20} />}
                                </Flex>
                                <Box minW="0">
                                    <Text
                                        fontFamily="mono"
                                        fontSize="10px"
                                        fontWeight={800}
                                        letterSpacing="0.1em"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                    >
                                        {p.label}
                                    </Text>
                                    <Text fontSize="md" fontWeight={800} color="fg.ink" truncate>
                                        {p.name}
                                    </Text>
                                </Box>
                            </Flex>
                        ))}
                    </Flex>
                )}

                {/* Awards */}
                {editing ? (
                    editingForm
                ) : hasAwards ? (
                    <Flex gap="3" wrap="wrap">
                        <AwardMedal icon={FaFutbol} color={GOLD} label="Najbolji strijelac" name={t.bestScorerName} />
                        <AwardMedal icon={FaStar} color={SILVER} label="MVP" name={t.bestPlayerName} />
                        <AwardMedal icon={FaShieldAlt} color={BRONZE} label="Najbolji vratar" name={t.bestGoalkeeperName} />
                    </Flex>
                ) : (
                    canEdit && (
                        <Text fontSize="sm" color="fg.muted">
                            Nagrade još nisu dodijeljene. Klikni "Dodijeli nagrade" za prijedloge.
                        </Text>
                    )
                )}
            </VStack>
        </Box>
    )
}

/* Player dropdown grouped by team; keeps a saved-but-unlisted value selectable. */
function AwardPicker({
    icon: Icon,
    color,
    label,
    value,
    onChange,
    players,
    hint,
    compact = false,
}: {
    icon: typeof FaStar
    color: string
    label: string
    value: string
    onChange: (v: string) => void
    players: AwardPlayerOption[]
    hint?: string
    compact?: boolean
}) {
    const byTeam = new Map<string, string[]>()
    for (const p of players) {
        const team = p.teamName?.trim() || "Bez ekipe"
        if (!byTeam.has(team)) byTeam.set(team, [])
        byTeam.get(team)!.push(p.name)
    }
    const known = new Set(players.map((p) => p.name))
    return (
        <Box>
            <HStack gap="2" mb="1.5">
                <Box color={color}>
                    <Icon size={14} />
                </Box>
                <Text fontSize="sm" fontWeight={600}>
                    {label}
                </Text>
            </HStack>
            {players.length > 0 ? (
                <NativeSelect.Root size="sm" w="full">
                    <NativeSelect.Field
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                    >
                        <option value="">- odaberi igrača -</option>
                        {value && !known.has(value) && <option value={value}>{value}</option>}
                        {[...byTeam.entries()].map(([team, names]) => (
                            <optgroup key={team} label={team}>
                                {names.map((n) => (
                                    <option key={team + "|" + n} value={n}>
                                        {n}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                </NativeSelect.Root>
            ) : (
                // No rosters entered - fall back to free text so the organizer
                // can still name the award winner.
                <Input
                    size="sm"
                    w="full"
                    placeholder="Ime i prezime"
                    value={value}
                    onChange={(e) => onChange(e.target.value.toUpperCase())}
                />
            )}
            {hint && (
                <Text fontSize={compact ? "11px" : "xs"} color="fg.muted" mt="1">
                    {hint}
                </Text>
            )}
        </Box>
    )
}

function AwardMedal({
    icon: Icon,
    color,
    label,
    name,
}: {
    icon: typeof FaStar
    color: string
    label: string
    name?: string | null
}) {
    if (!name) return null
    return (
        <Flex
            align="center"
            gap="3"
            px="4"
            py="3"
            rounded="xl"
            borderWidth="1px"
            borderColor="border"
            bg="bg.panel"
            flex="1"
            minW="200px"
        >
            <Flex
                w="40px"
                h="40px"
                rounded="full"
                align="center"
                justify="center"
                flexShrink={0}
                css={{ background: `${color}22` }}
                color={color}
            >
                <Icon size={18} />
            </Flex>
            <Box minW="0">
                <Text
                    fontFamily="mono"
                    fontSize="10px"
                    fontWeight={800}
                    letterSpacing="0.1em"
                    color="fg.muted"
                >
                    {label.toUpperCase()}
                </Text>
                <Text fontSize="sm" fontWeight={700} color="fg.ink" truncate>
                    {name}
                </Text>
            </Box>
        </Flex>
    )
}
