import { Box, Heading, Link, Text, VStack } from "@chakra-ui/react"
import { PageTitle } from "../ui/pitch"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   PrivacyPage - "Pravila privatnosti" (/privatnost).

   Plain content page covering the basics a public EU/HR site with login +
   push notifications should disclose (GDPR). This is a sensible template -
   review/adjust the wording (especially the contact + data-controller
   details) for your exact setup before relying on it legally.
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

export default function PrivacyPage() {
    const t = useTranslation()
    const p = t.pages.privacyPage

    useDocumentHead({
        title: p.documentTitle,
        description: p.documentDescription,
        canonical: "https://futsal-turniri.com/privatnost",
    })

    return (
        <VStack align="stretch" gap="6" maxW="760px" mx="auto" pb="8">
            <PageTitle
                kicker={p.kicker}
                title={p.title}
                subtitle={`${p.lastUpdatedPrefix} ${p.lastUpdatedDate}`}
            />

            <Section title={p.dataControllerHeading}>
                <Text>
                    {p.dataControllerBody}{" "}
                    <Link href={`mailto:${CONTACT_EMAIL}`} color="pitch.600" fontWeight={600}>
                        {CONTACT_EMAIL}
                    </Link>
                    .
                </Text>
            </Section>

            <Section title={p.dataCollectedHeading}>
                <Text>
                    • <b>{p.dataCollectedLoginLabel}</b> {p.dataCollectedLoginText}
                </Text>
                <Text>
                    • <b>{p.dataCollectedProfileLabel}</b> {p.dataCollectedProfileText}
                </Text>
                <Text>
                    • <b>{p.dataCollectedContentLabel}</b> {p.dataCollectedContentText}
                </Text>
                <Text>
                    • <b>{p.dataCollectedNotificationsLabel}</b> {p.dataCollectedNotificationsText}
                </Text>
                <Text>
                    • <b>{p.dataCollectedTechnicalLabel}</b> {p.dataCollectedTechnicalText}
                </Text>
            </Section>

            <Section title={p.purposeHeading}>
                <Text>{p.purposeBody}</Text>
            </Section>

            <Section title={p.cookiesHeading}>
                <Text>
                    {p.cookiesBodyBefore} <b>{p.cookiesBodyBold}</b> {p.cookiesBodyAfter}
                </Text>
            </Section>

            <Section title={p.retentionHeading}>
                <Text>{p.retentionBody}</Text>
            </Section>

            <Section title={p.rightsHeading}>
                <Text>
                    {p.rightsBodyBeforeLink}{" "}
                    <Link href={`mailto:${CONTACT_EMAIL}`} color="pitch.600" fontWeight={600}>
                        {CONTACT_EMAIL}
                    </Link>
                    {p.rightsBodyAfterLink}
                </Text>
            </Section>

            <Section title={p.changesHeading}>
                <Text>{p.changesBody}</Text>
            </Section>
        </VStack>
    )
}
