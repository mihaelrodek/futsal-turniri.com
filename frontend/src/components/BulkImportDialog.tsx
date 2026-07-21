import { useState, type ReactNode } from "react"
import { Button, Dialog, Portal, Text, Textarea, VStack } from "@chakra-ui/react"

/**
 * Generic "paste a list, one per line" import modal. The caller gets the
 * trimmed non-empty lines and does the actual parsing/creating - so the same
 * dialog serves teams (one name per line) and players (name + optional ",broj").
 */
export function BulkImportDialog({
    open,
    onClose,
    title,
    description,
    placeholder,
    submitLabel = "Uvezi",
    onSubmit,
}: {
    open: boolean
    onClose: () => void
    title: string
    description: ReactNode
    placeholder?: string
    submitLabel?: string
    /** Receives the trimmed, non-empty lines. Throwing keeps the modal open. */
    onSubmit: (lines: string[]) => Promise<void>
}) {
    const [text, setText] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)

    function close() {
        if (submitting) return
        setText("")
        onClose()
    }

    async function submit() {
        if (lines.length === 0 || submitting) return
        try {
            setSubmitting(true)
            await onSubmit(lines)
            setText("")
            onClose()
        } catch {
            /* the caller surfaces errors; keep the modal open so nothing is lost */
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(e) => { if (!e.open) close() }}
            placement="center"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="lg">
                        <Dialog.Header>{title}</Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="3">
                                <Text fontSize="sm" color="fg.muted">
                                    {description}
                                </Text>
                                <Textarea
                                    value={text}
                                    onChange={(e) => setText(e.target.value)}
                                    placeholder={placeholder}
                                    rows={10}
                                    fontFamily="mono"
                                    /* base must stay 16px: iOS Safari auto-zooms the page on
                                       focus for any input/textarea with font-size < 16px. */
                                    fontSize={{ base: "16px", md: "sm" }}
                                    resize="vertical"
                                    autoFocus
                                />
                                <Text fontSize="xs" color="fg.muted">
                                    Broj redova: {lines.length}
                                </Text>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" onClick={close} disabled={submitting}>
                                Odustani
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette="brand"
                                loading={submitting}
                                disabled={lines.length === 0}
                                onClick={submit}
                            >
                                {submitLabel}
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
