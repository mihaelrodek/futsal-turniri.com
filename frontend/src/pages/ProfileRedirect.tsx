import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Box, Spinner, Text, VStack } from "@chakra-ui/react"
import { useAuth } from "../auth/AuthContext"

/**
 * Sits at /profil and forwards to /profil/{my-slug} once the slug from
 * /user/me/sync has landed. We don't have the slug at first paint because
 * the auth-state callback fires the sync asynchronously, so we show a small
 * spinner while we wait.
 *
 * Anonymous visitors are bounced to /prijava (with a return-to so they come
 * back here after signing in).
 */
export default function ProfileRedirect() {
    const { user, loading, mySlug } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    useEffect(() => {
        if (loading) return
        if (!user) {
            navigate("/prijava", {
                state: { from: `${location.pathname}${location.search}` },
                replace: true,
            })
            return
        }
        if (mySlug) {
            navigate(`/profil/${mySlug}`, { replace: true })
        }
    }, [loading, user, mySlug, navigate, location.pathname, location.search])

    return (
        <VStack py="10" gap="3">
            <Spinner />
            <Box>
                <Text fontSize="sm" color="fg.muted">Otvaram tvoj profil…</Text>
            </Box>
        </VStack>
    )
}
