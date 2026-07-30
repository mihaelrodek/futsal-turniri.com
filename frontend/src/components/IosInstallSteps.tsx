import { Box, HStack, Text, VStack } from "@chakra-ui/react"
import { FiShare, FiPlusSquare } from "react-icons/fi"
import { useTranslation } from "../i18n"

/**
 * Shared three-step "Add to Home Screen" walkthrough for iOS Safari.
 *
 * Re-used by:
 *   - FirstRunInstallPrompt - shows the steps inline in the auto-popup so
 *     iPhone users get instructions on first visit without an extra click.
 *   - InstallAppButton - opens these steps in its own iOS dialog when the
 *     navbar download icon is tapped.
 *
 * Pure presentation, no state. Wraps each step number in a circular blue
 * badge so the sequence is visually obvious; uses the FiShare and
 * FiPlusSquare glyphs to match what the user will see in Safari's UI.
 */
export default function IosInstallSteps() {
    const t = useTranslation()
    return (
        <VStack align="stretch" gap="3">
            <Text fontSize="sm" color="fg.muted">
                {t.components.iosInstallSteps.intro}
            </Text>

            <Step n={1}>
                {t.components.iosInstallSteps.step1Before}{" "}
                <Box as="span" display="inline-flex" alignItems="center">
                    <FiShare />
                </Box>{" "}
                <strong>{t.components.iosInstallSteps.step1Bold}</strong> {t.components.iosInstallSteps.step1After}
            </Step>

            <Step n={2}>
                {t.components.iosInstallSteps.step2Before}{" "}
                <Box as="span" display="inline-flex" alignItems="center">
                    <FiPlusSquare />
                </Box>{" "}
                <strong>{t.components.iosInstallSteps.step2Bold}</strong>.
            </Step>

            <Step n={3}>
                {t.components.iosInstallSteps.step3Before} <strong>{t.components.iosInstallSteps.step3Bold}</strong> {t.components.iosInstallSteps.step3After}
            </Step>

            <Text fontSize="xs" color="fg.muted" pt="2">
                {t.components.iosInstallSteps.outro}
            </Text>
        </VStack>
    )
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
    return (
        <HStack align="start" gap="3">
            <Box
                minW="28px"
                h="28px"
                rounded="full"
                bg="blue.subtle"
                color="blue.fg"
                display="flex"
                alignItems="center"
                justifyContent="center"
                fontWeight="bold"
                fontSize="sm"
            >
                {n}
            </Box>
            <Text fontSize="sm">{children}</Text>
        </HStack>
    )
}
