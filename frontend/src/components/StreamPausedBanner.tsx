import { useState } from "react"
import { Box, Flex, HStack, Text, chakra } from "@chakra-ui/react"

/* ──────────────────────────────────────────────────────────────────────────
   StreamPausedBanner - shown in the home hero slot when a live stream is
   CONFIGURED but currently paused (the admin stopped it, or it's between
   sessions). Keeps the slot occupied with the sponsor's banner instead of
   snapping back to the promo carousel, so viewers know the stream is coming
   back.

   The sponsor logo is a static public asset (see SPONSOR_LOGO). It's not
   bundled - drop the image at `frontend/public/stream-paused.png` (the
   Karlovačko banner) and it renders here; if the file is missing the banner
   degrades gracefully to just the "pauziran" text.
   ────────────────────────────────────────────────────────────────────────── */

/** Public path for the sponsor logo shown while the stream is paused. */
const SPONSOR_LOGO = "/stream-paused.png"

export default function StreamPausedBanner() {
    const [logoOk, setLogoOk] = useState(true)

    return (
        <Box mb={{ base: 0, md: 5 }} w="full" maxW={{ base: "100%", md: "620px" }} mx="auto">
            <Flex
                direction="column"
                align="center"
                justify="center"
                gap={{ base: "3", md: "5" }}
                position="relative"
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border"
                rounded="2xl"
                overflow="hidden"
                px="6"
                css={{ aspectRatio: "16 / 9" }}
            >
                {/* "PAUZIRANO" pill - grey (not the live red). */}
                <HStack
                    position="absolute"
                    top="3"
                    left="3"
                    gap="1.5"
                    px="2.5"
                    py="1"
                    rounded="full"
                    bg="bg.surfaceTint"
                    borderWidth="1px"
                    borderColor="border"
                >
                    <Box w="6px" h="6px" rounded="full" bg="fg.muted" />
                    <Text fontFamily="mono" fontSize="10px" fontWeight={800} letterSpacing="0.08em" color="fg.muted">
                        PAUZIRANO
                    </Text>
                </HStack>

                {/* Sponsor logo (public asset). Hidden if the file isn't there. */}
                {logoOk && (
                    <chakra.img
                        src={SPONSOR_LOGO}
                        alt="Sponzor prijenosa"
                        onError={() => setLogoOk(false)}
                        maxH="55%"
                        maxW={{ base: "80%", md: "70%" }}
                        css={{ objectFit: "contain" }}
                    />
                )}

                <Text fontSize={{ base: "sm", md: "md" }} fontWeight={700} color="fg.muted" textAlign="center">
                    Stream je trenutno pauziran
                </Text>
            </Flex>
        </Box>
    )
}
