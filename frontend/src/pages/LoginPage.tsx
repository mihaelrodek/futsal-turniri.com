import React, { useEffect, useState } from "react"
import { Link as RouterLink, useLocation, useNavigate, useSearchParams } from "react-router-dom"
import {
    Box,
    Button,
    Card,
    Field,
    Heading,
    HStack,
    Input,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FcGoogle } from "react-icons/fc"
import { getFirebase } from "../firebase"
import { useAuth } from "../auth/AuthContext"
import { pickSafeNext } from "../utils/safeNextPath"
import { emailForUsername } from "../api/auth"
import { useTranslation } from "../i18n"
import type { Dictionary } from "../i18n"

/** Translate Firebase auth error codes into user-friendly messages. */
function authErrorMessage(err: any, t: Dictionary): string {
    const code: string = err?.code ?? ""
    switch (code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
        case "auth/user-not-found":
            return t.pages.loginPage.errors.invalidCredentials
        case "auth/invalid-email":
            return t.pages.loginPage.errors.invalidEmail
        case "auth/user-disabled":
            return t.pages.loginPage.errors.userDisabled
        case "auth/too-many-requests":
            return t.pages.loginPage.errors.tooManyRequests
        case "auth/popup-blocked":
            return t.pages.loginPage.errors.popupBlocked
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request":
            return "" // user closed popup - not really an error
        default:
            return err?.message ?? t.pages.loginPage.errors.loginFailed
    }
}

export default function LoginPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const [searchParams] = useSearchParams()
    const { signInWithIdentifier, signInWithGoogle, user, loading: authLoading } = useAuth()
    const t = useTranslation()

    // Holds an email OR a username; resolved in signInWithIdentifier.
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [resetMsg, setResetMsg] = useState<string | null>(null)

    // Where to send the user after a successful sign-in. Accepts a
    // ?next=/path query param (used by the claim-name share flow) and
    // falls back to whatever the navigation state carried (route guard
    // bumps a "from" hint in there).
    //
    // `pickSafeNext` rejects anything that isn't a same-origin path
    // (`//evil.tld`, `javascript:…`, backslash tricks, etc.) - without
    // this guard an attacker crafting
    //     /prijava?next=//evil.tld/phish
    // could turn a real login into an open redirect onto their domain.
    const redirectTo = pickSafeNext(
        [
            searchParams.get("next"),
            (location.state as { from?: string } | null)?.from,
        ],
        "/turniri",
    )

    /**
     * If the user is already authenticated, /login has nothing to do -
     * send them straight to the redirect target. Use {replace} so the
     * browser back button doesn't bounce them back to /login.
     */
    useEffect(() => {
        if (!authLoading && user?.uid) {
            navigate(redirectTo, { replace: true })
        }
    }, [authLoading, user?.uid, redirectTo, navigate])

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        setResetMsg(null)
        if (!email.trim() || !password) {
            setError(t.pages.loginPage.errors.missingFields)
            return
        }
        try {
            setSubmitting(true)
            await signInWithIdentifier(email.trim(), password)
            navigate(redirectTo, { replace: true })
        } catch (e: any) {
            const msg = authErrorMessage(e, t)
            if (msg) setError(msg)
        } finally {
            setSubmitting(false)
        }
    }

    async function onGoogle() {
        setError(null)
        setResetMsg(null)
        try {
            await signInWithGoogle()
            navigate(redirectTo, { replace: true })
        } catch (e: any) {
            const msg = authErrorMessage(e, t)
            if (msg) setError(msg)
        }
    }

    async function onResetPassword() {
        setError(null)
        setResetMsg(null)
        const idInput = email.trim()
        if (!idInput) {
            setError(t.pages.loginPage.errors.resetMissingIdentifier)
            return
        }
        try {
            // Password reset needs an email. If the user typed a username,
            // resolve it to the account email first.
            let resetEmail = idInput
            if (!idInput.includes("@")) {
                const resolved = await emailForUsername(idInput)
                if (!resolved) {
                    setError(t.pages.loginPage.errors.resetNeedsEmail)
                    return
                }
                resetEmail = resolved
            }
            const [{ auth }, { sendPasswordResetEmail }] =
                await Promise.all([getFirebase(), import("firebase/auth")])
            await sendPasswordResetEmail(auth, resetEmail)
            setResetMsg(t.pages.loginPage.resetEmailSent)
        } catch (e: any) {
            setError(authErrorMessage(e, t))
        }
    }

    return (
        <Box maxW="420px" mx="auto" mt={{ base: "4", md: "10" }}>
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "5", md: "6" }}>
                    <VStack align="stretch" gap="4">
                        <Heading size="md">{t.pages.loginPage.heading}</Heading>

                        <Button
                            variant="outline"
                            size="md"
                            onClick={onGoogle}
                            disabled={submitting}
                        >
                            <FcGoogle size={18} /> {t.pages.loginPage.continueWithGoogle}
                        </Button>

                        <HStack>
                            <Box flex="1" h="1px" bg="border.subtle" />
                            <Text fontSize="xs" color="fg.muted">{t.pages.loginPage.orDivider}</Text>
                            <Box flex="1" h="1px" bg="border.subtle" />
                        </HStack>

                        <form onSubmit={onSubmit}>
                            <VStack align="stretch" gap="3">
                                <Field.Root required>
                                    <Field.Label>{t.pages.loginPage.identifierLabel}</Field.Label>
                                    <Input
                                        type="text"
                                        autoComplete="username"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder={t.pages.loginPage.identifierPlaceholder}
                                    />
                                </Field.Root>
                                <Field.Root required>
                                    <Field.Label>{t.pages.loginPage.passwordLabel}</Field.Label>
                                    <Input
                                        type="password"
                                        autoComplete="current-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                </Field.Root>

                                {error && (
                                    <Box borderWidth="1px" borderColor="red.muted" bg="red.subtle" rounded="md" p="2">
                                        <Text fontSize="sm" color="red.fg">{error}</Text>
                                    </Box>
                                )}
                                {resetMsg && (
                                    <Box borderWidth="1px" borderColor="green.muted" bg="green.subtle" rounded="md" p="2">
                                        <Text fontSize="sm" color="green.fg">{resetMsg}</Text>
                                    </Box>
                                )}

                                <Button
                                    type="submit"
                                    variant="solid"
                                    colorPalette="pitch"
                                    loading={submitting}
                                    disabled={submitting}
                                >
                                    {t.pages.loginPage.submit}
                                </Button>
                            </VStack>
                        </form>

                        <HStack justify="space-between" wrap="wrap" gap="2">
                            <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={onResetPassword}
                            >
                                {t.pages.loginPage.forgotPassword}
                            </Button>
                            <Text fontSize="sm" color="fg.muted">
                                {t.pages.loginPage.noAccount}{" "}
                                <Box as="span" color="blue.fg" fontWeight="medium">
                                    <RouterLink to="/registracija">{t.pages.loginPage.registerLink}</RouterLink>
                                </Box>
                            </Text>
                        </HStack>
                    </VStack>
                </Card.Body>
            </Card.Root>
        </Box>
    )
}
