import { useState } from "react"
import { Box, Flex, HStack, Text, chakra } from "@chakra-ui/react"

/* ──────────────────────────────────────────────────────────────────────────
   StreamPausedBanner - fills the home hero slot when the stream isn't playing
   but the admin still wants the slot occupied (instead of snapping back to the
   promo carousel). Two modes:

     • "paused" - "Stream je trenutno pauziran"; the stream is coming back.
     • "ads"    - the sponsor / advertising banner ("mod reklama").

   The sponsor logo is a static public asset (see SPONSOR_LOGO). It's not
   bundled - drop the image at `frontend/public/stream-paused.png` (the
   Karlovačko banner) and it renders here; if the file is missing the banner
   degrades gracefully to just the text.
   ────────────────────────────────────────────────────────────────────────── */

/** Public path for the sponsor logo shown in ad mode. */
const SPONSOR_LOGO = "/stream-paused.png"

export default function StreamPausedBanner({
    mode = "ads",
    adUrl = null,
    adMediaType = null,
}: {
    mode?: "paused" | "ads"
    /** Uploaded ad blob (proxy url) to show in ad mode; null → sponsor logo. */
    adUrl?: string | null
    adMediaType?: "IMAGE" | "VIDEO" | null
}) {
    const [logoOk, setLogoOk] = useState(true)
    const isAds = mode === "ads"

    return (
        <Box mb="0" w="full" maxW={{ base: "100%", md: "620px" }} mx="auto">
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
                {/* Mode pill - grey (not the live red). Above the ad media. */}
                <HStack
                    position="absolute"
                    top="3"
                    left="3"
                    zIndex={1}
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
                        {isAds ? "REKLAMA" : "PAUZIRANO"}
                    </Text>
                </HStack>

                {isAds && adUrl ? (
                    /* Uploaded ad fills the 16:9 slot - image static, video looped. */
                    adMediaType === "VIDEO" ? (
                        <chakra.video
                            src={adUrl}
                            autoPlay
                            muted
                            loop
                            playsInline
                            position="absolute"
                            inset="0"
                            w="full"
                            h="full"
                            css={{ objectFit: "contain" }}
                        />
                    ) : (
                        <chakra.img
                            src={adUrl}
                            alt="Reklama"
                            position="absolute"
                            inset="0"
                            w="full"
                            h="full"
                            css={{ objectFit: "contain" }}
                        />
                    )
                ) : (
                    <>
                        {/* No uploaded ad → static sponsor logo (ad mode) or just
                            the paused text. */}
                        {isAds && logoOk && (
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
                            {isAds ? "Prijenos se uskoro nastavlja" : "Stream je trenutno pauziran"}
                        </Text>
                    </>
                )}
            </Flex>
        </Box>
    )
}
