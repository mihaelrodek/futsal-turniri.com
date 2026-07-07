import { IconButton } from "@chakra-ui/react"
import { FiMoon, FiSun } from "react-icons/fi"
import { useColorMode } from "../color-mode"
import { useAuth } from "../auth/AuthContext"
import { updateColorMode } from "../api/userMe"

/**
 * Sun/moon toggle for the navbar. Flips the theme via next-themes (persisted
 * to localStorage on this device) and, when signed in, also saves the choice
 * to the profile fire-and-forget so ThemeSync applies it on other devices.
 */
export default function ColorModeToggle({ size = "sm" }: { size?: "xs" | "sm" | "md" }) {
    const { colorMode, toggleColorMode } = useColorMode()
    const { user } = useAuth()
    const next = colorMode === "light" ? "dark" : "light"

    function handleClick() {
        toggleColorMode()
        if (user) {
            updateColorMode(next).catch(() => {
                /* best-effort - local toggle already applied */
            })
        }
    }

    return (
        <IconButton
            aria-label={next === "dark" ? "Tamna tema" : "Svijetla tema"}
            title={next === "dark" ? "Tamna tema" : "Svijetla tema"}
            size={size}
            variant="outline"
            rounded="full"
            colorPalette="pitch"
            onClick={handleClick}
        >
            {colorMode === "light" ? <FiMoon /> : <FiSun />}
        </IconButton>
    )
}
