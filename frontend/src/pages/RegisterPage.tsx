import React, { useEffect, useRef, useState } from "react"
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
import { checkUsernameAvailable } from "../api/auth"

function authErrorMessage(err: any): string {
    // Backend 409 from register-profile = username taken.
    if (err?.response?.status === 409) {
        return "Korisničko ime je upravo zauzeto. Odaberi drugo."
    }
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

/** Client-side approximation of the backend slug rule (backend is authoritative). */
function slugify(s: string): string {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "d")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
}

type UsernameStatus =
    | { state: "idle" }
    | { state: "checking" }
    | { state: "ok"; normalized: string }
    | { state: "taken"; normalized: string }
    | { state: "short" }

export default function RegisterPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const [searchParams] = useSearchParams()
    const { signUp, signInWithGoogle, user, loading: authLoading } = useAuth()

    const [firstName, setFirstName] = useState("")
    const [lastName, setLastName] = useState("")
    const [username, setUsername] = useState("")
    const usernameEditedRef = useRef(false)
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [confirm, setConfirm] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [uStatus, setUStatus] = useState<UsernameStatus>({ state: "idle" })

    const redirectTo = pickSafeNext(
        [searchParams.get("next"), (location.state as { from?: string } | null)?.from],
        "/turniri",
    )

    useEffect(() => {
        if (!authLoading && user?.uid) {
            navigate(redirectTo, { replace: true })
        }
    }, [authLoading, user?.uid, redirectTo, navigate])

    // Auto-derive the username from first + last name until the user edits it.
    useEffect(() => {
        if (usernameEditedRef.current) return
        const auto = slugify(`${firstName} ${lastName}`)
        setUsername(auto)
    }, [firstName, lastName])

    // Debounced live availability check.
    useEffect(() => {
        const u = username.trim()
        if (!u) {
            setUStatus({ state: "idle" })
            return
        }
        if (slugify(u).length < 3) {
            setUStatus({ state: "short" })
            return
        }
        setUStatus({ state: "checking" })
        let cancelled = false
        const id = window.setTimeout(async () => {
            try {
                const res = await checkUsernameAvailable(u)
                if (cancelled) return
                if (res.tooShort) setUStatus({ state: "short" })
                else if (res.available) setUStatus({ state: "ok", normalized: res.normalized })
                else setUStatus({ state: "taken", normalized: res.normalized })
            } catch {
                if (!cancelled) setUStatus({ state: "idle" })
            }
        }, 400)
        return () => {
            cancelled = true
            clearTimeout(id)
        }
    }, [username])

    const usernameOk = uStatus.state === "ok"

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        setError(null)
        if (!firstName.trim() || !lastName.trim()) {
            setError("Ime i prezime su obavezni.")
            return
        }
        if (!usernameOk) {
            setError("Odaberi dostupno korisničko ime.")
            return
        }
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
            await signUp(email.trim(), password, {
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                username: username.trim(),
            })
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
        <Box maxW="440px" mx="auto" mt={{ base: "4", md: "10" }}>
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "5", md: "6" }}>
                    <VStack align="stretch" gap="4">
                        <Heading size="md">Registracija</Heading>

                        <Button variant="outline" size="md" onClick={onGoogle} disabled={submitting}>
                            <FcGoogle size={18} /> Registriraj se s Googleom
                        </Button>

                        <HStack>
                            <Box flex="1" h="1px" bg="border.subtle" />
                            <Text fontSize="xs" color="fg.muted">ili</Text>
                            <Box flex="1" h="1px" bg="border.subtle" />
                        </HStack>

                        <form onSubmit={onSubmit}>
                            <VStack align="stretch" gap="3">
                                <HStack gap="3" align="start">
                                    <Field.Root required>
                                        <Field.Label>Ime</Field.Label>
                                        <Input
                                            autoComplete="given-name"
                                            value={firstName}
                                            onChange={(e) => setFirstName(e.target.value)}
                                            placeholder="Marko"
                                        />
                                    </Field.Root>
                                    <Field.Root required>
                                        <Field.Label>Prezime</Field.Label>
                                        <Input
                                            autoComplete="family-name"
                                            value={lastName}
                                            onChange={(e) => setLastName(e.target.value)}
                                            placeholder="Horvat"
                                        />
                                    </Field.Root>
                                </HStack>

                                <Field.Root required>
                                    <Field.Label>Korisničko ime</Field.Label>
                                    <Input
                                        autoComplete="username"
                                        value={username}
                                        onChange={(e) => {
                                            usernameEditedRef.current = true
                                            setUsername(e.target.value)
                                        }}
                                        placeholder="marko-horvat"
                                    />
                                    {uStatus.state === "checking" && (
                                        <Field.HelperText>Provjeravam dostupnost…</Field.HelperText>
                                    )}
                                    {uStatus.state === "ok" && (
                                        <Field.HelperText color="green.fg">
                                            ✓ „{uStatus.normalized}" je dostupno
                                        </Field.HelperText>
                                    )}
                                    {uStatus.state === "taken" && (
                                        <Field.HelperText color="red.fg">
                                            „{uStatus.normalized}" je zauzeto — odaberi drugo
                                        </Field.HelperText>
                                    )}
                                    {uStatus.state === "short" && (
                                        <Field.HelperText color="red.fg">
                                            Prekratko (najmanje 3 znaka).
                                        </Field.HelperText>
                                    )}
                                    {uStatus.state === "idle" && (
                                        <Field.HelperText>
                                            Automatski iz imena; možeš promijeniti. Bit će tvoj profil: /profil/…
                                        </Field.HelperText>
                                    )}
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
                                    disabled={submitting || !usernameOk}
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
