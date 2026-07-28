import { Box, Button, HStack } from "@chakra-ui/react"

import type { Surface } from "../types/tournaments"
import { SURFACE_OPTIONS } from "../utils/surface"

/** Small filled square in the surface's own colour - shared by the picker
 *  below and the detail-page stat tile, so "trava" always renders the exact
 *  same green everywhere. */
export function SurfaceSwatch({ color, size = "12px" }: { color: string; size?: string }) {
    return (
        <Box
            w={size}
            h={size}
            rounded="sm"
            bg={color}
            borderWidth="1px"
            borderColor="blackAlpha.300"
            flexShrink={0}
            aria-hidden
        />
    )
}

/**
 * Surface (playing ground) picker - a row of chips, each showing a coloured
 * swatch + label, so every option's real colour is visible AT SELECTION time
 * rather than hidden inside a native <select> (which can't render coloured
 * options across browsers). The selected chip's border picks up that same
 * colour instead of the app's brand colour, so the swatch stays the source
 * of truth for "which colour this surface is" everywhere it appears.
 */
export function SurfacePicker({
    value,
    onChange,
}: {
    value: Surface
    onChange: (surface: Surface) => void
}) {
    return (
        <HStack gap="1.5" wrap="wrap">
            {SURFACE_OPTIONS.map((opt) => {
                const selected = opt.value === value
                return (
                    <Button
                        key={opt.value}
                        type="button"
                        size="sm"
                        variant="outline"
                        bg={selected ? "bg.surfaceTint" : undefined}
                        borderWidth={selected ? "2px" : "1px"}
                        borderColor={selected ? opt.color : "border"}
                        fontWeight={selected ? 700 : 500}
                        onClick={() => onChange(opt.value)}
                    >
                        <SurfaceSwatch color={opt.color} />
                        {opt.label}
                    </Button>
                )
            })}
        </HStack>
    )
}
