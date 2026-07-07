import {
    Box,
    chakra,
    Flex,
    HStack,
    Heading,
    Icon,
    Text,
    type BoxProps,
    type FlexProps,
} from "@chakra-ui/react"
import type { ElementType, ReactNode } from "react"
import { FaFutbol } from "react-icons/fa"
import { FiDownload } from "react-icons/fi"

/* ──────────────────────────────────────────────────────────────────────────
   Pitch theme primitives - Nogometni-turniri.com redesign.

   Small, composable building blocks for the "Pitch" visual language:
   pitch green primary, scoreboard mono numerics, off-white canvas, pill
   chips with status dots. Built on Chakra UI v3 and the `pitch` palette
   defined in system.ts.

   Conventions:
   - Container components accept Chakra Box/Flex props so callers can
     override layout where needed.
   - The CSS animation `pitchPulse` is registered globally in system.ts
     (`globalCss.@keyframes pitchPulse`). Pulsing dots reference it by
     name.
   ────────────────────────────────────────────────────────────────────── */

/** Futsal-court backdrop - replaces the old football-pitch SVG.
 *
 * Why the change: futsal is played on hard indoor courts (parquet / sport
 * tile) or outdoor concrete street courts, NOT on grass. A green "football
 * pitch" backdrop on the card placeholders misrepresented the sport, so the
 * default look is now a **slate hard-court** with proper futsal markings:
 *
 *   - Rectangular court (no 18-yard penalty box - that's football)
 *   - Halfway line + centre circle (3m)
 *   - Two "D"-shaped penalty arcs at 6m from each goal (the futsal "D")
 *   - First and second penalty marks (6m and 10m - the 10m mark is unique
 *     to futsal and a recognisable visual cue)
 *   - Quarter-circle corner arcs
 *
 * Two visual tones via the `tone` prop:
 *   - `"court"` (default) - dark slate / asphalt gradient with a subtle
 *     concrete-grit dot pattern. Reads as a street / indoor hard court.
 *     Used everywhere a card needs a neutral placeholder.
 *   - `"pitch"` - the legacy green gradient. Reserved for branded hero
 *     blocks where the brand-green wash is intentional (live banner).
 */
export function PitchBackdrop({
    opacity = 0.16,
    variant = "default",
    tone = "court",
}: {
    opacity?: number
    variant?: string
    tone?: "court" | "pitch"
}) {
    const gid = `pitch-grad-${variant}-${tone}`
    const gritId = `pitch-grit-${variant}`
    const stops =
        tone === "pitch"
            ? { from: "#3aa56b", to: "#0b6b3a" }
            : // Polished-concrete mid-grey - light enough to feel friendly
              // and modern, dark enough that white-cream futsal markings
              // still read clearly. Lighter than the original #2f353d.
              { from: "#9aa3ad", to: "#5d6671" }
    const line = tone === "pitch" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.78)"
    return (
        <Box
            as="svg"
            // viewBox sized to a 40m × 20m futsal court (scaled 30×). All
            // marking distances are derived from the real laws of the game
            // so the silhouette reads as futsal even at low opacity.
            // @ts-expect-error - Chakra's `as="svg"` forwards SVG attrs.
            viewBox="0 0 1200 240"
            preserveAspectRatio="xMidYMid slice"
            position="absolute"
            inset="0"
            w="100%"
            h="100%"
            opacity={opacity}
            pointerEvents="none"
        >
            <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={stops.from} />
                    <stop offset="100%" stopColor={stops.to} />
                </linearGradient>
                {/* Concrete-grit dots - only on court tone, simulates the
                     subtle texture of a painted asphalt or sport-tile
                     surface. Skip on pitch tone so the green hero stays
                     clean. */}
                {tone === "court" && (
                    <pattern id={gritId} width="4" height="4" patternUnits="userSpaceOnUse">
                        <circle cx="2" cy="2" r="0.5" fill="rgba(255,255,255,0.06)" />
                    </pattern>
                )}
            </defs>

            <rect width="1200" height="240" fill={`url(#${gid})`} />
            {tone === "court" && (
                <rect width="1200" height="240" fill={`url(#${gritId})`} />
            )}

            {/* Court boundary (40m × 20m) */}
            <rect
                x="20"
                y="20"
                width="1160"
                height="200"
                fill="none"
                stroke={line}
                strokeWidth="2"
            />

            {/* Halfway line + centre spot + 3m centre circle */}
            <line x1="600" y1="20" x2="600" y2="220" stroke={line} strokeWidth="2" />
            <circle cx="600" cy="120" r="50" fill="none" stroke={line} strokeWidth="2" />
            <circle cx="600" cy="120" r="3" fill={line} />

            {/* Futsal "D" - 6m penalty arc at each end. Drawn as a half-
                 ellipse anchored at the goal line so it reads as a true
                 futsal mark, not a football-style penalty box. */}
            <path
                d="M 20 60 A 100 60 0 0 1 20 180"
                fill="none"
                stroke={line}
                strokeWidth="2"
            />
            <path
                d="M 1180 60 A 100 60 0 0 0 1180 180"
                fill="none"
                stroke={line}
                strokeWidth="2"
            />

            {/* First penalty mark (6m) and second penalty mark (10m) at
                 each end - the 10m mark is distinctively futsal. */}
            <circle cx="80" cy="120" r="3" fill={line} />
            <circle cx="1120" cy="120" r="3" fill={line} />
            <circle cx="140" cy="120" r="3" fill={line} />
            <circle cx="1060" cy="120" r="3" fill={line} />

            {/* Goal lines - small notches at each goal to suggest goals
                 without rendering full 3-D nets. */}
            <line x1="20" y1="100" x2="10" y2="100" stroke={line} strokeWidth="2" />
            <line x1="20" y1="140" x2="10" y2="140" stroke={line} strokeWidth="2" />
            <line x1="1180" y1="100" x2="1190" y2="100" stroke={line} strokeWidth="2" />
            <line x1="1180" y1="140" x2="1190" y2="140" stroke={line} strokeWidth="2" />

            {/* Corner quarter-arcs (25cm in the real laws - drawn slightly
                 bigger so they read at this scale). */}
            <path d="M 20 35 A 15 15 0 0 0 35 20" fill="none" stroke={line} strokeWidth="2" />
            <path d="M 1180 35 A 15 15 0 0 1 1165 20" fill="none" stroke={line} strokeWidth="2" />
            <path d="M 20 205 A 15 15 0 0 1 35 220" fill="none" stroke={line} strokeWidth="2" />
            <path d="M 1180 205 A 15 15 0 0 0 1165 220" fill="none" stroke={line} strokeWidth="2" />
        </Box>
    )
}

/** Distinctive soccer-ball SVG mark.
 *
 * `size` ≤ 24 ⇒ small inline glyph (line-drawing style, used as a
 * "goal scored" cue and a brand mark next to text).
 * `size`  > 24 ⇒ bold placeholder rendition - the centre pentagon stays
 * filled, but the surrounding strokes thicken proportionally so the ball
 * reads cleanly at hero / card-placeholder sizes (60-140 px).
 *
 * Keeping a single component (rather than `react-icons` `LuVolleyball`)
 * preserves the bespoke 5-panel silhouette from the design prototype.
 */
export function BallIcon({
    size = 16,
    color = "currentColor",
    strokeWidth,
}: {
    size?: number
    color?: string
    strokeWidth?: number
}) {
    // Scale stroke width with size - 1.6 looks right at 16px, ~1.4 at
    // 80px (the SVG itself is scaled, the stroke is relative to its
    // 0..24 viewBox). Caller can override.
    const sw = strokeWidth ?? (size > 24 ? 1.4 : 1.6)
    return (
        <Box
            as="svg"
            // @ts-expect-error - SVG attrs forwarded by Chakra.
            viewBox="0 0 24 24"
            width={`${size}px`}
            height={`${size}px`}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeLinejoin="round"
            display="inline-block"
        >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 4 L15.5 6.5 L14 10.5 L10 10.5 L8.5 6.5 Z" fill={color} fillOpacity="0.9" stroke="none" />
            <path d="M14 10.5 L17.5 13 L16 17 L12 16.5 L12 12.5 Z" />
            <path d="M10 10.5 L6.5 13 L8 17 L12 16.5" />
            <path d="M15.5 6.5 L19 9 L17.5 13" />
            <path d="M8.5 6.5 L5 9 L6.5 13" />
        </Box>
    )
}

/** Small all-caps mono caption - "DATUM", "ORGANIZATOR", scoreboard kickers. */
export function MonoLabel({
    children,
    color = "fg.muted",
    ...rest
}: { children: ReactNode } & BoxProps) {
    return (
        <Box
            as="span"
            fontFamily="mono"
            fontSize="10px"
            fontWeight={700}
            letterSpacing="0.1em"
            textTransform="uppercase"
            color={color}
            {...rest}
        >
            {children}
        </Box>
    )
}

/** Pulsing dot - base building block for the live/now indicator. */
export function PulseDot({
    color = "accent.red",
    size = 7,
    glow,
    ...rest
}: {
    color?: string
    size?: number
    glow?: boolean
} & BoxProps) {
    return (
        <Box
            display="inline-block"
            w={`${size}px`}
            h={`${size}px`}
            rounded="full"
            bg={color}
            boxShadow={glow ? `0 0 8px ${color}` : undefined}
            // Animation registered in system.ts globalCss.
            css={{ animation: "pitchPulse 1.6s infinite" }}
            {...rest}
        />
    )
}

export type StatusKind = "live" | "upcoming" | "soon" | "full" | "draft" | "active" | "finished"

/** Status pill - colored dot + label. Matches the design's `StatusChip` with
 *  six discrete kinds. `live` is solid red with a pulsing dot, all other
 *  upcoming statuses use a white pill with a colored marker for low visual
 *  noise. */
export function StatusChip({
    status,
    label,
    size = "md",
}: {
    status: StatusKind
    label: string
    size?: "sm" | "md" | "lg"
}) {
    const map: Record<StatusKind, { bg: string; fg: string; dot: string; border?: string; pulse?: boolean }> = {
        live: { bg: "accent.red", fg: "#fff", dot: "#fff", pulse: true },
        upcoming: { bg: "#fff", fg: "fg.ink", dot: "pitch.400", border: "border" },
        soon: { bg: "#fff", fg: "fg.ink", dot: "accent.amber", border: "border" },
        full: { bg: "#fff", fg: "fg.ink", dot: "fg.muted", border: "border" },
        draft: { bg: "fg.ink", fg: "#fff", dot: "accent.goal" },
        active: { bg: "pitch.500", fg: "#fff", dot: "#fff" },
        finished: { bg: "#fff", fg: "fg.ink", dot: "fg.muted", border: "border" },
    }
    const cfg = map[status]
    const dims =
        size === "lg"
            ? { fontSize: "12px", px: "14px", py: "6px" }
            : size === "sm"
                ? { fontSize: "9px", px: "8px", py: "3px" }
                : { fontSize: "10px", px: "10px", py: "4px" }
    return (
        <Flex
            as="span"
            display="inline-flex"
            align="center"
            gap="1.5"
            bg={cfg.bg}
            color={cfg.fg}
            borderWidth={cfg.border ? "1px" : "0"}
            borderColor={cfg.border}
            rounded="full"
            fontWeight={700}
            letterSpacing="0.04em"
            {...dims}
        >
            <PulseDot
                color={cfg.dot}
                size={6}
                // Only the live status actually pulses - for everything else
                // override the global pitchPulse animation with `none` so
                // upcoming/soon/full dots stay still.
                css={cfg.pulse ? undefined : { animation: "none" }}
            />
            {label}
        </Flex>
    )
}

/** SectionCard - the white panel container used across the design. Optional
 *  header row with icon + title + subtitle + right-aligned action slot. The
 *  body is rendered without padding when `padding="0"` so callers can
 *  paint edge-to-edge (e.g. embedded maps). */
export function SectionCard({
    title,
    subtitle,
    icon,
    action,
    children,
    padding = "20px 24px",
    ...rest
}: {
    title?: ReactNode
    subtitle?: ReactNode
    icon?: ElementType | ReactNode
    action?: ReactNode
    padding?: BoxProps["padding"]
} & Omit<BoxProps, "title">) {
    const hasHeader = title || icon
    return (
        <Box bg="bg.panel" borderWidth="1px" borderColor="border" rounded="xl" overflow="hidden" {...rest}>
            {hasHeader && (
                <Flex
                    px="6"
                    py="4"
                    direction={{ base: "column", md: "row" }}
                    justify="space-between"
                    align={{ base: "stretch", md: "center" }}
                    borderBottomWidth={children ? "1px" : "0"}
                    borderColor="border"
                    gap="3"
                >
                    <Flex align="center" gap="3" minW="0">
                        {icon ? (
                            <Flex
                                w="38px"
                                h="38px"
                                rounded="md"
                                bg="bg.surfaceTint"
                                color="pitch.500"
                                align="center"
                                justify="center"
                                flexShrink={0}
                            >
                                {typeof icon === "function" ? <Icon as={icon as ElementType} boxSize="4" /> : icon}
                            </Flex>
                        ) : null}
                        <Box minW="0">
                            {title ? (
                                <Heading size="md" lineHeight="1.25" letterSpacing="-0.01em" color="fg.ink">
                                    {title}
                                </Heading>
                            ) : null}
                            {subtitle ? (
                                <Text fontSize="sm" color="fg.muted" mt="0.5">
                                    {subtitle}
                                </Text>
                            ) : null}
                        </Box>
                    </Flex>
                    {action ? <Box flexShrink={0}>{action}</Box> : null}
                </Flex>
            )}
            {children ? <Box padding={padding}>{children}</Box> : null}
        </Box>
    )
}

/** Filter chip - pill toggle with optional colored leading dot and trailing
 *  count. Used in the listing page filter row and the live page filter
 *  switcher. Active state flips to a solid dark pill. */
export function FilterChip({
    label,
    count,
    dot,
    active,
    onClick,
    pulse,
}: {
    label: ReactNode
    count?: number
    dot?: string
    active?: boolean
    onClick?: () => void
    pulse?: boolean
}) {
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            display="inline-flex"
            alignItems="center"
            gap="1.5"
            px="3.5"
            py="1.5"
            rounded="full"
            border="none"
            cursor="pointer"
            bg={active ? "fg.ink" : "bg.panel"}
            color={active ? "white" : "fg.soft"}
            fontSize="12px"
            fontWeight={600}
            boxShadow={active ? "none" : "inset 0 0 0 1px var(--chakra-colors-border)"}
            transition="background 150ms, color 150ms"
            _hover={{ bg: active ? "fg.ink" : "bg.surfaceTint" }}
        >
            {dot ? (
                <Box
                    w="7px"
                    h="7px"
                    rounded="full"
                    bg={dot}
                    css={pulse ? { animation: "pitchPulse 1.6s infinite" } : undefined}
                />
            ) : null}
            <Box as="span">{label}</Box>
            {typeof count === "number" ? (
                <Box
                    as="span"
                    color={active ? "rgba(255,255,255,0.6)" : "fg.muted"}
                    fontWeight={700}
                >
                    {count}
                </Box>
            ) : null}
        </chakra.button>
    )
}

/** Pill-style tab bar used on the tournament detail screens (`Detalji`,
 *  `Ekipe`, `Ždrijeb`, `Raspored`, `Statistika`). Active tab fills with
 *  pitch green; the rest sit on the white pill background. */
export function PillTabBar<T extends string>({
    tabs,
    active,
    onChange,
    ...rest
}: {
    tabs: T[]
    active: T
    onChange: (next: T) => void
} & Omit<FlexProps, "onChange">) {
    return (
        <Flex
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="full"
            padding="6px"
            gap="2px"
            mb="6"
            overflowX="auto"
            {...rest}
        >
            {tabs.map((t) => {
                const isActive = t === active
                return (
                    <chakra.button
                        type="button"
                        key={t}
                        onClick={() => onChange(t)}
                        flex="1"
                        minW="fit-content"
                        px="4"
                        py="2.5"
                        rounded="full"
                        border="none"
                        bg={isActive ? "pitch.500" : "transparent"}
                        color={isActive ? "white" : "fg.ink"}
                        fontSize="14px"
                        fontWeight={600}
                        cursor="pointer"
                        whiteSpace="nowrap"
                        transition="background 150ms"
                        _hover={!isActive ? { bg: "bg.surfaceTint" } : undefined}
                    >
                        {t}
                    </chakra.button>
                )
            })}
        </Flex>
    )
}

/** Big accent-striped stat tile - used on the detail "Datum / Vrijeme /
 *  Ekipe / Kotizacija" quick stats row, the statistika headline row, and
 *  the team detail "Prijavljene / Popunjeno / …" strip. */
export function AccentStat({
    label,
    value,
    hint,
    accent = "pitch.500",
    icon,
}: {
    label: ReactNode
    value: ReactNode
    hint?: ReactNode
    accent?: string
    icon?: ReactNode
}) {
    return (
        <Box
            position="relative"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            px="4"
            py="3"
            overflow="hidden"
        >
            <Box position="absolute" top="0" left="0" w="3px" h="100%" bg={accent} />
            <HStack color="fg.muted" gap="1.5">
                {icon}
                <MonoLabel>{label}</MonoLabel>
            </HStack>
            <Text fontSize="22px" fontWeight={800} color="fg.ink" letterSpacing="-0.02em" mt="1">
                {value}
            </Text>
            {hint ? (
                <Text fontSize="xs" color="fg.muted" mt="0.5">
                    {hint}
                </Text>
            ) : null}
        </Box>
    )
}

/** Date stamp - top-left overlay on tournament cards. Day-of-week / day /
 *  month-mono triplet inside a translucent white pill. */
export function DateStamp({
    day,
    dayNum,
    month,
}: {
    day: string
    dayNum: string | number
    month: string
}) {
    return (
        <Box
            bg="rgba(255,255,255,0.95)"
            rounded="md"
            px="3"
            py="2"
            textAlign="center"
            minW="60px"
            css={{ backdropFilter: "blur(8px)" }}
        >
            <MonoLabel fontSize="9px">{day}</MonoLabel>
            <Text fontSize="20px" fontWeight={800} color="fg.ink" lineHeight={1} letterSpacing="-0.03em" mt="0.5">
                {dayNum}
            </Text>
            <Box as="span" fontFamily="mono" fontSize="9px" color="pitch.500" fontWeight={700} letterSpacing="0.1em">
                {month}
            </Box>
        </Box>
    )
}

/** Tournament poster - image when present, otherwise a styled empty-state
 *  with the pitch backdrop and centred initials. Same component used in
 *  the listing card (180px) and the detail view (500px, `big`). */
export function TournamentPoster({
    name,
    bannerUrl,
    height = 180,
    big = false,
    seed,
    downloadable = false,
    natural = false,
    priority = false,
}: {
    name: string
    bannerUrl?: string | null
    height?: number | string
    big?: boolean
    seed?: string
    /** Show a small download button (top-right) over the poster image. */
    downloadable?: boolean
    /** Render the poster at its natural aspect ratio (whole image always
     *  visible, height adapts) instead of a fixed-height cover crop - for
     *  the details page where a tall portrait poster must not be cut off.
     *  `height` is ignored in this mode. */
    natural?: boolean
    /** True for the likely-LCP poster (first card / details hero): loads
     *  eagerly with fetchpriority=high. Everything else lazy-loads. */
    priority?: boolean
}) {
    if (bannerUrl) {
        // A real <img> (not a CSS background) so the preload scanner discovers
        // the LCP image during HTML/early parse - PSI's "LCP request discovery"
        // flagged the old bgImage approach (only discovered after CSSOM+layout).
        return (
            <Box
                position="relative"
                overflow="hidden"
                {...(natural
                    ? {}
                    : { h: `${typeof height === "number" ? `${height}px` : height}` })}
            >
                <chakra.img
                    src={bannerUrl}
                    alt={`Plakat - ${name}`}
                    display="block"
                    w="full"
                    loading={priority ? "eager" : "lazy"}
                    fetchPriority={priority ? "high" : "auto"}
                    {...(natural
                        ? { h: "auto" }
                        : // Anchor the crop to the TOP of the poster - that's
                          // where the title/header lives on a typical portrait
                          // flyer; a centre crop showed the middle instead.
                          { h: "full", objectFit: "cover", objectPosition: "top center" })}
                />
                {downloadable && (
                    <chakra.a
                        href={bannerUrl}
                        download={`plakat-${name}.jpg`}
                        aria-label="Preuzmi plakat"
                        title="Preuzmi plakat"
                        onClick={(e) => e.stopPropagation()}
                        position="absolute"
                        top="2"
                        right="2"
                        display="inline-flex"
                        alignItems="center"
                        justifyContent="center"
                        boxSize="34px"
                        rounded="full"
                        bg="rgba(0,0,0,0.55)"
                        color="white"
                        backdropFilter="blur(4px)"
                        transition="background .15s"
                        _hover={{ bg: "rgba(0,0,0,0.75)" }}
                    >
                        <FiDownload size={16} />
                    </chakra.a>
                )}
            </Box>
        )
    }
    const initials =
        name
            .split(/\s+/)
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase() || "FT"
    return (
        <Box
            position="relative"
            h={`${typeof height === "number" ? `${height}px` : height}`}
            overflow="hidden"
            color="white"
            display="grid"
            css={{ placeItems: "center" }}
            // Polished-concrete grey gradient - lighter than the prior
            // slate and reads as an outdoor hard-court / indoor sport
            // tile. Brand green is reserved for accents (status pills,
            // CTAs); the placeholder itself stays neutral.
            bg="linear-gradient(135deg, #9aa3ad, #5d6671)"
        >
            <PitchBackdrop opacity={0.28} variant={seed ?? initials} tone="court" />
            <Box
                position="relative"
                textAlign="center"
                title={initials}
                // Drop shadow lifts the ball off the painted-line backdrop
                // so it remains the focal point at low backdrop opacity.
                filter="drop-shadow(0 6px 18px rgba(0,0,0,0.4))"
            >
                {/* Big centred futsal/soccer ball - using react-icons'
                     `FaFutbol` because it carries the universally-
                     recognised Telstar pattern (pentagon + hexagon
                     panels) at every size. The earlier custom outline
                     SVG read as line-art rather than a ball; this is a
                     filled icon that's immediately identifiable. */}
                <Box
                    as={FaFutbol}
                    boxSize={big ? "140px" : "92px"}
                    color="rgba(255,255,255,0.94)"
                    css={{ display: "block", margin: "0 auto" }}
                />
                {/* Tournament name instead of a "no poster" note - the
                    placeholder doubles as a text poster. Clamped to two
                    lines so a long name can't blow up the card height. */}
                <Text
                    color="rgba(255,255,255,0.92)"
                    fontFamily="heading"
                    fontSize={big ? "20px" : "15px"}
                    fontWeight={800}
                    letterSpacing="-0.01em"
                    lineHeight="1.25"
                    mt={big ? "3" : "2"}
                    px="4"
                    maxW={big ? "420px" : "260px"}
                    mx="auto"
                    css={{
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 2,
                        overflow: "hidden",
                    }}
                >
                    {name}
                </Text>
            </Box>
        </Box>
    )
}

/** Solid pitch-green CTA button styled to match the design's `PrimaryButton`. */
export function PrimaryButton({
    children,
    icon,
    onClick,
    full,
    type = "button",
    disabled,
    ...rest
}: {
    children: ReactNode
    icon?: ReactNode
    onClick?: () => void
    full?: boolean
    type?: "button" | "submit" | "reset"
    disabled?: boolean
} & Omit<BoxProps, "onClick" | "children">) {
    return (
        <chakra.button
            type={type}
            disabled={disabled}
            onClick={onClick}
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            gap="2"
            bg="pitch.500"
            color="white"
            border="none"
            px="6"
            py="3"
            rounded="lg"
            fontWeight={700}
            fontSize="14px"
            cursor={disabled ? "not-allowed" : "pointer"}
            opacity={disabled ? 0.5 : 1}
            width={full ? "100%" : "auto"}
            transition="background 150ms"
            _hover={{ bg: disabled ? "pitch.500" : "pitch.600" }}
            _active={{ bg: disabled ? "pitch.500" : "pitch.700" }}
            {...(rest as any)}
        >
            {icon}
            {children}
        </chakra.button>
    )
}

/** White / outline secondary button. `danger` flips text + border to red. */
export function GhostButton({
    children,
    icon,
    onClick,
    full,
    danger,
    type = "button",
    disabled,
    ...rest
}: {
    children: ReactNode
    icon?: ReactNode
    onClick?: () => void
    full?: boolean
    danger?: boolean
    type?: "button" | "submit" | "reset"
    disabled?: boolean
} & Omit<BoxProps, "onClick" | "children">) {
    return (
        <chakra.button
            type={type}
            disabled={disabled}
            onClick={onClick}
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            gap="2"
            bg="bg.panel"
            color={danger ? "accent.red" : "fg.ink"}
            borderWidth="1px"
            borderColor={danger ? "rgba(220,38,38,0.3)" : "border"}
            px="6"
            py="3"
            rounded="lg"
            fontWeight={600}
            fontSize="14px"
            cursor={disabled ? "not-allowed" : "pointer"}
            opacity={disabled ? 0.5 : 1}
            width={full ? "100%" : "auto"}
            transition="background 150ms"
            _hover={{ bg: disabled ? undefined : "bg.surfaceTint" }}
            {...(rest as any)}
        >
            {icon}
            {children}
        </chakra.button>
    )
}

/** Soft pitch-tinted "Detalji →" style pill button. */
export function TintButton({
    children,
    icon,
    onClick,
    ...rest
}: {
    children: ReactNode
    icon?: ReactNode
    onClick?: () => void
} & Omit<BoxProps, "onClick" | "children">) {
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            display="inline-flex"
            alignItems="center"
            gap="1"
            bg="bg.surfaceTint"
            color="pitch.500"
            border="none"
            px="3"
            py="1.5"
            rounded="full"
            fontWeight={700}
            fontSize="12px"
            cursor="pointer"
            _hover={{ bg: "pitch.100" }}
            {...(rest as any)}
        >
            {children}
            {icon}
        </chakra.button>
    )
}

/** Page heading row - title + optional status chip + right action slot. */
export function PageTitle({
    title,
    kicker,
    subtitle,
    status,
    statusLabel,
    action,
}: {
    title: ReactNode
    kicker?: ReactNode
    subtitle?: ReactNode
    status?: StatusKind
    statusLabel?: string
    action?: ReactNode
}) {
    return (
        <Flex
            justify="space-between"
            align={{ base: "flex-start", md: "flex-end" }}
            gap="4"
            mb="6"
            wrap="wrap"
        >
            <Box minW="0">
                {kicker ? (
                    <Box mb="1">
                        <MonoLabel color="pitch.500" letterSpacing="0.2em">
                            {kicker}
                        </MonoLabel>
                    </Box>
                ) : null}
                <Heading
                    as="h1"
                    fontFamily="heading"
                    fontSize={{ base: "28px", md: "34px" }}
                    fontWeight={800}
                    letterSpacing="-0.025em"
                    lineHeight={1.1}
                    color="fg.ink"
                >
                    {title}
                </Heading>
                {subtitle ? (
                    <Text fontSize="sm" color="fg.muted" mt="1">
                        {subtitle}
                    </Text>
                ) : null}
            </Box>
            <HStack gap="3" align="center">
                {status && statusLabel ? <StatusChip status={status} label={statusLabel} size="lg" /> : null}
                {action}
            </HStack>
        </Flex>
    )
}

/** Inline "← Natrag" back link. */
export function BackLink({
    to,
    onClick,
    label = "Natrag",
}: {
    to?: string
    onClick?: () => void
    label?: string
}) {
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            display="inline-flex"
            alignItems="center"
            gap="2"
            color="fg.soft"
            fontSize="14px"
            fontWeight={500}
            mb="4"
            bg="transparent"
            border="none"
            cursor="pointer"
            _hover={{ color: "fg.ink" }}
            data-href={to}
        >
            <Box
                as="svg"
                // @ts-expect-error - SVG attrs forwarded.
                viewBox="0 0 24 24"
                width="16px"
                height="16px"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M19 12H5M12 19l-7-7 7-7" />
            </Box>
            {label}
        </chakra.button>
    )
}
