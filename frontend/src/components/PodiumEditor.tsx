import { useState } from "react"
import { Box, Card, HStack, NativeSelect, Stack, Text } from "@chakra-ui/react"
import { FaMedal } from "react-icons/fa"
import { setPodium } from "../api/tournaments"
import type { TeamShort } from "../types/teams"
import type { TournamentDetails } from "../types/tournaments"

/**
 * Owner-only podium picker. Renders two dropdowns (2. mjesto / 3. mjesto)
 * on FINISHED tournaments and PATCHes the server on each change. Teams
 * already at gold position (winnerName) are excluded from both lists so
 * the organiser can't accidentally set the same team to two podium
 * slots - backend rejects this anyway, but the UI dropdown prevents
 * the round-trip.
 *
 * <p>Each dropdown clears with the "-" option, which sends null to the
 * server and unsets that podium column. Toaster surfaces backend errors
 * (rare, mostly the "name doesn't match a team" branch which the
 * dropdown should prevent).
 */
export default function PodiumEditor({
    tournamentUuid,
    winnerName,
    secondPlaceName,
    thirdPlaceName,
    teams,
    onUpdated,
}: {
    tournamentUuid: string
    winnerName: string | null
    secondPlaceName: string | null
    thirdPlaceName: string | null
    teams: TeamShort[]
    onUpdated: (t: TournamentDetails) => void
}) {
    const [saving, setSaving] = useState<"second" | "third" | null>(null)

    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase()

    // Candidate names = every team except the gold winner. Cast to a
    // Set to dedupe in the rare case of two teams with identical names
    // (legacy imports could produce this).
    const candidateNames = Array.from(
        new Set(
            teams
                .map((p) => p.name?.trim())
                .filter((n): n is string => !!n && norm(n) !== norm(winnerName)),
        ),
    ).sort((a, b) => a.localeCompare(b, "hr"))

    async function changeSecond(value: string) {
        try {
            setSaving("second")
            const next = value === "" ? null : value
            const updated = await setPodium(tournamentUuid, next, thirdPlaceName)
            onUpdated(updated)
        } catch {
            /* toaster handles it */
        } finally {
            setSaving(null)
        }
    }

    async function changeThird(value: string) {
        try {
            setSaving("third")
            const next = value === "" ? null : value
            const updated = await setPodium(tournamentUuid, secondPlaceName, next)
            onUpdated(updated)
        } catch {
            /* toaster handles it */
        } finally {
            setSaving(null)
        }
    }

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "3", md: "4" }}>
                <Stack gap="3">
                    <Box>
                        <Text fontSize="sm" fontWeight="semibold">Postolje</Text>
                        <Text fontSize="xs" color="fg.muted">
                            Odaberi ekipe koje su završile na drugom i trećem mjestu.
                            Pojavit će se na vrhu liste sa srebrnim i brončanim oznakama.
                        </Text>
                    </Box>

                    <HStack gap="3" align="end" wrap="wrap">
                        <Box flex="1" minW="200px">
                            <HStack gap="2" mb="1" align="center">
                                <Box color="gray.fg"><FaMedal size={14} /></Box>
                                <Text fontSize="xs" fontWeight="medium">2. mjesto (srebro)</Text>
                            </HStack>
                            <NativeSelect.Root size="sm" disabled={saving !== null}>
                                <NativeSelect.Field
                                    value={secondPlaceName ?? ""}
                                    onChange={(e) => changeSecond(e.target.value)}
                                >
                                    <option value="">- nije postavljeno -</option>
                                    {candidateNames
                                        .filter((n) => norm(n) !== norm(thirdPlaceName))
                                        .map((n) => (
                                            <option key={n} value={n}>{n}</option>
                                        ))}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                            </NativeSelect.Root>
                        </Box>
                        <Box flex="1" minW="200px">
                            <HStack gap="2" mb="1" align="center">
                                <Box color="orange.fg"><FaMedal size={14} /></Box>
                                <Text fontSize="xs" fontWeight="medium">3. mjesto (bronca)</Text>
                            </HStack>
                            <NativeSelect.Root size="sm" disabled={saving !== null}>
                                <NativeSelect.Field
                                    value={thirdPlaceName ?? ""}
                                    onChange={(e) => changeThird(e.target.value)}
                                >
                                    <option value="">- nije postavljeno -</option>
                                    {candidateNames
                                        .filter((n) => norm(n) !== norm(secondPlaceName))
                                        .map((n) => (
                                            <option key={n} value={n}>{n}</option>
                                        ))}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                            </NativeSelect.Root>
                        </Box>
                    </HStack>
                </Stack>
            </Card.Body>
        </Card.Root>
    )
}
