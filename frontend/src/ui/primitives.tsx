import {
    Box,
    Flex,
    Heading,
    Icon,
    Spinner,
    Text,
    type BoxProps,
    type FlexProps,
} from "@chakra-ui/react"
import type { ElementType, ReactNode } from "react"

/* ──────────────────────────────────────────────────────────────────────────
   Shared UI primitives — Nogometni-turniri.com redesign.

   Small, composable building blocks that give every redesigned section the
   same visual language: soft white panels on the canvas, a consistent
   section header, stat tiles, empty states and loaders. Built on Chakra
   UI v3 and the `brand` palette defined in `system.ts`.
   ────────────────────────────────────────────────────────────────────── */

/** Panel — the standard content surface: a white card on the soft canvas. */
export function Panel({ children, ...rest }: BoxProps) {
    return (
        <Box
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="2xl"
            shadow="sm"
            {...rest}
        >
            {children}
        </Box>
    )
}

/** A rounded icon chip — badges section headers and empty states. */
export function IconChip({
    icon,
    tone = "brand",
    size = "10",
    iconSize = "5",
}: {
    icon: ElementType
    tone?: string
    size?: string
    iconSize?: string
}) {
    return (
        <Flex
            align="center"
            justify="center"
            boxSize={size}
            flexShrink={0}
            rounded="xl"
            bg={`${tone}.subtle`}
            color={`${tone}.fg`}
        >
            <Icon as={icon} boxSize={iconSize} />
        </Flex>
    )
}

/** SectionHeader — a title row with optional icon, subtitle and right actions. */
export function SectionHeader({
    title,
    subtitle,
    icon,
    actions,
    ...rest
}: {
    title: ReactNode
    subtitle?: ReactNode
    icon?: ElementType
    actions?: ReactNode
} & Omit<FlexProps, "title">) {
    return (
        <Flex
            align={{ base: "flex-start", sm: "center" }}
            justify="space-between"
            gap="3"
            wrap="wrap"
            {...rest}
        >
            <Flex gap="3" align="center" minW="0">
                {icon ? <IconChip icon={icon} /> : null}
                <Box minW="0">
                    <Heading size="md" lineHeight="1.25" letterSpacing="-0.01em">
                        {title}
                    </Heading>
                    {subtitle ? (
                        <Text fontSize="sm" color="fg.muted" mt="0.5">
                            {subtitle}
                        </Text>
                    ) : null}
                </Box>
            </Flex>
            {actions ? (
                <Flex gap="2" wrap="wrap" align="center">
                    {actions}
                </Flex>
            ) : null}
        </Flex>
    )
}

/** StatTile — one labelled metric in a compact bordered tile. */
export function StatTile({
    label,
    value,
    hint,
    tone = "gray",
}: {
    label: ReactNode
    value: ReactNode
    hint?: ReactNode
    tone?: string
}) {
    const valueColor = tone && tone !== "gray" ? `${tone}.fg` : "fg"
    return (
        <Box borderWidth="1px" borderColor="border" rounded="xl" px="4" py="3" bg="bg.panel">
            <Text
                fontSize="2xs"
                fontWeight="semibold"
                letterSpacing="wider"
                textTransform="uppercase"
                color="fg.muted"
            >
                {label}
            </Text>
            <Text fontSize="2xl" fontWeight="bold" lineHeight="1.2" color={valueColor}>
                {value}
            </Text>
            {hint ? (
                <Text fontSize="xs" color="fg.muted">
                    {hint}
                </Text>
            ) : null}
        </Box>
    )
}

/** EmptyState — a centered placeholder with optional call to action. */
export function EmptyState({
    icon,
    title,
    description,
    action,
}: {
    icon?: ElementType
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
}) {
    return (
        <Flex direction="column" align="center" textAlign="center" py="12" px="6" gap="3">
            {icon ? (
                <Flex
                    align="center"
                    justify="center"
                    boxSize="14"
                    rounded="2xl"
                    bg="brand.subtle"
                    color="brand.fg"
                >
                    <Icon as={icon} boxSize="7" />
                </Flex>
            ) : null}
            <Box>
                <Heading size="sm">{title}</Heading>
                {description ? (
                    <Text fontSize="sm" color="fg.muted" mt="1" maxW="sm" mx="auto">
                        {description}
                    </Text>
                ) : null}
            </Box>
            {action ? <Box pt="1">{action}</Box> : null}
        </Flex>
    )
}

/** Meta — a small inline icon + text pair for metadata rows. */
export function Meta({
    icon,
    children,
    ...rest
}: { icon?: ElementType; children: ReactNode } & FlexProps) {
    return (
        <Flex align="center" gap="1.5" fontSize="sm" color="fg.muted" minW="0" {...rest}>
            {icon ? <Icon as={icon} boxSize="4" flexShrink={0} /> : null}
            <Box as="span" truncate>
                {children}
            </Box>
        </Flex>
    )
}

/** Loader — a centered spinner with a label, for section loading states. */
export function Loader({ label = "Učitavanje…" }: { label?: string }) {
    return (
        <Flex direction="column" align="center" justify="center" gap="3" py="16">
            <Spinner size="lg" color="brand.solid" />
            <Text fontSize="sm" color="fg.muted">
                {label}
            </Text>
        </Flex>
    )
}
