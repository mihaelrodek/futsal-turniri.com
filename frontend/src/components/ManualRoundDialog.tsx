import { useEffect, useMemo, useState } from "react"
import {
    Box,
    Button,
    Dialog,
    HStack,
    IconButton,
    Input,
    NativeSelect,
    Portal,
    Stack,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiPlus, FiTrash2 } from "react-icons/fi"
import { drawManualRound, type ManualMatchInput } from "../api/round"

export type ManualRoundTeam = {
    id: number
    name: string
}

/**
 * Modal for organisers to construct a round by hand. Spawned from the
 * "Ručno generiraj" button on the Ždrijeb tab when there are ≤ 4 active
 * teams and the random auto-draw doesn't team the way the organiser
 * wants (typical use-case: choosing who plays the final).
 *
 * <p>Each row in the form represents one match - team1 ⨯ team2 ⨯ table
 * number. Either team2 may be set to "Slobodan stol (bye)" to model a
 * walkover when the active-teams count is odd. Backend validates the
 * payload; common errors (eliminated team, duplicate team) come back as
 * HTTP 400 and are surfaced by the global toaster.
 */
export default function ManualRoundDialog({
    open,
    onClose,
    tournamentUuid,
    teams,
    nextRoundNumber,
    onCreated,
}: {
    open: boolean
    onClose: () => void
    tournamentUuid: string
    teams: ManualRoundTeam[]
    /** 1-based round number for the heading; null until the first round
     *  is calculated. */
    nextRoundNumber: number | null
    /** Called after the round is successfully generated server-side. The
     *  parent re-fetches rounds and closes the dialog. */
    onCreated: () => void
}) {
    type Row = { team1Id: number | null; team2Id: number | "BYE" | null; tableNo: number }

    // Seed with one empty row when the dialog opens. Resets every time
    // the dialog is reopened so a previous draft doesn't haunt the next
    // attempt.
    const [rows, setRows] = useState<Row[]>([])
    const [submitting, setSubmitting] = useState(false)
    useEffect(() => {
        if (open) {
            // Default to floor(N/2) rows with sequential table numbers -
            // matches the typical bracket layout (2 active → 1 final,
            // 3 active → 1 match + 1 bye, 4 active → 2 semis).
            const half = Math.max(1, Math.floor(teams.length / 2))
            setRows(
                Array.from({ length: half }, (_, i) => ({
                    team1Id: null,
                    team2Id: null,
                    tableNo: i + 1,
                })),
            )
        }
    }, [open, teams.length])

    // Teams that aren't yet picked anywhere - populates the dropdown
    // options. We allow each dropdown to show its own currently-selected
    // team (so the user can read what they picked) plus the unpicked
    // pool. Computed per-row inside the JSX below.
    const pickedIds = useMemo(() => {
        const out = new Set<number>()
        for (const r of rows) {
            if (r.team1Id != null) out.add(r.team1Id)
            if (typeof r.team2Id === "number") out.add(r.team2Id)
        }
        return out
    }, [rows])

    function setRow(idx: number, patch: Partial<Row>) {
        setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
    }

    function removeRow(idx: number) {
        setRows((prev) => prev.filter((_, i) => i !== idx))
    }

    function addRow() {
        setRows((prev) => [
            ...prev,
            { team1Id: null, team2Id: null, tableNo: prev.length + 1 },
        ])
    }

    // Form is submittable when every row has a team1, and team2 is set
    // to either a real team or the explicit BYE marker. We don't
    // duplicate the more nuanced backend validation here - relying on
    // the dropdown's filtered options to prevent picking the same team
    // twice in the UI in the first place.
    const canSubmit = useMemo(() => {
        if (rows.length === 0) return false
        for (const r of rows) {
            if (r.team1Id == null) return false
            if (r.team2Id == null) return false
            if (!Number.isFinite(r.tableNo) || r.tableNo < 1) return false
        }
        return true
    }, [rows])

    async function handleSubmit() {
        if (!canSubmit) return
        const payload: ManualMatchInput[] = rows.map((r) => ({
            team1Id: r.team1Id!,
            team2Id: r.team2Id === "BYE" ? null : (r.team2Id as number),
            tableNo: r.tableNo,
        }))
        try {
            setSubmitting(true)
            await drawManualRound(tournamentUuid, payload)
            onCreated()
            onClose()
        } catch {
            // Toaster surfaces the backend error; keep dialog open so
            // the admin can fix the picks instead of losing them.
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(e) => { if (!e.open) onClose() }}
            placement="center"
            motionPreset="slide-in-bottom"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW={{ base: "94%", md: "640px" }}>
                        <Dialog.Header>
                            <Dialog.Title>
                                Ručna generacija kola{nextRoundNumber != null ? ` ${nextRoundNumber}` : ""}
                            </Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <Stack gap="3">
                                <Text fontSize="sm" color="fg.muted">
                                    Odaberi ekipu-protiv-ekipe za svaki stol. Možeš dodati ili
                                    ukloniti redove po potrebi. Ako je broj aktivnih ekipa
                                    neparan, postavi jednu ekipu na "Slobodan stol (bye)".
                                </Text>

                                {rows.length === 0 ? (
                                    <Text fontSize="sm" color="fg.muted">
                                        Nema mečeva. Dodaj prvi mečom ispod.
                                    </Text>
                                ) : (
                                    <VStack align="stretch" gap="2">
                                        {rows.map((r, idx) => {
                                            const availFor1 = teams.filter(
                                                (p) =>
                                                    p.id === r.team1Id || !pickedIds.has(p.id),
                                            )
                                            const availFor2 = teams.filter(
                                                (p) =>
                                                    typeof r.team2Id === "number" && r.team2Id === p.id ||
                                                    !pickedIds.has(p.id),
                                            )
                                            return (
                                                <Box
                                                    key={idx}
                                                    p="2"
                                                    borderWidth="1px"
                                                    borderColor="border.subtle"
                                                    rounded="md"
                                                >
                                                    <Stack gap="2">
                                                        <HStack gap="2" wrap="wrap">
                                                            <Text fontSize="xs" color="fg.muted" minW="56px">
                                                                Stol
                                                            </Text>
                                                            <Input
                                                                size="sm"
                                                                type="number"
                                                                min={1}
                                                                value={r.tableNo}
                                                                onChange={(e) =>
                                                                    setRow(idx, {
                                                                        tableNo: Math.max(1, Number(e.target.value) || 1),
                                                                    })
                                                                }
                                                                w="80px"
                                                            />
                                                            <Box flex="1" />
                                                            <IconButton
                                                                aria-label="Ukloni meč"
                                                                size="xs"
                                                                variant="ghost"
                                                                colorPalette="red"
                                                                onClick={() => removeRow(idx)}
                                                            >
                                                                <FiTrash2 />
                                                            </IconButton>
                                                        </HStack>

                                                        <HStack gap="2" align="center">
                                                            <NativeSelect.Root size="sm" flex="1">
                                                                <NativeSelect.Field
                                                                    value={r.team1Id ?? ""}
                                                                    onChange={(e) =>
                                                                        setRow(idx, {
                                                                            team1Id: e.target.value ? Number(e.target.value) : null,
                                                                        })
                                                                    }
                                                                >
                                                                    <option value="">- odaberi ekipu -</option>
                                                                    {availFor1.map((p) => (
                                                                        <option key={p.id} value={p.id}>{p.name}</option>
                                                                    ))}
                                                                </NativeSelect.Field>
                                                                <NativeSelect.Indicator />
                                                            </NativeSelect.Root>

                                                            <Text fontWeight="semibold" color="fg.muted">vs</Text>

                                                            <NativeSelect.Root size="sm" flex="1">
                                                                <NativeSelect.Field
                                                                    value={
                                                                        r.team2Id == null
                                                                            ? ""
                                                                            : r.team2Id === "BYE"
                                                                                ? "BYE"
                                                                                : String(r.team2Id)
                                                                    }
                                                                    onChange={(e) => {
                                                                        const v = e.target.value
                                                                        if (v === "") setRow(idx, { team2Id: null })
                                                                        else if (v === "BYE") setRow(idx, { team2Id: "BYE" })
                                                                        else setRow(idx, { team2Id: Number(v) })
                                                                    }}
                                                                >
                                                                    <option value="">- odaberi ekipu -</option>
                                                                    <option value="BYE">Slobodan stol (bye)</option>
                                                                    {availFor2.map((p) => (
                                                                        <option key={p.id} value={p.id}>{p.name}</option>
                                                                    ))}
                                                                </NativeSelect.Field>
                                                                <NativeSelect.Indicator />
                                                            </NativeSelect.Root>
                                                        </HStack>
                                                    </Stack>
                                                </Box>
                                            )
                                        })}
                                    </VStack>
                                )}

                                <HStack>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={addRow}
                                    >
                                        <FiPlus /> Dodaj meč
                                    </Button>
                                </HStack>
                            </Stack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <HStack gap="2">
                                <Button variant="ghost" onClick={onClose}>Odustani</Button>
                                <Button
                                    colorPalette="pitch"
                                    onClick={handleSubmit}
                                    disabled={!canSubmit}
                                    loading={submitting}
                                >
                                    Generiraj
                                </Button>
                            </HStack>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
