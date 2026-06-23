"use client"
import * as React from "react"
import { ThemeProvider, useTheme } from "next-themes"

export function ColorModeProvider({ children }: { children: React.ReactNode }) {
    // Force light mode as the default on first visit, ignore the OS preference.
    // Users can still toggle to dark via the moon icon in the navbar; their
    // choice is persisted in localStorage by next-themes. Without
    // `enableSystem={false}` the OS preference would override our default and
    // dark-mode users would land in dark mode whether they wanted to or not.
    return (
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
            {children}
        </ThemeProvider>
    )
}

export function useColorMode() {
    const { theme, systemTheme, setTheme } = useTheme()
    const current =
        theme === "system" ? (systemTheme as "light" | "dark" | undefined) ?? "light" : (theme as "light" | "dark")
    const toggleColorMode = () => setTheme(current === "light" ? "dark" : "light")
    const setColorMode = (v: "light" | "dark" | "system") => setTheme(v)
    return { colorMode: current, toggleColorMode, setColorMode }
}

export function useColorModeValue<T>(light: T, dark: T): T {
    const { colorMode } = useColorMode()
    return colorMode === "light" ? light : dark
}
