import { Box, Flex, Grid, Heading, HStack, Icon, Text, VStack } from "@chakra-ui/react"
import { useNavigate } from "react-router-dom"
import type { ElementType, ReactNode } from "react"
import {
    LuTrophy,
    LuShuffle,
    LuCalendarClock,
    LuTimer,
    LuRadioTower,
    LuBellRing,
    LuChartColumn,
    LuMap,
    LuMonitorPlay,
    LuShare2,
    LuUsers,
    LuDownload,
    LuSparkles,
    LuQrCode,
    LuListOrdered,
    LuMove,
} from "react-icons/lu"
import { FiArrowRight } from "react-icons/fi"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { MonoLabel, PitchBackdrop, PrimaryButton, GhostButton } from "../ui/pitch"

/* ──────────────────────────────────────────────────────────────────────────
   Vodič / "Što nudimo" - marketing-style tour of the app, reached from the
   floating "?" button. Structure: hero (+ quick-overview panel) → five
   numbered chapters that follow the organizer's journey → final CTA.
   Purely presentational; no data fetching.
   ────────────────────────────────────────────────────────────────────── */

type Feature = { icon: ElementType; title: string; desc: string }

/** One feature card (icon + title + short description). */
function FeatureCard({ f }: { f: Feature }) {
    return (
        <VStack
            align="start"
            gap="2"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="xl"
            p="5"
            h="full"
            transition="border-color .15s, box-shadow .15s"
            _hover={{ borderColor: "pitch.400", boxShadow: "sm" }}
        >
            <Flex
                w="42px"
                h="42px"
                rounded="lg"
                bg="bg.surfaceTint"
                color="pitch.500"
                align="center"
                justify="center"
                flexShrink={0}
            >
                <Icon as={f.icon} boxSize="5" />
            </Flex>
            <Text fontWeight={700} fontSize="15px" color="fg.ink" lineHeight="1.3">
                {f.title}
            </Text>
            <Text fontSize="13.5px" color="fg.muted" lineHeight="1.55">
                {f.desc}
            </Text>
        </VStack>
    )
}

/** Numbered chapter: "N. Title" heading + intro + content below. */
function Chapter({
    n,
    title,
    intro,
    children,
}: {
    n: number
    title: string
    intro: string
    children: ReactNode
}) {
    return (
        <Box as="section">
            <HStack gap="3" align="baseline" mb="2">
                <Text
                    fontFamily="mono"
                    fontSize={{ base: "20px", md: "24px" }}
                    fontWeight={800}
                    color="pitch.500"
                    lineHeight="1"
                >
                    {n}.
                </Text>
                <Heading
                    fontFamily="heading"
                    fontSize={{ base: "20px", md: "24px" }}
                    fontWeight={700}
                    letterSpacing="-0.02em"
                    color="fg.ink"
                >
                    {title}
                </Heading>
            </HStack>
            <Text fontSize="14.5px" color="fg.muted" maxW="620px" mb="4" lineHeight="1.6">
                {intro}
            </Text>
            {children}
        </Box>
    )
}

/** Small card in the hero's "Brzi pregled" side panel. */
function QuickCard({ icon, title, sub }: { icon: ElementType; title: string; sub: string }) {
    return (
        <HStack
            gap="3"
            bg="rgba(255,255,255,0.08)"
            borderWidth="1px"
            borderColor="rgba(255,255,255,0.14)"
            rounded="lg"
            px="3.5"
            py="3"
            align="center"
        >
            <Icon as={icon} boxSize="5" color="rgba(255,255,255,0.9)" flexShrink={0} />
            <Box minW="0">
                <Text fontSize="13.5px" fontWeight={700} color="white" lineHeight="1.25">
                    {title}
                </Text>
                <Text fontSize="12px" color="rgba(255,255,255,0.65)" lineHeight="1.35">
                    {sub}
                </Text>
            </Box>
        </HStack>
    )
}

export default function GuidePage() {
    const navigate = useNavigate()
    useDocumentHead({
        title: "Što nudimo - Futsal Turniri",
        description:
            "Sve što trebaš za futsal turnir na jednom mjestu: kreiranje, ždrijeb, raspored, vođenje uživo, rezultati, statistika, obavijesti i dijeljenje.",
    })

    return (
        <VStack align="stretch" gap="12" pb="4">
            {/* ── Hero ─────────────────────────────────────────────────── */}
            <Box
                position="relative"
                rounded="2xl"
                overflow="hidden"
                color="white"
                bgImage="linear-gradient(135deg, #0b6b3a, #084a28)"
            >
                <PitchBackdrop opacity={0.15} variant="guide-hero" tone="pitch" />
                <Grid
                    position="relative"
                    templateColumns={{ base: "1fr", lg: "1.2fr 1fr" }}
                    gap={{ base: 8, lg: 10 }}
                    px={{ base: 6, md: 12 }}
                    py={{ base: 10, md: 14 }}
                    alignItems="center"
                >
                    {/* Left: copy + CTAs */}
                    <Box>
                        <HStack
                            gap="1.5"
                            bg="rgba(255,255,255,0.12)"
                            borderWidth="1px"
                            borderColor="rgba(255,255,255,0.2)"
                            rounded="full"
                            px="3"
                            py="1"
                            w="fit-content"
                        >
                            <Icon as={LuSparkles} boxSize="3.5" />
                            <Text fontSize="12px" fontWeight={700} letterSpacing="0.04em">
                                Što nudimo?
                            </Text>
                        </HStack>
                        <Heading
                            fontFamily="heading"
                            fontSize={{ base: "30px", md: "44px" }}
                            fontWeight={800}
                            letterSpacing="-0.02em"
                            lineHeight="1.08"
                            mt="4"
                            mb="4"
                        >
                            Cijeli futsal turnir -{" "}
                            <Box as="span" color="#ffd54a">
                                od prijava do pehara
                            </Box>{" "}
                            - na jednom mjestu
                        </Heading>
                        <Text
                            fontSize={{ base: "15px", md: "17px" }}
                            color="rgba(255,255,255,0.85)"
                            maxW="560px"
                            lineHeight="1.6"
                        >
                            Kreiraj turnir, izvuci ždrijeb, generiraj raspored i vodi utakmice
                            uživo - a rezultati, tablice i statistika ažuriraju se sami, u
                            stvarnom vremenu.
                        </Text>
                        <HStack gap="3" mt="7" wrap="wrap">
                            <PrimaryButton icon={<LuTrophy size={16} />} onClick={() => navigate("/turniri/novi")}>
                                Kreiraj turnir
                            </PrimaryButton>
                            <GhostButton
                                icon={<LuRadioTower size={15} />}
                                onClick={() => navigate("/uzivo")}
                                css={{
                                    color: "#fff",
                                    borderColor: "rgba(255,255,255,0.35)",
                                    background: "rgba(255,255,255,0.08)",
                                }}
                            >
                                Pogledaj uživo
                            </GhostButton>
                        </HStack>
                    </Box>

                    {/* Right: quick-overview panel */}
                    <Box
                        bg="rgba(0,0,0,0.18)"
                        borderWidth="1px"
                        borderColor="rgba(255,255,255,0.14)"
                        rounded="xl"
                        p="4"
                    >
                        <MonoLabel color="rgba(255,255,255,0.65)" letterSpacing="0.16em" mb="3" display="block">
                            BRZI PREGLED
                        </MonoLabel>
                        <VStack align="stretch" gap="2.5">
                            <QuickCard icon={LuShuffle} title="Ždrijeb" sub="Automatski ili ručni - grupe i eliminacija" />
                            <QuickCard icon={LuTimer} title="Utakmice uživo" sub="Mjerač, golovi, kartoni, prekršaji, penali" />
                            <QuickCard icon={LuChartColumn} title="Tablice i statistika" sub="Poredak, strijelci, bracket - sve samo" />
                            <QuickCard icon={LuBellRing} title="Obavijesti" sub="Push za početak, gol i kraj utakmice" />
                        </VStack>
                    </Box>
                </Grid>
            </Box>

            {/* ── 1. Priprema ──────────────────────────────────────────── */}
            <Chapter
                n={1}
                title="Kreiranje i priprema"
                intro="Sve kreće od turnira: uneseš osnovne podatke, dodaš ekipe i igrače - i spreman si za ždrijeb."
            >
                <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr", lg: "repeat(3, 1fr)" }} gap="4">
                    <FeatureCard f={{ icon: LuTrophy, title: "Novi turnir u par minuta", desc: "Naziv, lokacija, termin, kotizacija i nagrade. Format po želji: grupe + eliminacija ili samo eliminacija." }} />
                    <FeatureCard f={{ icon: LuUsers, title: "Ekipe i sastavi", desc: "Dodaj ekipe i igrače s brojevima. Ekipa može preuzeti svoj profil i sama urediti sastav putem linka." }} />
                    <FeatureCard f={{ icon: LuShuffle, title: "Ždrijeb po tvojim pravilima", desc: "Nasumičan ili ručni ždrijeb. Odredi broj grupa, koliko prolazi dalje i tko ide direktno u sljedeće kolo." }} />
                </Grid>
            </Chapter>

            {/* ── 2. Raspored ──────────────────────────────────────────── */}
            <Chapter
                n={2}
                title="Raspored bez ručnog računanja"
                intro="Odaberi trajanje poluvremena i pauze - termini svih utakmica izračunaju se sami."
            >
                <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr", lg: "repeat(3, 1fr)" }} gap="4">
                    <FeatureCard f={{ icon: LuCalendarClock, title: "Automatski termini", desc: "Satnica za cijeli turnir jednim klikom - grupe pa eliminacija, redom po terenu." }} />
                    <FeatureCard f={{ icon: LuMove, title: "Povuci i ispravi", desc: "Preslaguj utakmice drag & drop-om (radi i na mobitelu) - satnica se sama preračuna." }} />
                    <FeatureCard f={{ icon: LuListOrdered, title: "Kalendar za ekipe", desc: "Svaka utakmica ima 'Dodaj u kalendar' - igrači dobiju termin u svoj mobitel." }} />
                </Grid>
            </Chapter>

            {/* ── 3. Uživo ─────────────────────────────────────────────── */}
            <Chapter
                n={3}
                title="Vođenje utakmica uživo"
                intro="Zapisnik na mobitelu umjesto papira: sve što upišeš odmah vide svi - kod kuće, u dvorani i na velikom ekranu."
            >
                <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr", lg: "repeat(3, 1fr)" }} gap="4">
                    <FeatureCard f={{ icon: LuTimer, title: "Mjerač po poluvremenima", desc: "1. poluvrijeme → pauza → 2. poluvrijeme → kraj. Sat se zaustavlja na isteku i čeka tebe." }} />
                    <FeatureCard f={{ icon: LuRadioTower, title: "Golovi i događaji", desc: "Gol jednim dodirom na igrača - minuta se upiše sama. Žuti/crveni kartoni, prekršaji (deveterac) i penali." }} />
                    <FeatureCard f={{ icon: LuMonitorPlay, title: "TV / semafor prikaz", desc: "Fullscreen semafor za dvoranu: veliki rezultat, mjerač, prekršaji i strijelci - uživo." }} />
                </Grid>
            </Chapter>

            {/* ── 4. Rezultati i statistika ────────────────────────────── */}
            <Chapter
                n={4}
                title="Rezultati, tablice i statistika"
                intro="Nakon svakog sudačkog zvižduka sve je već izračunato - bez Excela i ručnog zbrajanja."
            >
                <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr", lg: "repeat(3, 1fr)" }} gap="4">
                    <FeatureCard f={{ icon: LuChartColumn, title: "Tablice i bracket", desc: "Poredak grupa (bodovi, razlika, međusobni), eliminacijski bracket i tijek svake utakmice." }} />
                    <FeatureCard f={{ icon: LuBellRing, title: "Obavijesti (zvonce)", desc: "Prati turnir ili utakmicu - push obavijest kad počne, kad padne gol i kad završi." }} />
                    <FeatureCard f={{ icon: LuMap, title: "Karta i pretraga", desc: "Svi turniri na karti - filtriraj po blizini, datumu i kotizaciji. Statistika strijelaca kroz sve turnire." }} />
                </Grid>
            </Chapter>

            {/* ── 5. Dijeljenje ────────────────────────────────────────── */}
            <Chapter
                n={5}
                title="Dijeljenje i promocija"
                intro="Neka se za turnir čuje: sve je spremno za objavu i ugradnju gdje god trebaš."
            >
                <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr", lg: "repeat(3, 1fr)" }} gap="4">
                    <FeatureCard f={{ icon: LuQrCode, title: "QR kod i plakat", desc: "Isprintaj QR kod dvorane - gledatelji skeniraju i prate rezultate. Plakat turnira uz jedan klik." }} />
                    <FeatureCard f={{ icon: LuShare2, title: "Podijeli i ugradi", desc: "Podijeli bracket kao sliku ili ugradi rezultate (embed) u klupsku stranicu ili portal." }} />
                    <FeatureCard f={{ icon: LuDownload, title: "Instaliraj kao aplikaciju", desc: "Dodaj na početni zaslon (iPhone i Android) i koristi kao pravu aplikaciju." }} />
                </Grid>
            </Chapter>

            {/* ── Final CTA ────────────────────────────────────────────── */}
            <Box
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border"
                rounded="2xl"
                px={{ base: 5, md: 10 }}
                py={{ base: 8, md: 10 }}
                textAlign="center"
            >
                <Heading
                    fontFamily="heading"
                    fontSize={{ base: "22px", md: "28px" }}
                    fontWeight={800}
                    letterSpacing="-0.02em"
                    color="fg.ink"
                >
                    Spreman za turnir bez stresa?
                </Heading>
                <Text fontSize="15px" color="fg.muted" maxW="480px" mx="auto" mt="2">
                    Besplatno je i traje par minuta - ostalo aplikacija odradi za tebe.
                </Text>
                <HStack gap="3" wrap="wrap" justify="center" mt="6">
                    <PrimaryButton icon={<LuTrophy size={16} />} onClick={() => navigate("/turniri/novi")}>
                        Kreiraj turnir
                    </PrimaryButton>
                    <GhostButton icon={<FiArrowRight size={15} />} onClick={() => navigate("/turniri")}>
                        Pregledaj turnire
                    </GhostButton>
                </HStack>
            </Box>
        </VStack>
    )
}
