import { useCallback, useEffect, useMemo, useState } from "react"
import { Box, Button, Dialog, Portal, Slider, Text, VStack } from "@chakra-ui/react"
import Cropper, { type Area } from "react-easy-crop"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   Lets the user reposition/zoom a just-picked photo before it becomes their
   avatar - rectangular photos with an off-center face are common, and the
   avatar is always rendered in a circle, so this is where that mismatch
   gets resolved instead of silently cropping around whatever the browser
   picks. Built on react-easy-crop; the actual pixel crop happens on a
   <canvas> in cropToFile() below, output as a fixed 512x512 square so every
   avatar is the same size regardless of the source photo.
   ────────────────────────────────────────────────────────────────────── */

const OUTPUT_SIZE = 512

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.addEventListener("load", () => resolve(img))
        img.addEventListener("error", () => reject(new Error("image load failed")))
        img.src = src
    })
}

async function cropToFile(imageSrc: string, area: Area, fileName: string, mimeType: string): Promise<File> {
    const image = await loadImage(imageSrc)
    const canvas = document.createElement("canvas")
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("canvas 2d context unavailable")
    ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, 0.92))
    if (!blob) throw new Error("canvas toBlob failed")
    return new File([blob], fileName, { type: mimeType })
}

export default function AvatarCropDialog({
    file,
    busy = false,
    onCancel,
    onConfirm,
}: {
    /** The just-picked file, or null when the dialog should be closed. */
    file: File | null
    /** True while the parent is uploading the cropped result. */
    busy?: boolean
    onCancel: () => void
    onConfirm: (croppedFile: File) => void | Promise<void>
}) {
    const t = useTranslation()
    const [crop, setCrop] = useState({ x: 0, y: 0 })
    const [zoom, setZoom] = useState(1)
    const [croppedArea, setCroppedArea] = useState<Area | null>(null)
    const [processing, setProcessing] = useState(false)

    const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
    useEffect(() => {
        if (!objectUrl) return
        return () => URL.revokeObjectURL(objectUrl)
    }, [objectUrl])

    // Reset pan/zoom for every newly picked file, not just the first open.
    useEffect(() => {
        setCrop({ x: 0, y: 0 })
        setZoom(1)
        setCroppedArea(null)
    }, [file])

    const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
        setCroppedArea(areaPixels)
    }, [])

    async function handleConfirm() {
        if (!file || !objectUrl || !croppedArea) return
        try {
            setProcessing(true)
            const cropped = await cropToFile(objectUrl, croppedArea, file.name, file.type || "image/jpeg")
            await onConfirm(cropped)
        } finally {
            setProcessing(false)
        }
    }

    const busyNow = busy || processing

    return (
        <Dialog.Root open={file != null} onOpenChange={(e) => { if (!e.open && !busyNow) onCancel() }} placement="center">
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="sm">
                        <Dialog.Header>{t.components.avatarCropDialog.title}</Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="3">
                                <Text fontSize="sm" color="fg.muted">
                                    {t.components.avatarCropDialog.hint}
                                </Text>
                                <Box position="relative" w="full" h="280px" bg="black" rounded="md" overflow="hidden">
                                    {objectUrl && (
                                        <Cropper
                                            image={objectUrl}
                                            crop={crop}
                                            zoom={zoom}
                                            aspect={1}
                                            cropShape="round"
                                            showGrid={false}
                                            onCropChange={setCrop}
                                            onZoomChange={setZoom}
                                            onCropComplete={onCropComplete}
                                        />
                                    )}
                                </Box>
                                <Slider.Root
                                    min={1}
                                    max={3}
                                    step={0.01}
                                    value={[zoom]}
                                    onValueChange={(e) => setZoom(e.value[0])}
                                    colorPalette="pitch"
                                >
                                    <Slider.Control>
                                        <Slider.Track>
                                            <Slider.Range />
                                        </Slider.Track>
                                        <Slider.Thumbs />
                                    </Slider.Control>
                                </Slider.Root>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" onClick={onCancel} disabled={busyNow}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette="pitch"
                                loading={busyNow}
                                disabled={!croppedArea}
                                onClick={handleConfirm}
                            >
                                {t.common.confirm}
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
