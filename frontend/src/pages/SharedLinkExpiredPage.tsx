import NotFoundView from "../components/NotFoundView"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { useTranslation } from "../i18n"

/**
 * Landing page for a dead permanent share link: the admin's
 * /match-recordings/share/{token} redirects here once the token has aged
 * past its 48h window (see MatchRecordingController#share) instead of
 * showing MinIO a raw 404 - the link was pasted straight into an email or
 * chat and opened directly in a browser, so a real page beats JSON.
 */
export default function SharedLinkExpiredPage() {
    const t = useTranslation()
    useDocumentHead({
        title: t.pages.sharedLinkExpiredPage.documentTitle,
        description: t.pages.sharedLinkExpiredPage.documentDescription,
    })
    return (
        <NotFoundView
            code="410"
            title={t.pages.sharedLinkExpiredPage.title}
            description={t.pages.sharedLinkExpiredPage.description}
        />
    )
}
