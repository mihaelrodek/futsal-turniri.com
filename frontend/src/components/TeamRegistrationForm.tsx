import { useState } from "react"
import {
    Box,
    Button,
    HStack,
    IconButton,
    Input,
    Stack,
    Text,
    Textarea,
    VStack,
    chakra,
} from "@chakra-ui/react"
import { FiPlus, FiTrash2 } from "react-icons/fi"

import type { RegistrationPlayerInput, TeamRegistrationInput } from "../api/teamRegistration"
import { KitSwatch } from "./jersey"
import { MonoLabel } from "../ui/pitch"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   TeamRegistrationForm - the roster a club fills in to enter a tournament.

   ONE component behind both entry points (the public link page and the
   signed-in dialog on the tournament page) so the two can never ask for
   different things. `requireContact` is the only difference: an anonymous
   submission has to leave a way back, a signed-in one already has an account
   behind it.

   Everything except the team name is optional on purpose. A club that only
   knows its name at signup time must still be able to enter - the organizer
   can fill the rest in later, and a form that refuses to submit over a missing
   shirt number is a form people give up on.
   ────────────────────────────────────────────────────────────────────── */

/** Blank roster line. Four of them are shown initially - enough to look like
 *  a roster, few enough not to look like homework. */
const EMPTY_PLAYER: RegistrationPlayerInput = {
    name: "",
    number: null,
    captain: false,
    goalkeeper: false,
}
const INITIAL_ROWS = 4
const MAX_ROWS = 40

export type TeamRegistrationFormProps = {
    /** True for the public link: contact name + phone/e-mail become mandatory. */
    requireContact: boolean
    busy?: boolean
    /** Rejected submissions come back here so the form can stay filled in. */
    errorText?: string | null
    submitLabel: string
    onSubmit: (payload: TeamRegistrationInput) => void
}

export default function TeamRegistrationForm({
    requireContact,
    busy = false,
    errorText,
    submitLabel,
    onSubmit,
}: TeamRegistrationFormProps) {
    const t = useTranslation()
    const f = t.components.teamRegistrationForm

    const [teamName, setTeamName] = useState("")
    const [jerseyColor, setJerseyColor] = useState<string | null>(null)
    const [shortsColor, setShortsColor] = useState<string | null>(null)
    const [contactName, setContactName] = useState("")
    const [contact, setContact] = useState("")
    const [note, setNote] = useState("")
    const [players, setPlayers] = useState<RegistrationPlayerInput[]>(
        () => Array.from({ length: INITIAL_ROWS }, () => ({ ...EMPTY_PLAYER })),
    )

    const namedPlayers = players.filter((p) => p.name.trim() !== "")
    const canSubmit =
        teamName.trim() !== "" &&
        (!requireContact || (contactName.trim() !== "" && contact.trim() !== "")) &&
        !busy

    function patchPlayer(index: number, patch: Partial<RegistrationPlayerInput>) {
        setPlayers((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
    }

    /** Captain is one per team, mirroring the roster editor - ticking a second
     *  one moves the mark rather than adding it. Goalkeeper is not capped: a
     *  squad may list a backup keeper. */
    function setCaptain(index: number) {
        setPlayers((prev) =>
            prev.map((p, i) => ({ ...p, captain: i === index ? !p.captain : false })),
        )
    }

    function submit() {
        if (!canSubmit) return
        onSubmit({
            teamName: teamName.trim(),
            jerseyColor,
            shortsColor,
            contactName: contactName.trim() || null,
            contact: contact.trim() || null,
            note: note.trim() || null,
            players: namedPlayers.map((p) => ({
                name: p.name.trim(),
                number: p.number ?? null,
                captain: !!p.captain,
                goalkeeper: !!p.goalkeeper,
            })),
        })
    }

    return (
        <VStack align="stretch" gap="5">
            {/* ── Team ─────────────────────────────────────────────── */}
            <Stack gap="2">
                <MonoLabel display="block">{f.teamLabel}</MonoLabel>
                <Input
                    size="sm"
                    value={teamName}
                    maxLength={200}
                    placeholder={f.teamNamePlaceholder}
                    onChange={(e) => setTeamName(e.target.value)}
                />
            </Stack>

            {/* ── Kit ──────────────────────────────────────────────── */}
            <Stack gap="2">
                <Box>
                    <MonoLabel display="block">{f.kitLabel}</MonoLabel>
                    <Text fontSize="xs" color="fg.muted" mt="0.5">{f.kitHint}</Text>
                </Box>
                <HStack gap="3" align="flex-start" wrap="wrap">
                    <KitSwatch jersey={jerseyColor} shorts={shortsColor} size={26} />
                    <Stack gap="2" flex="1" minW="220px">
                        <ColorRow
                            label={f.jerseyLabel}
                            value={jerseyColor}
                            onPick={setJerseyColor}
                            clearLabel={f.clearColor}
                        />
                        <ColorRow
                            label={f.shortsLabel}
                            value={shortsColor}
                            onPick={setShortsColor}
                            clearLabel={f.clearColor}
                        />
                    </Stack>
                </HStack>
            </Stack>

            {/* ── Roster ───────────────────────────────────────────── */}
            <Stack gap="2">
                <Box>
                    <MonoLabel display="block">{f.playersLabel}</MonoLabel>
                    <Text fontSize="xs" color="fg.muted" mt="0.5">{f.playersHint}</Text>
                </Box>

                <Stack gap="1.5">
                    {players.map((p, i) => (
                        <HStack key={i} gap="1.5" align="center">
                            <Input
                                size="sm"
                                w="64px"
                                flexShrink={0}
                                type="number"
                                inputMode="numeric"
                                placeholder={f.numberPlaceholder}
                                value={p.number ?? ""}
                                onChange={(e) => {
                                    const raw = e.target.value.trim()
                                    const n = raw === "" ? null : Number(raw)
                                    patchPlayer(i, {
                                        number: n == null || Number.isNaN(n) ? null : n,
                                    })
                                }}
                            />
                            <Input
                                size="sm"
                                flex="1"
                                minW="0"
                                maxLength={200}
                                placeholder={f.playerNamePlaceholder}
                                value={p.name}
                                onChange={(e) => patchPlayer(i, { name: e.target.value })}
                            />
                            {/* Same two marks as the roster editor, same wording. */}
                            <Button
                                size="2xs"
                                flexShrink={0}
                                variant={p.goalkeeper ? "solid" : "outline"}
                                colorPalette={p.goalkeeper ? "purple" : "gray"}
                                onClick={() => patchPlayer(i, { goalkeeper: !p.goalkeeper })}
                                title={t.teams.goalkeeper}
                            >
                                {t.teams.goalkeeperBadge}
                            </Button>
                            <Button
                                size="2xs"
                                flexShrink={0}
                                variant={p.captain ? "solid" : "outline"}
                                colorPalette={p.captain ? "brand" : "gray"}
                                onClick={() => setCaptain(i)}
                                title={t.teams.captain}
                            >
                                {t.teams.captainBadge}
                            </Button>
                            <IconButton
                                aria-label={f.removeRow}
                                title={f.removeRow}
                                size="2xs"
                                variant="ghost"
                                colorPalette="red"
                                flexShrink={0}
                                onClick={() => setPlayers((prev) => prev.filter((_, x) => x !== i))}
                            >
                                <FiTrash2 />
                            </IconButton>
                        </HStack>
                    ))}
                </Stack>

                <HStack justify="space-between" wrap="wrap" gap="2">
                    <Button
                        size="xs"
                        variant="outline"
                        colorPalette="pitch"
                        disabled={players.length >= MAX_ROWS}
                        onClick={() => setPlayers((prev) => [...prev, { ...EMPTY_PLAYER }])}
                    >
                        <FiPlus /> {f.addRow}
                    </Button>
                    <Text fontSize="xs" color="fg.muted">
                        {f.playerCount(namedPlayers.length)}
                    </Text>
                </HStack>
            </Stack>

            {/* ── Contact ──────────────────────────────────────────── */}
            <Stack gap="2">
                <Box>
                    <MonoLabel display="block">{f.contactLabel}</MonoLabel>
                    <Text fontSize="xs" color="fg.muted" mt="0.5">
                        {requireContact ? f.contactHintRequired : f.contactHintOptional}
                    </Text>
                </Box>
                <HStack gap="2" wrap={{ base: "wrap", sm: "nowrap" }}>
                    <Input
                        size="sm"
                        maxLength={200}
                        placeholder={f.contactNamePlaceholder}
                        value={contactName}
                        onChange={(e) => setContactName(e.target.value)}
                    />
                    <Input
                        size="sm"
                        maxLength={200}
                        placeholder={f.contactPlaceholder}
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                    />
                </HStack>
                <Textarea
                    size="sm"
                    rows={2}
                    maxLength={1000}
                    placeholder={f.notePlaceholder}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
            </Stack>

            {errorText && (
                <Text fontSize="sm" color="red.fg">{errorText}</Text>
            )}

            <Stack gap="2">
                <Text fontSize="xs" color="fg.muted">{f.pendingNotice}</Text>
                <Button
                    size="sm"
                    colorPalette="pitch"
                    loading={busy}
                    disabled={!canSubmit}
                    onClick={submit}
                >
                    {submitLabel}
                </Button>
            </Stack>
        </VStack>
    )
}

/**
 * One row of preset kit swatches. The same fixed palette the organizer picks
 * from on the Ekipe tab - free-hex input buys nothing here and produces the
 * near-black / near-white kits that make the chips unreadable.
 */
function ColorRow({
    label,
    value,
    onPick,
    clearLabel,
}: {
    label: string
    value: string | null
    onPick: (hex: string | null) => void
    clearLabel: string
}) {
    const t = useTranslation()
    return (
        <Stack gap="1">
            <Text fontSize="xs" color="fg.muted">{label}</Text>
            <HStack gap="1" wrap="wrap">
                {t.teams.jerseyColors.map((c) => (
                    <chakra.button
                        key={c.hex}
                        type="button"
                        title={c.label}
                        aria-label={c.label}
                        onClick={() => onPick(c.hex)}
                        boxSize="20px"
                        rounded="md"
                        bg={c.hex}
                        borderWidth={value === c.hex ? "2px" : "1px"}
                        borderColor={value === c.hex ? "pitch.500" : "blackAlpha.500"}
                        cursor="pointer"
                        flexShrink={0}
                    />
                ))}
                {value && (
                    <Button size="2xs" variant="ghost" onClick={() => onPick(null)}>
                        {clearLabel}
                    </Button>
                )}
            </HStack>
        </Stack>
    )
}
