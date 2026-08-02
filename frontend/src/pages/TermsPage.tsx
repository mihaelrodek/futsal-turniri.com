import { Box, Heading, Link, Text, VStack } from "@chakra-ui/react"
import { PageTitle } from "../ui/pitch"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   TermsPage - "Uvjeti korištenja" (/uvjeti).

   The copy is a structured list in i18n (`pages.termsPage.sections`) rather
   than fifty flat keys: the sections are pure prose, so a list keeps the three
   dictionaries aligned and lets a section be added without touching this file.

   NOT legal advice. The text is a sensible baseline for a Croatian platform
   that sells digital content (match recordings) - the provider's legal
   details are placeholders and the whole thing should be reviewed by a lawyer
   before it is relied on, especially the refund clause: it is what lets a
   buyer forfeit the 14-day withdrawal right, and that only holds if the buyer
   really does confirm it before the download starts.
   ────────────────────────────────────────────────────────────────────── */

const CONTACT_EMAIL = "mihael.rodek1@gmail.com"

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

export default function TermsPage() {
    const t = useTranslation()
    const p = t.pages.termsPage

    useDocumentHead({
        title: p.documentTitle,
        description: p.documentDescription,
        canonical: "https://futsal-turniri.com/uvjeti",
    })

    return (
        <VStack align="stretch" gap="6" maxW="760px" mx="auto" pb="8">
            <PageTitle
                kicker={p.kicker}
                title={p.title}
                subtitle={`${p.lastUpdatedPrefix} ${p.lastUpdatedDate}`}
            />

            <Text fontSize="sm" color="fg.muted" lineHeight="1.6">
                {p.intro}
            </Text>

            {p.sections.map((section, i) => (
                <Section key={i} title={`${i + 1}. ${section.heading}`}>
                    {section.paragraphs.map((paragraph, j) => (
                        <Text key={j}>{paragraph}</Text>
                    ))}
                </Section>
            ))}

            <Section title={p.contactHeading}>
                <Text>
                    {p.contactBody}{" "}
                    <Link href={`mailto:${CONTACT_EMAIL}`} color="pitch.600" fontWeight={600}>
                        {CONTACT_EMAIL}
                    </Link>
                    .
                </Text>
            </Section>
        </VStack>
    )
}
