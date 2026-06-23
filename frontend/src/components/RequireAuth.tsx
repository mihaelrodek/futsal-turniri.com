import React from "react"
import { Navigate, useLocation } from "react-router-dom"
import { Box, HStack, Spinner, Text } from "@chakra-ui/react"
import { useAuth } from "../auth/AuthContext"

/**
 * Wrap a route element to require authentication. Anonymous visitors get
 * redirected to /prijava with a `state.from` so login can send them back where
 * they came from. While the initial auth-state probe is running, render a
 * lightweight spinner instead of bouncing — that prevents a brief flash of
 * the login page for users who are signed-in but the SDK hasn't restored yet.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth()
    const location = useLocation()

    if (loading) {
        return (
            <HStack justify="center" py="16">
                <Spinner />
                <Text color="fg.muted">Provjeravam prijavu…</Text>
            </HStack>
        )
    }

    if (!user) {
        return (
            <Navigate
                to="/prijava"
                replace
                state={{ from: `${location.pathname}${location.search}` }}
            />
        )
    }

    return <Box>{children}</Box>
}
