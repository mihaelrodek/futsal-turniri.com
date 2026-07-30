import { useState } from "react"
import type { ElementType, FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import {
    Badge,
    Box,
    Button,
    Field,
    Flex,
    Grid,
    Heading,
    HStack,
    Icon,
    Input,
    Text,
    Textarea,
    VStack,
    chakra,
} from "@chakra-ui/react"
import {
    LuCamera,
    LuCheck,
    LuFlame,
    LuShoppingCart,
    LuSparkles,
    LuTarget,
    LuTrophy,
    LuVideo,
} from "react-icons/lu"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { MonoLabel, PitchBackdrop, GhostButton } from "../ui/pitch"
import { submitCameraInquiry } from "../api/cameraInquiry"
import { showError } from "../toaster"
import { useCart } from "../cart/CartContext"
import { formatPrice } from "../cart/CartShared"
import type { CartTier } from "../api/recordingCart"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   Cjenik - packages for buying match video: a single goal clip, a whole
   match, 3 matches from a tournament, or every match from a tournament.
   The camera package (live filming, price on request) closes the page with
   an inline inquiry form instead of a fixed price/CTA.
   Purely presentational except the camera inquiry form's submit.
   ────────────────────────────────────────────────────────────────────── */

type Tier = {
    id: CartTier
    icon: ElementType
    name: string
    price: string
    /** Euro amount as a plain number, for cart totals - `price` stays the
     *  display string ("5 €") so formatting never has to be re-derived. */
    priceValue: number
    tagline: string
    features: string[]
    highlight?: boolean
}

/** Static per-tier facts that never need translation - icon, id, and price
 *  (display string + numeric twin for cart totals). Paired with the
 *  translated name/tagline/features (from `t.pages.pricingPage.tiers.*`)
 *  inside `useTiers()` below. */
const TIER_META: { id: CartTier; icon: ElementType; price: string; priceValue: number; highlight?: boolean }[] = [
    { id: "GOAL", icon: LuTarget, price: "5 €", priceValue: 5 },
    { id: "MATCH", icon: LuVideo, price: "20 €", priceValue: 20 },
    { id: "HATTRICK", icon: LuFlame, price: "50 €", priceValue: 50 },
    { id: "TEAM", icon: LuTrophy, price: "100 €", priceValue: 100, highlight: true },
]

const TIER_DICT_KEY: Record<CartTier, "goal" | "match" | "hattrick" | "team"> = {
    GOAL: "goal",
    MATCH: "match",
    HATTRICK: "hattrick",
    TEAM: "team",
}

function useTiers(): Tier[] {
    const t = useTranslation()
    return TIER_META.map((meta) => {
        const copy = t.pages.pricingPage.tiers[TIER_DICT_KEY[meta.id]]
        return { ...meta, name: copy.name, tagline: copy.tagline, features: copy.features }
    })
}

function PricingCard({
    tier,
    selected,
    onToggle,
}: {
    tier: Tier
    selected: boolean
    onToggle: () => void
}) {
    const t = useTranslation()
    return (
        <chakra.button
            type="button"
            display="flex"
            flexDirection="column"
            alignItems="stretch"
            gap="4"
            bg={selected ? "pitch.subtle" : "bg.panel"}
            borderWidth={selected || tier.highlight ? "2px" : "1px"}
            borderColor={selected ? "pitch.600" : tier.highlight ? "pitch.500" : "border"}
            rounded="xl"
            p="5"
            position="relative"
            shadow={tier.highlight ? "md" : "sm"}
            cursor="pointer"
            textAlign="left"
            w="full"
            transition="border-color .15s, background .15s, transform .1s"
            _hover={{ borderColor: "pitch.500" }}
            _active={{ transform: "scale(0.99)" }}
            onClick={onToggle}
            aria-pressed={selected}
        >
            {tier.highlight && (
                <Badge
                    position="absolute"
                    top="-11px"
                    left="5"
                    colorPalette="pitch"
                    variant="solid"
                    fontSize="10px"
                    letterSpacing="0.06em"
                    textTransform="uppercase"
                >
                    {t.pages.pricingPage.bestValueBadge}
                </Badge>
            )}
            {/* Selection check - top-right so it never collides with the
                "Najbolja vrijednost" ribbon (top-left). */}
            <Flex
                position="absolute"
                top="4"
                right="4"
                w="24px"
                h="24px"
                rounded="full"
                align="center"
                justify="center"
                borderWidth="1.5px"
                borderColor={selected ? "pitch.600" : "border.emphasized"}
                bg={selected ? "pitch.600" : "transparent"}
                color="white"
                transition="background .15s, border-color .15s"
            >
                {selected && <Icon as={LuCheck} boxSize="3.5" />}
            </Flex>
            <Flex
                w="44px"
                h="44px"
                rounded="lg"
                bg="bg.surfaceTint"
                color="pitch.500"
                align="center"
                justify="center"
            >
                <Icon as={tier.icon} boxSize="5" />
            </Flex>
            <Box>
                <Heading size="md">{tier.name}</Heading>
                <Text fontSize="13px" color="fg.muted" mt="1">
                    {tier.tagline}
                </Text>
            </Box>
            <HStack align="baseline" gap="1">
                <Text fontSize="30px" fontWeight={800} lineHeight="1">
                    {tier.price}
                </Text>
            </HStack>
            <VStack align="stretch" gap="2" flex="1">
                {tier.features.map((f) => (
                    <HStack key={f} align="start" gap="2">
                        <Icon as={LuCheck} boxSize="4" color="pitch.500" mt="0.5" flexShrink={0} />
                        <Text fontSize="13.5px" color="fg.muted" lineHeight="1.45">
                            {f}
                        </Text>
                    </HStack>
                ))}
            </VStack>
        </chakra.button>
    )
}

/** Slim sticky bottom bar shown while the cart has items - count + total +
 *  a button that navigates to the full /kosarica page. Sticky (not fixed) so
 *  it never overlaps the footer area, and offset on mobile to clear the
 *  fixed bottom nav. */
function CartStickyBar({ count, totalEurCents }: { count: number; totalEurCents: number }) {
    const t = useTranslation()
    const navigate = useNavigate()
    return (
        <Box
            position="sticky"
            bottom={{ base: "calc(96px + env(safe-area-inset-bottom, 0px))", md: "4" }}
            zIndex="5"
        >
            <HStack
                justify="space-between"
                gap="3"
                bg="bg.panel"
                borderWidth="1px"
                borderColor="pitch.500"
                rounded="xl"
                shadow="lg"
                px="4"
                py="2.5"
            >
                <HStack gap="2">
                    <Icon as={LuShoppingCart} boxSize="4" color="pitch.600" />
                    <Badge colorPalette="pitch" variant="solid">{count}</Badge>
                    <Text fontWeight={800}>{formatPrice(totalEurCents)}</Text>
                </HStack>
                <Button size="sm" colorPalette="pitch" onClick={() => navigate("/kosarica")}>
                    <LuShoppingCart /> {t.pages.pricingPage.goToCartButton}
                </Button>
            </HStack>
        </Box>
    )
}

/* ── Camera package - price on request, closes with an inline form ── */

type InquiryState = "idle" | "sending" | "sent"

/** Mirrors the backend's simple, non-exhaustive patterns (CameraInquiryController)
 *  so obviously-fake input ("asdf", "123") gets caught before a round-trip. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/
const PHONE_RE = /^\+?[0-9]{6,15}$/

function CameraInquiryForm({ onSent }: { onSent: () => void }) {
    const t = useTranslation()
    const [name, setName] = useState("")
    const [contactEmail, setContactEmail] = useState("")
    const [contactPhone, setContactPhone] = useState("")
    const [tournamentName, setTournamentName] = useState("")
    const [message, setMessage] = useState("")
    const [state, setState] = useState<InquiryState>("idle")

    const emailOk = EMAIL_RE.test(contactEmail.trim())
    const phoneOk = PHONE_RE.test(contactPhone.replace(/\s+/g, ""))
    const canSubmit =
        name.trim().length > 0
        && emailOk
        && phoneOk
        && tournamentName.trim().length > 0
        && message.trim().length > 0

    async function onSubmit(e: FormEvent) {
        e.preventDefault()
        if (!canSubmit) {
            showError(t.pages.pricingPage.cameraForm.missingDataTitle, t.pages.pricingPage.cameraForm.missingDataDesc)
            return
        }
        try {
            setState("sending")
            await submitCameraInquiry({
                name: name.trim(),
                contactEmail: contactEmail.trim(),
                contactPhone: contactPhone.trim(),
                tournamentName: tournamentName.trim(),
                message: message.trim(),
            })
            setState("sent")
            onSent()
        } catch {
            setState("idle")
        }
    }

    if (state === "sent") {
        return (
            <VStack align="stretch" gap="1" py="2">
                <Text fontWeight={700}>{t.pages.pricingPage.cameraForm.sentTitle}</Text>
                <Text fontSize="sm" color="fg.muted">
                    {t.pages.pricingPage.cameraForm.sentDesc}
                </Text>
            </VStack>
        )
    }

    return (
        <chakra.form onSubmit={onSubmit}>
            <VStack align="stretch" gap="3">
                <HStack gap="3" align="start" wrap="wrap">
                    <Field.Root required flex="1" minW="200px">
                        <Field.Label>{t.pages.pricingPage.cameraForm.nameLabel} <Field.RequiredIndicator /></Field.Label>
                        <Input
                            size="sm"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t.pages.pricingPage.cameraForm.namePlaceholder}
                        />
                    </Field.Root>
                    <Field.Root required flex="1" minW="200px">
                        <Field.Label>{t.pages.pricingPage.cameraForm.tournamentNameLabel} <Field.RequiredIndicator /></Field.Label>
                        <Input
                            size="sm"
                            value={tournamentName}
                            onChange={(e) => setTournamentName(e.target.value)}
                            placeholder={t.pages.pricingPage.cameraForm.tournamentNamePlaceholder}
                        />
                    </Field.Root>
                </HStack>

                <HStack gap="3" align="start" wrap="wrap">
                    <Field.Root required flex="1" minW="200px" invalid={contactEmail.trim().length > 0 && !emailOk}>
                        <Field.Label>{t.pages.pricingPage.cameraForm.emailLabel} <Field.RequiredIndicator /></Field.Label>
                        <Input
                            size="sm"
                            type="email"
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            placeholder={t.pages.pricingPage.cameraForm.emailPlaceholder}
                        />
                        {contactEmail.trim().length > 0 && !emailOk && (
                            <Field.ErrorText>{t.pages.pricingPage.cameraForm.emailInvalid}</Field.ErrorText>
                        )}
                    </Field.Root>
                    <Field.Root required flex="1" minW="200px" invalid={contactPhone.trim().length > 0 && !phoneOk}>
                        <Field.Label>{t.pages.pricingPage.cameraForm.phoneLabel} <Field.RequiredIndicator /></Field.Label>
                        <Input
                            size="sm"
                            type="tel"
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            placeholder={t.pages.pricingPage.cameraForm.phonePlaceholder}
                        />
                        {contactPhone.trim().length > 0 && !phoneOk && (
                            <Field.ErrorText>{t.pages.pricingPage.cameraForm.phoneInvalid}</Field.ErrorText>
                        )}
                    </Field.Root>
                </HStack>

                <Field.Root required>
                    <Field.Label>{t.pages.pricingPage.cameraForm.descriptionLabel} <Field.RequiredIndicator /></Field.Label>
                    <Textarea
                        size="sm"
                        rows={3}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder={t.pages.pricingPage.cameraForm.descriptionPlaceholder}
                    />
                </Field.Root>

                <HStack justify="flex-end">
                    <Button
                        type="submit"
                        size="sm"
                        colorPalette="pitch"
                        loading={state === "sending"}
                        disabled={!canSubmit || state === "sending"}
                    >
                        {t.pages.pricingPage.cameraForm.submitButton}
                    </Button>
                </HStack>
            </VStack>
        </chakra.form>
    )
}

function CameraPackageBand() {
    const t = useTranslation()
    const [open, setOpen] = useState(false)
    const [sent, setSent] = useState(false)

    return (
        <Box
            borderWidth="1px"
            borderStyle="dashed"
            borderColor="border.emphasized"
            rounded="xl"
            p={{ base: "5", md: "6" }}
            bg="bg.panel"
        >
            <HStack justify="space-between" align="start" wrap="wrap" gap="4">
                <HStack align="start" gap="4">
                    <Flex
                        w="44px"
                        h="44px"
                        rounded="lg"
                        bg="bg.surfaceTint"
                        color="pitch.500"
                        align="center"
                        justify="center"
                        flexShrink={0}
                    >
                        <Icon as={LuCamera} boxSize="5" />
                    </Flex>
                    <Box>
                        <HStack gap="2" wrap="wrap">
                            <Heading size="md">{t.pages.pricingPage.cameraPackage.heading}</Heading>
                            <Badge variant="subtle" colorPalette="gray">{t.pages.pricingPage.cameraPackage.priceOnRequestBadge}</Badge>
                        </HStack>
                        <Text fontSize="13.5px" color="fg.muted" mt="1.5" maxW="560px">
                            {t.pages.pricingPage.cameraPackage.description}
                        </Text>
                    </Box>
                </HStack>
                {!open && !sent && (
                    <GhostButton onClick={() => setOpen(true)}>{t.pages.pricingPage.cameraPackage.requestQuoteButton}</GhostButton>
                )}
            </HStack>

            {(open || sent) && (
                <Box mt="5" pt="5" borderTopWidth="1px" borderColor="border.emphasized">
                    <CameraInquiryForm onSent={() => setSent(true)} />
                </Box>
            )}
        </Box>
    )
}

export default function PricingPage() {
    const t = useTranslation()
    const tiers = useTiers()

    useDocumentHead({
        title: t.pages.pricingPage.documentTitle,
        description: t.pages.pricingPage.documentDescription,
    })

    const cart = useCart()

    // A card's "selected" state just mirrors whether the cart already has AN
    // item of that tier - clicking it again removes that one item. Buying a
    // second Gol/Hattrick/etc is still possible, just from the cart page
    // itself (its own "dodaj još jednu stavku" row), not by re-clicking here.
    function itemOfTier(tierId: CartTier) {
        return cart.items.find((it) => it.tier === tierId)
    }

    function toggle(tierId: CartTier) {
        const existing = itemOfTier(tierId)
        if (existing) cart.removeItem(existing.id)
        else cart.addTier(tierId)
    }

    return (
        <VStack align="stretch" gap="10" pb="4">
            {/* ── Hero ─────────────────────────────────────────────────── */}
            <Box
                position="relative"
                rounded="2xl"
                overflow="hidden"
                color="white"
                bgImage="linear-gradient(135deg, #132A3E, #0B1522)"
            >
                <PitchBackdrop opacity={0.15} variant="pricing-hero" tone="pitch" />
                <VStack
                    position="relative"
                    align="start"
                    gap="4"
                    px={{ base: 6, md: 12 }}
                    py={{ base: 10, md: 12 }}
                >
                    <HStack
                        gap="1.5"
                        bg="rgba(255,255,255,0.12)"
                        borderWidth="1px"
                        borderColor="rgba(255,255,255,0.2)"
                        rounded="full"
                        px="3"
                        py="1"
                    >
                        <Icon as={LuSparkles} boxSize="3.5" />
                        <MonoLabel color="white" letterSpacing="0.06em">{t.pages.pricingPage.kicker}</MonoLabel>
                    </HStack>
                    <Heading
                        fontFamily="heading"
                        fontSize={{ base: "28px", md: "40px" }}
                        fontWeight={800}
                        letterSpacing="-0.02em"
                        lineHeight="1.1"
                    >
                        {t.pages.pricingPage.heroHeading}
                    </Heading>
                    <Text fontSize={{ base: "14px", md: "16px" }} color="rgba(255,255,255,0.85)" maxW="640px">
                        {t.pages.pricingPage.heroSubtitle}
                    </Text>
                </VStack>
            </Box>

            {/* ── Fixed-price packages - click a card to add/remove it from
                  the cart below. ─────────────────────────────────────── */}
            <Grid
                templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }}
                gap="4"
            >
                {tiers.map((tier) => (
                    <PricingCard
                        key={tier.id}
                        tier={tier}
                        selected={!!itemOfTier(tier.id)}
                        onToggle={() => toggle(tier.id)}
                    />
                ))}
            </Grid>

            {/* ── Camera package - price on request ────────────────────── */}
            <CameraPackageBand />

            {cart.items.length > 0 && (
                <CartStickyBar count={cart.itemCount} totalEurCents={cart.totalEurCents} />
            )}
        </VStack>
    )
}
