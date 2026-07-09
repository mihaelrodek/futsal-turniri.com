import { HStack, Spinner, Text } from "@chakra-ui/react"
import { FiCheckCircle, FiWifiOff } from "react-icons/fi"

/**
 * Tiny status pill for offline live-scoring. Hidden when everything is synced
 * and online. Shows "Offline · N nespremljeno" while disconnected, and
 * "Sinkronizacija…" while the queue drains after reconnect.
 */
export function LiveSyncIndicator({
    online,
    pending,
    syncing,
}: {
    online: boolean
    pending: number
    syncing: boolean
}) {
    // All good - nothing to show.
    if (online && pending === 0 && !syncing) return null

    const offline = !online
    const draining = online && (syncing || pending > 0)

    const label = offline
        ? pending > 0
            ? `Bez veze · ${pending} nespremljeno`
            : "Bez veze"
        : draining
            ? `Sinkronizacija…${pending > 0 ? ` (${pending})` : ""}`
            : "Spremljeno"

    const palette = offline ? "orange" : draining ? "blue" : "green"

    return (
        <HStack
            gap="1.5"
            alignSelf="center"
            px="2.5"
            py="1"
            rounded="full"
            fontSize="xs"
            fontWeight={600}
            bg={`${palette}.subtle`}
            color={`${palette}.fg`}
            borderWidth="1px"
            borderColor={`${palette}.emphasized`}
        >
            {offline ? (
                <FiWifiOff size={13} />
            ) : draining ? (
                <Spinner size="xs" />
            ) : (
                <FiCheckCircle size={13} />
            )}
            <Text whiteSpace="nowrap">{label}</Text>
        </HStack>
    )
}
