import React, { useEffect, useMemo, useState } from "react"
import {
    Box,
    Button,
    Flex,
    Grid,
    Heading,
    HStack,
    IconButton,
    Input,
    Menu,
    Portal,
    Skeleton,
    Slider,
    Stack,
    Text,
    VStack,
} from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import {
    FiCalendar,
    FiChevronDown,
    FiChevronRight,
    FiChevronUp,
    FiClock,
    FiFilter,
    FiGrid,
    FiList,
    FiMapPin,
    FiNavigation,
    FiCheck,
    FiPlus,
    FiSearch,
    FiSliders,
    FiX,
} from "react-icons/fi"
import type { TournamentCard } from "../types/tournaments"
import { fetchTournaments, fetchTournamentsCount } from "../api/tournaments"
import { fetchLiveMatches, pickFeaturedFirst, type LiveMatch } from "../api/live"
import { useUserLocation } from "../hooks/useUserLocation"
import { haversineKm } from "../utils/distance"
import { useDocumentHead } from "../hooks/useDocumentHead"
import {
    BallIcon,
    DateStamp,
    MonoLabel,
    PitchBackdrop,
    PulseDot,
    StatusChip,
    TintButton,
    TournamentPoster,
} from "../ui/pitch"

/* ──────────────────────────────────────────────────────────────────────────
   Turniri (listing) — "Pitch" theme.

   Layout:
     1. Live scoreboard hero        (rendered when a live match exists)
     2. Search + filter toolbar     (Filteri, view switcher, kotizacija slider)
     3. Status filter chips         (Svi turniri / Uživo / Nadolazeći / …)
     4. "Predstojeći turniri" grid  — 3-column tournament cards
     5. "Završeni turniri" section  — same card layout, finished variant
   ────────────────────────────────────────────────────────────────────── */

type TournamentCardWithUuid = TournamentCard & { uuid: string }

// ---------- formatters ----------
const HR_MONTHS_SHORT = [
    "SIJ", "VEL", "OŽU", "TRA", "SVI", "LIP", "SRP", "KOL", "RUJ", "LIS", "STU", "PRO",
]
const HR_WEEKDAYS_SHORT = ["NED", "PON", "UTO", "SRI", "ČET", "PET", "SUB"]

function formatTime(iso?: string | null) {
    if (!iso) return "—"
    const d = new Date(iso)
    return new Intl.DateTimeFormat("hr-HR", { hour: "2-digit", minute: "2-digit" }).format(d)
}
function fmtEuro(n?: number | null) {
    if (typeof n !== "number" || !isFinite(n)) return null
    const s = n.toFixed(2)
    const trimmed = s.endsWith(".00") ? s.slice(0, -3) : s
    return `${trimmed}€`
}
function relativeDays(iso?: string | null): { days: number; label: string } | null {
    if (!iso) return null
    const startMs = new Date(iso).setHours(0, 0, 0, 0)
    const todayMs = new Date().setHours(0, 0, 0, 0)
    const diff = Math.round((startMs - todayMs) / (24 * 60 * 60 * 1000))
    if (diff < 0) return null
    if (diff === 0) return { days: 0, label: "Danas" }
    if (diff === 1) return { days: 1, label: "Sutra" }
    if (diff <= 14) return { days: diff, label: `Za ${diff} dana` }
    return { days: diff, label: "Nadolazeći" }
}

function decomposeDate(iso?: string | null) {
    if (!iso) return null
    const d = new Date(iso)
    return {
        day: HR_WEEKDAYS_SHORT[d.getDay()],
        dayNum: String(d.getDate()).padStart(2, "0"),
        month: HR_MONTHS_SHORT[d.getMonth()],
        time: formatTime(iso),
    }
}

/** Map a tournament + helpers to the shared `StatusKind` the design uses. */
function classifyStatus(
    t: TournamentCardWithUuid,
    variant: "upcoming" | "finished",
): { status: "live" | "upcoming" | "soon" | "full" | "finished"; label: string } {
    if (variant === "finished") return { status: "finished", label: "Završen" }
    if (t.liveMatch) return { status: "live", label: "UŽIVO" }
    const isFull =
        typeof t.registeredTeams === "number" &&
        typeof t.maxTeams === "number" &&
        t.registeredTeams >= t.maxTeams
    if (isFull) return { status: "full", label: "Mjesta puna" }
    const rel = relativeDays(t.startAt)
    if (rel && rel.days > 1 && rel.days <= 7) return { status: "soon", label: rel.label }
    return { status: "upcoming", label: rel?.label ?? "Nadolazeći" }
}

/* ──────────────────────────────────────────────────────────────────────────
   Live scoreboard hero — the dark gradient panel that opens the page when
   at least one match is live. Pulls the highest-watching live match and
   renders the 78px score block.
   ────────────────────────────────────────────────────────────────────── */
function teamShort(name: string | null | undefined): string {
    if (!name) return "??"
    const words = name.trim().split(/\s+/)
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
}

function LiveHero({ match }: { match: LiveMatch }) {
    return (
        <Box
            position="relative"
            rounded="2xl"
            overflow="hidden"
            color="white"
            mb="7"
            bgImage="linear-gradient(135deg, #0b6b3a, #084a28)"
        >
            <PitchBackdrop opacity={0.15} variant="hero" tone="pitch" />
            <Box
                position="absolute"
                inset="0"
                pointerEvents="none"
                bg="repeating-linear-gradient(90deg, transparent 0, transparent 70px, rgba(0,0,0,0.05) 70px, rgba(0,0,0,0.05) 140px)"
            />

            {/* Top sub-bar */}
            <Flex
                position="relative"
                justify="space-between"
                align="center"
                px={{ base: 4, md: 7 }}
                py="3.5"
                borderBottomWidth="1px"
                borderColor="rgba(255,255,255,0.12)"
                bg="rgba(220, 38, 38, 0.18)"
                gap="3"
            >
                <HStack gap="2.5">
                    <PulseDot color="white" size={8} glow />
                    <Box fontFamily="mono" fontSize="11px" fontWeight={700} letterSpacing="0.15em">
                        UŽIVO · MATCHDAY
                    </Box>
                </HStack>
                <Box
                    fontFamily="mono"
                    fontSize="10px"
                    color="rgba(255,255,255,0.65)"
                    letterSpacing="0.1em"
                    display={{ base: "none", md: "block" }}
                    textTransform="uppercase"
                    truncate
                >
                    {match.tournamentName ?? "Tekuća utakmica"}
                </Box>
            </Flex>

            {/* Centre scoreboard */}
            <Grid
                position="relative"
                templateColumns={{ base: "1fr", md: "1fr auto 1fr" }}
                alignItems="center"
                gap={{ base: 5, md: 6 }}
                px={{ base: 4, md: 8 }}
                py={{ base: 5, md: 7 }}
            >
                <HStack gap={{ base: "3", md: "4" }} justify={{ base: "center", md: "flex-end" }} wrap="wrap">
                    <Box textAlign={{ base: "center", md: "right" }}>
                        <MonoLabel color="rgba(255,255,255,0.6)">DOMAĆIN</MonoLabel>
                        <Box
                            fontFamily="heading"
                            fontSize={{ base: "16px", md: "28px" }}
                            fontWeight={700}
                            letterSpacing="-0.02em"
                            lineHeight={1.1}
                            mt="0.5"
                        >
                            {match.team1Name ?? "—"}
                        </Box>
                    </Box>
                    <Flex
                        w={{ base: "44px", md: "64px" }}
                        h={{ base: "44px", md: "64px" }}
                        rounded="lg"
                        bgImage="linear-gradient(145deg, #ff5c4e, #c93026)"
                        align="center"
                        justify="center"
                        fontFamily="heading"
                        fontSize={{ base: "16px", md: "24px" }}
                        fontWeight={800}
                        boxShadow="0 8px 24px rgba(201,48,38,0.45)"
                    >
                        {teamShort(match.team1Name)}
                    </Flex>
                </HStack>

                <Box textAlign="center" px="2">
                    <Box
                        as="span"
                        display="inline-flex"
                        alignItems="center"
                        gap="1.5"
                        fontFamily="mono"
                        fontSize="11px"
                        color="accent.goal"
                        letterSpacing="0.18em"
                        fontWeight={700}
                    >
                        <FiClock size={12} /> UŽIVO ·{" "}
                        {match.secondHalfStartedAt ? "2. POLUVRIJEME" : "1. POLUVRIJEME"}
                    </Box>
                    <Box
                        fontFamily="mono"
                        fontSize={{ base: "40px", md: "78px" }}
                        fontWeight={800}
                        letterSpacing="-0.05em"
                        lineHeight={1}
                        mt="1.5"
                    >
                        {match.score1 ?? 0}
                        <Box as="span" color="rgba(255,255,255,0.35)" px={{ base: "1.5", md: "4" }}>
                            :
                        </Box>
                        {match.score2 ?? 0}
                    </Box>
                    <MonoLabel
                        color="rgba(255,255,255,0.5)"
                        letterSpacing="0.15em"
                        mt="1.5"
                        display="block"
                    >
                        FUTSAL · NOGOMETNI-TURNIRI.COM
                    </MonoLabel>
                </Box>

                <HStack gap={{ base: "3", md: "4" }} justify={{ base: "center", md: "flex-start" }} wrap="wrap">
                    <Flex
                        w={{ base: "44px", md: "64px" }}
                        h={{ base: "44px", md: "64px" }}
                        rounded="lg"
                        bgImage="linear-gradient(145deg, #4d80ff, #1a4dcc)"
                        align="center"
                        justify="center"
                        fontFamily="heading"
                        fontSize={{ base: "16px", md: "24px" }}
                        fontWeight={800}
                        boxShadow="0 8px 24px rgba(26,77,204,0.45)"
                        order={{ base: 2, md: 1 }}
                    >
                        {teamShort(match.team2Name)}
                    </Flex>
                    <Box textAlign={{ base: "center", md: "left" }} order={{ base: 1, md: 2 }}>
                        <MonoLabel color="rgba(255,255,255,0.6)">GOST</MonoLabel>
                        <Box
                            fontFamily="heading"
                            fontSize={{ base: "16px", md: "28px" }}
                            fontWeight={700}
                            letterSpacing="-0.02em"
                            lineHeight={1.1}
                            mt="0.5"
                        >
                            {match.team2Name ?? "—"}
                        </Box>
                    </Box>
                </HStack>
            </Grid>

            {/* Bottom CTA strip */}
            <Flex
                position="relative"
                borderTopWidth="1px"
                borderColor="rgba(255,255,255,0.12)"
                bg="rgba(0,0,0,0.3)"
                px={{ base: 4, md: 7 }}
                py="3.5"
                justify="space-between"
                align="center"
                gap="3"
                wrap="wrap"
            >
                <HStack
                    gap="2"
                    fontFamily="mono"
                    fontSize="11px"
                    color="rgba(255,255,255,0.7)"
                    letterSpacing="0.05em"
                >
                    <BallIcon size={12} color="#f5b921" />
                    <Box>Pratite tijek utakmice u stvarnom vremenu</Box>
                </HStack>
                <Button
                    asChild
                    size="sm"
                    bg="accent.goal"
                    color="fg.ink"
                    fontWeight={700}
                    rounded="md"
                    _hover={{ bg: "#e8aa15" }}
                >
                    <RouterLink to={match.tournamentUuid ? `/turniri/${match.tournamentSlug ?? match.tournamentUuid}` : "/uzivo"}>
                        Prati uživo →
                    </RouterLink>
                </Button>
            </Flex>
        </Box>
    )
}

/* Normalised location string for card display.
 *
 * Geocoded addresses come back from Nominatim as the full reverse-geocode
 * tail — e.g. "Žarovnica, Grad Lepoglava, Varaždinska županija, 42250,
 * Hrvatska". Showing all five segments makes one card look "fuller" than a
 * sibling that only has a city name and creates an inconsistent visual
 * rhythm across the listing grid.
 *
 * Rule: keep the first 1-2 comma segments (venue + city in most cases),
 * drop county / postal code / country. Strip pure numeric segments (postal
 * codes) and the country tail. Final string is then hard-capped to 38
 * characters with an ellipsis — guarantees the row never wraps even at
 * the narrowest mobile viewport (~320px). */
const COUNTRY_TAIL = new Set([
    "hrvatska",
    "croatia",
    "bosna i hercegovina",
    "bih",
    "slovenija",
    "slovenia",
    "srbija",
    "serbia",
    "crna gora",
    "montenegro",
])
function shortLocation(loc: string | null | undefined): string {
    if (!loc) return ""
    const parts = loc
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        // Drop postal codes (pure digits, possibly with spaces) and the
        // country tail; both are noise on a card.
        .filter((p) => !/^\d[\d\s]*$/.test(p))
        .filter((p) => !COUNTRY_TAIL.has(p.toLowerCase()))
    if (parts.length === 0) return loc.trim()
    // Take first two meaningful segments — typically "Venue, City" or
    // just "City". A third "County" segment is dropped so cards stay
    // visually balanced.
    const head = parts.slice(0, 2).join(", ")
    // Hard char cap as a safety net for unusually long venue names.
    return head.length > 38 ? head.slice(0, 36).trimEnd() + "…" : head
}

/* ──────────────────────────────────────────────────────────────────────────
   Tournament card — full Pitch redesign with overlay date stamp, status
   badge, capacity progress bar and pitch-tinted "Detalji →" pill.
   ────────────────────────────────────────────────────────────────────── */
function TournamentCardView({
    t,
    variant,
}: {
    t: TournamentCardWithUuid
    variant: "upcoming" | "finished"
}) {
    const ds = decomposeDate(t.startAt)
    const status = classifyStatus(t, variant)
    const fill =
        typeof t.registeredTeams === "number" && typeof t.maxTeams === "number" && t.maxTeams > 0
            ? Math.min(1, t.registeredTeams / t.maxTeams)
            : 0
    const accent =
        status.status === "live"
            ? "accent.red"
            : status.status === "soon"
                ? "accent.amber"
                : status.status === "full"
                    ? "fg.muted"
                    : status.status === "finished"
                        ? "fg.muted"
                        : "pitch.400"
    const price = fmtEuro(t.entryPrice)
    const winner = (t.winnerName ?? "").trim()

    return (
        <RouterLink
            to={`/turniri/${t.slug ?? t.uuid}`}
            style={{ textDecoration: "none", color: "inherit", display: "block", height: "100%" }}
        >
            <Box
                bg="bg.panel"
                rounded="xl"
                overflow="hidden"
                borderWidth="1px"
                borderColor="border"
                h="full"
                display="flex"
                flexDirection="column"
                transition="transform .15s, box-shadow .15s"
                _hover={{ transform: "translateY(-2px)", shadow: "md" }}
                cursor="pointer"
            >
                {/* Poster area — shorter on mobile so the card stays compact
                     and the body remains the focus. */}
                <Box position="relative" h={{ base: "140px", md: "180px" }}>
                    <TournamentPoster
                        name={t.name}
                        bannerUrl={t.bannerUrl}
                        height="100%"
                        seed={t.uuid}
                    />
                    <Box position="absolute" top="3" left="3">
                        {ds ? <DateStamp day={ds.day} dayNum={ds.dayNum} month={ds.month} /> : null}
                    </Box>
                    <Box position="absolute" top="3" right="3">
                        <StatusChip status={status.status} label={status.label} />
                    </Box>
                    {ds ? (
                        <Flex
                            position="absolute"
                            bottom="3"
                            right="3"
                            bg="rgba(0,0,0,0.55)"
                            color="white"
                            px="2.5"
                            py="1"
                            rounded="md"
                            align="center"
                            gap="1.5"
                            css={{ backdropFilter: "blur(8px)" }}
                        >
                            <FiClock size={12} />
                            <Box fontFamily="mono" fontSize="14px" fontWeight={700} letterSpacing="-0.02em">
                                {ds.time}
                            </Box>
                        </Flex>
                    ) : null}
                </Box>

                {/* Body — flex column with FIXED-HEIGHT title and location
                     rows so every card in a grid row has identical body
                     dimensions regardless of content length. The progress
                     block flows naturally and the footer is pinned to the
                     bottom via `mt="auto"`. A long Croatian address ("…,
                     Varaždinska županija, 42250, Hrvatska") truncates with
                     ellipsis instead of wrapping and stretching the card. */}
                <VStack
                    align="stretch"
                    gap="3"
                    p="4"
                    flex="1"
                    minW="0"
                >
                    {/* Title + location bundled — fixed heights so a
                         one-line name and a two-line name both occupy the
                         same vertical space, and a long address truncates
                         to one line with ellipsis instead of wrapping. */}
                    <Box minW="0">
                        <Heading
                            as="h3"
                            fontSize="17px"
                            fontWeight={700}
                            color="fg.ink"
                            letterSpacing="-0.01em"
                            lineHeight={1.25}
                            m="0"
                            css={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 2,
                                overflow: "hidden",
                                wordBreak: "break-word",
                                // Lock to exactly two line-heights — one-line
                                // and two-line titles take identical space.
                                height: "calc(2 * 17px * 1.25)",
                            }}
                        >
                            {t.name}
                        </Heading>
                        <Box
                            mt="1"
                            h="20px"
                            display="flex"
                            alignItems="center"
                            gap="1"
                            color="fg.muted"
                            fontSize="13px"
                            minW="0"
                            overflow="hidden"
                        >
                            {t.location ? (
                                <>
                                    <Box flexShrink={0} display="inline-flex">
                                        <FiMapPin size={12} />
                                    </Box>
                                    <Box
                                        flex="1"
                                        minW="0"
                                        title={t.location}
                                        css={{
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {shortLocation(t.location)}
                                    </Box>
                                </>
                            ) : null}
                        </Box>
                    </Box>

                    {variant === "finished" && winner ? (
                        <HStack gap="2" align="center">
                            <Box
                                fontFamily="mono"
                                fontSize="10px"
                                color="fg.muted"
                                letterSpacing="0.1em"
                                fontWeight={700}
                            >
                                POBJEDNIK
                            </Box>
                            <Box
                                bg="rgba(245,185,33,0.15)"
                                color="accent.amber"
                                px="2"
                                py="0.5"
                                rounded="full"
                                fontSize="12px"
                                fontWeight={700}
                            >
                                {winner}
                            </Box>
                        </HStack>
                    ) : typeof t.maxTeams === "number" ? (
                        <Box>
                            <Flex justify="space-between" align="baseline" mb="1.5">
                                <Text fontSize="12px" color="fg.muted" fontWeight={500}>
                                    Popunjenost
                                </Text>
                                <Box fontFamily="mono" fontSize="12px" fontWeight={700} color="fg.ink">
                                    {t.registeredTeams ?? 0} / {t.maxTeams}
                                </Box>
                            </Flex>
                            <Box h="6px" bg="bg.surfaceTint" rounded="full" overflow="hidden">
                                <Box
                                    h="100%"
                                    w={`${fill * 100}%`}
                                    rounded="full"
                                    bgImage={`linear-gradient(90deg, var(--chakra-colors-pitch-400), var(--chakra-colors-${
                                        accent === "accent.red"
                                            ? "accent-red"
                                            : accent === "accent.amber"
                                                ? "accent-amber"
                                                : accent === "fg.muted"
                                                    ? "ink-mute"
                                                    : "pitch-400"
                                    }))`}
                                />
                            </Box>
                        </Box>
                    ) : null}

                    <Flex
                        justify="space-between"
                        align="center"
                        pt="3"
                        borderTopWidth="1px"
                        borderColor="border"
                        mt="auto"
                    >
                        <HStack gap="1.5" color="pitch.500" fontWeight={700} fontSize="16px">
                            {price ? (
                                <>
                                    <Box>{price}</Box>
                                    <Box fontSize="11px" color="fg.muted" fontWeight={500}>
                                        kotizacija
                                    </Box>
                                </>
                            ) : (
                                <Box fontSize="13px" color="fg.muted" fontWeight={500}>
                                    Besplatan ulaz
                                </Box>
                            )}
                        </HStack>
                        <TintButton>Detalji →</TintButton>
                    </Flex>
                </VStack>
            </Box>
        </RouterLink>
    )
}

/** Skeleton matching the card shape. */
function CardSkeleton() {
    return (
        <Box bg="bg.panel" borderWidth="1px" borderColor="border" rounded="xl" overflow="hidden">
            <Skeleton h="180px" />
            <VStack align="stretch" gap="2" p="4">
                <Skeleton h="4" w="70%" />
                <Skeleton h="3" w="50%" />
                <Skeleton h="2" w="100%" mt="2" />
            </VStack>
        </Box>
    )
}

/** Dashed-border empty state with the pitch backdrop, used both for filtered
 *  empty results and for the "Završeni turniri" empty case. */
function EmptyState({
    title,
    description,
    cta,
    withBackdrop = true,
}: {
    title: string
    description?: string
    cta?: React.ReactNode
    withBackdrop?: boolean
}) {
    return (
        <Box
            position="relative"
            overflow="hidden"
            bg="bg.panel"
            borderStyle="dashed"
            borderWidth="1px"
            borderColor="border"
            rounded="xl"
            py="12"
            px="6"
            textAlign="center"
        >
            {withBackdrop ? (
                <Box position="absolute" inset="0" opacity={0.04} pointerEvents="none">
                    <PitchBackdrop opacity={1} />
                </Box>
            ) : null}
            <Box position="relative">
                <Flex
                    display="inline-flex"
                    align="center"
                    justify="center"
                    w="56px"
                    h="56px"
                    rounded="full"
                    bg="bg.surfaceTint"
                    color="pitch.500"
                    mx="auto"
                    mb="3"
                >
                    <FiCalendar size={22} />
                </Flex>
                <Heading size="md" color="fg.ink">
                    {title}
                </Heading>
                {description ? (
                    <Text color="fg.muted" fontSize="sm" mt="1" maxW="md" mx="auto">
                        {description}
                    </Text>
                ) : null}
                {cta ? <Box mt="3">{cta}</Box> : null}
            </Box>
        </Box>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   List view (by month) — moved here from /uzivo. Renders the upcoming
   tournaments as compact rows grouped first by month, then by day. The
   grid view stays the default; this is the alternate, calendar-style read.
   ────────────────────────────────────────────────────────────────────── */

const HR_MONTHS_NOM = [
    "Siječanj", "Veljača", "Ožujak", "Travanj", "Svibanj", "Lipanj",
    "Srpanj", "Kolovoz", "Rujan", "Listopad", "Studeni", "Prosinac",
]
const HR_MONTHS_GEN = [
    "siječnja", "veljače", "ožujka", "travnja", "svibnja", "lipnja",
    "srpnja", "kolovoza", "rujna", "listopada", "studenoga", "prosinca",
]
const HR_WEEKDAYS = [
    "Nedjelja", "Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota",
]
function pad2(n: number): string {
    return String(n).padStart(2, "0")
}
function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function dayHeading(d: Date, today: Date): string {
    const diff = Math.round(
        (startOfDay(d).getTime() - startOfDay(today).getTime()) / 86400000,
    )
    if (diff === 0) return "Danas"
    if (diff === 1) return "Sutra"
    return `${HR_WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${HR_MONTHS_GEN[d.getMonth()]}`
}
function timeLabel(iso?: string | null): string {
    if (!iso) return "—"
    return new Intl.DateTimeFormat("hr-HR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}

type MonthGroup = {
    key: string
    label: string
    sort: number
    days: { key: string; date: Date; items: TournamentCard[] }[]
}

/** Group a flat upcoming-tournament list into month → day buckets,
 *  chronological throughout. Tournaments without a start date are dropped
 *  (they can't be placed on a calendar). */
function groupByMonth(items: TournamentCard[]): MonthGroup[] {
    const months = new Map<string, MonthGroup>()
    for (const t of items) {
        if (!t.startAt) continue
        const d = new Date(t.startAt)
        const mKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
        let mg = months.get(mKey)
        if (!mg) {
            mg = {
                key: mKey,
                label: `${HR_MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`,
                sort: d.getFullYear() * 12 + d.getMonth(),
                days: [],
            }
            months.set(mKey, mg)
        }
        const dKey = `${mKey}-${pad2(d.getDate())}`
        let day = mg.days.find((x) => x.key === dKey)
        if (!day) {
            day = { key: dKey, date: d, items: [] }
            mg.days.push(day)
        }
        day.items.push(t)
    }
    const out = [...months.values()].sort((a, b) => a.sort - b.sort)
    for (const m of out) {
        m.days.sort((a, b) => a.date.getTime() - b.date.getTime())
        for (const day of m.days) {
            day.items.sort((a, b) => {
                const ta = a.startAt ? new Date(a.startAt).getTime() : 0
                const tb = b.startAt ? new Date(b.startAt).getTime() : 0
                return ta - tb
            })
        }
    }
    return out
}

/** A single tournament row in the list view. */
function ListRow({ t }: { t: TournamentCard }) {
    return (
        <RouterLink
            to={`/turniri/${t.slug ?? t.uuid}`}
            style={{ textDecoration: "none" }}
        >
            <Flex
                align="center"
                gap="3"
                px="3"
                py="2.5"
                rounded="lg"
                borderWidth="1px"
                borderColor="border"
                bg="bg.panel"
                transition="background 0.15s"
                _hover={{ bg: "bg.surfaceTint" }}
            >
                <Flex
                    direction="column"
                    align="center"
                    justify="center"
                    minW="14"
                    px="2"
                    py="1"
                    rounded="md"
                    bg="pitch.50"
                    color="pitch.500"
                >
                    <Text fontFamily="mono" fontSize="sm" fontWeight={800} lineHeight="1.1">
                        {timeLabel(t.startAt)}
                    </Text>
                </Flex>
                <Box flex="1" minW="0">
                    <Text fontSize="sm" fontWeight={600} truncate color="fg.ink">
                        {t.name}
                    </Text>
                    <HStack gap="1" mt="0.5" color="fg.muted">
                        {t.location ? (
                            <>
                                <FiMapPin size={11} />
                                <Text fontSize="xs" truncate>{t.location}</Text>
                            </>
                        ) : (
                            <>
                                <FiClock size={11} />
                                <Text fontSize="xs">Lokacija nije navedena</Text>
                            </>
                        )}
                    </HStack>
                </Box>
                <Box as="span" color="fg.muted" flexShrink={0}>
                    <FiChevronRight />
                </Box>
            </Flex>
        </RouterLink>
    )
}

/** Segmented-control button for the grid/list view switcher. */
function ViewToggleButton({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean
    onClick: () => void
    icon: React.ReactNode
    label: string
}) {
    return (
        <Box
            as="button"
            onClick={onClick}
            display="inline-flex"
            alignItems="center"
            gap="1.5"
            px="3"
            py="1.5"
            rounded="full"
            fontSize="12px"
            fontWeight={700}
            cursor="pointer"
            bg={active ? "pitch.500" : "transparent"}
            color={active ? "white" : "fg.muted"}
            transition="background 150ms"
            _hover={active ? undefined : { color: "fg.ink" }}
        >
            {icon}
            <Box as="span" display={{ base: "none", sm: "inline" }}>{label}</Box>
        </Box>
    )
}

/** Month-grouped calendar list of upcoming tournaments. */
function UpcomingMonthList({ items }: { items: TournamentCard[] }) {
    const today = useMemo(() => new Date(), [])
    const groups = useMemo(() => groupByMonth(items), [items])

    if (groups.length === 0) {
        return (
            <Text fontSize="sm" color="fg.muted" textAlign="center" py="4">
                Nijedan turnir ne odgovara odabranim filterima.
            </Text>
        )
    }

    return (
        <VStack align="stretch" gap="6">
            {groups.map((m) => (
                <Box key={m.key}>
                    <Flex align="center" gap="3" mb="3">
                        <Heading
                            fontFamily="heading"
                            fontSize="18px"
                            fontWeight={700}
                            letterSpacing="-0.02em"
                            color="fg.ink"
                        >
                            {m.label}
                        </Heading>
                        <Box flex="1" h="1px" bg="border" />
                        <Text fontFamily="mono" fontSize="11px" fontWeight={700} color="pitch.500" letterSpacing="0.05em">
                            {m.days.reduce((s, d) => s + d.items.length, 0)}
                        </Text>
                    </Flex>
                    <VStack align="stretch" gap="4">
                        {m.days.map((day) => (
                            <Box key={day.key}>
                                <MonoLabel color="pitch.500">
                                    {dayHeading(day.date, today)}
                                </MonoLabel>
                                <VStack align="stretch" gap="1.5" mt="2">
                                    {day.items.map((t) => (
                                        <ListRow key={t.uuid} t={t} />
                                    ))}
                                </VStack>
                            </Box>
                        ))}
                    </VStack>
                </Box>
            ))}
        </VStack>
    )
}

/* ────────────────────────────────────────────────────────────────── page ── */
const FINISHED_PREVIEW_LIMIT = 6
const RADIUS_MAX_KM = 100

/* ── Sort options ──────────────────────────────────────────────────────────
   Driven by the toolbar's "Sortiraj" menu. Each entry has:
     - key:   internal id (also persisted to localStorage if we add it later)
     - label: Croatian copy shown in the menu + in the active button label
     - cmp:   pure comparator on TournamentCardWithUuid pairs

   Comparator helpers normalise missing values: a tournament without a date
   sorts to the END of any date-based ordering, a missing entryPrice sorts to
   the END of the cheapest-first ordering, and so on — the user shouldn't
   see "unknown" rows interleaved with sorted ones.
   ────────────────────────────────────────────────────────────────── */
type SortMode = "date_asc" | "date_desc" | "price_asc" | "popular" | "name_asc"
const SORT_OPTIONS: Array<{ key: SortMode; label: string; description: string }> = [
    { key: "date_asc", label: "Najraniji prvi", description: "Datum početka, najbliži prvi" },
    { key: "date_desc", label: "Najkasniji prvi", description: "Datum početka, najudaljeniji prvi" },
    { key: "price_asc", label: "Najjeftiniji", description: "Kotizacija od najniže" },
    { key: "popular", label: "Najpopularniji", description: "Najviše prijavljenih ekipa" },
    { key: "name_asc", label: "Po imenu A-Ž", description: "Abecedno po imenu turnira" },
]
function sortTournaments(
    list: TournamentCardWithUuid[],
    mode: SortMode,
): TournamentCardWithUuid[] {
    // Always operate on a copy — the `filtered` array comes straight from a
    // .filter() and mutating it would also mutate the upstream state-derived
    // memo on re-render.
    const arr = [...list]
    const dateOf = (t: TournamentCardWithUuid): number =>
        t.startAt ? new Date(t.startAt).getTime() : Number.POSITIVE_INFINITY
    const fillRatio = (t: TournamentCardWithUuid): number => {
        if (typeof t.registeredTeams !== "number" || typeof t.maxTeams !== "number" || t.maxTeams <= 0) {
            return -1 // unknowns sort last under desc
        }
        return t.registeredTeams / t.maxTeams
    }
    switch (mode) {
        case "date_asc":
            return arr.sort((a, b) => dateOf(a) - dateOf(b))
        case "date_desc":
            return arr.sort((a, b) => dateOf(b) - dateOf(a))
        case "price_asc":
            return arr.sort((a, b) => {
                const ap = typeof a.entryPrice === "number" ? a.entryPrice : Number.POSITIVE_INFINITY
                const bp = typeof b.entryPrice === "number" ? b.entryPrice : Number.POSITIVE_INFINITY
                if (ap !== bp) return ap - bp
                return dateOf(a) - dateOf(b)
            })
        case "popular":
            return arr.sort((a, b) => {
                const diff = fillRatio(b) - fillRatio(a)
                if (diff !== 0) return diff
                return dateOf(a) - dateOf(b)
            })
        case "name_asc":
            return arr.sort((a, b) =>
                a.name.localeCompare(b.name, "hr", { sensitivity: "base" }),
            )
    }
}

export default function TournamentsPage() {
    useDocumentHead({
        title: "Futsal turniri u Hrvatskoj — nogometni-turniri.com",
        description:
            "Pregled svih nadolazećih i odigranih Futsal turnira u Hrvatskoj i regiji. Pretraži po lokaciji, datumu i cijeni.",
        ogTitle: "Futsal turniri u Hrvatskoj",
        ogDescription:
            "Pregled svih nadolazećih i odigranih Futsal turnira u Hrvatskoj i regiji.",
        ogType: "website",
        canonical: "https://nogometni-turniri.com/turniri",
    })

    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [loadingFinished, setLoadingFinished] = useState(true)
    const [errorFinished, setErrorFinished] = useState<string | null>(null)

    const [upcoming, setUpcoming] = useState<TournamentCardWithUuid[]>([])
    const [finished, setFinished] = useState<TournamentCardWithUuid[]>([])
    const [finishedTotal, setFinishedTotal] = useState(0)
    const [loadingMoreFinished, setLoadingMoreFinished] = useState(false)
    const [liveTop, setLiveTop] = useState<LiveMatch | null>(null)

    // ---- Search + filters ----
    const [filtersOpen, setFiltersOpen] = useState(false)
    // Upcoming-section view mode: "grid" (cards, default) or "list"
    // (compact rows grouped by month — the calendar moved here from /uzivo).
    const [upcomingView, setUpcomingView] = useState<"grid" | "list">("grid")
    const [sortMode, setSortMode] = useState<SortMode>("date_asc")
    const [search, setSearch] = useState("")
    const [locationFilter, setLocationFilter] = useState("")
    const [priceMin, setPriceMin] = useState("")
    const [priceMax, setPriceMax] = useState("")
    const [radiusKm, setRadiusKm] = useState<number>(RADIUS_MAX_KM)

    const { pos: userPos, status: geoStatus, request: requestLocation } = useUserLocation()

    const sanitizeNum = (s: string) => s.replace(/[^\d.,]/g, "").replace(",", ".")
    const parseNum = (s: string): number | null => {
        if (!s.trim()) return null
        const n = parseFloat(s)
        return Number.isFinite(n) ? n : null
    }
    const activeFilterCount =
        (locationFilter.trim() ? 1 : 0) +
        (priceMin.trim() ? 1 : 0) +
        (priceMax.trim() ? 1 : 0) +
        (userPos && radiusKm < RADIUS_MAX_KM ? 1 : 0)
    const resetFilters = () => {
        setSearch("")
        setLocationFilter("")
        setPriceMin("")
        setPriceMax("")
        setRadiusKm(RADIUS_MAX_KM)
    }

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                setLoading(true)
                setError(null)
                setLoadingFinished(true)
                setErrorFinished(null)
                const [dataUpcoming, dataFinishedPage, finishedTotalCount, live] = await Promise.all([
                    fetchTournaments("upcoming"),
                    fetchTournaments("finished", { offset: 0, limit: FINISHED_PREVIEW_LIMIT }),
                    fetchTournamentsCount("finished"),
                    fetchLiveMatches().catch(() => []),
                ])
                if (!cancelled) {
                    setUpcoming(dataUpcoming as TournamentCardWithUuid[])
                    setFinished(dataFinishedPage as TournamentCardWithUuid[])
                    setFinishedTotal(finishedTotalCount)
                    // Promote a match from the admin-featured tournament
                    // when one is live; otherwise fall back to the first
                    // live match the backend returned. `pickFeaturedFirst`
                    // sorts: featured-tournament matches first (most
                    // recently featured wins on ties), then by
                    // liveStartedAt asc.
                    setLiveTop(pickFeaturedFirst(live)[0] ?? null)
                }
            } catch (e: any) {
                if (!cancelled) {
                    setError(e?.message ?? "Failed to load tournaments")
                    setErrorFinished(e?.message ?? "Failed to load finished tournaments")
                    setUpcoming([])
                    setFinished([])
                    setFinishedTotal(0)
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                    setLoadingFinished(false)
                }
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    async function loadMoreFinished() {
        if (loadingMoreFinished) return
        if (finished.length >= finishedTotal) return
        setLoadingMoreFinished(true)
        try {
            const next = await fetchTournaments("finished", {
                offset: finished.length,
                limit: FINISHED_PREVIEW_LIMIT,
            })
            setFinished((prev) => [...prev, ...(next as TournamentCardWithUuid[])])
        } catch {
            /* toast surfaces error */
        } finally {
            setLoadingMoreFinished(false)
        }
    }

    const finishedHasMore = finished.length < finishedTotal

    const filteredUpcoming = useMemo(() => {
        const q = search.trim().toLowerCase()
        const loc = locationFilter.trim().toLowerCase()
        const min = parseNum(priceMin)
        const max = parseNum(priceMax)
        const me = userPos ? { lat: userPos[0], lng: userPos[1] } : null
        const filtered = upcoming.filter((t) => {
            if (q && !t.name.toLowerCase().includes(q)) return false
            if (loc && !(t.location ?? "").toLowerCase().includes(loc)) return false
            if (typeof t.entryPrice === "number") {
                if (min != null && t.entryPrice < min) return false
                if (max != null && t.entryPrice > max) return false
            } else if (min != null || max != null) {
                return false
            }
            if (me && radiusKm < RADIUS_MAX_KM) {
                if (typeof t.latitude !== "number" || typeof t.longitude !== "number") return false
                if (haversineKm(me, { lat: t.latitude, lng: t.longitude }) > radiusKm) return false
            }
            return true
        })
        return sortTournaments(filtered, sortMode)
    }, [upcoming, search, locationFilter, priceMin, priceMax, userPos, radiusKm, sortMode])

    const isFiltering = search.trim().length > 0 || activeFilterCount > 0

    const gridCols = { base: "1fr", md: "1fr 1fr", lg: "repeat(3, 1fr)" }

    return (
        <VStack align="stretch" gap="7">
            {liveTop ? <LiveHero match={liveTop} /> : null}

            {/* ── Toolbar ─────────────────────────────────────────────────── */}
            <Box>
                <Stack direction={{ base: "column", md: "row" }} gap="3" align="stretch">
                    {/* Search */}
                    <Box position="relative" flex="1" minW={{ base: "100%", md: "260px" }}>
                        <Box
                            position="absolute"
                            left="4"
                            top="50%"
                            color="fg.muted"
                            pointerEvents="none"
                            css={{ transform: "translateY(-50%)" }}
                        >
                            <FiSearch />
                        </Box>
                        <Input
                            pl="10"
                            pr={search ? "16" : "4"}
                            h="46px"
                            bg="bg.panel"
                            borderColor="border"
                            rounded="lg"
                            placeholder="Pretraži po imenu turnira, gradu ili dvorani…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <Box
                            position="absolute"
                            right="3"
                            top="50%"
                            display={{ base: "none", md: "block" }}
                            css={{ transform: "translateY(-50%)" }}
                        >
                            {search ? (
                                <IconButton
                                    aria-label="Očisti pretragu"
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => setSearch("")}
                                >
                                    <FiX />
                                </IconButton>
                            ) : (
                                <Box
                                    fontFamily="mono"
                                    fontSize="10px"
                                    color="fg.muted"
                                    bg="bg.surfaceTint"
                                    px="1.5"
                                    py="0.5"
                                    rounded="sm"
                                >
                                    ⌘ K
                                </Box>
                            )}
                        </Box>
                    </Box>
                    {/* Filter controls — kept on a single row on mobile too
                        (no wrap), with slightly smaller buttons so Filteri +
                        Sortiraj + the grid/list toggle all fit one line. */}
                    <HStack
                        gap="2"
                        wrap={{ base: "nowrap", md: "wrap" }}
                        justify={{ base: "space-between", md: "flex-start" }}
                    >
                        <Button
                            h={{ base: "40px", md: "46px" }}
                            px={{ base: "3", md: "4" }}
                            flexShrink={1}
                            bg={activeFilterCount > 0 ? "pitch.500" : "bg.panel"}
                            color={activeFilterCount > 0 ? "white" : "fg.ink"}
                            borderWidth="1px"
                            borderColor={activeFilterCount > 0 ? "pitch.500" : "border"}
                            rounded="lg"
                            fontWeight={600}
                            onClick={() => setFiltersOpen((v) => !v)}
                            aria-expanded={filtersOpen}
                        >
                            <FiFilter /> Filteri
                            {activeFilterCount > 0 && (
                                <Box
                                    ml="2"
                                    bg={activeFilterCount > 0 ? "rgba(255,255,255,0.25)" : "pitch.500"}
                                    color="white"
                                    rounded="full"
                                    px="2"
                                    py="0.5"
                                    fontSize="10px"
                                    fontWeight={700}
                                >
                                    {activeFilterCount}
                                </Box>
                            )}
                            {filtersOpen ? <FiChevronUp /> : <FiChevronDown />}
                        </Button>

                        {/* Sort menu — sits between Filteri and Kreiraj
                             turnir. The current option is shown inline on
                             desktop ("Sortiraj: Najraniji prvi") and
                             collapsed to just the icon on narrow screens
                             so the toolbar still fits the search input. */}
                        <Menu.Root>
                            <Menu.Trigger asChild>
                                <Button
                                    h={{ base: "40px", md: "46px" }}
                                    px={{ base: "3", md: "4" }}
                                    flexShrink={1}
                                    bg="bg.panel"
                                    color="fg.ink"
                                    borderWidth="1px"
                                    borderColor="border"
                                    rounded="lg"
                                    fontWeight={600}
                                >
                                    <FiSliders />
                                    <Box as="span" display={{ base: "none", md: "inline" }}>
                                        Sortiraj:{" "}
                                        <Box as="span" color="pitch.500" fontWeight={700}>
                                            {SORT_OPTIONS.find((o) => o.key === sortMode)?.label ?? "—"}
                                        </Box>
                                    </Box>
                                    <Box as="span" display={{ base: "inline", md: "none" }}>
                                        Sortiraj
                                    </Box>
                                    <FiChevronDown />
                                </Button>
                            </Menu.Trigger>
                            <Portal>
                                <Menu.Positioner>
                                    <Menu.Content
                                        minW="260px"
                                        rounded="lg"
                                        borderWidth="1px"
                                        borderColor="border"
                                        bg="bg.panel"
                                        shadow="lg"
                                        py="1"
                                    >
                                        {SORT_OPTIONS.map((opt) => {
                                            const active = opt.key === sortMode
                                            return (
                                                <Menu.Item
                                                    key={opt.key}
                                                    value={opt.key}
                                                    onClick={() => setSortMode(opt.key)}
                                                    px="3"
                                                    py="2.5"
                                                    cursor="pointer"
                                                    _hover={{ bg: "bg.surfaceTint" }}
                                                    bg={active ? "bg.surfaceTint" : undefined}
                                                >
                                                    <Flex w="full" align="center" gap="3">
                                                        <Box
                                                            color="pitch.500"
                                                            opacity={active ? 1 : 0}
                                                            flexShrink={0}
                                                        >
                                                            <FiCheck />
                                                        </Box>
                                                        <Box flex="1" minW="0">
                                                            <Text
                                                                fontSize="14px"
                                                                fontWeight={active ? 700 : 600}
                                                                color="fg.ink"
                                                            >
                                                                {opt.label}
                                                            </Text>
                                                            <Text fontSize="12px" color="fg.muted">
                                                                {opt.description}
                                                            </Text>
                                                        </Box>
                                                    </Flex>
                                                </Menu.Item>
                                            )
                                        })}
                                    </Menu.Content>
                                </Menu.Positioner>
                            </Portal>
                        </Menu.Root>

                        {/* Grid / list view switcher — replaces the old
                            "Kreiraj turnir" button (creating a tournament
                            already lives in the top nav, so a second button
                            here was redundant). Grid is the default card
                            layout; list groups upcoming by month. */}
                        <HStack
                            gap="0.5"
                            h={{ base: "40px", md: "46px" }}
                            px="1"
                            bg="bg.panel"
                            borderWidth="1px"
                            borderColor="border"
                            rounded="lg"
                            flexShrink={0}
                        >
                            <ViewToggleButton
                                active={upcomingView === "grid"}
                                onClick={() => setUpcomingView("grid")}
                                icon={<FiGrid size={16} />}
                                label="Mreža"
                            />
                            <ViewToggleButton
                                active={upcomingView === "list"}
                                onClick={() => setUpcomingView("list")}
                                icon={<FiList size={16} />}
                                label="Popis"
                            />
                        </HStack>
                    </HStack>
                </Stack>

                {filtersOpen && (
                    <Box
                        mt="4"
                        p="4"
                        bg="bg.panel"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="lg"
                    >
                        <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="3">
                            <Box>
                                <MonoLabel>LOKACIJA</MonoLabel>
                                <Input
                                    mt="1"
                                    size="sm"
                                    placeholder="npr. Zagreb"
                                    value={locationFilter}
                                    onChange={(e) => setLocationFilter(e.target.value)}
                                />
                            </Box>
                            <Box>
                                <MonoLabel>KOTIZACIJA (€)</MonoLabel>
                                <HStack mt="1" gap="2">
                                    <Input
                                        size="sm"
                                        inputMode="decimal"
                                        placeholder="od"
                                        value={priceMin}
                                        onChange={(e) => setPriceMin(sanitizeNum(e.target.value))}
                                    />
                                    <Text color="fg.muted">–</Text>
                                    <Input
                                        size="sm"
                                        inputMode="decimal"
                                        placeholder="do"
                                        value={priceMax}
                                        onChange={(e) => setPriceMax(sanitizeNum(e.target.value))}
                                    />
                                </HStack>
                            </Box>
                        </Grid>
                        <Box mt="3">
                            <HStack gap="2" mb="1.5" align="center" wrap="wrap">
                                <MonoLabel>U KRUGU OD:</MonoLabel>
                                <Text fontSize="xs" fontWeight={700} color="pitch.500">
                                    {userPos
                                        ? radiusKm >= RADIUS_MAX_KM
                                            ? "Sve"
                                            : `${radiusKm} km`
                                        : "—"}
                                </Text>
                                {!userPos && (
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        colorPalette="pitch"
                                        onClick={requestLocation}
                                        disabled={geoStatus === "asking" || geoStatus === "unsupported"}
                                        loading={geoStatus === "asking"}
                                    >
                                        <FiNavigation /> Uključi lokaciju
                                    </Button>
                                )}
                                {geoStatus === "denied" && (
                                    <Text fontSize="xs" color="fg.muted">
                                        Lokacija je odbijena u pregledniku.
                                    </Text>
                                )}
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={resetFilters}
                                    disabled={!isFiltering}
                                    ml="auto"
                                >
                                    Očisti sve
                                </Button>
                            </HStack>
                            <Slider.Root
                                min={1}
                                max={RADIUS_MAX_KM}
                                step={1}
                                value={[radiusKm]}
                                onValueChange={(e) => setRadiusKm(e.value[0])}
                                disabled={!userPos}
                                colorPalette="pitch"
                            >
                                <Slider.Control>
                                    <Slider.Track>
                                        <Slider.Range />
                                    </Slider.Track>
                                    <Slider.Thumbs />
                                </Slider.Control>
                            </Slider.Root>
                        </Box>
                    </Box>
                )}

            </Box>

            {/* ── Upcoming section ────────────────────────────────────────── */}
            <Box>
                <Flex justify="space-between" align="flex-end" mb="4" gap="3" wrap="wrap">
                    <Box>
                        <Heading
                            fontFamily="heading"
                            fontSize="22px"
                            fontWeight={700}
                            letterSpacing="-0.02em"
                            color="fg.ink"
                        >
                            Nadolazeći turniri
                        </Heading>
                    </Box>
                </Flex>

                {loading ? (
                    <Grid templateColumns={gridCols} gap="4">
                        <CardSkeleton />
                        <CardSkeleton />
                        <CardSkeleton />
                    </Grid>
                ) : upcoming.length === 0 ? (
                    <EmptyState
                        title={error ? "Nije moguće učitati turnire" : "Nema nadolazećih turnira"}
                        description={error ?? "Kreiraj turnir i počni primati prijave ekipa."}
                        cta={
                            !error && (
                                <Button asChild size="sm" colorPalette="pitch">
                                    <RouterLink to="/turniri/novi">
                                        <FiPlus /> Kreiraj turnir
                                    </RouterLink>
                                </Button>
                            )
                        }
                    />
                ) : filteredUpcoming.length === 0 ? (
                    <EmptyState
                        title="Nema rezultata"
                        description="Nijedan turnir ne odgovara odabranim filterima."
                        cta={
                            <Button size="sm" variant="outline" onClick={resetFilters}>
                                Očisti filtere
                            </Button>
                        }
                    />
                ) : upcomingView === "list" ? (
                    <UpcomingMonthList items={filteredUpcoming} />
                ) : (
                    <Grid templateColumns={gridCols} gap="5">
                        {filteredUpcoming.map((t) => (
                            <TournamentCardView key={t.uuid} t={t} variant="upcoming" />
                        ))}
                    </Grid>
                )}
            </Box>

            {/* ── Finished section ────────────────────────────────────────── */}
            <Box>
                <Flex justify="space-between" align="baseline" mb="4">
                    <Heading
                        fontFamily="heading"
                        fontSize="22px"
                        fontWeight={700}
                        letterSpacing="-0.02em"
                        color="fg.ink"
                    >
                        Završeni turniri
                    </Heading>
                    {finished.length > 0 ? (
                        <Box fontSize="13px" color="pitch.500" fontWeight={600}>
                            Arhiva sezona →
                        </Box>
                    ) : null}
                </Flex>

                {loadingFinished ? (
                    <Grid templateColumns={gridCols} gap="4">
                        <CardSkeleton />
                        <CardSkeleton />
                        <CardSkeleton />
                    </Grid>
                ) : finished.length === 0 ? (
                    <EmptyState
                        title={
                            errorFinished
                                ? "Nije moguće učitati završene turnire"
                                : "Još nema završenih turnira"
                        }
                        description={
                            errorFinished
                                ? errorFinished
                                : "Završeni turniri će se pojaviti ovdje s konačnim rezultatima, statistikama i strijelcima."
                        }
                    />
                ) : (
                    <>
                        <Grid templateColumns={gridCols} gap="5">
                            {finished.map((t) => (
                                <TournamentCardView key={t.uuid} t={t} variant="finished" />
                            ))}
                        </Grid>
                        {finishedHasMore && (
                            <HStack justify="center" mt="4">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    colorPalette="pitch"
                                    onClick={loadMoreFinished}
                                    loading={loadingMoreFinished}
                                >
                                    Učitaj više ({finishedTotal - finished.length})
                                </Button>
                            </HStack>
                        )}
                    </>
                )}
            </Box>
        </VStack>
    )
}
