import {
    Box,
    Button,
    Card,
    Dialog,
    Flex,
    Heading,
    HStack,
    Icon,
    Portal,
    Spinner,
    Text,
    type BoxProps,
    type FlexProps,
} from "@chakra-ui/react"
import type { ElementType, ReactNode } from "react"

/* -- Confirm dialog (popup modal) ---------------------------------------- */
/** A small yes/no confirmation modal - more visible than a toast for
 *  destructive actions (reset / regenerate / clear). */
export function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    danger = false,
    busy = false,
    onClose,
    onConfirm,
}: {
    open: boolean
    title: string
    description: ReactNode
    confirmLabel: string
    danger?: boolean
    busy?: boolean
    onClose: () => void
    onConfirm: () => void
}) {
    return (
        <Dialog.Root open={open} onOpenChange={(e) => { if (!e.open && !busy) onClose() }} placement="center">
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="sm">
                        <Dialog.Header>{title}</Dialog.Header>
                        <Dialog.Body>
                            <Text>{description}</Text>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" onClick={onClose} disabled={busy}>
                                Odustani
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette={danger ? "red" : "brand"}
                                loading={busy}
                                onClick={onConfirm}
                            >
                                {confirmLabel}
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   Shared UI primitives - Nogometni-turniri.com redesign.

   Small, composable building blocks that give every redesigned section the
   same visual language: soft white panels on the canvas, a consistent
   section header, stat tiles, empty states and loaders. Built on Chakra
   UI v3 and the `brand` palette defined in `system.ts`.
   ────────────────────────────────────────────────────────────────────── */

/**
 * FormSectionCard - a bordered, titled section card used by the tournament
 * create AND edit forms so both look 1:1. Blue inline icon + title in the
 * header, tight body padding for dense forms. `icon` is a rendered node
 * (e.g. {@code <FiInfo />}).
 */
export function FormSectionCard({
    icon,
    title,
    description,
    children,
}: {
    icon?: ReactNode
    title: string
    description?: string
    children: ReactNode
}) {
    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Header pb="2" pt="4" px={{ base: "4", md: "5" }}>
                <HStack gap="2.5" align="center">
                    {icon && (
                        <Box color="blue.500" display="flex" alignItems="center">
                            {icon}
                        </Box>
                    )}
                    <Card.Title fontSize="md">{title}</Card.Title>
                </HStack>
                {description && (
                    <Card.Description fontSize="sm" color="fg.muted" mt="1">
                        {description}
                    </Card.Description>
                )}
            </Card.Header>
            <Card.Body pt="3" pb="4" px={{ base: "4", md: "5" }}>
                {children}
            </Card.Body>
        </Card.Root>
    )
}

/** Panel - the standard content surface: a white card on the soft canvas. */
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

/** A rounded icon chip - badges section headers and empty states. */
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

/** SectionHeader - a title row with optional icon, subtitle and right actions. */
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

/** StatTile - one labelled metric in a compact bordered tile. */
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

/** EmptyState - a centered placeholder with optional call to action. */
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

/** Meta - a small inline icon + text pair for metadata rows. */
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

/** Loader - a centered spinner with a label, for section loading states. */
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
