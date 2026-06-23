import { Toast, Toaster, Stack, Spinner } from "@chakra-ui/react"
import { toaster } from "../toaster"

/**
 * Renders the actual toast UI for our shared toaster instance. Chakra v3's
 * <Toaster> is a render-prop wrapper — it owns the viewport positioning and
 * lifecycle, but each individual toast is laid out by this child function.
 *
 * Mounted once at the app root in main.tsx; the toaster instance lives in
 * src/toaster.ts and is shared with the axios interceptor.
 */
export default function AppToaster() {
    return (
        <Toaster toaster={toaster}>
            {(toast) => (
                <Toast.Root width={{ md: "sm" }}>
                    {toast.type === "loading" ? (
                        <Spinner size="sm" color="blue.solid" />
                    ) : (
                        <Toast.Indicator />
                    )}
                    <Stack gap="1" flex="1" maxWidth="100%">
                        {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
                        {toast.description && (
                            <Toast.Description>{toast.description}</Toast.Description>
                        )}
                    </Stack>
                    {toast.action && (
                        <Toast.ActionTrigger>{toast.action.label}</Toast.ActionTrigger>
                    )}
                    {toast.closable && <Toast.CloseTrigger />}
                </Toast.Root>
            )}
        </Toaster>
    )
}
