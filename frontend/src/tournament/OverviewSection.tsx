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
    FiDownload,
    FiExternalLink,
    FiGift,
    FiGrid,
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

import type { TournamentDetails, TournamentFormat, BracketFill } from "../types/tournaments"
import { LocationAutocomplete } from "../components/LocationAutocomplete"
import LocationMapPicker from "../components/LocationMapPicker"
import { FormatSketch } from "../components/FormatSketch"
import { FormSectionCard } from "../ui/primitives"
import {
    AccentStat,
    GhostButton,
    MonoLabel,
    SectionCard,
    TournamentPoster,
} from "../ui/pitch"
import {
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
    /** True once the tournament has started/finished — the format editor is
     *  locked then (changing it would desync generated groups / bracket). */
    tournamentStarted: boolean
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
        tournamentStarted,
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
                {/* Osnovne informacije — identical card to the create form. */}
                <FormSectionCard icon={<FiInfo />} title="Osnovne informacije">
                    <VStack align="stretch" gap="4">
                        <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "2fr 2fr 1fr 1fr" }} gap="4">
                            <Field.Root required>
                                <Field.Label>Ime turnira <Field.RequiredIndicator /></Field.Label>
                                <Input
                                    placeholder="npr. Futsal open"
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
                                    placeholder="npr. 32 (može ostati prazno)"
                                    value={editForm.maxTeams}
                                    onChange={(e) => patchEdit("maxTeams", sanitizeInt(e.target.value))}
                                />
                            </Field.Root>
                            <Field.Root>
                                <Field.Label>Kotizacija</Field.Label>
                                <SuffixInput
                                    value={editForm.entryPrice}
                                    onChange={(v) => patchEdit("entryPrice", sanitizeMoney(v))}
                                    placeholder="100"
                                    suffix="€"
                                />
                            </Field.Root>
                        </Box>

                        {/* Row 2 — left: Detalji + Kontakt + Plakat · right: Lokacija + map.
                            Identical structure to the create form's "Osnovne informacije". */}
                        <Box
                            display="grid"
                            gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }}
                            gap="4"
                            alignItems="start"
                        >
                            {/* RIGHT — Lokacija above the map */}
                            <VStack align="stretch" gap="4" gridColumn={{ md: "2" }} order={{ base: 0, md: 1 }}>
                                <Field.Root required>
                                    <Field.Label>Lokacija <Field.RequiredIndicator /></Field.Label>
                                    <LocationAutocomplete
                                        value={editForm.location}
                                        onChange={(v) => patchEdit("location", v)}
                                        onPickSuggestion={(s) => {
                                            setEditPickedCoords({ lat: s.latitude, lng: s.longitude })
                                        }}
                                        placeholder="Unesi lokaciju ili izaberi na karti"
                                    />
                                </Field.Root>
                                <LocationMapPicker
                                    value={editPickedCoords}
                                    onPick={(p) => {
                                        patchEdit("location", p.displayName)
                                        setEditPickedCoords({ lat: p.lat, lng: p.lng })
                                    }}
                                    height={{ base: "260px", md: "300px" }}
                                    minH={{ base: "260px", md: "300px" }}
                                />
                            </VStack>

                            {/* LEFT — Detalji, Kontakt, Plakat */}
                            <VStack
                                align="stretch"
                                gap="4"
                                gridColumn={{ md: "1" }}
                                gridRow={{ md: "1" }}
                                order={{ base: 1, md: 0 }}
                            >
                                <Field.Root>
                                    <Field.Label>Detalji</Field.Label>
                                    <Textarea
                                        rows={3}
                                        placeholder="Dodatne informacije - pravila, parking, hrana, piće..."
                                        value={editForm.details}
                                        onChange={(e) => patchEdit("details", e.target.value)}
                                    />
                                </Field.Root>

                                {/* Sistem igre — quick presets + free text. */}
                                <Field.Root>
                                    <Field.Label>Sistem igre</Field.Label>
                                    <HStack gap="1.5" wrap="wrap" align="center">
                                        {["3vs3", "4+1", "5+1"].map((sys) => (
                                            <Button
                                                key={sys}
                                                type="button"
                                                size="sm"
                                                flexShrink={0}
                                                variant={editForm.gameSystem === sys ? "solid" : "outline"}
                                                colorPalette="brand"
                                                onClick={() => patchEdit("gameSystem", sys)}
                                            >
                                                {sys}
                                            </Button>
                                        ))}
                                        <Input
                                            flex="1"
                                            minW="120px"
                                            placeholder="ili upiši ručno"
                                            value={editForm.gameSystem}
                                            onChange={(e) => patchEdit("gameSystem", e.target.value)}
                                            maxLength={40}
                                        />
                                    </HStack>
                                </Field.Root>

                                {/* Web stranica organizatora — external link. */}
                                <Field.Root>
                                    <Field.Label>Web stranica organizatora</Field.Label>
                                    <Input
                                        type="url"
                                        inputMode="url"
                                        placeholder="npr. https://facebook.com/events/..."
                                        value={editForm.websiteUrl}
                                        onChange={(e) => patchEdit("websiteUrl", e.target.value)}
                                        maxLength={500}
                                    />
                                </Field.Root>

                                {/* Kontakt — ime + telefon on one row (create style). */}
                                <Box>
                                    <HStack gap="2" mb="1.5" fontSize="sm" fontWeight="medium">
                                        <FiPhone />
                                        <Text>
                                            Kontakt{" "}
                                            <chakra.span color="fg.muted" fontWeight="normal">
                                                (ime i telefon)
                                            </chakra.span>
                                        </Text>
                                    </HStack>
                                    <Box
                                        display="grid"
                                        gridTemplateColumns={{ base: "1fr", sm: "1fr 1fr" }}
                                        gap="2"
                                    >
                                        <Input
                                            placeholder="Ime organizatora"
                                            value={editForm.contactName}
                                            onChange={(e) => patchEdit("contactName", e.target.value)}
                                        />
                                        <HStack gap="2">
                                            <NativeSelect.Root size="md" w="100px" flexShrink={0}>
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
                                    </Box>
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
                        </Box>
                    </VStack>
                </FormSectionCard>

                {/* Format natjecanja — editable while the schedule hasn't been
                    generated yet (the backend preserves the format config once
                    fixtures exist, so changes can't desync groups/bracket). */}
                <FormSectionCard
                    icon={<FiGrid />}
                    title="Format natjecanja"
                    description="Odaberi kako je turnir strukturiran."
                >
                    <VStack align="stretch" gap="4">
                        {tournamentStarted ? (
                            <Box
                                fontSize="sm"
                                color="fg.muted"
                                bg="bg.subtle"
                                rounded="md"
                                px="3"
                                py="2"
                            >
                                Format se ne može mijenjati nakon što turnir počne.
                            </Box>
                        ) : (
                            <Box
                                fontSize="xs"
                                color="fg.muted"
                                bg="bg.subtle"
                                rounded="md"
                                px="3"
                                py="2"
                            >
                                Format se može promijeniti samo dok raspored nije generiran.
                            </Box>
                        )}

                        <Field.Root>
                            <Field.Label>Format</Field.Label>
                            <RadioGroup.Root
                                value={editForm.format}
                                onValueChange={(v) =>
                                    patchEdit("format", (typeof v === "string" ? v : (v as any)?.value) as TournamentFormat)
                                }
                                disabled={tournamentStarted}
                            >
                                <HStack gap="6" wrap="wrap" rowGap="2">
                                    <RadioGroup.Item value="GROUPS_KNOCKOUT">
                                        <RadioGroup.ItemHiddenInput />
                                        <RadioGroup.ItemIndicator />
                                        <RadioGroup.ItemText>Grupe + eliminacija</RadioGroup.ItemText>
                                    </RadioGroup.Item>
                                    <RadioGroup.Item value="KNOCKOUT_ONLY">
                                        <RadioGroup.ItemHiddenInput />
                                        <RadioGroup.ItemIndicator />
                                        <RadioGroup.ItemText>Samo eliminacija</RadioGroup.ItemText>
                                    </RadioGroup.Item>
                                </HStack>
                            </RadioGroup.Root>
                        </Field.Root>

                        <FormatSketch format={editForm.format} />

                        {editForm.format === "GROUPS_KNOCKOUT" && (
                            <>
                                <Box
                                    display="grid"
                                    gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }}
                                    gap="4"
                                >
                                    <Field.Root>
                                        <Field.Label>Broj grupa</Field.Label>
                                        <Input
                                            type="number"
                                            inputMode="numeric"
                                            min={2}
                                            disabled={tournamentStarted}
                                            value={editForm.groupCount}
                                            onChange={(e) => patchEdit("groupCount", sanitizeInt(e.target.value))}
                                        />
                                    </Field.Root>
                                    <Field.Root>
                                        <Field.Label>Ekipa prolazi iz grupe</Field.Label>
                                        <Input
                                            type="number"
                                            inputMode="numeric"
                                            min={1}
                                            disabled={tournamentStarted}
                                            value={editForm.advancePerGroup}
                                            onChange={(e) => patchEdit("advancePerGroup", sanitizeInt(e.target.value))}
                                        />
                                    </Field.Root>
                                </Box>

                                <Field.Root>
                                    <Field.Label>Popunjavanje eliminacijske ljestvice</Field.Label>
                                    <RadioGroup.Root
                                        value={editForm.bracketFill}
                                        onValueChange={(v) =>
                                            patchEdit("bracketFill", (typeof v === "string" ? v : (v as any)?.value) as BracketFill)
                                        }
                                        disabled={tournamentStarted}
                                    >
                                        <VStack align="stretch" gap="2">
                                            <RadioGroup.Item value="BYES">
                                                <RadioGroup.ItemHiddenInput />
                                                <RadioGroup.ItemIndicator />
                                                <RadioGroup.ItemText>
                                                    Slobodan prolaz — najbolje ekipe preskaču prvo kolo kad broj ekipa nije potpun
                                                </RadioGroup.ItemText>
                                            </RadioGroup.Item>
                                            <RadioGroup.Item value="WILDCARDS">
                                                <RadioGroup.ItemHiddenInput />
                                                <RadioGroup.ItemIndicator />
                                                <RadioGroup.ItemText>
                                                    Najbolji trećeplasirani — dodatne ekipe popunjavaju ljestvicu
                                                </RadioGroup.ItemText>
                                            </RadioGroup.Item>
                                        </VStack>
                                    </RadioGroup.Root>
                                </Field.Root>
                            </>
                        )}

                        {editForm.format === "KNOCKOUT_ONLY" && (
                            <Box fontSize="sm" color="fg.muted">
                                Sve prijavljene ekipe idu izravno u eliminacijsku ljestvicu, bez grupne faze.
                            </Box>
                        )}
                    </VStack>
                </FormSectionCard>

                {/* Nagradni fond — amount + free-text note per place (4 places). */}
                <FormSectionCard
                    icon={<FiGift />}
                    title="Nagradni fond"
                    description="Za svako mjesto upiši iznos (€) i po želji dodatnu napomenu (npr. Pehar, Prijelazni pehar). Sve je neobavezno."
                >
                    <VStack align="stretch" gap="3">
                        <Box
                            display={{ base: "none", md: "grid" }}
                            gridTemplateColumns="60px 130px 1fr"
                            gap="3"
                            px="1"
                            fontFamily="mono"
                            fontSize="10px"
                            fontWeight={800}
                            letterSpacing="0.12em"
                            color="fg.muted"
                        >
                            <Box>MJESTO</Box>
                            <Box>IZNOS</Box>
                            <Box>OSTALO</Box>
                        </Box>
                        {([
                            { amountKey: "rewardFirst", noteKey: "rewardFirstNote", label: "1." },
                            { amountKey: "rewardSecond", noteKey: "rewardSecondNote", label: "2." },
                            { amountKey: "rewardThird", noteKey: "rewardThirdNote", label: "3." },
                            { amountKey: "rewardFourth", noteKey: "rewardFourthNote", label: "4." },
                        ] as const).map((r) => (
                            <Box
                                key={r.amountKey}
                                display="grid"
                                gridTemplateColumns={{ base: "1fr", md: "60px 130px 1fr" }}
                                gap="3"
                                alignItems="center"
                            >
                                <Flex
                                    w="28px"
                                    h="28px"
                                    rounded="full"
                                    align="center"
                                    justify="center"
                                    bg="brand.subtle"
                                    color="brand.fg"
                                    fontWeight={800}
                                    fontSize="13px"
                                    flexShrink={0}
                                >
                                    {r.label}
                                </Flex>
                                <SuffixInput
                                    value={editForm[r.amountKey]}
                                    onChange={(v) => patchEdit(r.amountKey, sanitizeMoney(v))}
                                    suffix="€"
                                    placeholder="0"
                                />
                                <Input
                                    value={editForm[r.noteKey]}
                                    onChange={(e) => patchEdit(r.noteKey, e.target.value)}
                                    placeholder="npr. Pehar, Prijelazni pehar…"
                                    maxLength={200}
                                />
                            </Box>
                        ))}
                    </VStack>
                </FormSectionCard>

                {/* Floating save capsule — sticky at the bottom-RIGHT of the form
                    content (aligned to the content edge, not the viewport corner),
                    floating above the footer while the form scrolls. Bottom offset
                    clears the mobile bottom nav (≈92px) / desktop footer. */}
                <Box
                    position="sticky"
                    alignSelf="flex-end"
                    bottom={{
                        base: "calc(96px + env(safe-area-inset-bottom, 0px))",
                        md: "72px",
                    }}
                    zIndex={950}
                    mt="1"
                >
                    <VStack
                        align="stretch"
                        gap="2"
                        bg="bg.panel"
                        borderWidth="1px"
                        borderColor="border.emphasized"
                        rounded="2xl"
                        p="3"
                        maxW="320px"
                        css={{ boxShadow: "0 8px 28px rgba(14,31,21,0.16)" }}
                    >
                        {/* Only the blocking states get a line; the "ready"
                            message was removed on request. */}
                        {(editStartInPast || editMissingRequired.length > 0) && (
                            <Text fontSize="xs" color="red.fg" textAlign="right">
                                {editStartInPast
                                    ? "Datum/vrijeme ne mogu biti u prošlosti."
                                    : `Nedostaje: ${editMissingRequired.join(", ")}`}
                            </Text>
                        )}
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
    // Prize fund — up to 4 places, each an amount + optional note ("Ostalo").
    // A place is shown only if it has an amount or a note. Medal-tint for the
    // top three, neutral for 4th.
    const prizeColors = ["#f5c842", "#c0c5cc", "#cd8654", "#9aa6b2"]
    const rewardRows = [
        { place: 1, amount: t.rewardFirst, note: t.rewardFirstNote },
        { place: 2, amount: t.rewardSecond, note: t.rewardSecondNote },
        { place: 3, amount: t.rewardThird, note: t.rewardThirdNote },
        { place: 4, amount: t.rewardFourth, note: t.rewardFourthNote },
    ].filter((r) => r.amount != null || (r.note && r.note.trim()))
    const totalReward =
        (t.rewardFirst ?? 0) + (t.rewardSecond ?? 0) +
        (t.rewardThird ?? 0) + (t.rewardFourth ?? 0)

    return (
        <VStack align="stretch" gap="6">
            {/* ── Top row: Organizator · Kontakt · Datum · Vrijeme (equal boxes) ── */}
            <Grid templateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }} gap="3">
                {/* Organizator */}
                {t.createdByName ? (
                    <Box position="relative" bg="bg.panel" borderWidth="1px" borderColor="border" rounded="lg" px="4" py="3" overflow="hidden">
                        <Box position="absolute" top="0" left="0" w="3px" h="100%" bg="var(--chakra-colors-pitch-600)" />
                        <HStack color="fg.muted" gap="1.5">
                            <FiUser size={12} />
                            <MonoLabel>ORGANIZATOR</MonoLabel>
                        </HStack>
                        <HStack gap="2" mt="1.5">
                            <Flex
                                w="28px"
                                h="28px"
                                rounded="full"
                                bgImage="linear-gradient(135deg, #3aa56b, #0b6b3a)"
                                color="white"
                                align="center"
                                justify="center"
                                fontSize="11px"
                                fontWeight={700}
                                flexShrink={0}
                            >
                                {t.createdByName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                            </Flex>
                            <Text fontSize="15px" fontWeight={700} color="fg.ink" lineHeight="1.2" truncate>
                                {t.createdByName}
                            </Text>
                        </HStack>
                    </Box>
                ) : (
                    <Box />
                )}
                {/* Kontakt */}
                <Box position="relative" bg="bg.panel" borderWidth="1px" borderColor="border" rounded="lg" px="4" py="3" overflow="hidden">
                    <Box position="absolute" top="0" left="0" w="3px" h="100%" bg="var(--chakra-colors-pitch-600)" />
                    <HStack color="fg.muted" gap="1.5">
                        <FiPhone size={12} />
                        <MonoLabel>KONTAKT</MonoLabel>
                    </HStack>
                    <Box mt="1.5">
                        {t.contactName || t.contactPhone ? (
                            <>
                                {t.contactName && (
                                    <Text fontSize="15px" fontWeight={700} color="fg.ink" lineHeight="1.2" truncate>
                                        {t.contactName}
                                    </Text>
                                )}
                                {t.contactPhone && (
                                    <chakra.a
                                        href={`tel:${t.contactPhone.replace(/\s+/g, "")}`}
                                        color="pitch.500"
                                        fontSize="13px"
                                        fontWeight={600}
                                        display="inline-flex"
                                        alignItems="center"
                                        gap="1"
                                        _hover={{ textDecoration: "underline" }}
                                    >
                                        <FiPhone size={11} /> {t.contactPhone}
                                    </chakra.a>
                                )}
                            </>
                        ) : (
                            <Text fontSize="14px" color="fg.muted">Nije navedeno</Text>
                        )}
                    </Box>
                </Box>
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
            </Grid>

            {/* ── Main: plakat (left) + sadržaj (right) ── */}
            <Grid templateColumns={{ base: "1fr", md: "380px 1fr" }} gap="6" alignItems="start">
            {/* Left column: plakat → QR → admin */}
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

                {/* QR kod — directly below the poster. Links to this
                    tournament's page, server-rendered with the brand mark in
                    the centre; downloadable so the organizer can print it and
                    stick it up at the venue. */}
                <SectionCard
                    icon={FiGrid}
                    title="QR kod"
                >
                    <VStack align="stretch" gap="3">
                        <Flex justify="center">
                            <chakra.img
                                src={`/api/tournaments/${t.slug ?? t.uuid}/qr.png`}
                                alt={`QR kod za turnir ${t.name}`}
                                w="200px"
                                h="200px"
                                rounded="lg"
                                borderWidth="1px"
                                borderColor="border"
                                bg="white"  
                                p="2.5"
                                loading="lazy"
                            />
                        </Flex>
                        <chakra.a
                            href={`/api/tournaments/${t.slug ?? t.uuid}/qr.png`}
                            download={`qr-${t.slug ?? t.uuid}.png`}
                            display="inline-flex"
                            alignItems="center"
                            justifyContent="center"
                            gap="2"
                            bg="pitch.500"
                            color="white"
                            fontWeight={600}
                            fontSize="14px"
                            px="4"
                            py="2.5"
                            rounded="lg"
                            _hover={{ bg: "pitch.600" }}
                        >
                            <FiDownload size={15} /> Preuzmi QR
                        </chakra.a>
                    </VStack>
                </SectionCard>

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

            {/* ── Right column: ekipe/kotizacija/detalji + lokacija + nagrade ── */}
            <VStack align="stretch" gap="3">
                {/* Lijevo: kompaktni Ekipe + Kotizacija pa Lokacija · Desno: Detalji */}
                <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="3" alignItems="stretch">
                    {/* Left: ekipe/kotizacija (compact) + lokacija below */}
                    <VStack align="stretch" gap="3">
                        <Grid templateColumns="1fr 1fr" gap="3">
                            <AccentStat
                                accent="var(--chakra-colors-accent-amber)"
                                icon={<FiUsers size={12} />}
                                label="EKIPE"
                                value={`${teamCount}${typeof t.maxTeams === "number" ? ` / ${t.maxTeams}` : ""}`}
                            />
                            {typeof t.entryPrice === "number" ? (
                                <AccentStat
                                    accent="var(--chakra-colors-accent-goal)"
                                    icon={<FiDollarSign size={12} />}
                                    label="KOTIZACIJA"
                                    value={fmtMoney(t.entryPrice)}
                                />
                            ) : (
                                <Box />
                            )}
                        </Grid>
                        {t.location && (
                            <Box
                                bg="bg.panel"
                                borderWidth="1px"
                                borderColor="border"
                                rounded="xl"
                                p="5"
                                flex="1"
                                display="flex"
                                flexDirection="column"
                            >
                                <HStack gap="3" align="start">
                                    <Flex
                                        w="36px"
                                        h="36px"
                                        rounded="lg"
                                        bg="bg.surfaceTint"
                                        align="center"
                                        justify="center"
                                        color="pitch.500"
                                        flexShrink={0}
                                    >
                                        <FiMapPin size={16} />
                                    </Flex>
                                    <Box minW="0">
                                        <Text fontSize="15px" fontWeight={700} color="fg.ink">
                                            Lokacija
                                        </Text>
                                        <Text fontSize="13px" color="fg.muted">
                                            {t.location}
                                        </Text>
                                    </Box>
                                </HStack>
                                <chakra.a
                                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.location)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    display="inline-flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    gap="1.5"
                                    bg="bg.surfaceTint"
                                    color="pitch.500"
                                    px="3.5"
                                    py="2.5"
                                    rounded="full"
                                    fontSize="13px"
                                    fontWeight={600}
                                    textDecoration="none"
                                    mt="auto"
                                    pt="4"
                                    w="fit-content"
                                    _hover={{ bg: "pitch.100", textDecoration: "none" }}
                                >
                                    <FiExternalLink /> Otvori u kartama
                                </chakra.a>
                            </Box>
                        )}
                    </VStack>

                    {/* Right: Detalji — opisni tekst iznad strukture formata */}
                    {(t.details || t.format || t.gameSystem || t.websiteUrl || (t.additionalOptions?.length ?? 0) > 0) ? (
                        <Box bg="bg.panel" borderWidth="1px" borderColor="border" rounded="xl" p="5">
                            <HStack color="fg.muted" gap="1.5" mb="3">
                                <FiInfo size={13} />
                                <MonoLabel>DETALJI I FORMAT</MonoLabel>
                            </HStack>
                            {t.details && (
                                <Text fontSize="14px" color="fg.soft" lineHeight={1.6} whiteSpace="pre-wrap" mb="3">
                                    {t.details}
                                </Text>
                            )}
                            {t.gameSystem && (
                                <HStack gap="2" mb="3" fontSize="14px">
                                    <Text fontWeight={700} color="fg.ink">Sistem igre:</Text>
                                    <Badge variant="subtle" colorPalette="pitch" size="sm">
                                        {t.gameSystem}
                                    </Badge>
                                </HStack>
                            )}
                            {t.format && <FormatSketch format={t.format} />}
                            {t.additionalOptions && t.additionalOptions.length > 0 && (
                                <HStack wrap="wrap" gap="1.5" mt="3">
                                    {t.additionalOptions.map((opt) => (
                                        <Badge key={opt} variant="solid" colorPalette="pitch" size="sm">
                                            {opt}
                                        </Badge>
                                    ))}
                                </HStack>
                            )}
                            {t.websiteUrl && (
                                <chakra.a
                                    href={/^https?:\/\//i.test(t.websiteUrl) ? t.websiteUrl : `https://${t.websiteUrl}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    display="inline-flex"
                                    alignItems="center"
                                    gap="1.5"
                                    bg="bg.surfaceTint"
                                    color="pitch.500"
                                    px="3.5"
                                    py="2.5"
                                    rounded="full"
                                    fontSize="13px"
                                    fontWeight={600}
                                    textDecoration="none"
                                    mt="3"
                                    w="fit-content"
                                    _hover={{ bg: "pitch.100", textDecoration: "none" }}
                                >
                                    <FiExternalLink /> Web stranica organizatora
                                </chakra.a>
                            )}
                        </Box>
                    ) : (
                        <Box />
                    )}
                </Grid>

                {/* Nagradni fond — Mjesto / Iznos / Ostalo table. */}
                {rewardRows.length > 0 && (
                    <SectionCard
                        icon={FiGift}
                        title="Nagradni fond"
                        action={
                            totalReward > 0 ? (
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
                        <Box
                            borderWidth="1px"
                            borderColor="border"
                            rounded="lg"
                            overflow="hidden"
                        >
                            {/* Header */}
                            <Box
                                display="grid"
                                gridTemplateColumns="64px 110px 1fr"
                                gap="3"
                                px="4"
                                py="2.5"
                                bg="bg.surfaceTint"
                                fontFamily="mono"
                                fontSize="10px"
                                fontWeight={800}
                                letterSpacing="0.12em"
                                color="fg.muted"
                            >
                                <Box>MJESTO</Box>
                                <Box>IZNOS</Box>
                                <Box>OSTALO</Box>
                            </Box>
                            {rewardRows.map((r, i) => {
                                const color = prizeColors[r.place - 1] ?? prizeColors[3]
                                return (
                                    <Box
                                        key={r.place}
                                        display="grid"
                                        gridTemplateColumns="64px 110px 1fr"
                                        gap="3"
                                        px="4"
                                        py="3"
                                        alignItems="center"
                                        borderTopWidth={i === 0 ? "0" : "1px"}
                                        borderColor="border"
                                    >
                                        <Flex align="center" gap="2">
                                            <Flex
                                                w="26px"
                                                h="26px"
                                                rounded="full"
                                                bgImage={`linear-gradient(145deg, ${color}, ${color}cc)`}
                                                align="center"
                                                justify="center"
                                                color="white"
                                                flexShrink={0}
                                            >
                                                <FaTrophy size={13} />
                                            </Flex>
                                            <Text fontWeight={800} color="fg.ink">
                                                {r.place}
                                            </Text>
                                        </Flex>
                                        <Text
                                            fontFamily="heading"
                                            fontSize="16px"
                                            fontWeight={800}
                                            color="fg.ink"
                                            letterSpacing="-0.01em"
                                        >
                                            {r.amount != null ? fmtMoney(r.amount) : "—"}
                                        </Text>
                                        <Text fontSize="sm" color={r.note ? "fg.ink" : "fg.muted"}>
                                            {r.note?.trim() || "—"}
                                        </Text>
                                    </Box>
                                )
                            })}
                        </Box>
                    </SectionCard>
                )}
            </VStack>
        </Grid>
        </VStack>
    )
}
