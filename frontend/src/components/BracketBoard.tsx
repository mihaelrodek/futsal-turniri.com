import {
    forwardRef,
    useImperativeHandle,
    useLayoutEffect,
    useRef,
    useState,
    type PointerEvent as ReactPointerEvent,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
} from "react"
import { Box, Flex, HStack, IconButton } from "@chakra-ui/react"
import {
    TransformComponent,
    TransformWrapper,
    type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch"
import { FiMaximize, FiMinus, FiPlus } from "react-icons/fi"

import type { BracketMatch, BracketRound } from "../types/bracket"
import { MonoLabel } from "../ui/pitch"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   Single-elimination bracket layout.

   Replaces `@g-loot/react-tournament-brackets`, which only ever provided two
   things - the column layout and the SVG connectors - at the cost of a fixed
   match-box height, no third-place slot, and a peer dependency stuck on
   React 18.

   THE LAYOUT DOES NO MEASURING. Each round is a flex column; each match sits
   in a wrapper with `flex: 1`, and the card is centred inside its wrapper.
   A round with half as many matches therefore gets wrappers exactly twice as
   tall, so every card lands at the vertical midpoint of the two that feed it -
   automatically, at any card height. No getBoundingClientRect, no
   ResizeObserver, no reflow pass.

   CONNECTORS ARE TWO HALVES THAT MEET AT A SHARED EDGE. The upper match of a
   pair draws a vertical from its own centre DOWN to its wrapper's bottom edge;
   the lower one draws from its top edge UP to its own centre. Because each
   half is relative to its own wrapper, the two always meet exactly - even if
   one card grows (an open result editor) and its wrapper grows with it. That
   is the one property a percentage-of-the-pair approach would lose.

   Wrappers are contiguous: vertical spacing comes from padding INSIDE each
   wrapper, never from a column `gap`, or the halves would not touch.

   Sizing is configurable (cardWidth/colGap/…) so the SAME layout serves the
   full Eliminacija tab, the match-detail context tab, and the compact mini
   bracket in the home-page stream panel - one geometry, three scales.
   ────────────────────────────────────────────────────────────────────── */

/** Card width. Matches the old library's `options.style.width`. */
const DEFAULT_CARD_W = 236
/** Horizontal space between round columns. The vertical connector sits at its midpoint. */
const DEFAULT_COL_GAP = 56
/** Vertical breathing room around a card, applied as wrapper padding. */
const DEFAULT_ROW_GAP = 34
/** Floor for a wrapper so a sparse first round doesn't collapse. */
const DEFAULT_MIN_CARD_H = 132
/** Round-header pill height + its gap to the first card. */
const DEFAULT_HEADER_H = 32
const DEFAULT_HEADER_GAP = 16
/** Connector stroke. */
const LINE = 2

export type BracketBoardProps = {
    rounds: BracketRound[]
    /** Render one match card. `isFinal` is true for the last round's match. */
    renderMatch: (match: BracketMatch, ctx: { isFinal: boolean; roundIndex: number }) => ReactNode
    /** Third-place playoff, rendered in its own row under the Finale column.
     *  Deliberately outside the round chain so no connector is drawn to it. */
    thirdPlace?: BracketMatch | null
    renderThirdPlace?: (match: BracketMatch) => ReactNode
    /** Matches whose OUTGOING connector is drawn in the accent colour - the
     *  path teams actually took. Defaults to every finished match. */
    highlightIds?: ReadonlySet<number>
    /** Column width in px. Defaults to the full-size Eliminacija tab card. */
    cardWidth?: number
    colGap?: number
    rowGap?: number
    minCardHeight?: number
    headerHeight?: number
    headerGap?: number
    /** Round-header content. Defaults to `round.title` - override for a
     *  compact embed that wants short codes ("ČF", "PF") instead of the full
     *  backend title ("Četvrtfinale"). */
    roundLabel?: (round: BracketRound, index: number) => ReactNode
}

/** True when this match's outgoing connector should be accented. */
function defaultHighlight(m: BracketMatch): boolean {
    return m.status === "FINISHED" && m.winnerTeamId != null
}

export function BracketBoard({
    rounds,
    renderMatch,
    thirdPlace,
    renderThirdPlace,
    highlightIds,
    cardWidth = DEFAULT_CARD_W,
    colGap = DEFAULT_COL_GAP,
    rowGap = DEFAULT_ROW_GAP,
    minCardHeight = DEFAULT_MIN_CARD_H,
    headerHeight = DEFAULT_HEADER_H,
    headerGap = DEFAULT_HEADER_GAP,
    roundLabel,
}: BracketBoardProps) {
    const lastRound = rounds.length - 1

    // Third place sits directly under the Finale card, not under the whole
    // rounds row. The Finale COLUMN is stretched to the tallest column's
    // height (mandatory - the connector math needs every column to share one
    // total height, see the file header), so the Finale card itself renders
    // vertically CENTRED in that tall column, not at its top. A plain
    // in-flow row after the rounds Flex would then land far below it on any
    // bracket taller than one round.
    //
    // Fixed with a measured negative margin-top pulling the (still in-flow -
    // not position:absolute, so panning/scroll regions keep including it)
    // third-place row up to the Finale card's actual rendered bottom edge.
    // Uses offsetTop/offsetHeight, NOT getBoundingClientRect: the board sits
    // inside the zoom/pan wrapper's `transform: scale(...)`, which changes
    // what getBoundingClientRect reports but leaves layout-space offsets
    // untouched - so this stays correct at any zoom level with no extra math.
    const roundsRowRef = useRef<HTMLDivElement>(null)
    const finalCardRef = useRef<HTMLDivElement>(null)
    const [thirdPlaceMarginTop, setThirdPlaceMarginTop] = useState<number | null>(null)

    useLayoutEffect(() => {
        if (!thirdPlace) {
            setThirdPlaceMarginTop(null)
            return
        }
        const compute = () => {
            const row = roundsRowRef.current
            const card = finalCardRef.current
            if (!row || !card) return
            let top = 0
            let node: HTMLElement | null = card
            while (node && node !== row) {
                top += node.offsetTop
                node = node.offsetParent as HTMLElement | null
            }
            if (node !== row) return // row wasn't in the offsetParent chain - leave natural flow
            const desiredTop = top + card.offsetHeight + rowGap / 2
            const naturalTop = row.offsetHeight + rowGap
            setThirdPlaceMarginTop(desiredTop - naturalTop)
        }
        // Measure now (pre-paint) so it lands in place without a visible
        // jump, then again once layout has fully settled, and keep tracking
        // the Finale card's own height (an open result editor grows it).
        compute()
        const t = setTimeout(compute, 90)
        const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(compute) : null
        if (ro) {
            if (roundsRowRef.current) ro.observe(roundsRowRef.current)
            if (finalCardRef.current) ro.observe(finalCardRef.current)
        }
        window.addEventListener("resize", compute)
        return () => {
            clearTimeout(t)
            ro?.disconnect()
            window.removeEventListener("resize", compute)
        }
    }, [rounds, thirdPlace, rowGap])

    return (
        <Flex direction="column" gap={`${rowGap}px`} w="fit-content">
            <Flex ref={roundsRowRef} position="relative" align="stretch" gap={`${colGap}px`}>
                {rounds.map((round, roundIdx) => {
                    const isLastRound = roundIdx === lastRound
                    return (
                        <Flex
                            key={round.stage ?? roundIdx}
                            direction="column"
                            w={`${cardWidth}px`}
                            flexShrink="0"
                        >
                            {/* Round title - our backend's own ("Četvrtfinale",
                                "Polufinale", "Finale"), no generator hook needed. */}
                            <Flex
                                h={`${headerHeight}px`}
                                mb={`${headerGap}px`}
                                align="center"
                                justify="center"
                                rounded="full"
                                bg="bg.surfaceTint"
                                borderWidth="1px"
                                borderColor="border.subtle"
                                flexShrink="0"
                            >
                                <MonoLabel color="fg.soft">
                                    {roundLabel ? roundLabel(round, roundIdx) : (round.title ?? "")}
                                </MonoLabel>
                            </Flex>

                            {/* Match column. No gap - spacing lives in the
                                wrappers so connector halves stay flush. */}
                            <Flex direction="column" flex="1">
                                {round.matches.map((m, i) => {
                                    // Pairing: (0,1) → 0, (2,3) → 1, … A trailing
                                    // odd match (bye) has no sibling, so it gets a
                                    // straight run across instead of a vertical.
                                    const isUpper = i % 2 === 0
                                    const hasSibling = isUpper
                                        ? i + 1 < round.matches.length
                                        : true
                                    const accent = highlightIds
                                        ? highlightIds.has(m.matchId)
                                        : defaultHighlight(m)
                                    const stroke = accent ? "pitch.500" : "border.emphasized"

                                    return (
                                        <Flex
                                            key={m.matchId}
                                            flex="1"
                                            minH={`${minCardHeight + rowGap}px`}
                                            align="center"
                                            position="relative"
                                            py={`${rowGap / 2}px`}
                                        >
                                            {/* Incoming stub: gap midpoint → card. */}
                                            {roundIdx > 0 && (
                                                <Box
                                                    position="absolute"
                                                    left={`-${colGap / 2}px`}
                                                    top="50%"
                                                    w={`${colGap / 2}px`}
                                                    h={`${LINE}px`}
                                                    bg="border.emphasized"
                                                    aria-hidden
                                                />
                                            )}

                                            {!isLastRound && (
                                                <>
                                                    {/* Outgoing stub: card → gap
                                                        midpoint. Without a sibling
                                                        it runs the whole gap. */}
                                                    <Box
                                                        position="absolute"
                                                        right={
                                                            hasSibling
                                                                ? `-${colGap / 2}px`
                                                                : `-${colGap}px`
                                                        }
                                                        top="50%"
                                                        w={
                                                            hasSibling
                                                                ? `${colGap / 2}px`
                                                                : `${colGap}px`
                                                        }
                                                        h={`${LINE}px`}
                                                        bg={stroke}
                                                        aria-hidden
                                                    />
                                                    {/* Half-vertical. Upper match
                                                        runs centre → bottom edge,
                                                        lower runs top edge → centre;
                                                        they meet on the shared edge
                                                        whatever the card heights. */}
                                                    {hasSibling && (
                                                        <Box
                                                            position="absolute"
                                                            right={`-${colGap / 2}px`}
                                                            w={`${LINE}px`}
                                                            bg={stroke}
                                                            {...(isUpper
                                                                ? { top: "50%", bottom: "0" }
                                                                : { top: "0", bottom: "50%" })}
                                                            aria-hidden
                                                        />
                                                    )}
                                                </>
                                            )}

                                            <Box
                                                flex="1"
                                                minW="0"
                                                // Only the Finale's single match needs
                                                // tracking - it's what the third-place
                                                // margin above measures against.
                                                ref={isLastRound && i === 0 ? finalCardRef : undefined}
                                            >
                                                {renderMatch(m, {
                                                    isFinal: isLastRound,
                                                    roundIndex: roundIdx,
                                                })}
                                            </Box>
                                        </Flex>
                                    )
                                })}
                            </Flex>
                        </Flex>
                    )
                })}
            </Flex>

            {/* Third place, aligned under the Finale column horizontally by
                flex, and vertically pulled up to sit right under the Finale
                card itself via the measured margin above. */}
            {thirdPlace && renderThirdPlace && (
                <Flex
                    justify="flex-end"
                    mt={thirdPlaceMarginTop != null ? `${thirdPlaceMarginTop}px` : undefined}
                >
                    <Box w={`${cardWidth}px`}>{renderThirdPlace(thirdPlace)}</Box>
                </Flex>
            )}
        </Flex>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   Zoom/pan wrapper - shared by every BracketBoard embed (full Eliminacija
   tab, match-detail context tab, home-page mini bracket). One
   react-zoom-pan-pinch instance + one imperative handle (centre-on-element,
   zoom in/out/reset) so callers don't each reinvent the ref plumbing.
   ────────────────────────────────────────────────────────────────────── */

export type ZoomableBracketHandle = {
    /** Centre the viewport on an element (e.g. the LIVE match's card ref),
     *  keeping the current zoom level - a focus jump must not also zoom. */
    centerOn: (el: HTMLElement | null | undefined) => void
    zoomIn: () => void
    zoomOut: () => void
    /** Back to the initial scale/position. */
    reset: () => void
}

export type ZoomableBracketProps = {
    children: ReactNode
    minScale?: number
    maxScale?: number
    initialScale?: number
    /** Merged over the default `{ width: "100%", cursor: "grab" }` - pass
     *  `height`/`maxHeight` to bound the viewport (a vh value for a
     *  near-fullscreen board, `"100%"` inside an already-clipped flex panel). */
    wrapperStyle?: React.CSSProperties
    contentPadding?: string
}

export const ZoomableBracket = forwardRef<ZoomableBracketHandle, ZoomableBracketProps>(
    function ZoomableBracket(
        { children, minScale = 0.35, maxScale = 1.6, initialScale = 1, wrapperStyle, contentPadding = "20px" },
        ref,
    ) {
        const zoomRef = useRef<ReactZoomPanPinchRef>(null)

        // Swallow the click that ENDS a real drag, so panning across a match
        // card never opens it. react-zoom-pan-pinch moves the content itself
        // but has no notion of "was this a click or a drag" - it fires
        // onPanningStart on every pointerdown, drag or not. So this tracks
        // movement distance independently (same technique the bracket's old
        // hand-rolled pan hook used) purely to decide whether to eat the
        // click; the library still owns all the actual panning.
        const drag = useRef({ down: false, x: 0, y: 0, moved: false })
        const onPointerDownCapture = (e: ReactPointerEvent) => {
            drag.current = { down: true, x: e.clientX, y: e.clientY, moved: false }
        }
        const onPointerMoveCapture = (e: ReactPointerEvent) => {
            const d = drag.current
            // Ignore hover movement between clicks - only a drag that started
            // with a real pointerdown counts, or ordinary mouse wandering
            // would wrongly arm the swallow for the NEXT click.
            if (!d.down || d.moved) return
            if (Math.abs(e.clientX - d.x) > 4 || Math.abs(e.clientY - d.y) > 4) {
                d.moved = true
            }
        }
        const onPointerUpCapture = () => {
            drag.current.down = false
        }
        const onClickCapture = (e: ReactMouseEvent) => {
            if (drag.current.moved) {
                e.preventDefault()
                e.stopPropagation()
                drag.current.moved = false
            }
        }

        useImperativeHandle(ref, () => ({
            centerOn: (el) => {
                const api = zoomRef.current
                if (!el || !api) return
                api.zoomToElement(el, api.instance.state.scale, 400)
            },
            zoomIn: () => zoomRef.current?.zoomIn(),
            zoomOut: () => zoomRef.current?.zoomOut(),
            reset: () => zoomRef.current?.resetTransform(),
        }), [])

        return (
            <Box
                onPointerDownCapture={onPointerDownCapture}
                onPointerMoveCapture={onPointerMoveCapture}
                onPointerUpCapture={onPointerUpCapture}
                onPointerLeave={onPointerUpCapture}
                onClickCapture={onClickCapture}
            >
                <TransformWrapper
                    ref={zoomRef}
                    minScale={minScale}
                    maxScale={maxScale}
                    initialScale={initialScale}
                    centerOnInit={false}
                    limitToBounds={false}
                    // wheelDisabled blocks a PLAIN wheel event from zooming - which
                    // is also what a trackpad's two-finger scroll sends, so without
                    // this a page-scroll gesture over the bracket zoomed it instead
                    // of scrolling the page. A real pinch gesture is a wheel event
                    // with `ctrlKey: true` (the browser sets it, not the OS) and
                    // still gets through - see isWheelAllowed in the library. Mouse
                    // users lose wheel-to-zoom entirely; they still have the +/-
                    // buttons, drag-to-pan and touch pinch.
                    wheel={{ step: 0.08, wheelDisabled: true }}
                    // Double-click zoom would fight the cards (a mis-timed double
                    // tap on a match would zoom instead of opening it).
                    doubleClick={{ disabled: true }}
                    panning={{
                        velocityDisabled: true,
                        // Drag anywhere to pan EXCEPT over a control - otherwise the
                        // pan swallows the click and buttons/links/inputs never
                        // fire. Entries match as CSS selectors (tag OR class),
                        // descendants included.
                        excluded: ["button", "input", "select", "textarea", "a", "label", "no-pan"],
                    }}
                >
                    <TransformComponent
                        wrapperStyle={{ width: "100%", cursor: "grab", ...wrapperStyle }}
                        contentStyle={{ padding: contentPadding }}
                    >
                        {children}
                    </TransformComponent>
                </TransformWrapper>
            </Box>
        )
    },
)

/** Small +/-/reset pill for a ZoomableBracket. Caller positions it (usually
 *  `position="absolute"` in a corner of the bracket panel). */
export function ZoomControls({
    onZoomIn,
    onZoomOut,
    onReset,
    size = "sm",
}: {
    onZoomIn: () => void
    onZoomOut: () => void
    onReset: () => void
    size?: "xs" | "sm"
}) {
    const t = useTranslation()
    return (
        <HStack
            gap="0.5"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border.emphasized"
            rounded="full"
            shadow="md"
            p="1"
            className="no-pan"
        >
            <IconButton aria-label={t.components.bracketBoard.zoomOutAria} title={t.components.bracketBoard.zoomOutAria} size={size} variant="ghost" rounded="full" onClick={onZoomOut}>
                <FiMinus />
            </IconButton>
            <IconButton aria-label={t.components.bracketBoard.zoomInAria} title={t.components.bracketBoard.zoomInAria} size={size} variant="ghost" rounded="full" onClick={onZoomIn}>
                <FiPlus />
            </IconButton>
            <IconButton aria-label={t.components.bracketBoard.resetViewAria} title={t.components.bracketBoard.resetViewAria} size={size} variant="ghost" rounded="full" onClick={onReset}>
                <FiMaximize />
            </IconButton>
        </HStack>
    )
}
