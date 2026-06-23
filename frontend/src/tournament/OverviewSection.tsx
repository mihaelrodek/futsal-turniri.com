import type React from "react"
import {
    Badge,
    Box,
    Button,
    Field,
    Flex,
    Grid,
    HStack,
    IconButton,
    Input,
    NativeSelect,
    RadioGroup,
    Text,
    Textarea,
    VStack,
    chakra,
} from "@chakra-ui/react"
import DatePicker from "react-datepicker"
import {
    FiCalendar,
    FiClock,
    FiDollarSign,
    FiExternalLink,
    FiGift,
    FiImage,
    FiInfo,
    FiMapPin,
    FiPhone,
    FiStar,
    FiTrash2,
    FiUser,
    FiUsers,
    FiX,
} from "react-icons/fi"
import { FaTrophy } from "react-icons/fa"

import type { TournamentDetails } from "../types/tournaments"
import { LocationAutocomplete } from "../components/LocationAutocomplete"
import LocationMapPicker from "../components/LocationMapPicker"
import { Panel, SectionHeader } from "../ui/primitives"
import {
    AccentStat,
    GhostButton,
    MonoLabel,
    PrimaryButton,
    SectionCard,
    TournamentPoster,
} from "../ui/pitch"
import {
    EditPerTeamHint,
    PHONE_COUNTRIES,
    SuffixInput,
    fmtMoney,
    formatDate,
    formatTime,
    sanitizeInt,
    sanitizeMoney,
    sanitizePhone,
} from "./parts"
import type { EditForm } from "./parts"

/* ──────────────────────────────────────────────────────────────────────────
   "Detalji" tab — the single, cohesive tournament-details card.

   Read mode is ONE card holding everything about the tournament: the
   poster, name + status, the key meta row (datum/vrijeme, lokacija,
   maks. ekipa, kotizacija), detalji text, nagrade, kontakt, dodatne
   opcije, plus the Podijeli / Uredi / Obriši toolbar.

   Edit mode is the owner/admin-only inline form (basic info, kotizacija,
   nagrade, kontakt) with poster pick/replace/remove and a sticky save
   bar. All logic is owned by the shell — this is a presentational view.
   ────────────────────────────────────────────────────────────────────── */

/* Poster validation thresholds — mirror CreateTournamentPage. */
export const POSTER_MAX_MB = 5
export const POSTER_ACCEPT = ["image/jpeg", "image/png", "image/webp"] as const

type OverviewSectionProps = {
    t: TournamentDetails
    canEdit: boolean
    isAdmin: boolean
    shareUrl: string
    /** Total registered teams — shown in the "Ekipe" meta tile. */
    teamCount: number
    // edit-mode state + handlers (owned by the shell)
    editingDetails: boolean
    editForm: EditForm | null
    enterEdit: () => void
    cancelEdit: () => void
    saveEdit: () => void
    savingDetails: boolean
    patchEdit: <K extends keyof EditForm>(key: K, value: EditForm[K]) => void
    editMissingRequired: string[]
    editStartInPast: boolean
    onDeleteTournament: () => void
    /** Admin-only: flip the tournament's "featured for the day" highlight.
     *  Visible in the read view as the "Istakni za dan" / "Ukloni
     *  istaknuto" GhostButton next to Uredi / Obriši. */
    onToggleFeature: () => void
    // poster state + handlers
    posterFile: File | null
    posterPreviewUrl: string | null
    posterRemove: boolean
    posterUploadErr: string | null
    handlePosterPick: (file: File) => void
    clearPosterPick: () => void
    markPosterForRemoval: () => void
    // map picker
    editPickedCoords: { lat: number; lng: number } | null
    setEditPickedCoords: (c: { lat: number; lng: number } | null) => void
}

export default function OverviewSection(props: OverviewSectionProps) {
    const {
        t,
        // canEdit / shareUrl / enterEdit are still part of the props
        // contract (passed by the parent) but the share/edit affordances
        // they powered moved to the page header, so they're intentionally
        // not consumed here anymore.
        isAdmin,
        teamCount,
        editingDetails,
        editForm,
        cancelEdit,
        saveEdit,
        savingDetails,
        patchEdit,
        editMissingRequired,
        editStartInPast,
        onDeleteTournament,
        onToggleFeature,
        posterFile,
        posterPreviewUrl,
        posterRemove,
        posterUploadErr,
        handlePosterPick,
        clearPosterPick,
        markPosterForRemoval,
        editPickedCoords,
        setEditPickedCoords,
    } = props

    /* ===== EDIT MODE ===== */
    if (editingDetails && editForm) {
        return (
            <VStack align="stretch" gap="5">
                {/* Osnovno */}
                <Panel p={{ base: "5", md: "6" }}>
                    <VStack align="stretch" gap="5">
                        <SectionHeader icon={FiInfo} title="Osnovno" />
                        <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "2fr 2fr 1fr" }} gap="4">
                            <Field.Root required>
                                <Field.Label>Ime turnira <Field.RequiredIndicator /></Field.Label>
                                <Input
                                    value={editForm.name}
                                    onChange={(e) => patchEdit("name", e.target.value)}
                                />
                            </Field.Root>
                            <Field.Root required>
                                <Field.Label>Datum i vrijeme <Field.RequiredIndicator /></Field.Label>
                                <Box className="futsal-datepicker-wrap" w="full">
                                    <DatePicker
                                        selected={
                                            editForm.startDate && editForm.startTime
                                                ? new Date(`${editForm.startDate}T${editForm.startTime}:00`)
                                                : null
                                        }
                                        onChange={(d) => {
                                            if (!d) {
                                                patchEdit("startDate", "")
                                                patchEdit("startTime", "")
                                                return
                                            }
                                            const pad = (n: number) => String(n).padStart(2, "0")
                                            const yyyy = d.getFullYear()
                                            const mm = pad(d.getMonth() + 1)
                                            const dd = pad(d.getDate())
                                            const hh = pad(d.getHours())
                                            const mi = pad(d.getMinutes())
                                            patchEdit("startDate", `${yyyy}-${mm}-${dd}`)
                                            patchEdit("startTime", `${hh}:${mi}`)
                                        }}
                                        showTimeSelect
                                        timeIntervals={15}
                                        timeFormat="HH:mm"
                                        timeCaption="Vrijeme"
                                        dateFormat="dd/MM/yyyy HH:mm"
                                        locale="hr"
                                        minDate={new Date()}
                                        placeholderText="DD/MM/GGGG HH:MM"
                                        wrapperClassName="futsal-datepicker-input-wrap"
                                        className="futsal-datepicker-input"
                                        popperPlacement="bottom-start"
                                    />
                                </Box>
                            </Field.Root>
                            <Field.Root>
                                <Field.Label>Maks. ekipa</Field.Label>
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={2}
                                    value={editForm.maxTeams}
                                    onChange={(e) => patchEdit("maxTeams", sanitizeInt(e.target.value))}
                                />
                            </Field.Root>
                        </Box>

                        <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="4">
                            <Field.Root required>
                                <Field.Label>Lokacija <Field.RequiredIndicator /></Field.Label>
                                <LocationAutocomplete
                                    value={editForm.location}
                                    onChange={(v) => patchEdit("location", v)}
                                    onPickSuggestion={(s) => {
                                        setEditPickedCoords({ lat: s.latitude, lng: s.longitude })
                                    }}
                                    placeholder="npr. Caffe bar Belot, Zagreb"
                                />
                            </Field.Root>

                            <Box gridRow={{ base: "auto", md: "span 2" }} gridColumn={{ base: "auto", md: "2" }}>
                                <LocationMapPicker
                                    value={editPickedCoords}
                                    onPick={(p) => {
                                        patchEdit("location", p.displayName)
                                        setEditPickedCoords({ lat: p.lat, lng: p.lng })
                                    }}
                                    height={{ base: "220px", md: "100%" }}
                                    minH="220px"
                                />
                            </Box>

                            <Field.Root>
                                <Field.Label>Detalji</Field.Label>
                                <Textarea
                                    rows={3}
                                    value={editForm.details}
                                    onChange={(e) => patchEdit("details", e.target.value)}
                                />
                            </Field.Root>
                        </Box>

                        {/* Poster picker */}
                        <Box>
                            <HStack gap="2" mb="2" fontSize="sm" fontWeight="medium">
                                <FiImage />
                                <Text>
                                    Plakat <chakra.span color="fg.muted" fontWeight="normal">(opcionalno)</chakra.span>
                                </Text>
                            </HStack>
                            <HStack align="center" gap="3" wrap="wrap" justify={{ base: "center", md: "flex-start" }}>
                                {(() => {
                                    const showLocalPreview = !!posterPreviewUrl
                                    const showServerPoster =
                                        !showLocalPreview && !posterRemove && !!t.bannerUrl
                                    if (showLocalPreview || showServerPoster) {
                                        const src = showLocalPreview ? posterPreviewUrl! : t.bannerUrl!
                                        return (
                                            <Box
                                                position="relative"
                                                borderWidth="1px"
                                                rounded="md"
                                                overflow="hidden"
                                                w="120px"
                                                h="120px"
                                            >
                                                <img
                                                    src={src}
                                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                                />
                                                <IconButton
                                                    type="button"
                                                    aria-label="Ukloni plakat"
                                                    size="2xs"
                                                    variant="solid"
                                                    colorPalette="red"
                                                    position="absolute"
                                                    top="1"
                                                    right="1"
                                                    onClick={() => {
                                                        if (showLocalPreview) clearPosterPick()
                                                        else markPosterForRemoval()
                                                    }}
                                                >
                                                    <FiX />
                                                </IconButton>
                                            </Box>
                                        )
                                    }
                                    return (
                                        <Box
                                            w="120px"
                                            h="120px"
                                            borderWidth="1px"
                                            borderStyle="dashed"
                                            borderColor="border.emphasized"
                                            rounded="md"
                                            display="flex"
                                            alignItems="center"
                                            justifyContent="center"
                                            color="fg.muted"
                                        >
                                            <FiImage size={28} />
                                        </Box>
                                    )
                                })()}

                                <VStack align={{ base: "center", md: "start" }} gap="1" flex="1" minW="0">
                                    <Button as="label" variant="outline" colorPalette="brand" size="sm" cursor="pointer">
                                        {posterFile
                                            ? "Promijeni sliku"
                                            : t.bannerUrl && !posterRemove
                                                ? "Zamijeni plakat"
                                                : "Odaberi sliku"}
                                        <input
                                            type="file"
                                            accept={POSTER_ACCEPT.join(",")}
                                            style={{ display: "none" }}
                                            onChange={(e) => {
                                                const f = e.target.files?.[0]
                                                if (f) handlePosterPick(f)
                                                e.target.value = ""
                                            }}
                                        />
                                    </Button>
                                    {posterUploadErr ? (
                                        <Text color="red.fg" fontSize="xs">{posterUploadErr}</Text>
                                    ) : posterRemove ? (
                                        <Text color="yellow.fg" fontSize="xs">
                                            Plakat će biti uklonjen pri spremanju.
                                        </Text>
                                    ) : (
                                        <Text color="fg.muted" fontSize="xs">
                                            PNG, JPG ili WEBP, do {POSTER_MAX_MB} MB.
                                        </Text>
                                    )}
                                </VStack>
                            </HStack>
                        </Box>
                    </VStack>
                </Panel>

                {/* Kotizacija */}
                <Panel p={{ base: "5", md: "6" }}>
                    <VStack align="stretch" gap="5">
                        <SectionHeader icon={FiDollarSign} title="Kotizacija" />
                        <Box
                            display="grid"
                            gridTemplateColumns={{ base: "1fr", md: "200px 1fr" }}
                            gap="4"
                            alignItems="start"
                        >
                            <Field.Root>
                                <Field.Label>Kotizacija</Field.Label>
                                <SuffixInput
                                    value={editForm.entryPrice}
                                    onChange={(v) => patchEdit("entryPrice", sanitizeMoney(v))}
                                    suffix="€"
                                />
                                <EditPerTeamHint value={editForm.entryPrice} />
                            </Field.Root>
                        </Box>
                    </VStack>
                </Panel>

                {/* Nagrade */}
                <Panel p={{ base: "5", md: "6" }}>
                    <VStack align="stretch" gap="5">
                        <SectionHeader icon={FiGift} title="Nagrade" />
                        <RadioGroup.Root
                            value={editForm.rewardType}
                            onValueChange={(v) =>
                                patchEdit(
                                    "rewardType",
                                    (typeof v === "string" ? v : (v as any)?.value) as "FIXED" | "PERCENTAGE",
                                )
                            }
                        >
                            <HStack gap="6" wrap="wrap" rowGap="2">
                                <RadioGroup.Item value="FIXED">
                                    <RadioGroup.ItemHiddenInput />
                                    <RadioGroup.ItemIndicator />
                                    <RadioGroup.ItemText>Fiksne (€)</RadioGroup.ItemText>
                                </RadioGroup.Item>
                                <RadioGroup.Item value="PERCENTAGE">
                                    <RadioGroup.ItemHiddenInput />
                                    <RadioGroup.ItemIndicator />
                                    <RadioGroup.ItemText>Postotak fonda (%)</RadioGroup.ItemText>
                                </RadioGroup.Item>
                            </HStack>
                        </RadioGroup.Root>
                        <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "1fr 1fr 1fr" }} gap="4">
                            <Field.Root required>
                                <Field.Label>1. mjesto <Field.RequiredIndicator /></Field.Label>
                                <SuffixInput
                                    value={editForm.rewardFirst}
                                    onChange={(v) => patchEdit("rewardFirst", sanitizeMoney(v))}
                                    suffix={editForm.rewardType === "FIXED" ? "€" : "%"}
                                />
                            </Field.Root>
                            <Field.Root required>
                                <Field.Label>2. mjesto <Field.RequiredIndicator /></Field.Label>
                                <SuffixInput
                                    value={editForm.rewardSecond}
                                    onChange={(v) => patchEdit("rewardSecond", sanitizeMoney(v))}
                                    suffix={editForm.rewardType === "FIXED" ? "€" : "%"}
                                />
                            </Field.Root>
                            <Field.Root required>
                                <Field.Label>3. mjesto <Field.RequiredIndicator /></Field.Label>
                                <SuffixInput
                                    value={editForm.rewardThird}
                                    onChange={(v) => patchEdit("rewardThird", sanitizeMoney(v))}
                                    suffix={editForm.rewardType === "FIXED" ? "€" : "%"}
                                />
                            </Field.Root>
                        </Box>
                    </VStack>
                </Panel>

                {/* Kontakt organizatora */}
                <Panel p={{ base: "5", md: "6" }}>
                    <VStack align="stretch" gap="5">
                        <SectionHeader icon={FiPhone} title="Kontakt organizatora" />
                        <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="4">
                            <Field.Root>
                                <Field.Label>Ime</Field.Label>
                                <Input
                                    placeholder="Ime organizatora"
                                    value={editForm.contactName}
                                    onChange={(e) => patchEdit("contactName", e.target.value)}
                                />
                            </Field.Root>
                            <Field.Root>
                                <Field.Label>Broj telefona</Field.Label>
                                <HStack gap="2">
                                    <NativeSelect.Root size="md" w="120px" flexShrink={0}>
                                        <NativeSelect.Field
                                            value={editForm.contactPhoneCountry}
                                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                                patchEdit("contactPhoneCountry", e.target.value)
                                            }
                                        >
                                            {PHONE_COUNTRIES.map((c) => (
                                                <option key={c.value} value={c.value}>
                                                    {c.label}
                                                </option>
                                            ))}
                                        </NativeSelect.Field>
                                    </NativeSelect.Root>
                                    <Input
                                        flex="1"
                                        inputMode="numeric"
                                        pattern="[0-9 ]*"
                                        placeholder="91 234 5678"
                                        value={editForm.contactPhone}
                                        onChange={(e) => patchEdit("contactPhone", sanitizePhone(e.target.value))}
                                    />
                                </HStack>
                            </Field.Root>
                        </Box>
                    </VStack>
                </Panel>

                {/* Sticky save bar */}
                <Box
                    position="sticky"
                    bottom="0"
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border"
                    rounded="2xl"
                    shadow="md"
                    py="3"
                    px="4"
                    mt="1"
                >
                    <VStack align="stretch" gap="2">
                        <Text fontSize="sm" color="fg.muted">
                            {editMissingRequired.length === 0 && !editStartInPast ? (
                                <chakra.span color="green.fg">Spremno za spremanje.</chakra.span>
                            ) : editStartInPast ? (
                                <chakra.span color="red.fg">
                                    Datum i vrijeme ne mogu biti u prošlosti.
                                </chakra.span>
                            ) : (
                                <chakra.span color="red.fg">
                                    Nedostaje: {editMissingRequired.join(", ")}
                                </chakra.span>
                            )}
                        </Text>
                        <HStack gap="2" justify="flex-end">
                            <Button variant="ghost" onClick={cancelEdit} disabled={savingDetails}>
                                Odustani
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette="brand"
                                onClick={saveEdit}
                                loading={savingDetails}
                                disabled={
                                    editMissingRequired.length > 0 || editStartInPast || savingDetails
                                }
                            >
                                Spremi izmjene
                            </Button>
                        </HStack>
                    </VStack>
                </Box>
            </VStack>
        )
    }

    /* ===== READ MODE — Pitch theme 2-column layout ===== */
    return <DetailsReadView
        t={t}
        isAdmin={isAdmin}
        teamCount={teamCount}
        onDeleteTournament={onDeleteTournament}
        onToggleFeature={onToggleFeature}
    />
}

/** Read-mode view extracted into its own component so the edit-mode return
 *  above stays focused on form rendering. Mirrors the layout from
 *  design-reference/page-detail.jsx — poster column on the left,
 *  info cards on the right. Share / embed / edit / fullscreen actions now
 *  live in the page header; only admin controls render in the poster column. */
function DetailsReadView({
    t,
    isAdmin,
    teamCount,
    onDeleteTournament,
    onToggleFeature,
}: {
    t: TournamentDetails
    isAdmin: boolean
    teamCount: number
    onDeleteTournament: () => void
    onToggleFeature: () => void
}) {
    const isPercent = t.rewardType === "PERCENTAGE"
    const fmtReward = (n: number | null | undefined) =>
        isPercent ? `${n ?? 0}%` : fmtMoney(n)
    const totalReward =
        (t.rewardFirst ?? 0) + (t.rewardSecond ?? 0) + (t.rewardThird ?? 0)
    const prizeColors = ["#f5c842", "#c0c5cc", "#cd8654"]

    return (
        <Grid templateColumns={{ base: "1fr", md: "380px 1fr" }} gap="6">
            {/* ── Poster column ────────────────────────────────────────── */}
            <VStack align="stretch" gap="3">
                <Box
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border"
                    rounded="xl"
                    overflow="hidden"
                >
                    <TournamentPoster
                        name={t.name}
                        bannerUrl={t.bannerUrl}
                        height={360}
                        big
                        seed={t.uuid}
                    />
                </Box>
                {/* The Podijeli / Ugradi / Uredi / Fullscreen actions moved
                    up to the page header (top-right). Only the admin-only
                    controls remain here — they're rarer and don't belong in
                    the always-visible header for non-admins. */}
                {isAdmin && (
                    <HStack gap="2" wrap="wrap">
                        {/* Daily highlight toggle. Label flips between
                             "Istakni za dan" and "Ukloni istaknuto". */}
                        <GhostButton
                            icon={<FiStar size={14} />}
                            onClick={onToggleFeature}
                        >
                            {t.featuredAt ? "Ukloni istaknuto" : "Istakni za dan"}
                        </GhostButton>
                        <GhostButton
                            danger
                            icon={<FiTrash2 size={14} />}
                            onClick={onDeleteTournament}
                        >
                            Obriši
                        </GhostButton>
                    </HStack>
                )}
            </VStack>

            {/* ── Info column ──────────────────────────────────────────── */}
            <VStack align="stretch" gap="4">
                {/* Quick-stat tiles */}
                <Grid templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }} gap="3">
                    <AccentStat
                        accent="var(--chakra-colors-pitch-400)"
                        icon={<FiCalendar size={12} />}
                        label="DATUM"
                        value={formatDate(t.startAt)}
                    />
                    <AccentStat
                        accent="var(--chakra-colors-pitch-500)"
                        icon={<FiClock size={12} />}
                        label="VRIJEME"
                        value={formatTime(t.startAt)}
                    />
                    <AccentStat
                        accent="var(--chakra-colors-accent-amber)"
                        icon={<FiUsers size={12} />}
                        label="EKIPE"
                        value={`${teamCount}${typeof t.maxTeams === "number" ? ` / ${t.maxTeams}` : ""}`}
                    />
                    {typeof t.entryPrice === "number" && (
                        <AccentStat
                            accent="var(--chakra-colors-accent-goal)"
                            icon={<FiDollarSign size={12} />}
                            label="KOTIZACIJA"
                            value={fmtMoney(t.entryPrice)}
                        />
                    )}
                </Grid>

                {/* Organizer pill bar */}
                {t.createdByName && (
                    <Flex
                        bg="bg.panel"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="lg"
                        px="5"
                        py="3.5"
                        justify="space-between"
                        align="center"
                        gap="3"
                        wrap="wrap"
                    >
                        <HStack gap="3">
                            <Flex
                                w="38px"
                                h="38px"
                                rounded="full"
                                bgImage="linear-gradient(135deg, #3aa56b, #0b6b3a)"
                                color="white"
                                align="center"
                                justify="center"
                                fontSize="13px"
                                fontWeight={700}
                            >
                                {t.createdByName
                                    .split(/\s+/)
                                    .map((w) => w[0])
                                    .slice(0, 2)
                                    .join("")
                                    .toUpperCase()}
                            </Flex>
                            <Box>
                                <MonoLabel>ORGANIZATOR</MonoLabel>
                                <Text fontSize="15px" fontWeight={700} color="fg.ink">
                                    {t.createdByName}
                                </Text>
                            </Box>
                        </HStack>
                    </Flex>
                )}

                {/* Lokacija */}
                {t.location && (
                    <SectionCard
                        icon={FiMapPin}
                        title="Lokacija"
                        subtitle={t.location}
                        action={
                            <chakra.a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.location)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                display="inline-flex"
                                alignItems="center"
                                gap="1.5"
                                bg="bg.surfaceTint"
                                color="pitch.500"
                                px="3.5"
                                py="2"
                                rounded="full"
                                fontSize="13px"
                                fontWeight={600}
                                textDecoration="none"
                                _hover={{ bg: "pitch.100", textDecoration: "none" }}
                            >
                                <FiExternalLink /> Otvori u kartama
                            </chakra.a>
                        }
                    />
                )}

                {/* Detalji turnira */}
                {t.details && (
                    <SectionCard
                        icon={FiInfo}
                        title="Detalji turnira"
                        subtitle="Pravila, format, dodatne informacije"
                    >
                        <Text fontSize="14px" color="fg.soft" lineHeight={1.6} whiteSpace="pre-wrap">
                            {t.details}
                        </Text>
                        {(t.format || t.additionalOptions?.length) && (
                            <Grid templateColumns={{ base: "1fr", sm: "repeat(3, 1fr)" }} gap="3" mt="4">
                                {t.format && (
                                    <Box bg="bg.surfaceTint2" rounded="md" px="3.5" py="2.5">
                                        <MonoLabel>FORMAT</MonoLabel>
                                        <Text fontSize="14px" fontWeight={700} color="fg.ink" mt="0.5">
                                            {t.format === "GROUPS_KNOCKOUT"
                                                ? "Grupe + eliminacija"
                                                : "Eliminacija"}
                                        </Text>
                                    </Box>
                                )}
                                {typeof t.maxTeams === "number" && (
                                    <Box bg="bg.surfaceTint2" rounded="md" px="3.5" py="2.5">
                                        <MonoLabel>MAKS. EKIPA</MonoLabel>
                                        <Text fontSize="14px" fontWeight={700} color="fg.ink" mt="0.5">
                                            {t.maxTeams}
                                        </Text>
                                    </Box>
                                )}
                                {t.additionalOptions && t.additionalOptions.length > 0 && (
                                    <Box bg="bg.surfaceTint2" rounded="md" px="3.5" py="2.5">
                                        <MonoLabel>OPCIJE</MonoLabel>
                                        <HStack wrap="wrap" gap="1.5" mt="1">
                                            {t.additionalOptions.map((opt) => (
                                                <Badge key={opt} variant="solid" colorPalette="pitch" size="sm">
                                                    {opt}
                                                </Badge>
                                            ))}
                                        </HStack>
                                    </Box>
                                )}
                            </Grid>
                        )}
                    </SectionCard>
                )}

                {/* Nagradni fond */}
                {t.rewardType && (
                    <SectionCard
                        icon={FiGift}
                        title="Nagradni fond"
                        subtitle={isPercent ? "Postotak fonda po plasmanu" : "Fiksne nagrade po plasmanu"}
                        action={
                            !isPercent && totalReward > 0 ? (
                                <Box
                                    bg="bg.surfaceTint"
                                    color="pitch.500"
                                    px="2.5"
                                    py="1"
                                    rounded="full"
                                    fontSize="11px"
                                    fontWeight={700}
                                    fontFamily="mono"
                                    letterSpacing="0.05em"
                                >
                                    UKUPNO {fmtMoney(totalReward)}
                                </Box>
                            ) : null
                        }
                    >
                        <Grid templateColumns={{ base: "1fr", sm: "repeat(3, 1fr)" }} gap="3">
                            {[
                                { place: 1, amount: t.rewardFirst },
                                { place: 2, amount: t.rewardSecond },
                                { place: 3, amount: t.rewardThird },
                            ].map((p) => {
                                const color = prizeColors[p.place - 1]
                                return (
                                    <Flex
                                        key={p.place}
                                        bg="bg.surfaceTint2"
                                        borderWidth="1px"
                                        borderColor="border"
                                        rounded="lg"
                                        px="4"
                                        py="3.5"
                                        align="center"
                                        gap="3"
                                    >
                                        <Flex
                                            w="36px"
                                            h="36px"
                                            rounded="full"
                                            bgImage={`linear-gradient(145deg, ${color}, ${color}cc)`}
                                            align="center"
                                            justify="center"
                                            color="white"
                                            flexShrink={0}
                                        >
                                            <FaTrophy size={18} />
                                        </Flex>
                                        <Box>
                                            <MonoLabel>{p.place}. MJESTO</MonoLabel>
                                            <Text
                                                fontSize="20px"
                                                fontWeight={800}
                                                color="fg.ink"
                                                letterSpacing="-0.02em"
                                            >
                                                {fmtReward(p.amount)}
                                            </Text>
                                        </Box>
                                    </Flex>
                                )
                            })}
                        </Grid>
                    </SectionCard>
                )}

                {/* Kontakt */}
                {(t.contactName || t.contactPhone) && (
                    <SectionCard icon={FiUser} title="Kontakt" subtitle="Za pitanja i prijave" padding="0">
                        <Flex
                            px="6"
                            py="4"
                            align="center"
                            justify="space-between"
                            gap="3"
                            wrap="wrap"
                        >
                            <Box>
                                {t.contactName && (
                                    <Text fontSize="15px" fontWeight={700} color="fg.ink">
                                        {t.contactName}
                                    </Text>
                                )}
                                {t.contactPhone && (
                                    <HStack gap="1.5" mt="0.5" color="fg.muted" fontSize="13px">
                                        <FiPhone size={12} />
                                        <chakra.a
                                            href={`tel:${t.contactPhone.replace(/\s+/g, "")}`}
                                            color="pitch.500"
                                            fontWeight={500}
                                            _hover={{ textDecoration: "underline" }}
                                        >
                                            {t.contactPhone}
                                        </chakra.a>
                                    </HStack>
                                )}
                            </Box>
                            {t.status !== "FINISHED" && (
                                <PrimaryButton>Prijavi ekipu</PrimaryButton>
                            )}
                        </Flex>
                    </SectionCard>
                )}
            </VStack>
        </Grid>
    )
}
