import { Box, Heading, Link, Text, VStack } from "@chakra-ui/react"
import { PageTitle } from "../ui/pitch"
import { useDocumentHead } from "../hooks/useDocumentHead"

/* ──────────────────────────────────────────────────────────────────────────
   PrivacyPage - "Pravila privatnosti" (/privatnost).

   Plain content page covering the basics a public EU/HR site with login +
   push notifications should disclose (GDPR). This is a sensible template -
   review/adjust the wording (especially the contact + data-controller
   details) for your exact setup before relying on it legally.
   ────────────────────────────────────────────────────────────────────── */

const CONTACT_EMAIL = "mihael.rodek1@gmail.com"
const LAST_UPDATED = "23. lipnja 2026."

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <Box>
            <Heading
                as="h2"
                fontFamily="heading"
                fontSize="18px"
                fontWeight={700}
                letterSpacing="-0.01em"
                color="fg.ink"
                mb="2"
            >
                {title}
            </Heading>
            <VStack align="stretch" gap="2" color="fg.muted" fontSize="sm" lineHeight="1.6">
                {children}
            </VStack>
        </Box>
    )
}

export default function PrivacyPage() {
    useDocumentHead({
        title: "Pravila privatnosti - futsal-turniri.com",
        description:
            "Kako futsal-turniri.com prikuplja i obrađuje osobne podatke - prijava, turniri, obavijesti i prava korisnika.",
        canonical: "https://futsal-turniri.com/privatnost",
    })

    return (
        <VStack align="stretch" gap="6" maxW="760px" mx="auto" pb="8">
            <PageTitle
                kicker="PRAVNO"
                title="Pravila privatnosti"
                subtitle={`Zadnje ažurirano: ${LAST_UPDATED}`}
            />

            <Section title="1. Voditelj obrade">
                <Text>
                    Voditelj obrade osobnih podataka je Mihael Rodek (privatni
                    projekt futsal-turniri.com). Za sva pitanja o privatnosti
                    kontaktiraj{" "}
                    <Link href={`mailto:${CONTACT_EMAIL}`} color="pitch.600" fontWeight={600}>
                        {CONTACT_EMAIL}
                    </Link>
                    .
                </Text>
            </Section>

            <Section title="2. Koje podatke prikupljamo">
                <Text>• <b>Prijava:</b> ime, e-mail adresa i profilna slika(ako ju uneseš).</Text>
                <Text>• <b>Profil:</b> prikazno ime i, ako ga sam upišeš, broj telefona.</Text>
                <Text>• <b>Sadržaj turnira:</b> nazivi turnira, ekipa i igrača, rezultati, rasporedi te plakati/slike koje učitaš.</Text>
                <Text>• <b>Obavijesti (push):</b> tehnički identifikator tvog preglednika za slanje obavijesti - samo ako ih izričito odobriš.</Text>
                <Text>• <b>Tehnički podaci:</b> IP adresa i zapisi poslužitelja, nužni za rad i sigurnost stranice.</Text>
            </Section>

            <Section title="3. Svrha i pravna osnova">
                <Text>
                    Podatke obrađujemo radi pružanja usluge (organizacija i
                    praćenje futsal turnira) - pravna osnova je izvršenje
                    usluge koju koristiš. Push obavijesti se šalju isključivo
                    na temelju tvoje privole, koju u svakom trenutku možeš
                    povući isključivanjem obavijesti.
                </Text>
            </Section>

            <Section title="5. Kolačići i lokalna pohrana">
                <Text>
                    Koristimo isključivo <b>nužnu</b> lokalnu pohranu preglednika
                    za održavanje prijave i tvojih postavki (npr. tema). Ne
                    koristimo reklamne kolačiće niti alate za praćenje.
                </Text>
            </Section>

            <Section title="5. Koliko dugo čuvamo podatke">
                <Text>
                    Podatke čuvamo dok imaš aktivan račun ili dok su potrebni za
                    prikaz povijesti turnira. Na zahtjev brišemo tvoje osobne
                    podatke (osim onih koje smo dužni zadržati po zakonu).
                </Text>
            </Section>

            <Section title="6. Tvoja prava">
                <Text>
                    Imaš pravo na pristup, ispravak, brisanje i ograničenje
                    obrade svojih podataka te pravo na prigovor. Za ostvarivanje
                    bilo kojeg prava javi se na{" "}
                    <Link href={`mailto:${CONTACT_EMAIL}`} color="pitch.600" fontWeight={600}>
                        {CONTACT_EMAIL}
                    </Link>
                    . Također imaš pravo podnijeti pritužbu Agenciji za zaštitu
                    osobnih podataka (AZOP).
                </Text>
            </Section>

            <Section title="7. Izmjene ovih pravila">
                <Text>
                    Pravila se mogu povremeno ažurirati. Datum zadnje izmjene
                    naveden je na vrhu stranice.
                </Text>
            </Section>
        </VStack>
    )
}
