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
import { useAuth } from "../auth/AuthContext"
import { pickSafeNext } from "../utils/safeNextPath"

function authErrorMessage(err: any): string {
    const code: string = err?.code ?? ""
    switch (code) {
        case "auth/email-already-in-use":
            return "Već postoji račun s tom email adresom. Probaj se prijaviti."
        case "auth/invalid-email":
            return "Neispravan format email adrese."
        case "auth/weak-password":
            return "Lozinka je preslaba. Mora imati barem 6 znakova."
        case "auth/popup-closed-by-user":
        case "auth/cancelled-popup-request":
            return ""
        default:
            return err?.message ?? "Registracija nije uspjela."
    }
}

export default function RegisterPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const [searchParams] = useSearchParams()
    const { signUp, signInWithGoogle, user, loading: authLoading } = useAuth()

    const [name, setName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Honour ?next= from the URL (claim-name flow uses it), then
    // navigation-state hint, then the default home for tournaments.
    // Where to bounce the user after a successful sign-up.
    //
    // `pickSafeNext` rejects open-redirect payloads (`//evil.tld`,
    // `javascript:…`, backslash variants) so an attacker can't turn a
    // legitimate `?next=` link into a phish redirect through us.
    const redirectTo = pickSafeNext(
        [
            searchParams.get("next"),
            (location.state as { from?: string } | null)?.from,
        ],
        "/turniri",
    )

    /**
     * If the user is already signed in, /register has nothing to do -
     * bounce them to the redirect target with {replace} so the back
     * button doesn't loop here.
     */
    useEffect(() => {
        if (!authLoading && user?.uid) {
            navigate(redirectTo, { replace: true })
        }
    }, [authLoading, user?.uid, redirectTo, navigate])

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        if (!email.trim() || !password) {
            setError("Email i lozinka su obavezni.")
            return
        }
        if (password.length < 6) {
            setError("Lozinka mora imati barem 6 znakova.")
            return
        }
        if (password !== confirm) {
            setError("Lozinke se ne podudaraju.")
            return
        }
        try {
            setSubmitting(true)
            await signUp(email.trim(), password, name.trim() || undefined)
            navigate(redirectTo, { replace: true })
        } catch (e: any) {
            const msg = authErrorMessage(e)
            if (msg) setError(msg)
        } finally {
            setSubmitting(false)
        }
    }

    async function onGoogle() {
        setError(null)
        try {
            await signInWithGoogle()
            navigate(redirectTo, { replace: true })
        } catch (e: any) {
            const msg = authErrorMessage(e)
            if (msg) setError(msg)
        }
    }

    return (
        <Box maxW="420px" mx="auto" mt={{ base: "4", md: "10" }}>
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "5", md: "6" }}>
                    <VStack align="stretch" gap="4">
                        <Heading size="md">Registracija</Heading>

                        <Button
                            variant="outline"
                            size="md"
                            onClick={onGoogle}
                            disabled={submitting}
                        >
                            <FcGoogle size={18} /> Registriraj se s Googleom
                        </Button>

                        <HStack>
                            <Box flex="1" h="1px" bg="border.subtle" />
                            <Text fontSize="xs" color="fg.muted">ili</Text>
                            <Box flex="1" h="1px" bg="border.subtle" />
                        </HStack>

                        <form onSubmit={onSubmit}>
                            <VStack align="stretch" gap="3">
                                <Field.Root>
                                    <Field.Label>Ime <Box as="span" color="fg.muted" fontSize="xs">(opcionalno)</Box></Field.Label>
                                    <Input
                                        autoComplete="name"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="npr. Marko"
                                    />
                                </Field.Root>
                                <Field.Root required>
                                    <Field.Label>Email</Field.Label>
                                    <Input
                                        type="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                    />
                                </Field.Root>
                                <Field.Root required>
                                    <Field.Label>Lozinka</Field.Label>
                                    <Input
                                        type="password"
                                        autoComplete="new-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                    />
                                    <Field.HelperText>Najmanje 6 znakova.</Field.HelperText>
                                </Field.Root>
                                <Field.Root required>
                                    <Field.Label>Potvrdi lozinku</Field.Label>
                                    <Input
                                        type="password"
                                        autoComplete="new-password"
                                        value={confirm}
                                        onChange={(e) => setConfirm(e.target.value)}
                                    />
                                </Field.Root>

                                {error && (
                                    <Box borderWidth="1px" borderColor="red.muted" bg="red.subtle" rounded="md" p="2">
                                        <Text fontSize="sm" color="red.fg">{error}</Text>
                                    </Box>
                                )}

                                <Button
                                    type="submit"
                                    variant="solid"
                                    colorPalette="pitch"
                                    loading={submitting}
                                    disabled={submitting}
                                >
                                    Kreiraj račun
                                </Button>
                            </VStack>
                        </form>

                        <Text fontSize="sm" color="fg.muted" textAlign="center">
                            Već imaš račun?{" "}
                            <Box as="span" color="blue.fg" fontWeight="medium">
                                <RouterLink to="/prijava">Prijavi se</RouterLink>
                            </Box>
                        </Text>
                    </VStack>
                </Card.Body>
            </Card.Root>
        </Box>
    )
}
