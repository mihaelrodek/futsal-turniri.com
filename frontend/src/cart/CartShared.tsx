import { useMemo, useState } from "react"
import { isAxiosError } from "axios"
import {
    Box,
    Button,
    Field,
    HStack,
    Icon,
    Input,
    Link as ChakraLink,
    NativeSelect,
    Spinner,
    Text,
    VStack,
    chakra,
} from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { LuFlame, LuSparkles, LuTrash2, LuTrophy, LuVideo } from "react-icons/lu"
import { FiCheck, FiEdit2 } from "react-icons/fi"
import { useQuery } from "@tanstack/react-query"
import { useAuth } from "../auth/AuthContext"
import { useCart, type CartItem, type CartItemConfig } from "./CartContext"
import { fetchTournaments } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import { getTeams } from "../api/teams"
import { createCartCheckout, TIER_MATCH_COUNT, type CartCheckoutItem } from "../api/recordingCart"
import { showError } from "../toaster"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   Shared cart building blocks, rendered by the /kosarica page (CartPage):
   the per-item configurator (which tournament/match(es)/team the
   package is for), the item row, and the checkout section (anonymous
   contact fields + total + the single-Stripe-session "Plati" flow).
   ────────────────────────────────────────────────────────────────────── */

export const TIER_ICON = { MATCH: LuVideo, HATTRICK: LuFlame, PETARDA: LuSparkles, TEAM: LuTrophy } as const

export function formatPrice(cents: number): string {
    const eur = cents / 100
    return `${Number.isInteger(eur) ? eur : eur.toFixed(2).replace(".", ",")} €`
}

function matchLabel(team1: string | null, team2: string | null): string {
    return `${team1 ?? "?"} – ${team2 ?? "?"}`
}

/** local@domain.tld - mirrors the backend's simple, non-exhaustive pattern. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/
const PHONE_RE = /^\+?[0-9]{6,15}$/

/** Configuration form shown while an item has no config yet (or "Uredi"). */
export function ItemConfigurator({
    item,
    onSave,
    onCancel,
}: {
    item: CartItem
    onSave: (config: CartItemConfig) => void
    onCancel: (() => void) | null
}) {
    const t = useTranslation()
    const [tournamentUuid, setTournamentUuid] = useState("")
    const [matchId, setMatchId] = useState<number | null>(null)
    /** Selection for the multi-match tiers (Hattrick 3, Petarda 5). */
    const [multiIds, setMultiIds] = useState<number[]>([])
    const [teamId, setTeamId] = useState<number | null>(null)

    /** >0 for a multi-match tier, undefined for MATCH/TEAM. */
    const requiredMatches = TIER_MATCH_COUNT[item.tier]

    // Only tournaments that were actually livestreamed - one that never went
    // live has no recording to sell, and picking it here used to leave the
    // match dropdown empty with no explanation. Mirrors the per-match filter
    // (pickableMatches below), just one level up.
    const { data: tournaments, isLoading: tournamentsLoading } = useQuery({
        queryKey: ["cart", "pickerTournaments"] as const,
        queryFn: async () => {
            const [upcoming, finished] = await Promise.all([
                fetchTournaments("upcoming", { hasLivestream: true }),
                fetchTournaments("finished", { hasLivestream: true }),
            ])
            return [...upcoming, ...finished]
        },
    })

    const { data: schedule, isLoading: scheduleLoading } = useQuery({
        queryKey: ["cart", "schedule", tournamentUuid] as const,
        queryFn: () => fetchSchedule(tournamentUuid),
        enabled: !!tournamentUuid && item.tier !== "TEAM",
    })

    const { data: teams, isLoading: teamsLoading } = useQuery({
        queryKey: ["cart", "teams", tournamentUuid] as const,
        queryFn: () => getTeams(tournamentUuid),
        enabled: !!tournamentUuid && item.tier === "TEAM",
    })

    /* Only matches that were actually broadcast can be bought - there is no
       footage otherwise, and the backend rejects the checkout with
       NO_LIVESTREAM. Filtered out here rather than shown-and-refused, so the
       cart can never be assembled into an order that cannot succeed. */
    const pickableMatches = useMemo(
        () =>
            (schedule?.matches ?? []).filter(
                (m) => m.team1Name && m.team2Name && m.livestream === true,
            ),
        [schedule],
    )

    function resetMatchSelection() {
        setMatchId(null)
        setMultiIds([])
        setTeamId(null)
    }

    function toggleMultiMatch(id: number) {
        setMultiIds((prev) => {
            if (prev.includes(id)) return prev.filter((x) => x !== id)
            if (requiredMatches != null && prev.length >= requiredMatches) return prev
            return [...prev, id]
        })
    }

    const tournament = (tournaments ?? []).find((t) => t.uuid === tournamentUuid) ?? null

    function canSave(): boolean {
        if (!tournament) return false
        if (item.tier === "MATCH") return matchId != null
        if (requiredMatches != null) return multiIds.length === requiredMatches
        if (item.tier === "TEAM") return teamId != null
        return false
    }

    function save() {
        if (!tournament || !canSave()) return
        if (item.tier === "MATCH") {
            const m = pickableMatches.find((x) => x.matchId === matchId)!
            onSave({ kind: "MATCH", tournamentUuid, tournamentName: tournament.name, matchId: matchId!, matchLabel: matchLabel(m.team1Name, m.team2Name) })
        } else if (requiredMatches != null) {
            const labels = multiIds.map((id) => {
                const m = pickableMatches.find((x) => x.matchId === id)!
                return matchLabel(m.team1Name, m.team2Name)
            })
            onSave({
                kind: item.tier === "PETARDA" ? "PETARDA" : "HATTRICK",
                tournamentUuid, tournamentName: tournament.name, matchIds: multiIds, matchLabels: labels,
            })
        } else if (item.tier === "TEAM") {
            const team = (teams ?? []).find((x) => x.id === teamId)!
            onSave({ kind: "TEAM", tournamentUuid, tournamentName: tournament.name, teamId: teamId!, teamName: team.name })
        }
    }

    return (
        <VStack align="stretch" gap="2" mt="1.5">
            <NativeSelect.Root size="sm">
                <NativeSelect.Field
                    value={tournamentUuid}
                    onChange={(e) => {
                        setTournamentUuid((e.target as HTMLSelectElement).value)
                        resetMatchSelection()
                    }}
                >
                    <option value="">{t.pages.cartPage.pickTournamentOption}</option>
                    {(tournaments ?? []).map((tn) => (
                        <option key={tn.uuid} value={tn.uuid}>{tn.name}</option>
                    ))}
                </NativeSelect.Field>
            </NativeSelect.Root>
            {tournamentsLoading && (
                <HStack gap="2" color="fg.muted"><Spinner size="xs" /><Text fontSize="sm">{t.pages.cartPage.loadingTournaments}</Text></HStack>
            )}

            {tournamentUuid && item.tier === "TEAM" && (
                teamsLoading ? (
                    <HStack gap="2" color="fg.muted"><Spinner size="xs" /><Text fontSize="sm">{t.pages.cartPage.loadingTeams}</Text></HStack>
                ) : (teams ?? []).length === 0 ? (
                    <Text fontSize="sm" color="fg.muted">{t.pages.cartPage.noTeams}</Text>
                ) : (
                    <NativeSelect.Root size="sm">
                        <NativeSelect.Field
                            value={teamId == null ? "" : String(teamId)}
                            onChange={(e) => setTeamId(Number((e.target as HTMLSelectElement).value) || null)}
                        >
                            <option value="">{t.pages.cartPage.pickTeamOption}</option>
                            {(teams ?? []).map((tm) => (
                                <option key={tm.id} value={String(tm.id)}>{tm.name}</option>
                            ))}
                        </NativeSelect.Field>
                    </NativeSelect.Root>
                )
            )}

            {tournamentUuid && item.tier !== "TEAM" && (
                scheduleLoading ? (
                    <HStack gap="2" color="fg.muted"><Spinner size="xs" /><Text fontSize="sm">{t.pages.cartPage.loadingMatches}</Text></HStack>
                ) : pickableMatches.length === 0 ? (
                    <Text fontSize="sm" color="fg.muted">{t.pages.cartPage.noMatchesGeneric}</Text>
                ) : requiredMatches != null ? (
                    <VStack align="stretch" gap="1" maxH="220px" overflowY="auto" borderWidth="1px" borderColor="border" rounded="md" p="2">
                        <Text fontSize="xs" color="fg.muted">
                            {t.pages.cartPage.pickExactlyN(requiredMatches, multiIds.length)}
                        </Text>
                        {pickableMatches.map((m) => {
                            const checked = multiIds.includes(m.matchId)
                            const disabled = !checked && multiIds.length >= requiredMatches
                            return (
                                <chakra.label
                                    key={m.matchId}
                                    display="flex"
                                    alignItems="center"
                                    gap="2"
                                    px="1.5"
                                    py="1"
                                    rounded="sm"
                                    cursor={disabled ? "not-allowed" : "pointer"}
                                    opacity={disabled ? 0.5 : 1}
                                    _hover={!disabled ? { bg: "bg.subtle" } : undefined}
                                >
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        disabled={disabled}
                                        onChange={() => toggleMultiMatch(m.matchId)}
                                    />
                                    <Text fontSize="sm">{matchLabel(m.team1Name, m.team2Name)}</Text>
                                </chakra.label>
                            )
                        })}
                    </VStack>
                ) : (
                    <NativeSelect.Root size="sm">
                        <NativeSelect.Field
                            value={matchId == null ? "" : String(matchId)}
                            onChange={(e) => setMatchId(Number((e.target as HTMLSelectElement).value) || null)}
                        >
                            <option value="">{t.pages.cartPage.pickMatchOption}</option>
                            {pickableMatches.map((m) => (
                                <option key={m.matchId} value={String(m.matchId)}>{matchLabel(m.team1Name, m.team2Name)}</option>
                            ))}
                        </NativeSelect.Field>
                    </NativeSelect.Root>
                )
            )}

            <HStack justify="flex-end" gap="2">
                {onCancel && (
                    <Button size="xs" variant="ghost" onClick={onCancel}>{t.common.cancel}</Button>
                )}
                <Button size="xs" variant="solid" colorPalette="pitch" disabled={!canSave()} onClick={save}>
                    <FiCheck /> {t.common.confirm}
                </Button>
            </HStack>
        </VStack>
    )
}

export function configSummary(item: CartItem): string {
    const c = item.config
    if (!c) return ""
    switch (c.kind) {
        case "HATTRICK": return `${c.tournamentName} — ${c.matchLabels.join(", ")}`
        case "PETARDA": return `${c.tournamentName} — ${c.matchLabels.join(", ")}`
        case "TEAM": return `${c.tournamentName} — ${c.teamName}`
        case "MATCH": return `${c.tournamentName} — ${c.matchLabel}`
    }
}

export function CartItemRow({ item }: { item: CartItem }) {
    const t = useTranslation()
    const cart = useCart()
    // Closed by default, even for a just-added, unconfigured item - the
    // inline configurator (tournament/match/goal pickers) is tall, and
    // auto-opening one per quick-added item used to stack several of them
    // at once and bury the "Ukupno/Plati" summary below the fold on mobile.
    // A collapsed row with an explicit "Konfiguriraj" CTA keeps each item to
    // one compact line until the user actually wants to configure it.
    const [editing, setEditing] = useState(false)
    const Icon_ = TIER_ICON[item.tier]

    return (
        <Box borderWidth="1px" borderColor="border.emphasized" rounded="lg" p="2.5">
            <HStack justify="space-between" align="start" gap="2">
                <HStack gap="2" align="center" minW="0">
                    <Icon as={Icon_} boxSize="4" color="pitch.500" flexShrink={0} />
                    <Text fontWeight={600} fontSize="sm" truncate>{item.label}</Text>
                </HStack>
                <HStack gap="2" align="center" flexShrink={0}>
                    <Text fontWeight={700} fontSize="sm">{formatPrice(item.priceEurCents)}</Text>
                    <chakra.button
                        type="button"
                        aria-label={t.pages.cartPage.removeItemAria(item.label)}
                        onClick={() => cart.removeItem(item.id)}
                        display="inline-flex"
                        color="fg.muted"
                        bg="transparent"
                        border="none"
                        cursor="pointer"
                        _hover={{ color: "accent.red" }}
                    >
                        <LuTrash2 size={16} />
                    </chakra.button>
                </HStack>
            </HStack>

            {editing ? (
                <ItemConfigurator
                    item={item}
                    onSave={(config) => {
                        cart.setItemConfig(item.id, config)
                        setEditing(false)
                    }}
                    onCancel={() => setEditing(false)}
                />
            ) : item.config ? (
                <HStack justify="space-between" align="center" mt="1.5" gap="2">
                    <Text fontSize="xs" color="fg.muted" truncate minW="0" flex="1">{configSummary(item)}</Text>
                    <Button size="2xs" variant="ghost" flexShrink={0} onClick={() => setEditing(true)}>
                        <FiEdit2 /> {t.common.edit}
                    </Button>
                </HStack>
            ) : (
                <HStack justify="space-between" align="center" mt="1.5" gap="2">
                    <Text fontSize="xs" color="orange.fg" truncate minW="0" flex="1">{t.pages.cartPage.unconfiguredLabel}</Text>
                    <Button size="2xs" variant="solid" colorPalette="pitch" flexShrink={0} onClick={() => setEditing(true)}>
                        {t.pages.cartPage.configureButton}
                    </Button>
                </HStack>
            )}
        </Box>
    )
}

export function itemToCheckoutPayload(item: CartItem): CartCheckoutItem {
    const c = item.config!
    switch (c.kind) {
        case "HATTRICK":
            return { tier: "HATTRICK", tournamentUuid: c.tournamentUuid, matchIds: c.matchIds }
        case "PETARDA":
            return { tier: "PETARDA", tournamentUuid: c.tournamentUuid, matchIds: c.matchIds }
        case "TEAM":
            return { tier: "TEAM", tournamentUuid: c.tournamentUuid, matchIds: [], teamId: c.teamId }
        case "MATCH":
            return { tier: "MATCH", tournamentUuid: c.tournamentUuid, matchIds: [c.matchId] }
    }
}

/**
 * Contact fields (anonymous checkout) + total + "Plati" button, with the
 * whole single-Stripe-session checkout flow and its 409-code error toasts.
 */
export function CartCheckoutSection() {
    const t = useTranslation()
    const cart = useCart()
    const { user } = useAuth()

    const [contactEmail, setContactEmail] = useState(user?.email ?? "")
    const [contactPhone, setContactPhone] = useState("")
    const [submitting, setSubmitting] = useState(false)

    const emailOk = EMAIL_RE.test(contactEmail.trim())
    const phoneOk = PHONE_RE.test(contactPhone.replace(/\s+/g, ""))
    const contactOk = user ? (contactEmail.trim() === "" || emailOk) : (emailOk && phoneOk)

    async function onCheckout() {
        if (!cart.allConfigured || !contactOk || cart.items.length === 0) return
        try {
            setSubmitting(true)
            const { url } = await createCartCheckout({
                items: cart.items.map(itemToCheckoutPayload),
                contactEmail: contactEmail.trim() || undefined,
                contactPhone: contactPhone.trim() || undefined,
            })
            window.location.href = url
        } catch (err) {
            const code = isAxiosError(err) && err.response?.status === 409
                ? (err.response.data as { code?: string })?.code
                : undefined
            if (code === "NOT_CONFIGURED") showError(t.pages.cartPage.checkoutErrorNotConfiguredTitle, t.pages.cartPage.checkoutErrorNotConfiguredDesc)
            else if (code === "TEAM_NO_MATCHES") showError(t.pages.cartPage.checkoutErrorTeamNoMatchesTitle, t.pages.cartPage.checkoutErrorTeamNoMatchesDesc)
            else if (code === "DUPLICATE") showError(t.pages.cartPage.checkoutErrorDuplicateTitle, t.pages.cartPage.checkoutErrorDuplicateDesc)
            else if (code === "NO_LIVESTREAM") showError(t.pages.cartPage.checkoutErrorNoLivestreamTitle, t.pages.cartPage.checkoutErrorNoLivestreamDesc)
            else {
                // Anything else (500 - Stripe misconfigured, insufficient
                // balance, ...) - this call is `silent: true`, so without an
                // explicit fallback here "Plati" just silently does nothing.
                showError(t.pages.cartPage.checkoutErrorGenericTitle, t.pages.cartPage.checkoutErrorGenericDesc)
            }
        } finally {
            setSubmitting(false)
        }
    }

    if (cart.items.length === 0) {
        return (
            <VStack align="stretch" gap="2.5" w="full">
                <HStack justify="space-between">
                    <Text fontWeight={700}>{t.pages.cartPage.totalLabel}</Text>
                    <Text fontWeight={800} fontSize="18px">{formatPrice(0)}</Text>
                </HStack>
                <Text fontSize="sm" color="fg.muted">{t.pages.cartPage.emptySummaryHint}</Text>
            </VStack>
        )
    }

    return (
        <VStack align="stretch" gap="3" w="full">
            <HStack justify="flex-end">
                <Button size="2xs" variant="outline" colorPalette="red" onClick={() => cart.clear()}>
                    <LuTrash2 size={13} /> {t.pages.pricingPage.clearCart}
                </Button>
            </HStack>

            {!user && (
                <VStack align="stretch" gap="2.5">
                    <Text fontSize="sm" fontWeight={600}>{t.pages.cartPage.anonymousContactHeading}</Text>
                    <VStack gap="2.5" align="stretch">
                        <Field.Root required invalid={contactEmail.trim().length > 0 && !emailOk}>
                            <Field.Label>{t.pages.cartPage.emailLabel} <Field.RequiredIndicator /></Field.Label>
                            <Input
                                size="sm"
                                type="email"
                                value={contactEmail}
                                onChange={(e) => setContactEmail(e.target.value)}
                                placeholder={t.pages.cartPage.emailPlaceholder}
                            />
                            {contactEmail.trim().length > 0 && !emailOk && (
                                <Field.ErrorText>{t.pages.cartPage.emailInvalid}</Field.ErrorText>
                            )}
                        </Field.Root>
                        <Field.Root required invalid={contactPhone.trim().length > 0 && !phoneOk}>
                            <Field.Label>{t.pages.cartPage.phoneLabel} <Field.RequiredIndicator /></Field.Label>
                            <Input
                                size="sm"
                                type="tel"
                                value={contactPhone}
                                onChange={(e) => setContactPhone(e.target.value)}
                                placeholder={t.pages.cartPage.phonePlaceholder}
                            />
                            {contactPhone.trim().length > 0 && !phoneOk && (
                                <Field.ErrorText>{t.pages.cartPage.phoneInvalid}</Field.ErrorText>
                            )}
                        </Field.Root>
                    </VStack>
                </VStack>
            )}

            <HStack justify="space-between" pt={user ? "0" : "1"} borderTopWidth={user ? "0" : "1px"} borderColor="border">
                <Text fontWeight={700}>{t.pages.cartPage.totalLabel}</Text>
                <Text fontWeight={800} fontSize="18px">{formatPrice(cart.totalEurCents)}</Text>
            </HStack>

            {!cart.allConfigured && (
                <Text fontSize="xs" color="fg.muted">
                    {t.pages.cartPage.incompleteConfigNote}
                </Text>
            )}

            <Button
                size="md"
                colorPalette="pitch"
                disabled={!cart.allConfigured || !contactOk || submitting}
                loading={submitting}
                onClick={onCheckout}
            >
                {t.pages.cartPage.payButton(formatPrice(cart.totalEurCents))}
            </Button>

            {/* Same sentence as the single-request status page: the terms'
                withdrawal waiver only holds if it was shown before paying. */}
            <Text fontSize="xs" color="fg.muted">
                {t.recordingRequest.status.termsNoteBefore}{" "}
                <ChakraLink asChild color="pitch.600" fontWeight={600}>
                    <RouterLink to="/uvjeti">{t.recordingRequest.status.termsLinkLabel}</RouterLink>
                </ChakraLink>
                {t.recordingRequest.status.termsNoteAfter}
            </Text>
        </VStack>
    )
}
