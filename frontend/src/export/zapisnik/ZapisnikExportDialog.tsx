// Export dialog for the FIFA-style match report (zapisnik). Collects the
// fields the data model doesn't carry - officials, hall, venue override and
// goalkeeper marks - then downloads the filled form as XLSX or PDF. The
// generators are dynamic-imported so their libraries stay out of the main
// bundle. Public feature - no canEdit gate.

import { useEffect, useState } from "react"
import {
    Box,
    Button,
    Checkbox,
    Dialog,
    Flex,
    Grid,
    HStack,
    IconButton,
    Input,
    Portal,
    RadioGroup,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiDownload, FiX } from "react-icons/fi"
import { showError, showSuccess } from "../../toaster"
import type { PlayerDto } from "../../types/players"
import type { ZapisnikLang } from "./types"
import { PLAYER_ROWS } from "./types"
import { DEFAULT_ZAPISNIK_LANG } from "./spec"
import {
    buildZapisnikData,
    loadZapisnikContext,
    type ZapisnikMatchContext,
} from "./data"

/** Windows-illegal characters out, spaces → underscores. */
function fileToken(name: string): string {
    return (
        name
            .trim()
            .replace(/[\\/:*?"<>|]+/g, "")
            .replace(/\s+/g, "_") || "ekipa"
    )
}

type OfficialsFieldKey =
    | "referee1"
    | "referee2"
    | "referee3"
    | "delegate"
    | "timekeeper"
    | "hall"

const OFFICIALS_FIELDS: Array<{ key: OfficialsFieldKey; label: string }> = [
    { key: "referee1", label: "Sudac 1" },
    { key: "referee2", label: "Sudac 2" },
    { key: "referee3", label: "Sudac 3" },
    { key: "delegate", label: "Delegat" },
    { key: "timekeeper", label: "Mjeritelj vremena" },
    { key: "hall", label: "Dvorana" },
]

const EMPTY_FIELDS: Record<OfficialsFieldKey, string> = {
    referee1: "",
    referee2: "",
    referee3: "",
    delegate: "",
    timekeeper: "",
    hall: "",
}

export function ZapisnikExportDialog({
    open,
    onClose,
    uuid,
    matchId,
}: {
    open: boolean
    onClose: () => void
    uuid: string
    matchId: number
}) {
    const [ctx, setCtx] = useState<ZapisnikMatchContext | null>(null)
    const [loading, setLoading] = useState(false)
    const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null)
    const [lang, setLang] = useState<ZapisnikLang>(DEFAULT_ZAPISNIK_LANG)
    const [fields, setFields] = useState(EMPTY_FIELDS)
    const [venueTown, setVenueTown] = useState("")
    const [gkIds, setGkIds] = useState<Set<number>>(new Set())

    // The page component is reused across match navigation (same route,
    // different param), so player-bound state must not leak between matches.
    useEffect(() => {
        setCtx(null)
        setGkIds(new Set())
    }, [uuid, matchId])

    // Load everything once per open (schedule + tournament + events + both
    // rosters). Prefill the venue from the tournament location unless the
    // user already typed one.
    useEffect(() => {
        if (!open) return
        let cancelled = false
        setLoading(true)
        loadZapisnikContext(uuid, matchId)
            .then((c) => {
                if (cancelled) return
                setCtx(c)
                setVenueTown((v) => v || (c.tournament.location ?? ""))
                // Seed the ticks from the roster's own GK marks (Ekipe ->
                // igrači). Still editable here - who actually keeps goal in
                // THIS match is a per-match call - but the common case no
                // longer means re-ticking the same two names every export.
                setGkIds(new Set(
                    [...c.hostPlayers, ...c.guestPlayers]
                        .filter((p) => p.goalkeeper)
                        .map((p) => p.id),
                ))
            })
            .catch((err) => {
                console.error("[ZapisnikExport] context load failed", err)
                if (!cancelled) showError("Učitavanje podataka nije uspjelo", "Pokušaj ponovno.")
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [open, uuid, matchId])

    const setField = (key: OfficialsFieldKey, value: string) =>
        setFields((f) => ({ ...f, [key]: value }))

    const toggleGk = (playerId: number) =>
        setGkIds((prev) => {
            const next = new Set(prev)
            if (next.has(playerId)) next.delete(playerId)
            else next.add(playerId)
            return next
        })

    const rosterOverflow =
        !!ctx &&
        (ctx.hostPlayers.length > PLAYER_ROWS || ctx.guestPlayers.length > PLAYER_ROWS)

    async function handleDownload(kind: "xlsx" | "pdf") {
        if (!ctx || busy) return
        setBusy(kind)
        try {
            const data = buildZapisnikData(ctx, lang, {
                officials: {
                    referee1: fields.referee1,
                    referee2: fields.referee2,
                    referee3: fields.referee3,
                    delegate: fields.delegate,
                    timekeeper: fields.timekeeper,
                },
                hall: fields.hall,
                venueTown,
                goalkeeperIds: gkIds,
            })
            const blob =
                kind === "xlsx"
                    ? await (await import("./xlsx")).generateZapisnikXlsx(data)
                    : await (await import("./pdf")).generateZapisnikPdf(data)
            const filename = `Zapisnik_${fileToken(data.host.name)}_vs_${fileToken(data.guest.name)}.${kind}`
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = filename
            document.body.appendChild(a)
            a.click()
            a.remove()
            window.setTimeout(() => URL.revokeObjectURL(url), 4000)
            showSuccess("Zapisnik spremljen", "Preuzimanje je pokrenuto.")
        } catch (err) {
            console.error("[ZapisnikExport] generation failed", err)
            showError("Izrada zapisnika nije uspjela", "Pokušaj ponovno.")
        } finally {
            setBusy(null)
        }
    }

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(e) => {
                if (!e.open && !busy) onClose()
            }}
            placement="center"
            size="lg"
            scrollBehavior="inside"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="540px">
                        <Dialog.Header>
                            <Flex justify="space-between" align="center" w="full" gap="3">
                                <Dialog.Title>Preuzmi zapisnik</Dialog.Title>
                                <Dialog.CloseTrigger asChild>
                                    <IconButton aria-label="Zatvori" size="sm" variant="ghost" disabled={!!busy}>
                                        <FiX />
                                    </IconButton>
                                </Dialog.CloseTrigger>
                            </Flex>
                        </Dialog.Header>
                        <Dialog.Body>
                            <Text fontSize="sm" color="fg.muted" mb="4">
                                Službeni obrazac zapisnika s podacima utakmice. Neobavezna polja
                                ostaju prazna na ispisu pa se mogu popuniti rukom.
                            </Text>

                            {/* Form language. */}
                            <Box mb="4">
                                <SectionLabel>Jezik obrasca</SectionLabel>
                                <RadioGroup.Root
                                    value={lang}
                                    onValueChange={(e: string | { value?: string | null }) => {
                                        const v = typeof e === "string" ? e : e?.value
                                        if (v === "hr" || v === "en") setLang(v)
                                    }}
                                >
                                    <HStack gap="6">
                                        <RadioGroup.Item value="hr">
                                            <RadioGroup.ItemHiddenInput />
                                            <RadioGroup.ItemIndicator />
                                            <RadioGroup.ItemText>Hrvatski</RadioGroup.ItemText>
                                        </RadioGroup.Item>
                                        <RadioGroup.Item value="en">
                                            <RadioGroup.ItemHiddenInput />
                                            <RadioGroup.ItemIndicator />
                                            <RadioGroup.ItemText>English</RadioGroup.ItemText>
                                        </RadioGroup.Item>
                                    </HStack>
                                </RadioGroup.Root>
                            </Box>

                            {/* Officials + venue - all optional free entry. */}
                            <Box mb="4">
                                <SectionLabel>Službene osobe i mjesto (neobavezno)</SectionLabel>
                                <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="2.5">
                                    {OFFICIALS_FIELDS.map((f) => (
                                        <LabeledInput
                                            key={f.key}
                                            label={f.label}
                                            value={fields[f.key]}
                                            onChange={(v) => setField(f.key, v)}
                                        />
                                    ))}
                                    <LabeledInput
                                        label="Mjesto igranja"
                                        value={venueTown}
                                        onChange={setVenueTown}
                                    />
                                </Grid>
                            </Box>

                            {/* Goalkeeper marking - the model has no GK flag. */}
                            <Box mb="2">
                                <SectionLabel>Vratari (neobavezno)</SectionLabel>
                                <Text fontSize="xs" color="fg.muted" mb="2">
                                    Označeni igrači na obrascu dobivaju oznaku vratara.
                                </Text>
                                {loading || !ctx ? (
                                    <Flex minH="90px" align="center" justify="center" gap="2">
                                        <Spinner size="sm" color="brand.solid" />
                                        <Text fontSize="sm" color="fg.muted">Učitavanje sastava…</Text>
                                    </Flex>
                                ) : (
                                    <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="3">
                                        <GkRoster
                                            title={ctx.scheduled.team1Name ?? "Domaći"}
                                            players={ctx.hostPlayers}
                                            gkIds={gkIds}
                                            onToggle={toggleGk}
                                            disabled={!!busy}
                                        />
                                        <GkRoster
                                            title={ctx.scheduled.team2Name ?? "Gosti"}
                                            players={ctx.guestPlayers}
                                            gkIds={gkIds}
                                            onToggle={toggleGk}
                                            disabled={!!busy}
                                        />
                                    </Grid>
                                )}
                            </Box>

                            {rosterOverflow && (
                                <Text fontSize="xs" fontWeight={700} color="orange.fg" mt="2">
                                    Obrazac ima mjesta za {PLAYER_ROWS} igrača — višak neće biti
                                    ispisan.
                                </Text>
                            )}
                        </Dialog.Body>
                        <Dialog.Footer gap="3">
                            <Button
                                colorPalette="brand"
                                variant="solid"
                                loading={busy === "xlsx"}
                                loadingText="Izrada…"
                                disabled={!!busy || loading || !ctx}
                                onClick={() => handleDownload("xlsx")}
                            >
                                <FiDownload /> Preuzmi XLSX
                            </Button>
                            <Button
                                colorPalette="brand"
                                variant="outline"
                                loading={busy === "pdf"}
                                loadingText="Izrada…"
                                disabled={!!busy || loading || !ctx}
                                onClick={() => handleDownload("pdf")}
                            >
                                <FiDownload /> Preuzmi PDF
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <Text
            fontFamily="mono"
            fontSize="10px"
            fontWeight={700}
            letterSpacing="0.12em"
            textTransform="uppercase"
            color="fg.muted"
            mb="2"
        >
            {children}
        </Text>
    )
}

function LabeledInput({
    label,
    value,
    onChange,
}: {
    label: string
    value: string
    onChange: (value: string) => void
}) {
    return (
        <Box>
            <Text fontSize="xs" fontWeight={700} color="fg.muted" mb="1">
                {label}
            </Text>
            <Input size="sm" value={value} onChange={(e) => onChange(e.target.value)} />
        </Box>
    )
}

function GkRoster({
    title,
    players,
    gkIds,
    onToggle,
    disabled,
}: {
    title: string
    players: PlayerDto[]
    gkIds: ReadonlySet<number>
    onToggle: (playerId: number) => void
    disabled: boolean
}) {
    return (
        <Box borderWidth="1px" borderColor="border" rounded="md" p="2" minW="0">
            <Text fontSize="xs" fontWeight={800} color="fg.ink" mb="1.5" lineClamp={1}>
                {title}
            </Text>
            {players.length === 0 ? (
                <Text fontSize="xs" color="fg.muted" py="2">
                    Nema unesenih igrača.
                </Text>
            ) : (
                <VStack align="stretch" gap="1" maxH="180px" overflowY="auto">
                    {players.map((p) => (
                        <Checkbox.Root
                            key={p.id}
                            size="sm"
                            checked={gkIds.has(p.id)}
                            onCheckedChange={() => onToggle(p.id)}
                            disabled={disabled}
                        >
                            <Checkbox.HiddenInput />
                            <Checkbox.Control />
                            <Checkbox.Label>
                                <Text as="span" fontSize="xs" color="fg.ink" lineClamp={1}>
                                    {p.number != null ? `${p.number} · ` : ""}
                                    {p.name}
                                </Text>
                            </Checkbox.Label>
                        </Checkbox.Root>
                    ))}
                </VStack>
            )}
        </Box>
    )
}
