import { Component, type ErrorInfo, type ReactNode } from "react"
import { Box, Button, Heading, Text, VStack } from "@chakra-ui/react"

type Props = { children: ReactNode }
type State = { hasError: boolean }

/**
 * Top-level safety net: any uncaught render error (a crashing component, or a
 * lazy chunk that fails even after the one-shot reload in App.tsx) is caught
 * here and shown as a friendly "refresh" screen instead of a blank white page.
 */
export default class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false }

    static getDerivedStateFromError(): State {
        return { hasError: true }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        // Surface for debugging; no external error reporting is wired up.
        console.error("[ErrorBoundary]", error, info.componentStack)
    }

    render() {
        if (!this.state.hasError) return this.props.children
        return (
            <Box minH="100dvh" display="flex" alignItems="center" justifyContent="center" p="6">
                <VStack gap="4" textAlign="center" maxW="sm">
                    <Text fontSize="40px" lineHeight="1">⚽</Text>
                    <Heading size="md" color="fg.ink">Nešto je pošlo po zlu</Heading>
                    <Text fontSize="sm" color="fg.muted">
                        Dogodila se neočekivana greška. Osvježi stranicu pa pokušaj ponovno.
                    </Text>
                    <Button colorPalette="brand" onClick={() => window.location.reload()}>
                        Osvježi stranicu
                    </Button>
                </VStack>
            </Box>
        )
    }
}
