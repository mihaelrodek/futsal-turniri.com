import { Box, Text, chakra } from "@chakra-ui/react"

import type { TournamentFormat } from "../types/tournaments"

/* ──────────────────────────────────────────────────────────────────────────
   FormatSketch — a lightweight SVG diagram of how the chosen competition
   format flows. Shared between the create wizard (Format step) and the
   tournament detail view (Detalji box).

   · GROUPS_KNOCKOUT: two group boxes feeding an arrow into a small bracket.
   · KNOCKOUT_ONLY:   a single elimination bracket, no groups.
   ────────────────────────────────────────────────────────────────────── */
export function FormatSketch({ format }: { format: TournamentFormat }) {
    const stroke = "var(--chakra-colors-pitch-500)"
    const faint = "var(--chakra-colors-border-emphasized)"
    const ink = "var(--chakra-colors-fg-muted)"

    return (
        <Box
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            p="4"
        >
            <Text
                fontFamily="mono"
                fontSize="10px"
                fontWeight={800}
                letterSpacing="0.15em"
                color="fg.muted"
                mb="3"
            >
                {format === "GROUPS_KNOCKOUT"
                    ? "SKICA · GRUPE → ELIMINACIJA"
                    : "SKICA · ELIMINACIJA"}
            </Text>

            {format === "GROUPS_KNOCKOUT" ? (
                <chakra.svg
                    viewBox="0 0 360 130"
                    width="100%"
                    height="auto"
                    maxW="420px"
                    css={{ display: "block" }}
                >
                    {/* Group A */}
                    <rect x="2" y="6" width="92" height="50" rx="8" fill="none" stroke={faint} strokeWidth="1.5" />
                    <text x="10" y="20" fontSize="9" fontWeight="700" fill={ink}>GRUPA A</text>
                    <line x1="10" y1="30" x2="86" y2="30" stroke={faint} strokeWidth="1" />
                    <line x1="10" y1="40" x2="86" y2="40" stroke={faint} strokeWidth="1" />
                    <line x1="10" y1="50" x2="86" y2="50" stroke={faint} strokeWidth="1" />
                    {/* Group B */}
                    <rect x="2" y="72" width="92" height="50" rx="8" fill="none" stroke={faint} strokeWidth="1.5" />
                    <text x="10" y="86" fontSize="9" fontWeight="700" fill={ink}>GRUPA B</text>
                    <line x1="10" y1="96" x2="86" y2="96" stroke={faint} strokeWidth="1" />
                    <line x1="10" y1="106" x2="86" y2="106" stroke={faint} strokeWidth="1" />
                    <line x1="10" y1="116" x2="86" y2="116" stroke={faint} strokeWidth="1" />

                    {/* Arrow → */}
                    <line x1="100" y1="64" x2="132" y2="64" stroke={stroke} strokeWidth="2" />
                    <path d="M132 64 l-7 -4 v8 z" fill={stroke} />
                    <text x="100" y="56" fontSize="8" fontWeight="700" fill={stroke}>prolaze</text>

                    {/* Bracket — semis → final */}
                    {/* SF1 */}
                    <rect x="146" y="20" width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    {/* SF2 */}
                    <rect x="146" y="86" width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    {/* connectors to final */}
                    <path d="M220 28 H240 V61 H260" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M220 94 H240 V67 H260" fill="none" stroke={stroke} strokeWidth="1.5" />
                    {/* Final */}
                    <rect x="260" y="54" width="84" height="20" rx="5" fill="none" stroke={stroke} strokeWidth="2" />
                    <text x="302" y="68" fontSize="9" fontWeight="800" fill={stroke} textAnchor="middle">FINALE</text>
                </chakra.svg>
            ) : (
                <chakra.svg
                    viewBox="0 0 360 130"
                    width="100%"
                    height="auto"
                    maxW="420px"
                    css={{ display: "block" }}
                >
                    {/* Quarterfinals (4) */}
                    {[10, 38, 80, 108].map((y, i) => (
                        <rect key={i} x="2" y={y} width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    ))}
                    {/* QF → SF connectors */}
                    <path d="M76 18 H92 V40 H110" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M76 46 H92 V40" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M76 88 H92 V110 H110" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M76 116 H92 V110" fill="none" stroke={stroke} strokeWidth="1.5" />
                    {/* Semifinals (2) */}
                    <rect x="110" y="32" width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    <rect x="110" y="102" width="74" height="16" rx="4" fill="none" stroke={faint} strokeWidth="1.5" />
                    {/* SF → final connectors */}
                    <path d="M184 40 H206 V65 H228" fill="none" stroke={stroke} strokeWidth="1.5" />
                    <path d="M184 110 H206 V73 H228" fill="none" stroke={stroke} strokeWidth="1.5" />
                    {/* Final */}
                    <rect x="228" y="55" width="92" height="22" rx="5" fill="none" stroke={stroke} strokeWidth="2" />
                    <text x="274" y="70" fontSize="9" fontWeight="800" fill={stroke} textAnchor="middle">FINALE</text>
                </chakra.svg>
            )}

            <Text fontSize="xs" color="fg.muted" mt="3">
                {format === "GROUPS_KNOCKOUT"
                    ? "Ekipe se prvo bore u grupama; najbolji iz svake grupe prolaze u eliminacijsku ljestvicu do finala."
                    : "Sve ekipe idu izravno u eliminacijsku ljestvicu — poraz znači ispadanje, sve do finala."}
            </Text>
        </Box>
    )
}
