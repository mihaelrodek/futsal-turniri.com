import { useState } from "react"
import type { ElementType, FormEvent } from "react"
import {
    Badge,
    Box,
    Button,
    Field,
    Flex,
    Grid,
    Heading,
    HStack,
    Icon,
    Input,
    Text,
    Textarea,
    VStack,
    chakra,
} from "@chakra-ui/react"
import {
    LuCamera,
    LuCheck,
    LuFlame,
    LuShoppingCart,
    LuSparkles,
    LuTarget,
    LuTrash2,
    LuTrophy,
    LuVideo,
    LuX,
} from "react-icons/lu"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { MonoLabel, PitchBackdrop, GhostButton } from "../ui/pitch"
import { submitCameraInquiry } from "../api/cameraInquiry"
import { showError } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   Cjenik - packages for buying match video: a single goal clip, a whole
   match, 3 matches from a tournament, or every match from a tournament.
   The camera package (live filming, price on request) closes the page with
   an inline inquiry form instead of a fixed price/CTA.
   Purely presentational except the camera inquiry form's submit.
   ────────────────────────────────────────────────────────────────────── */

type Tier = {
    icon: ElementType
    name: string
    price: string
    /** Euro amount as a plain number, for cart totals - `price` stays the
     *  display string ("5 €") so formatting never has to be re-derived. */
    priceValue: number
    tagline: string
    features: string[]
    highlight?: boolean
}

const TIERS: Tier[] = [
    {
        icon: LuTarget,
        name: "Gol",
        price: "5 €",
        priceValue: 5,
        tagline: "Jedan gol, spreman za dijeljenje.",
        features: [
            "Isječak jednog gola u HD kvaliteti",
            "Spreman za preuzimanje i dijeljenje",
            "Dostava u pravilu unutar 48 h",
        ],
    },
    {
        icon: LuVideo,
        name: "Tekma",
        price: "20 €",
        priceValue: 20,
        tagline: "Cijela utakmica, oba poluvremena.",
        features: [
            "Snimka cijele utakmice",
            "Puna rezolucija za preuzimanje",
            "Dostava u pravilu unutar 48 h",
        ],
    },
    {
        icon: LuFlame,
        name: "Hattrick",
        price: "50 €",
        priceValue: 50,
        tagline: "3 utakmice s turnira po tvom izboru.",
        features: [
            "Snimke bilo koje 3 utakmice s turnira",
            "Sam biraš koje utakmice",
            "Jeftinije nego pojedinačna kupnja",
        ],
    },
    {
        icon: LuTrophy,
        name: "Zlatna kopačka",
        price: "100 €",
        priceValue: 100,
        tagline: "Cijeli turnir, sve utakmice tvoje ekipe.",
        features: [
            "Snimke svih odigranih utakmica s turnira",
            "Kompletna video arhiva za cijelu ekipu",
            "Najisplativiji paket po utakmici",
        ],
        highlight: true,
    },
]

function PricingCard({
    tier,
    selected,
    onToggle,
}: {
    tier: Tier
    selected: boolean
    onToggle: () => void
}) {
    return (
        <chakra.button
            type="button"
            display="flex"
            flexDirection="column"
            alignItems="stretch"
            gap="4"
            bg={selected ? "pitch.subtle" : "bg.panel"}
            borderWidth={selected || tier.highlight ? "2px" : "1px"}
            borderColor={selected ? "pitch.600" : tier.highlight ? "pitch.500" : "border"}
            rounded="xl"
            p="5"
            position="relative"
            shadow={tier.highlight ? "md" : "sm"}
            cursor="pointer"
            textAlign="left"
            w="full"
            transition="border-color .15s, background .15s, transform .1s"
            _hover={{ borderColor: "pitch.500" }}
            _active={{ transform: "scale(0.99)" }}
            onClick={onToggle}
            aria-pressed={selected}
        >
            {tier.highlight && (
                <Badge
                    position="absolute"
                    top="-11px"
                    left="5"
                    colorPalette="pitch"
                    variant="solid"
                    fontSize="10px"
                    letterSpacing="0.06em"
                    textTransform="uppercase"
                >
                    Najbolja vrijednost
                </Badge>
            )}
            {/* Selection check - top-right so it never collides with the
                "Najbolja vrijednost" ribbon (top-left). */}
            <Flex
                position="absolute"
                top="4"
                right="4"
                w="24px"
                h="24px"
                rounded="full"
                align="center"
                justify="center"
                borderWidth="1.5px"
                borderColor={selected ? "pitch.600" : "border.emphasized"}
                bg={selected ? "pitch.600" : "transparent"}
                color="white"
                transition="background .15s, border-color .15s"
            >
                {selected && <Icon as={LuCheck} boxSize="3.5" />}
            </Flex>
            <Flex
                w="44px"
                h="44px"
                rounded="lg"
                bg="bg.surfaceTint"
                color="pitch.500"
                align="center"
                justify="center"
            >
                <Icon as={tier.icon} boxSize="5" />
            </Flex>
            <Box>
                <Heading size="md">{tier.name}</Heading>
                <Text fontSize="13px" color="fg.muted" mt="1">
                    {tier.tagline}
                </Text>
            </Box>
            <HStack align="baseline" gap="1">
                <Text fontSize="30px" fontWeight={800} lineHeight="1">
                    {tier.price}
                </Text>
            </HStack>
            <VStack align="stretch" gap="2" flex="1">
                {tier.features.map((f) => (
                    <HStack key={f} align="start" gap="2">
                        <Icon as={LuCheck} boxSize="4" color="pitch.500" mt="0.5" flexShrink={0} />
                        <Text fontSize="13.5px" color="fg.muted" lineHeight="1.45">
                            {f}
                        </Text>
                    </HStack>
                ))}
            </VStack>
        </chakra.button>
    )
}

/** "5 €" + "20 €" → "25 €" - both display strings are always plain whole
 *  euros (see TIERS), so summing the numeric twin and re-appending " €"
 *  is simpler than parsing the string back out. */
function formatTotal(cents: number): string {
    return `${cents} €`
}

function CartSummary({
    tiers,
    onRemove,
    onClear,
}: {
    tiers: Tier[]
    onRemove: (name: string) => void
    onClear: () => void
}) {
    const total = tiers.reduce((sum, t) => sum + t.priceValue, 0)
    return (
        <Box
            borderWidth="1px"
            borderColor="pitch.500"
            rounded="xl"
            p={{ base: "4", md: "5" }}
            bg="pitch.subtle"
        >
            <HStack justify="space-between" align="center" mb="3">
                <HStack gap="2">
                    <Icon as={LuShoppingCart} boxSize="5" color="pitch.700" />
                    <Heading size="sm">Košarica</Heading>
                    <Badge colorPalette="pitch" variant="solid">{tiers.length}</Badge>
                </HStack>
                <chakra.button
                    type="button"
                    onClick={onClear}
                    display="inline-flex"
                    alignItems="center"
                    gap="1"
                    fontSize="12.5px"
                    fontWeight={600}
                    color="fg.muted"
                    bg="transparent"
                    border="none"
                    cursor="pointer"
                    _hover={{ color: "fg.ink" }}
                >
                    <LuTrash2 size={13} /> Isprazni košaricu
                </chakra.button>
            </HStack>
            <VStack align="stretch" gap="2">
                {tiers.map((t) => (
                    <HStack
                        key={t.name}
                        justify="space-between"
                        bg="bg.panel"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="lg"
                        px="3"
                        py="2"
                    >
                        <HStack gap="2">
                            <Icon as={t.icon} boxSize="4" color="pitch.500" />
                            <Text fontSize="14px" fontWeight={600}>{t.name}</Text>
                        </HStack>
                        <HStack gap="3">
                            <Text fontSize="14px" fontWeight={700}>{t.price}</Text>
                            <chakra.button
                                type="button"
                                aria-label={`Ukloni ${t.name} iz košarice`}
                                title="Ukloni"
                                onClick={() => onRemove(t.name)}
                                display="inline-flex"
                                color="fg.muted"
                                bg="transparent"
                                border="none"
                                cursor="pointer"
                                _hover={{ color: "accent.red" }}
                            >
                                <LuX size={16} />
                            </chakra.button>
                        </HStack>
                    </HStack>
                ))}
            </VStack>
            <HStack justify="space-between" mt="3" pt="3" borderTopWidth="1px" borderColor="pitch.emphasized">
                <Text fontWeight={700}>Ukupno</Text>
                <Text fontWeight={800} fontSize="18px">{formatTotal(total)}</Text>
            </HStack>
        </Box>
    )
}

/* ── Camera package - price on request, closes with an inline form ── */

type InquiryState = "idle" | "sending" | "sent"

/** Mirrors the backend's simple, non-exhaustive patterns (CameraInquiryController)
 *  so obviously-fake input ("asdf", "123") gets caught before a round-trip. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/
const PHONE_RE = /^\+?[0-9]{6,15}$/

function CameraInquiryForm({ onSent }: { onSent: () => void }) {
    const [name, setName] = useState("")
    const [contactEmail, setContactEmail] = useState("")
    const [contactPhone, setContactPhone] = useState("")
    const [tournamentName, setTournamentName] = useState("")
    const [message, setMessage] = useState("")
    const [state, setState] = useState<InquiryState>("idle")

    const emailOk = EMAIL_RE.test(contactEmail.trim())
    const phoneOk = PHONE_RE.test(contactPhone.replace(/\s+/g, ""))
    const canSubmit =
        name.trim().length > 0
        && emailOk
        && phoneOk
        && tournamentName.trim().length > 0
        && message.trim().length > 0

    async function onSubmit(e: FormEvent) {
        e.preventDefault()
        if (!canSubmit) {
            showError("Nedostaju podaci", "Ime, email, broj telefona, naziv turnira i opis su obavezni.")
            return
        }
        try {
            setState("sending")
            await submitCameraInquiry({
                name: name.trim(),
                contactEmail: contactEmail.trim(),
                contactPhone: contactPhone.trim(),
                tournamentName: tournamentName.trim(),
                message: message.trim(),
            })
            setState("sent")
            onSent()
        } catch {
            setState("idle")
        }
    }

    if (state === "sent") {
        return (
            <VStack align="stretch" gap="1" py="2">
                <Text fontWeight={700}>Upit je poslan.</Text>
                <Text fontSize="sm" color="fg.muted">
                    Javit ćemo se s ponudom na kontakt koji si ostavio/la - potvrda je poslana i na tvoj email.
                </Text>
            </VStack>
        )
    }

    return (
        <chakra.form onSubmit={onSubmit}>
            <VStack align="stretch" gap="3">
                <HStack gap="3" align="start" wrap="wrap">
                    <Field.Root required flex="1" minW="200px">
                        <Field.Label>Ime <Field.RequiredIndicator /></Field.Label>
                        <Input
                            size="sm"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ime i prezime"
                        />
                    </Field.Root>
                    <Field.Root required flex="1" minW="200px">
                        <Field.Label>Naziv turnira <Field.RequiredIndicator /></Field.Label>
                        <Input
                            size="sm"
                            value={tournamentName}
                            onChange={(e) => setTournamentName(e.target.value)}
                            placeholder="npr. Ljetni turnir 2026"
                        />
                    </Field.Root>
                </HStack>

                <HStack gap="3" align="start" wrap="wrap">
                    <Field.Root required flex="1" minW="200px" invalid={contactEmail.trim().length > 0 && !emailOk}>
                        <Field.Label>Email <Field.RequiredIndicator /></Field.Label>
                        <Input
                            size="sm"
                            type="email"
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            placeholder="ime@email.com"
                        />
                        {contactEmail.trim().length > 0 && !emailOk && (
                            <Field.ErrorText>Email adresa nije ispravna.</Field.ErrorText>
                        )}
                    </Field.Root>
                    <Field.Root required flex="1" minW="200px" invalid={contactPhone.trim().length > 0 && !phoneOk}>
                        <Field.Label>Broj telefona <Field.RequiredIndicator /></Field.Label>
                        <Input
                            size="sm"
                            type="tel"
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            placeholder="+385 91 234 5678"
                        />
                        {contactPhone.trim().length > 0 && !phoneOk && (
                            <Field.ErrorText>Broj telefona nije ispravan.</Field.ErrorText>
                        )}
                    </Field.Root>
                </HStack>

                <Field.Root required>
                    <Field.Label>Opis <Field.RequiredIndicator /></Field.Label>
                    <Textarea
                        size="sm"
                        rows={3}
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Broj utakmica, datumi, streaming uživo - što god je bitno za ponudu."
                    />
                </Field.Root>

                <HStack justify="flex-end">
                    <Button
                        type="submit"
                        size="sm"
                        colorPalette="pitch"
                        loading={state === "sending"}
                        disabled={!canSubmit || state === "sending"}
                    >
                        Pošalji upit
                    </Button>
                </HStack>
            </VStack>
        </chakra.form>
    )
}

function CameraPackageBand() {
    const [open, setOpen] = useState(false)
    const [sent, setSent] = useState(false)

    return (
        <Box
            borderWidth="1px"
            borderStyle="dashed"
            borderColor="border.emphasized"
            rounded="xl"
            p={{ base: "5", md: "6" }}
            bg="bg.panel"
        >
            <HStack justify="space-between" align="start" wrap="wrap" gap="4">
                <HStack align="start" gap="4">
                    <Flex
                        w="44px"
                        h="44px"
                        rounded="lg"
                        bg="bg.surfaceTint"
                        color="pitch.500"
                        align="center"
                        justify="center"
                        flexShrink={0}
                    >
                        <Icon as={LuCamera} boxSize="5" />
                    </Flex>
                    <Box>
                        <HStack gap="2" wrap="wrap">
                            <Heading size="md">Kamera paket</Heading>
                            <Badge variant="subtle" colorPalette="gray">Cijena na upit</Badge>
                        </HStack>
                        <Text fontSize="13.5px" color="fg.muted" mt="1.5" maxW="560px">
                            Dogovorno snimanje kamerom uživo na tvom turniru, prilagođeno broju
                            utakmica i trajanju - javi se i pošaljemo ponudu.
                        </Text>
                    </Box>
                </HStack>
                {!open && !sent && (
                    <GhostButton onClick={() => setOpen(true)}>Zatraži ponudu</GhostButton>
                )}
            </HStack>

            {(open || sent) && (
                <Box mt="5" pt="5" borderTopWidth="1px" borderColor="border.emphasized">
                    <CameraInquiryForm onSent={() => setSent(true)} />
                </Box>
            )}
        </Box>
    )
}

export default function PricingPage() {
    useDocumentHead({
        title: "Cjenik - Futsal Turniri",
        description: "Snimke gola, utakmice ili cijelog turnira - odaberi paket koji ti odgovara.",
    })

    const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
    const selectedTiers = TIERS.filter((t) => selectedNames.has(t.name))

    function toggle(name: string) {
        setSelectedNames((prev) => {
            const next = new Set(prev)
            if (next.has(name)) next.delete(name)
            else next.add(name)
            return next
        })
    }

    return (
        <VStack align="stretch" gap="10" pb="4">
            {/* ── Hero ─────────────────────────────────────────────────── */}
            <Box
                position="relative"
                rounded="2xl"
                overflow="hidden"
                color="white"
                bgImage="linear-gradient(135deg, #132A3E, #0B1522)"
            >
                <PitchBackdrop opacity={0.15} variant="pricing-hero" tone="pitch" />
                <VStack
                    position="relative"
                    align="start"
                    gap="4"
                    px={{ base: 6, md: 12 }}
                    py={{ base: 10, md: 12 }}
                >
                    <HStack
                        gap="1.5"
                        bg="rgba(255,255,255,0.12)"
                        borderWidth="1px"
                        borderColor="rgba(255,255,255,0.2)"
                        rounded="full"
                        px="3"
                        py="1"
                    >
                        <Icon as={LuSparkles} boxSize="3.5" />
                        <MonoLabel color="white" letterSpacing="0.06em">Cjenik</MonoLabel>
                    </HStack>
                    <Heading
                        fontFamily="heading"
                        fontSize={{ base: "28px", md: "40px" }}
                        fontWeight={800}
                        letterSpacing="-0.02em"
                        lineHeight="1.1"
                    >
                        Snimka tvog trenutka na terenu
                    </Heading>
                    <Text fontSize={{ base: "14px", md: "16px" }} color="rgba(255,255,255,0.85)" maxW="640px">
                        Od jednog gola do cijelog turnira - odaberi paket koji ti odgovara.
                        Sve snimke stižu u punoj HD kvaliteti, spremne za preuzimanje.
                    </Text>
                </VStack>
            </Box>

            {/* ── Fixed-price packages - click a card to add/remove it from
                  the cart below. ─────────────────────────────────────── */}
            <Grid
                templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }}
                gap="4"
            >
                {TIERS.map((tier) => (
                    <PricingCard
                        key={tier.name}
                        tier={tier}
                        selected={selectedNames.has(tier.name)}
                        onToggle={() => toggle(tier.name)}
                    />
                ))}
            </Grid>

            {selectedTiers.length > 0 && (
                <CartSummary
                    tiers={selectedTiers}
                    onRemove={(name) => toggle(name)}
                    onClear={() => setSelectedNames(new Set())}
                />
            )}

            {/* ── Camera package - price on request ────────────────────── */}
            <CameraPackageBand />
        </VStack>
    )
}
