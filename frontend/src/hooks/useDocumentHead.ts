import { useEffect } from "react"

/**
 * Accept only safe image URLs for `og:image` / JSON-LD `image` injection.
 * The value usually comes from a backend banner URL, but in case a
 * malicious or hand-edited row sneaks in a `javascript:` or `data:` URI
 * we silently drop the meta rather than risk a downstream aggregator
 * following it. Accepts: `https://…`, `http://…` (legacy), `/relative`.
 */
function isSafeImageUrl(raw: string): boolean {
    if (!raw || typeof raw !== "string") return false
    const trimmed = raw.trim()
    if (!trimmed) return false
    if (trimmed.startsWith("/")) return !trimmed.startsWith("//")
    return /^https?:\/\//i.test(trimmed)
}

/**
 * Per-route document.title + <meta> updater.
 *
 * Why this exists:
 *   - The app is a client-side SPA. Without a hook like this, every URL
 *     ships the same <title> and <meta description> from index.html, which
 *     hurts SEO badly for tournament and profile pages.
 *   - True SEO for SPAs needs SSR or build-time prerendering. JS-aware
 *     crawlers (Googlebot, Bing) do pick up these client-side updates
 *     reliably; non-JS crawlers (Slack/WhatsApp/Facebook link-preview bots)
 *     will still see the static index.html. For full link-preview support,
 *     introduce a server-side render path (Vike, vite-plugin-prerender,
 *     or a User-Agent-aware proxy in front of the SPA).
 *
 * Usage:
 *   useDocumentHead({
 *     title: "Zimska Futsal Liga, Zagreb — nogometni-turniri.com",
 *     description: "...",
 *     ogTitle: "Zimska Futsal Liga, Zagreb",
 *     ogImage: "https://...",
 *     canonical: "https://nogometni-turniri.com/turniri/abc",
 *   })
 */
export type DocumentHead = {
    title?: string
    description?: string
    ogTitle?: string
    ogDescription?: string
    ogImage?: string
    ogType?: string
    canonical?: string
    /**
     * Open Graph canonical URL for the page. Defaults to the same value
     * as {@link canonical} when omitted — they're nearly always the same.
     * Set explicitly only when you need them to differ.
     */
    ogUrl?: string
    /**
     * Per-route schema.org JSON-LD. Pass a single object or an array of
     * objects (e.g. Event + BreadcrumbList for a tournament page). They
     * are injected as {@code <script type="application/ld+json"
     * data-futsal-jsonld="route">} into the document head and removed
     * automatically when the component unmounts.
     *
     * <p>Pair this with the matching backend SSR preview controller for
     * a belt-and-braces SEO setup: the controller serves non-JS crawlers
     * (WhatsApp, Slack, Facebook), this hook serves Googlebot rendering
     * the SPA. The two emit the same schema so Search Console doesn't
     * see conflicting structured data between rendered and unrendered
     * variants.
     */
    jsonLd?: object | object[]
}

// Tab title is intentionally identical for every route. Per-page titles
// fragmented the browser-tab UX (long noisy strings, language-specific
// suffixes) for no real SEO win — JS-aware crawlers still pick up
// per-page <meta> + og:title below, which is what actually drives search
// snippets and WhatsApp/Slack link previews.
const STATIC_TITLE = "Futsal turniri"
const DEFAULT_DESCRIPTION =
    "Futsal turniri — organiziraj i prati Futsal turnire. Pretraži nadolazeće turnire, pridruži se ekipi i prati rezultate."

export function useDocumentHead(head: DocumentHead) {
    useEffect(() => {
        const previousMeta = snapshotMeta()
        const previousCanonical = currentCanonical()

        // Force the static title regardless of what the caller passed —
        // see STATIC_TITLE comment above. We deliberately ignore head.title.
        document.title = STATIC_TITLE
        if (head.description) setMeta("name", "description", head.description)
        if (head.ogTitle) setMeta("property", "og:title", head.ogTitle)
        if (head.ogDescription) setMeta("property", "og:description", head.ogDescription)
        // og:image is fed from backend-supplied tournament banner URLs.
        // While our content-type chain is locked down, we don't want a
        // mis-stored or hand-edited row to inject a `javascript:` /
        // `data:` URL that some downstream aggregator might follow.
        // Limit to absolute https:// / http:// or same-origin paths.
        if (head.ogImage && isSafeImageUrl(head.ogImage)) {
            setMeta("property", "og:image", head.ogImage)
        }
        if (head.ogType) setMeta("property", "og:type", head.ogType)
        if (head.canonical) setCanonical(head.canonical)
        // og:url defaults to the canonical when not explicitly set —
        // they're the same thing on every page we care about. Facebook's
        // scraper flags missing og:url as a required-property warning.
        const ogUrl = head.ogUrl ?? head.canonical
        if (ogUrl) setMeta("property", "og:url", ogUrl)

        // JSON-LD: inject one or more <script type="application/ld+json">
        // blocks tagged with data-futsal-jsonld="route" so we can remove
        // exactly our injected nodes on unmount without disturbing the
        // site-level WebSite/Organization records baked into index.html.
        const jsonLdItems = head.jsonLd
            ? Array.isArray(head.jsonLd) ? head.jsonLd : [head.jsonLd]
            : []
        for (const item of jsonLdItems) appendJsonLd(item)

        // On unmount: restore the meta + canonical the next route may want
        // to reset, but keep the title pinned to STATIC_TITLE — there's
        // nothing to "restore" because every route already wants it.
        return () => {
            document.title = STATIC_TITLE
            restoreMeta(previousMeta)
            restoreCanonical(previousCanonical)
            removeRouteJsonLd()
        }
    }, [
        head.description,
        head.ogTitle,
        head.ogDescription,
        head.ogImage,
        head.ogType,
        head.canonical,
        // Stringify the JSON-LD for the dep array — comparing object
        // references would re-run the effect on every render whenever
        // the caller builds a fresh literal each time, which is the
        // common pattern in our pages. Serialising once per render is
        // cheap; the alternative is making every caller memoise it.
        JSON.stringify(head.jsonLd ?? null),
    ])
}

/* ───────────────────── helpers ───────────────────── */

type MetaSnapshot = Record<string, string | null>

function setMeta(attr: "name" | "property", key: string, value: string) {
    let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
    if (!el) {
        el = document.createElement("meta")
        el.setAttribute(attr, key)
        document.head.appendChild(el)
    }
    el.setAttribute("content", value)
}

function snapshotMeta(): MetaSnapshot {
    const keys: Array<[string, string]> = [
        ["name", "description"],
        ["property", "og:title"],
        ["property", "og:description"],
        ["property", "og:image"],
        ["property", "og:type"],
        ["property", "og:url"],
    ]
    const snap: MetaSnapshot = {}
    for (const [attr, key] of keys) {
        const el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
        snap[`${attr}:${key}`] = el ? el.getAttribute("content") : null
    }
    return snap
}

function restoreMeta(snap: MetaSnapshot) {
    for (const k of Object.keys(snap)) {
        const [attr, key] = k.split(":") as ["name" | "property", string]
        const previousValue = snap[k]
        if (previousValue == null) {
            // Tag didn't exist before — leave whatever we set in place; cheaper
            // than removing/recreating, and the next route that mounts the hook
            // will overwrite it anyway. For the description tag we restore the
            // app-level default so it doesn't leak across routes.
            if (key === "description") setMeta(attr, key, DEFAULT_DESCRIPTION)
            continue
        }
        setMeta(attr, key, previousValue)
    }
    if (!snap["name:description"]) document.title = STATIC_TITLE
}

function currentCanonical(): string | null {
    const el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    return el ? el.getAttribute("href") : null
}

function setCanonical(href: string) {
    let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!el) {
        el = document.createElement("link")
        el.setAttribute("rel", "canonical")
        document.head.appendChild(el)
    }
    el.setAttribute("href", href)
}

/**
 * Append a JSON-LD script element to the document head. Tagged with
 * {@code data-futsal-jsonld="route"} so {@link removeRouteJsonLd} can find
 * and remove it on unmount without touching the site-wide JSON-LD blocks
 * baked into {@code index.html}.
 */
function appendJsonLd(item: object) {
    const el = document.createElement("script")
    el.setAttribute("type", "application/ld+json")
    el.setAttribute("data-futsal-jsonld", "route")
    // Use innerHTML rather than .textContent to keep parity with how the
    // backend renders these blocks; the JSON.stringify output is already
    // safe (no </script> sequences can appear inside a JSON string from
    // typical data, but be defensive anyway and escape the offending
    // forward slash).
    el.textContent = JSON.stringify(item).replace(/<\/(script)/gi, "<\\/$1")
    document.head.appendChild(el)
}

function removeRouteJsonLd() {
    const nodes = document.head.querySelectorAll('script[data-futsal-jsonld="route"]')
    nodes.forEach((n) => n.parentElement?.removeChild(n))
}

function restoreCanonical(previous: string | null) {
    const el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (previous == null) {
        if (el) el.parentElement?.removeChild(el)
        return
    }
    if (!el) {
        const created = document.createElement("link")
        created.setAttribute("rel", "canonical")
        created.setAttribute("href", previous)
        document.head.appendChild(created)
        return
    }
    el.setAttribute("href", previous)
}
