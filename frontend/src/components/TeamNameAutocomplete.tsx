import { useEffect, useRef, useState } from "react"
import { Box, Input, VStack } from "@chakra-ui/react"
import { searchTeams } from "../api/tournaments"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   TeamNameAutocomplete - name input that suggests existing teams.

   As the organiser types, we query /teams/search for distinct existing team
   names across ALL tournaments and show them in a dropdown. Picking one
   reuses that exact name (teams are identified by name across tournaments,
   there's no shared id) so the same club shows up consistently everywhere.
   Typing a brand-new name and submitting just names a new team.

   Unlike player names, team names are NOT force-uppercased - they're kept
   exactly as the organiser types them.
   ────────────────────────────────────────────────────────────────────── */

export default function TeamNameAutocomplete({
    value,
    onChange,
    onCommit,
    onPick,
    onBlur,
    onEnter,
    placeholder,
    size = "sm",
    variant,
    fontWeight,
    autoFocus,
}: {
    value: string
    onChange: (next: string) => void
    /** Fired right after a suggestion is picked (the new value has already
     *  been applied via `onChange`) - the same "commit" handler as `onBlur`,
     *  so picking a suggestion persists it exactly like tabbing away does.
     *  Deferred to the next tick so the parent has re-rendered with the
     *  fresh value before it reads its own state. */
    onCommit?: () => void
    /** Fired synchronously with the picked name whenever a suggestion from
     *  the DATABASE is chosen (not on plain typing/blur/Enter) - lets the
     *  caller reuse more than just the name, e.g. pre-filling that team's
     *  saved default kit colours. */
    onPick?: (name: string) => void
    /** Native blur - e.g. to flush a rename when the organiser tabs away
     *  without picking a suggestion. */
    onBlur?: () => void
    /** Fired on Enter when the dropdown isn't capturing the keystroke. */
    onEnter?: () => void
    placeholder?: string
    size?: "sm" | "md"
    variant?: "outline" | "subtle" | "flushed"
    fontWeight?: string | number
    autoFocus?: boolean
}) {
    const t = useTranslation()
    const effectivePlaceholder = placeholder ?? t.autocomplete.teamNamePlaceholder
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
            searchTeams(q)
                .then((names) => {
                    if (cancelled) return
                    // Hide a suggestion that exactly equals the current input
                    // (nothing to pick - they've already typed it). Team
                    // names aren't case-normalised, so compare case-insensitively.
                    const filtered = names.filter(
                        (n) => n.toLowerCase() !== q.toLowerCase(),
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
        onPick?.(name)
        if (onCommit) {
            // Defer to the next tick: `onChange` just scheduled a state
            // update in the parent, and `onCommit` (the parent's blur/commit
            // handler) closes over that parent's state as of *this* render -
            // calling it synchronously would persist the value the input had
            // before the pick. By the time this macrotask runs, React has
            // re-rendered and the parent passed a fresh `onCommit` closure.
            setTimeout(() => onCommit(), 0)
        }
    }

    return (
        <Box position="relative" ref={boxRef} flex="1" minW="160px">
            <Input
                size={size}
                variant={variant}
                fontWeight={fontWeight}
                autoFocus={autoFocus}
                placeholder={effectivePlaceholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onBlur}
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
