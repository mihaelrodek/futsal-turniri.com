import { Box, Button, HStack, Menu, Portal, chakra } from "@chakra-ui/react"
import { LOCALE_LABELS, setLocale, useLocale, type Locale } from "../i18n"
import { useAuth } from "../auth/AuthContext"
import { updateLanguage } from "../api/userMe"

/* ──────────────────────────────────────────────────────────────────────────
   Navbar language switcher - HR / EN / SI, trigger shows the currently
   active flag. Picking one calls `setLocale()` (frontend/src/i18n), which
   re-renders every `useTranslation()` call site immediately and is also
   read by `api/http.ts`'s request interceptor (`X-Locale` header) so
   server-rendered strings (emails, push, validation errors) match too.
   When signed in, the pick is ALSO saved to the profile (fire-and-forget,
   same pattern as the theme switch in PublicProfilePage's SettingsCard) so
   it follows the account across devices via `LocaleSync` on the next login
   elsewhere.

   Two variants:
   - "menu" (default): flag button opening a portalled Menu - for the
     desktop top bar, where nothing else owns an overlay.
   - "inline": a plain horizontal row of 3 toggle buttons, NO Menu/Portal.
     Mandatory inside the mobile Drawer and inside the profile Menu -
     nesting a portalled Menu in another open overlay makes it render
     underneath / fight the parent's outside-click dismissal.
   ────────────────────────────────────────────────────────────────────── */

const LOCALES: Locale[] = ["hr", "en", "sl"]

/** Short display codes - "SI" (not "SL") matches the Slovenian convention
 *  used elsewhere in the UI. */
const LOCALE_CODES: Record<Locale, string> = { hr: "HR", en: "EN", sl: "SI" }

export default function LanguagePicker({
    size = 30,
    variant = "menu",
}: {
    size?: number
    variant?: "menu" | "inline"
}) {
    const active = useLocale()
    const { user } = useAuth()

    function pick(loc: Locale) {
        setLocale(loc)
        if (user) {
            updateLanguage(loc).catch(() => {
                /* best-effort - local switch already applied */
            })
        }
    }

    if (variant === "inline") {
        return (
            <HStack gap="1.5">
                {LOCALES.map((loc) => (
                    <Button
                        key={loc}
                        type="button"
                        size="xs"
                        px="2"
                        variant={loc === active ? "solid" : "outline"}
                        colorPalette={loc === active ? "pitch" : "gray"}
                        aria-label={LOCALE_LABELS[loc].name}
                        aria-pressed={loc === active}
                        title={LOCALE_LABELS[loc].name}
                        onClick={() => pick(loc)}
                    >
                        <Box as="span" fontSize="14px" lineHeight="1">
                            {LOCALE_LABELS[loc].flag}
                        </Box>
                        {LOCALE_CODES[loc]}
                    </Button>
                ))}
            </HStack>
        )
    }

    return (
        <Menu.Root positioning={{ placement: "bottom-end" }}>
            <Menu.Trigger asChild>
                <chakra.button
                    type="button"
                    aria-label={LOCALE_LABELS[active].name}
                    title={LOCALE_LABELS[active].name}
                    display="inline-flex"
                    alignItems="center"
                    justifyContent="center"
                    w={`${size}px`}
                    h={`${size}px`}
                    rounded="full"
                    bg="bg.surfaceTint"
                    border="none"
                    cursor="pointer"
                    fontSize={`${Math.round(size * 0.55)}px`}
                    lineHeight="1"
                    _hover={{ bg: "pitch.100" }}
                >
                    {LOCALE_LABELS[active].flag}
                </chakra.button>
            </Menu.Trigger>
            <Portal>
                <Menu.Positioner>
                    <Menu.Content minW="160px">
                        {LOCALES.map((loc) => (
                            <Menu.Item
                                key={loc}
                                value={loc}
                                onSelect={() => pick(loc)}
                                fontWeight={loc === active ? 700 : 500}
                            >
                                <Box as="span" fontSize="16px" mr="1.5">{LOCALE_LABELS[loc].flag}</Box>
                                {LOCALE_LABELS[loc].name}
                            </Menu.Item>
                        ))}
                    </Menu.Content>
                </Menu.Positioner>
            </Portal>
        </Menu.Root>
    )
}
