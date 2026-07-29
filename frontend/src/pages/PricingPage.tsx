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
    LuSparkles,
    LuTarget,
    LuTrophy,
    LuVideo,
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
    tagline: string
    features: string[]
    highlight?: boolean
}

const TIERS: Tier[] = [
    {
        icon: LuTarget,
        name: "Gol",
        price: "5 €",
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
        tagline: "Cijeli turnir, sve utakmice tvoje ekipe.",
        features: [
            "Snimke svih odigranih utakmica s turnira",
            "Kompletna video arhiva za cijelu ekipu",
            "Najisplativiji paket po utakmici",
        ],
        highlight: true,
    },
]

function PricingCard({ tier }: { tier: Tier }) {
    return (
        <VStack
            align="stretch"
            gap="4"
            bg="bg.panel"
            borderWidth={tier.highlight ? "2px" : "1px"}
            borderColor={tier.highlight ? "pitch.500" : "border"}
            rounded="xl"
            p="5"
            position="relative"
            shadow={tier.highlight ? "md" : "sm"}
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
        </VStack>
    )
}

/* ── Camera package - price on request, closes with an inline form ── */

type InquiryState = "idle" | "sending" | "sent"

function CameraInquiryForm({ onSent }: { onSent: () => void }) {
    const [name, setName] = useState("")
    const [contactEmail, setContactEmail] = useState("")
    const [contactPhone, setContactPhone] = useState("")
    const [tournamentName, setTournamentName] = useState("")
    const [message, setMessage] = useState("")
    const [state, setState] = useState<InquiryState>("idle")

    const hasContact = contactEmail.trim().length > 0 || contactPhone.trim().length > 0
    const canSubmit = name.trim().length > 0 && hasContact

    async function onSubmit(e: FormEvent) {
        e.preventDefault()
        if (!canSubmit) {
            showError("Nedostaju podaci", "Upiši ime i barem jedan kontakt (email ili telefon).")
            return
        }
        try {
            setState("sending")
            await submitCameraInquiry({
                name: name.trim(),
                contactEmail: contactEmail.trim() || undefined,
                contactPhone: contactPhone.trim() || undefined,
                tournamentName: tournamentName.trim() || undefined,
                message: message.trim() || undefined,
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
                    Javit ćemo se s ponudom na kontakt koji si ostavio/la.
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
                    <Field.Root flex="1" minW="200px">
                        <Field.Label>Naziv turnira</Field.Label>
                        <Input
                            size="sm"
                            value={tournamentName}
                            onChange={(e) => setTournamentName(e.target.value)}
                            placeholder="npr. Ljetni turnir 2026"
                        />
                    </Field.Root>
                </HStack>

                <HStack gap="3" align="start" wrap="wrap">
                    <Field.Root flex="1" minW="200px">
                        <Field.Label>Email</Field.Label>
                        <Input
                            size="sm"
                            type="email"
                            value={contactEmail}
                            onChange={(e) => setContactEmail(e.target.value)}
                            placeholder="ime@email.com"
                        />
                    </Field.Root>
                    <Field.Root flex="1" minW="200px">
                        <Field.Label>Broj telefona</Field.Label>
                        <Input
                            size="sm"
                            type="tel"
                            value={contactPhone}
                            onChange={(e) => setContactPhone(e.target.value)}
                            placeholder="+385 91 234 5678"
                        />
                    </Field.Root>
                </HStack>
                {!hasContact && (
                    <Field.HelperText mt="-2">Upiši barem jedno - email ili telefon.</Field.HelperText>
                )}

                <Field.Root>
                    <Field.Label>Poruka</Field.Label>
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

            {/* ── Fixed-price packages ─────────────────────────────────── */}
            <Grid
                templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", lg: "repeat(4, 1fr)" }}
                gap="4"
            >
                {TIERS.map((tier) => (
                    <PricingCard key={tier.name} tier={tier} />
                ))}
            </Grid>

            {/* ── Camera package - price on request ────────────────────── */}
            <CameraPackageBand />
        </VStack>
    )
}
