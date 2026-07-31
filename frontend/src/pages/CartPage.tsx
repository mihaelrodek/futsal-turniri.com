import { useEffect } from "react"
import type { ElementType } from "react"
import { useSearchParams } from "react-router-dom"
import { Box, Card, chakra, Flex, Grid, Heading, Icon, Text, VStack } from "@chakra-ui/react"
import { LuFlame, LuTarget, LuTrophy, LuVideo } from "react-icons/lu"
import { FiCheck, FiPlus } from "react-icons/fi"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { useCart, TIER_INFO } from "../cart/CartContext"
import { CartCheckoutSection, CartItemRow, formatPrice } from "../cart/CartShared"
import { Panel } from "../ui/primitives"
import { useTranslation } from "../i18n"
import type { CartTier } from "../api/recordingCart"

/* ──────────────────────────────────────────────────────────────────────────
   /kosarica - the cart's own page (also the Stripe success/cancel landing
   target, ?placanje=uspjeh|odustao). Leads with a compact "quick add" tier
   picker - a stripped-down version of /cjenik's cards - so a visitor never
   has to leave this page to add a package, then configures/pays each item
   via the shared pieces in cart/CartShared.tsx. Once the cart isn't empty,
   the page splits into a wide working column (picker + item rows) and a
   narrow, sticky "Ukupno / Plati" summary column (~20-25% of the viewport)
   in ONE Stripe Checkout Session (backend: RecordingRequestController#cartCheckout).
   ────────────────────────────────────────────────────────────────────── */

const QUICK_ADD_TIERS: { id: CartTier; icon: ElementType }[] = [
    { id: "GOAL", icon: LuTarget },
    { id: "MATCH", icon: LuVideo },
    { id: "HATTRICK", icon: LuFlame },
    { id: "TEAM", icon: LuTrophy },
]

const TIER_DICT_KEY: Record<CartTier, "goal" | "match" | "hattrick" | "team"> = {
    GOAL: "goal",
    MATCH: "match",
    HATTRICK: "hattrick",
    TEAM: "team",
}

function QuickAddTiers() {
    const t = useTranslation()
    const cart = useCart()
    return (
        <VStack align="stretch" gap="2.5">
            <Heading size="sm">{t.pages.cartPage.quickAddHeading}</Heading>
            <Grid templateColumns={{ base: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }} gap="2.5">
                {QUICK_ADD_TIERS.map(({ id, icon }) => {
                    const copy = t.pages.pricingPage.tiers[TIER_DICT_KEY[id]]
                    const info = TIER_INFO[id]
                    return (
                        <chakra.button
                            key={id}
                            type="button"
                            onClick={() => cart.addTier(id)}
                            aria-label={t.pages.cartPage.quickAddButton}
                            title={t.pages.cartPage.quickAddButton}
                            textAlign="left"
                            position="relative"
                            display="flex"
                            flexDirection={{ base: "row", sm: "column" }}
                            alignItems={{ base: "center", sm: "stretch" }}
                            gap={{ base: "2.5", sm: "0" }}
                            borderWidth="1px"
                            borderColor="border"
                            rounded="lg"
                            p={{ base: "2", sm: "2.5" }}
                            bg="bg.panel"
                            cursor="pointer"
                            transition="border-color 0.15s, transform 0.1s"
                            _hover={{ borderColor: "pitch.500", transform: "translateY(-1px)" }}
                            _active={{ transform: "translateY(0)" }}
                        >
                            {/* Mobile: one compact row - name/price left, tagline
                                right. sm+: the taller stacked card from before. */}
                            {/* Fixed width on mobile (wide enough for "Premium",
                                the longest tier name) so the delimiter after it
                                lines up at the same x across every row. */}
                            <Box w={{ base: "120px", sm: "auto" }} flexShrink={0} alignSelf="center">
                                <HStackTierHeader icon={icon} name={copy.name} price={formatPrice(info.priceEurCents)} />
                            </Box>
                            <Box
                                display={{ base: "block", sm: "none" }}
                                alignSelf="stretch"
                                w="1px"
                                bg="border"
                                flexShrink={0}
                            />
                            <Text
                                flex={{ base: "1", sm: "initial" }}
                                alignSelf="center"
                                minW="0"
                                fontSize="xs"
                                color="fg.muted"
                                mt={{ base: "0", sm: "1.5" }}
                                pr={{ base: "6", sm: "5" }}
                                lineClamp={{ base: 2, sm: 2 }}
                            >
                                {copy.tagline}
                            </Text>
                            <Flex
                                position="absolute"
                                top={{ base: "50%", sm: "2" }}
                                right="2"
                                transform={{ base: "translateY(-50%)", sm: "none" }}
                                w="20px"
                                h="20px"
                                rounded="full"
                                bg="pitch.500"
                                color="white"
                                align="center"
                                justify="center"
                            >
                                <FiPlus size={12} />
                            </Flex>
                        </chakra.button>
                    )
                })}
            </Grid>
        </VStack>
    )
}

function HStackTierHeader({ icon, name, price }: { icon: ElementType; name: string; price: string }) {
    return (
        <Flex align="center" gap="2">
            <Flex w="30px" h="30px" rounded="md" bg="bg.surfaceTint" color="pitch.500" align="center" justify="center" flexShrink={0}>
                <Icon as={icon} boxSize="3.5" />
            </Flex>
            <Box minW="0">
                <Text fontWeight={700} fontSize="sm" truncate>{name}</Text>
                <Text fontSize="xs" color="fg.muted">{price}</Text>
            </Box>
        </Flex>
    )
}

export default function CartPage() {
    const t = useTranslation()
    useDocumentHead({ title: t.pages.cartPage.documentTitle, description: t.pages.cartPage.documentDescription })

    const cart = useCart()
    const [searchParams] = useSearchParams()
    const placanje = searchParams.get("placanje")

    // Successful payment - the order is done, drop the paid items. In an
    // effect (not during render): clearing dispatches react-use-cart state.
    const paymentSuccess = placanje === "uspjeh"
    useEffect(() => {
        if (paymentSuccess) cart.clear()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paymentSuccess])

    if (paymentSuccess) {
        return (
            <Panel p={{ base: "6", md: "8" }} textAlign="center">
                <VStack gap="2">
                    <Icon as={FiCheck} boxSize="10" color="pitch.500" />
                    <Heading size="md">{t.pages.cartPage.paymentSuccessTitle}</Heading>
                    <Text color="fg.muted">
                        {t.pages.cartPage.paymentSuccessDesc}
                    </Text>
                </VStack>
            </Panel>
        )
    }

    const hasItems = cart.items.length > 0

    return (
        <VStack align="stretch" gap="4">
            <Heading size="lg">{t.pages.cartPage.heading}</Heading>

            {placanje === "odustao" && (
                <Box borderWidth="1px" borderColor="orange.emphasized" bg="orange.subtle" rounded="md" p="3">
                    <Text fontSize="sm">{t.pages.cartPage.paymentCancelledDesc}</Text>
                </Box>
            )}

            {/* "Brzo dodaj paket" and "Ukupno" share row 1 - a CSS grid row's
                height is set by its tallest cell, and stretch (the grid
                default) makes the shorter one match it, so the two boxes are
                always the same height whether the cart is empty or not. The
                item list is a plain row below, width-matched to the picker
                column only (the "." cell keeps the summary column's row 2
                empty rather than stretching under it). */}
            <Grid
                templateColumns={{ base: "1fr", lg: "1fr minmax(260px, 340px)" }}
                templateAreas={{
                    base: `"quickadd" "items" "summary"`,
                    lg: `"quickadd summary" "items ."`,
                }}
                gap="4"
            >
                <Panel gridArea="quickadd" p={{ base: "3.5", md: "4" }}>
                    <QuickAddTiers />
                </Panel>

                <Box gridArea="summary">
                    <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" h="full">
                        <Card.Body p={{ base: "4", md: "4" }}>
                            <CartCheckoutSection />
                        </Card.Body>
                    </Card.Root>
                </Box>

                <Box gridArea="items">
                    {!hasItems ? (
                        <Box textAlign="center" py="2">
                            <Heading size="sm">{t.pages.cartPage.emptyCartTitle}</Heading>
                            <Text fontSize="sm" color="fg.muted" mt="1">{t.pages.cartPage.emptyCartDesc}</Text>
                        </Box>
                    ) : (
                        <VStack align="stretch" gap="2.5">
                            {cart.items.map((item) => (
                                <CartItemRow key={item.id} item={item} />
                            ))}
                        </VStack>
                    )}
                </Box>
            </Grid>
        </VStack>
    )
}
