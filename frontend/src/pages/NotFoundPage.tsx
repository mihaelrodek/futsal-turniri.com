import NotFoundView from "../components/NotFoundView"

/**
 * Catch-all for unmatched URLs. Avoids the React Router default of rendering
 * nothing, which makes typos look like a hard browser error. The actual
 * rendering lives in the shared NotFoundView (also used by detail pages
 * whose entity no longer exists, e.g. a deleted tournament).
 */
export default function NotFoundPage() {
    return <NotFoundView />
}
