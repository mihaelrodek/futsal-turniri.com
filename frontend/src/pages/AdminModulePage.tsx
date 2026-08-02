import { Box, Button, Flex, Heading } from "@chakra-ui/react"
import { FiAlertCircle } from "react-icons/fi"
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom"

import { findAdminModule } from "../admin/modules"
import { useTranslation } from "../i18n"
import { EmptyState, IconChip } from "../ui/primitives"
import { BackLink } from "../ui/pitch"

/* ──────────────────────────────────────────────────────────────────────────
   AdminModulePage - /admin/{slug}. Resolves the slug against the module
   registry and mounts that module's own screen unchanged; it owns only the
   chrome (back link + header). No admin logic lives here.
   ────────────────────────────────────────────────────────────────────── */

export default function AdminModulePage() {
    const t = useTranslation()
    const navigate = useNavigate()
    const { slug } = useParams<{ slug: string }>()

    const copy = t.pages.adminConsole
    const module = findAdminModule(slug)

    // BackLink is a <button>, not an anchor - it needs the navigation handler.
    const goBack = () => navigate("/admin")

    if (!module) {
        return (
            <Box>
                <BackLink to="/admin" onClick={goBack} label={copy.backToDashboard} />
                <EmptyState
                    icon={FiAlertCircle}
                    title={copy.notFound}
                    action={
                        <Button asChild size="sm" variant="outline" colorPalette="pitch">
                            <RouterLink to="/admin">{copy.backToDashboard}</RouterLink>
                        </Button>
                    }
                />
            </Box>
        )
    }

    const label = copy.modules[module.key]

    return (
        <Box>
            <BackLink to="/admin" onClick={goBack} label={copy.backToDashboard} />
            {/* Title only. The module's own screen no longer repeats it, and
                the one-line description belongs on the dashboard card, where
                it helps someone CHOOSE a module - not here, where they already
                did and know what the screen does. */}
            <Flex align="center" gap="3" mb="4" minW="0">
                <IconChip icon={module.icon} size="11" iconSize="5" />
                <Heading as="h1" size="lg" lineHeight="1.2" letterSpacing="-0.02em" color="fg.ink" minW="0">
                    {label.title}
                </Heading>
            </Flex>
            {module.render()}
        </Box>
    )
}
