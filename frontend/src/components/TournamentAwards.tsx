import { useState } from "react"
import { Box, Button, Flex, HStack, Input, Text, VStack } from "@chakra-ui/react"
import { FaShieldAlt, FaStar, FaFutbol } from "react-icons/fa"
import { FiEdit2 } from "react-icons/fi"
import {
    fetchAwardSuggestions,
    saveAwards,
    type AwardSuggestions,
} from "../api/tournaments"
import type { TournamentDetails } from "../types/tournaments"
import { SectionCard } from "../ui/pitch"
import { showError } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   TournamentAwards - individual end-of-tournament awards.

   Read mode (everyone): shows the three awards (best goalkeeper / player /
   scorer) as medal cards, when set.

   Edit mode (organizer/admin): three name inputs pre-filled from either the
   saved value or a data-driven suggestion (top scorer, strongest-defence
   team hint). The organizer can accept or override each, then save.

   Only meaningful once a tournament is FINISHED, but we let the organizer
   set them any time after results exist.
   ────────────────────────────────────────────────────────────────────── */

type AwardKey = "goalkeeper" | "player" | "scorer"

const AWARD_META: Record<
    AwardKey,
    { label: string; icon: typeof FaStar; color: string }
> = {
    scorer: { label: "Najbolji strijelac", icon: FaFutbol, color: "#f5c842" },
    player: { label: "Najbolji igrač", icon: FaStar, color: "#c0c5cc" },
    goalkeeper: { label: "Najbolji vratar", icon: FaShieldAlt, color: "#cd8654" },
}

export default function TournamentAwards({
    t,
    canEdit,
    onSaved,
}: {
    t: TournamentDetails
    canEdit: boolean
    onSaved: (updated: TournamentDetails) => void
}) {
    const [editing, setEditing] = useState(false)
    const [suggestions, setSuggestions] = useState<AwardSuggestions | null>(null)
    const [gk, setGk] = useState("")
    const [player, setPlayer] = useState("")
    const [scorer, setScorer] = useState("")
    const [saving, setSaving] = useState(false)

    const hasAny = !!(t.bestGoalkeeperName || t.bestPlayerName || t.bestScorerName)

    // Visible to everyone only when something is set; visible to the
    // organizer always (so they can fill it in).
    if (!hasAny && !canEdit) return null

    async function enterEdit() {
        // Seed inputs from saved values first.
        setGk(t.bestGoalkeeperName ?? "")
        setPlayer(t.bestPlayerName ?? "")
        setScorer(t.bestScorerName ?? "")
        setEditing(true)
        // Then pull suggestions; only auto-fill empty fields so we never
        // clobber a value the organizer already saved.
        try {
            const s = await fetchAwardSuggestions(t.uuid)
            setSuggestions(s)
            if (!t.bestScorerName && s.bestScorer?.name) setScorer(s.bestScorer.name)
            if (!t.bestPlayerName && s.bestPlayer?.name) setPlayer(s.bestPlayer.name)
            // GK has no player suggestion - leave the input, show the team hint.
        } catch {
            /* suggestions are optional - silent */
        }
    }

    async function save() {
        try {
            setSaving(true)
            const updated = await saveAwards(t.uuid, {
                bestGoalkeeperName: gk.trim() || null,
                bestPlayerName: player.trim() || null,
                bestScorerName: scorer.trim() || null,
            })
            onSaved(updated)
            setEditing(false)
        } catch (e: any) {
            showError("Greška", String(e?.response?.data ?? e?.message ?? "Spremanje nije uspjelo."))
        } finally {
            setSaving(false)
        }
    }

    if (editing) {
        return (
            <SectionCard icon={<FaStar />} title="Nagrade - pojedinačne">
                <VStack align="stretch" gap="4">
                    <Text fontSize="sm" color="fg.muted">
                        Prijedlozi su izračunati iz rezultata. Možeš ih prihvatiti ili
                        ručno izmijeniti. Imena se spremaju velikim slovima.
                    </Text>

                    <AwardField
                        meta={AWARD_META.scorer}
                        value={scorer}
                        onChange={setScorer}
                        hint={
                            suggestions?.bestScorer?.name
                                ? `Prijedlog: ${suggestions.bestScorer.name} (${suggestions.bestScorer.goals} gol${suggestions.bestScorer.goals === 1 ? "" : "ova"})`
                                : undefined
                        }
                    />
                    <AwardField
                        meta={AWARD_META.player}
                        value={player}
                        onChange={setPlayer}
                        hint={
                            suggestions?.bestPlayer?.name
                                ? `Prijedlog: ${suggestions.bestPlayer.name}`
                                : undefined
                        }
                    />
                    <AwardField
                        meta={AWARD_META.goalkeeper}
                        value={gk}
                        onChange={setGk}
                        hint={
                            suggestions?.bestGoalkeeperTeam?.teamName
                                ? `Najbolja obrana: ${suggestions.bestGoalkeeperTeam.teamName} (${suggestions.bestGoalkeeperTeam.goalsConceded} primljenih) - upiši vratara`
                                : undefined
                        }
                    />

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
                </VStack>
            </SectionCard>
        )
    }

    return (
        <SectionCard
            icon={<FaStar />}
            title="Nagrade"
            action={
                canEdit ? (
                    <Button size="xs" variant="outline" onClick={enterEdit}>
                        <FiEdit2 /> {hasAny ? "Uredi" : "Dodijeli"}
                    </Button>
                ) : undefined
            }
        >
            {hasAny ? (
                <Flex gap="3" wrap="wrap">
                    <AwardMedal meta={AWARD_META.scorer} name={t.bestScorerName} />
                    <AwardMedal meta={AWARD_META.player} name={t.bestPlayerName} />
                    <AwardMedal meta={AWARD_META.goalkeeper} name={t.bestGoalkeeperName} />
                </Flex>
            ) : (
                <Text fontSize="sm" color="fg.muted">
                    Nagrade još nisu dodijeljene. Klikni "Dodijeli" za prijedloge.
                </Text>
            )}
        </SectionCard>
    )
}

function AwardField({
    meta,
    value,
    onChange,
    hint,
}: {
    meta: { label: string; icon: typeof FaStar; color: string }
    value: string
    onChange: (v: string) => void
    hint?: string
}) {
    const Icon = meta.icon
    return (
        <Box>
            <HStack gap="2" mb="1.5">
                <Box color={meta.color}>
                    <Icon size={14} />
                </Box>
                <Text fontSize="sm" fontWeight={600}>
                    {meta.label}
                </Text>
            </HStack>
            <Input
                size="sm"
                placeholder="Ime i prezime"
                value={value}
                onChange={(e) => onChange(e.target.value.toUpperCase())}
            />
            {hint && (
                <Text fontSize="xs" color="fg.muted" mt="1">
                    {hint}
                </Text>
            )}
        </Box>
    )
}

function AwardMedal({
    meta,
    name,
}: {
    meta: { label: string; icon: typeof FaStar; color: string }
    name?: string | null
}) {
    if (!name) return null
    const Icon = meta.icon
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
                css={{ background: `${meta.color}22` }}
                color={meta.color}
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
                    {meta.label.toUpperCase()}
                </Text>
                <Text fontSize="sm" fontWeight={700} color="fg.ink" truncate>
                    {name}
                </Text>
            </Box>
        </Flex>
    )
}
