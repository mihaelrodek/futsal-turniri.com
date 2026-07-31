import { Switch } from "@chakra-ui/react"
import { FiMoon, FiSun } from "react-icons/fi"
import { useColorMode } from "../color-mode"
import { useAuth } from "../auth/AuthContext"
import { updateColorMode } from "../api/userMe"
import { useTranslation } from "../i18n"

/**
 * Animated light/dark slider - a single shared control used everywhere the
 * theme can be switched (Profil → Postavke, the desktop profile menu, the
 * mobile drawer, and the desktop guest menu for signed-out visitors).
 * Flips the theme via next-themes (persisted to localStorage on this
 * device) and, when signed in, also saves the choice to the profile
 * fire-and-forget so it follows the account across devices (ThemeSync reads
 * it back on login elsewhere).
 */
export default function ThemeSwitch({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
    const { colorMode, setColorMode } = useColorMode()
    const { user } = useAuth()
    const t = useTranslation()

    // Glyph tracks the control size - the "lg" slider used in the nav menus
    // would otherwise carry the same tiny 11px icon as the "sm" one.
    const iconSize = size === "lg" ? 13 : size === "sm" ? 9 : 11

    function handleChange(dark: boolean) {
        const next = dark ? "dark" : "light"
        setColorMode(next)
        if (user) {
            updateColorMode(next).catch(() => {
                /* best-effort - local toggle already applied */
            })
        }
    }

    return (
        <Switch.Root
            checked={colorMode === "dark"}
            onCheckedChange={(e) => handleChange(e.checked)}
            colorPalette="pitch"
            size={size}
        >
            <Switch.HiddenInput aria-label={t.nav.themeLabel} />
            <Switch.Control>
                <Switch.Thumb>
                    <Switch.ThumbIndicator fallback={<FiSun size={iconSize} color="var(--chakra-colors-yellow-500)" />}>
                        <FiMoon size={iconSize} />
                    </Switch.ThumbIndicator>
                </Switch.Thumb>
            </Switch.Control>
        </Switch.Root>
    )
}
