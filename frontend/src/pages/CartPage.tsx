import { useEffect } from "react"
import type { ElementType } from "react"
import { useSearchParams } from "react-router-dom"
import { Box, Button, Card, Flex, Grid, Heading, Icon, Text, VStack } from "@chakra-ui/react"
import { LuFlame, LuTarget, LuTrophy, LuVideo } from "react-icons/lu"
import { FiCheck, FiPlus, FiX } from "react-icons/fi"
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
   via the shared pieces in cart/CartShared.tsx in ONE Stripe Checkout
   Session (backend: RecordingRequestController#cartCheckout).
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
        <VStack align="stretch" gap="3">
            <Heading size="sm">{t.pages.cartPage.quickAddHeading}</Heading>
            <Grid templateColumns={{ base: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }} gap="3">
                {QUICK_ADD_TIERS.map(({ id, icon }) => {
                    const copy = t.pages.pricingPage.tiers[TIER_DICT_KEY[id]]
                    const info = TIER_INFO[id]
                    return (
                        <Box key={id} borderWidth="1px" borderColor="border" rounded="lg" p="3">
                            <HStackTierHeader icon={icon} name={copy.name} price={formatPrice(info.priceEurCents)} />
                            <Text fontSize="xs" color="fg.muted" mt="2" lineClamp={2}>
                                {copy.tagline}
                            </Text>
                            <Button
                                size="xs"
                                mt="2.5"
                                w="full"
                                variant="outline"
                                colorPalette="pitch"
                                onClick={() => cart.addTier(id)}
                            >
                                <FiPlus /> {t.pages.cartPage.quickAddButton}
                            </Button>
                        </Box>
                    )
                })}
            </Grid>
        </VStack>
    )
}

function HStackTierHeader({ icon, name, price }: { icon: ElementType; name: string; price: string }) {
    return (
        <Flex align="center" gap="2">
            <Flex w="34px" h="34px" rounded="md" bg="bg.surfaceTint" color="pitch.500" align="center" justify="center" flexShrink={0}>
                <Icon as={icon} boxSize="4" />
            </Flex>
            <Box>
                <Text fontWeight={700} fontSize="sm">{name}</Text>
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

    return (
        <VStack align="stretch" gap="5">
            <Heading size="lg">{t.pages.cartPage.heading}</Heading>

            {placanje === "odustao" && (
                <Box borderWidth="1px" borderColor="orange.emphasized" bg="orange.subtle" rounded="md" p="3">
                    <Text fontSize="sm">{t.pages.cartPage.paymentCancelledDesc}</Text>
                </Box>
            )}

            <Panel>
                <QuickAddTiers />
            </Panel>

            {cart.items.length === 0 ? (
                <Box textAlign="center" py="2">
                    <Heading size="sm">{t.pages.cartPage.emptyCartTitle}</Heading>
                    <Text fontSize="sm" color="fg.muted" mt="1">{t.pages.cartPage.emptyCartDesc}</Text>
                </Box>
            ) : (
                <>
                    <VStack align="stretch" gap="3">
                        {cart.items.map((item) => (
                            <CartItemRow key={item.id} item={item} />
                        ))}
                    </VStack>

                    <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized">
                        <Card.Body p={{ base: "4", md: "5" }}>
                            <CartCheckoutSection />
                        </Card.Body>
                    </Card.Root>

                    <Button size="xs" variant="ghost" colorPalette="red" alignSelf="flex-start" onClick={() => cart.clear()}>
                        <FiX /> {t.pages.pricingPage.clearCart}
                    </Button>
                </>
            )}
        </VStack>
    )
}
