import { useEffect, useRef, useState } from "react"
import { Box, Input, VStack } from "@chakra-ui/react"
import { searchPlayers } from "../api/players"

/* ──────────────────────────────────────────────────────────────────────────
   PlayerNameAutocomplete - name input that suggests existing players.

   As the organiser types, we query /players/search for distinct existing
   (uppercase) player names and show them in a dropdown. Picking one reuses
   that exact name so the same person's goals aggregate on the all-time
   scorer list. Typing a brand-new full name and submitting just adds a new
   player.

   Input is force-uppercased so every player is stored consistently (the
   backend uppercases too, but doing it here gives immediate visual feedback
   and makes the suggestion match what the user sees).
   ────────────────────────────────────────────────────────────────────── */

export default function PlayerNameAutocomplete({
    value,
    onChange,
    onEnter,
    placeholder = "Ime i prezime igrača",
    size = "sm",
    autoFocus,
}: {
    value: string
    onChange: (next: string) => void
    /** Fired on Enter when the dropdown isn't capturing the keystroke. */
    onEnter?: () => void
    placeholder?: string
    size?: "sm" | "md"
    autoFocus?: boolean
}) {
    const [suggestions, setSuggestions] = useState<string[]>([])
    const [open, setOpen] = useState(false)
    const [highlight, setHighlight] = useState(-1)
    const boxRef = useRef<HTMLDivElement>(null)
    const justPickedRef = useRef(false)

    // Debounced search whenever the value changes (unless the change came
    // from picking a suggestion).
    useEffect(() => {
        if (justPickedRef.current) {
            justPickedRef.current = false
            return
        }
        const q = value.trim()
        if (q.length < 2) {
            setSuggestions([])
            setOpen(false)
            return
        }
        let cancelled = false
        const id = setTimeout(() => {
            searchPlayers(q)
                .then((names) => {
                    if (cancelled) return
                    // Hide a suggestion that exactly equals the current input
                    // (nothing to pick - they've already typed it).
                    const filtered = names.filter(
                        (n) => n.toUpperCase() !== q.toUpperCase(),
                    )
                    setSuggestions(filtered)
                    setOpen(filtered.length > 0)
                    setHighlight(-1)
                })
                .catch(() => {
                    if (!cancelled) {
                        setSuggestions([])
                        setOpen(false)
                    }
                })
        }, 180)
        return () => {
            cancelled = true
            clearTimeout(id)
        }
    }, [value])

    // Close on outside click.
    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", onDocClick)
        return () => document.removeEventListener("mousedown", onDocClick)
    }, [])

    function pick(name: string) {
        justPickedRef.current = true
        onChange(name)
        setSuggestions([])
        setOpen(false)
        setHighlight(-1)
    }

    return (
        <Box position="relative" ref={boxRef} flex="1" minW="160px">
            <Input
                size={size}
                autoFocus={autoFocus}
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value.toUpperCase())}
                onFocus={() => {
                    if (suggestions.length > 0) setOpen(true)
                }}
                onKeyDown={(e) => {
                    if (open && suggestions.length > 0) {
                        if (e.key === "ArrowDown") {
                            e.preventDefault()
                            setHighlight((h) => Math.min(h + 1, suggestions.length - 1))
                            return
                        }
                        if (e.key === "ArrowUp") {
                            e.preventDefault()
                            setHighlight((h) => Math.max(h - 1, 0))
                            return
                        }
                        if (e.key === "Enter" && highlight >= 0) {
                            e.preventDefault()
                            pick(suggestions[highlight])
                            return
                        }
                        if (e.key === "Escape") {
                            setOpen(false)
                            return
                        }
                    }
                    if (e.key === "Enter") {
                        e.preventDefault()
                        onEnter?.()
                    }
                }}
            />
            {open && suggestions.length > 0 && (
                <VStack
                    align="stretch"
                    gap="0"
                    position="absolute"
                    top="calc(100% + 4px)"
                    left="0"
                    right="0"
                    zIndex={20}
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border.emphasized"
                    rounded="md"
                    shadow="lg"
                    overflow="hidden"
                    maxH="220px"
                    overflowY="auto"
                >
                    {suggestions.map((name, i) => (
                        <Box
                            key={name}
                            px="3"
                            py="2"
                            fontSize="sm"
                            fontWeight={600}
                            color="fg.ink"
                            cursor="pointer"
                            bg={i === highlight ? "bg.surfaceTint" : "transparent"}
                            _hover={{ bg: "bg.surfaceTint" }}
                            // onMouseDown (not onClick) so it fires before the
                            // input's blur/outside-click closes the dropdown.
                            onMouseDown={(e) => {
                                e.preventDefault()
                                pick(name)
                            }}
                        >
                            {name}
                        </Box>
                    ))}
                </VStack>
            )}
        </Box>
    )
}
