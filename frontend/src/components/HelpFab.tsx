import { useEffect, useState } from "react"
import { Box, chakra, HStack, Text } from "@chakra-ui/react"
import { useNavigate } from "react-router-dom"
import { FiX } from "react-icons/fi"

/**
 * Floating help button - a small circular "?" pinned to the bottom-right of
 * the viewport. Tapping it opens the /vodic tour of the app. Sits above the
 * mobile bottom nav (which is ~92px tall + iOS safe-area) on small screens,
 * and a normal corner offset on desktop.
 *
 * First visit only, a small coach-mark bubble appears above the button with
 * an arrow pointing at it ("Novi ovdje? …"). Dismissed by its X, by opening
 * the guide, or by clicking the button itself - persisted in localStorage so
 * it never shows again.
 */

const HINT_KEY = "futsal:guide-hint-dismissed"
const HINT_DELAY_MS = 2000

function readHintDismissed(): boolean {
    try {
        return window.localStorage.getItem(HINT_KEY) === "1"
    } catch {
        return false
    }
}
function persistHintDismissed() {
    try {
        window.localStorage.setItem(HINT_KEY, "1")
    } catch {
        /* private mode - hint may show again next visit, harmless */
    }
}

export default function HelpFab() {
    const navigate = useNavigate()
    const [hintOpen, setHintOpen] = useState(false)

    // Show the coach mark once, after the page settles a bit.
    useEffect(() => {
        if (readHintDismissed()) return
        const id = window.setTimeout(() => setHintOpen(true), HINT_DELAY_MS)
        return () => window.clearTimeout(id)
    }, [])

    function dismissHint() {
        setHintOpen(false)
        persistHintDismissed()
    }

    function openGuide() {
        dismissHint()
        navigate("/vodic")
    }

    return (
        <>
            {/* Coach mark - anchored just above the FAB, arrow pointing down at it. */}
            {hintOpen && (
                <Box
                    position="fixed"
                    zIndex={21}
                    right={{ base: "16px", md: "24px" }}
                    bottom={{ base: "calc(160px + env(safe-area-inset-bottom, 0px))", md: "124px" }}
                    maxW="240px"
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="pitch.emphasized"
                    rounded="xl"
                    boxShadow="lg"
                    p="3"
                    // Pop-in so the eye lands on it without being obnoxious.
                    css={{ animation: "pitchPulse 1.6s ease-in-out 1" }}
                >
                    <HStack align="start" gap="2">
                        <Box
                            flex="1"
                            minW="0"
                            cursor="pointer"
                            onClick={openGuide}
                            role="button"
                            aria-label="Otvori vodič"
                        >
                            <Text fontSize="13.5px" fontWeight={700} color="fg.ink" lineHeight="1.35">
                                Novi ovdje? 👋
                            </Text>
                            <Text fontSize="12.5px" color="fg.muted" lineHeight="1.45" mt="0.5">
                                Klikni <b>?</b> za kratki vodič kroz sve što aplikacija nudi.
                            </Text>
                        </Box>
                        <chakra.button
                            type="button"
                            aria-label="Zatvori uputu"
                            onClick={dismissHint}
                            border="none"
                            bg="transparent"
                            color="fg.muted"
                            cursor="pointer"
                            p="0.5"
                            rounded="md"
                            flexShrink={0}
                            _hover={{ color: "fg.ink", bg: "bg.muted" }}
                        >
                            <FiX size={15} />
                        </chakra.button>
                    </HStack>
                    {/* Arrow - a rotated square peeking from the bubble's bottom
                        edge, horizontally aligned with the FAB's centre. */}
                    <Box
                        position="absolute"
                        bottom="-6px"
                        right="18px"
                        w="12px"
                        h="12px"
                        bg="bg.panel"
                        borderRightWidth="1px"
                        borderBottomWidth="1px"
                        borderColor="pitch.emphasized"
                        transform="rotate(45deg)"
                    />
                </Box>
            )}

            <chakra.button
                type="button"
                aria-label="Vodič - što nudi aplikacija"
                title="Vodič - što nudi aplikacija"
                onClick={openGuide}
                position="fixed"
                zIndex={20}
                right={{ base: "16px", md: "24px" }}
                // Mobile: clear the bottom nav (~92px + iOS safe-area). Desktop:
                // clear the ~52px sticky footer so the button isn't hidden behind it.
                bottom={{ base: "calc(104px + env(safe-area-inset-bottom, 0px))", md: "68px" }}
                w="46px"
                h="46px"
                rounded="full"
                bg="pitch.500"
                color="white"
                border="none"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                fontSize="22px"
                fontWeight={800}
                lineHeight="1"
                cursor="pointer"
                boxShadow="0 6px 20px rgba(42,212,200,0.45)"
                transition="background .15s, transform .15s"
                _hover={{ bg: "pitch.600", transform: "translateY(-1px)" }}
                _active={{ bg: "pitch.700", transform: "none" }}
            >
                ?
            </chakra.button>
        </>
    )
}
