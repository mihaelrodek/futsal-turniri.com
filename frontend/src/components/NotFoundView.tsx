import { Box, Flex, Heading, HStack, Text } from "@chakra-ui/react"
import { useNavigate } from "react-router-dom"
import { FiArrowLeft, FiHelpCircle } from "react-icons/fi"
import { FaFutbol } from "react-icons/fa"
import { GhostButton, PitchBackdrop, PrimaryButton } from "../ui/pitch"

/**
 * Shared "not found" panel in the Pitch theme - dark-green gradient hero with
 * the painted-lines backdrop, a big mono 404 and a football rolling off the
 * baseline. Used by the router catch-all (NotFoundPage) and by detail pages
 * whose entity vanished (deleted tournament, dead slug), replacing the raw
 * axios "Request failed with status code 404" text.
 */
export default function NotFoundView({
    code = "404",
    title = "Stranica nije pronađena",
    description = "Adresa koju si otvorio ne postoji ili je premještena.",
}: {
    code?: string
    title?: string
    description?: string
}) {
    const navigate = useNavigate()
    return (
        <Flex justify="center" py={{ base: "8", md: "14" }}>
            <Box
                position="relative"
                overflow="hidden"
                rounded="2xl"
                maxW="560px"
                w="full"
                color="white"
                bgImage="linear-gradient(135deg, #0B1522, #0F2E35)"
                textAlign="center"
                px={{ base: "6", md: "10" }}
                py={{ base: "10", md: "12" }}
            >
                <PitchBackdrop opacity={0.16} variant="not-found" tone="pitch" />
                <Box position="relative">
                    <HStack justify="center" align="baseline" gap="3" mt="3">
                        <Heading
                            fontFamily="mono"
                            fontSize={{ base: "72px", md: "96px" }}
                            fontWeight={800}
                            letterSpacing="-0.06em"
                            lineHeight="1"
                        >
                            {code}
                        </Heading>
                        <Box
                            as={FaFutbol}
                            boxSize={{ base: "34px", md: "44px" }}
                            color="rgba(255,255,255,0.92)"
                            css={{ transform: "rotate(12deg)" }}
                        />
                    </HStack>
                    <Heading
                        fontFamily="heading"
                        fontSize={{ base: "20px", md: "24px" }}
                        fontWeight={700}
                        letterSpacing="-0.01em"
                        mt="4"
                    >
                        {title}
                    </Heading>
                    <Text
                        fontSize="14.5px"
                        color="rgba(255,255,255,0.8)"
                        lineHeight="1.6"
                        maxW="380px"
                        mx="auto"
                        mt="2"
                    >
                        {description}
                    </Text>
                    <HStack justify="center" gap="3" mt="7" wrap="wrap">
                        <PrimaryButton
                            icon={<FiArrowLeft size={15} />}
                            onClick={() => navigate("/turniri")}
                            css={{ background: "#fff", color: "#0E8A81" }}
                            _hover={{ background: "rgba(255,255,255,0.9)" }}
                        >
                            Natrag na turnire
                        </PrimaryButton>
                        <GhostButton
                            icon={<FiHelpCircle size={15} />}
                            onClick={() => navigate("/vodic")}
                            css={{
                                color: "#fff",
                                borderColor: "rgba(255,255,255,0.35)",
                                background: "rgba(255,255,255,0.08)",
                            }}
                        >
                            Vodič
                        </GhostButton>
                    </HStack>
                </Box>
            </Box>
        </Flex>
    )
}
