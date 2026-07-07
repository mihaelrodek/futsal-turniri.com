/* ──────────────────────────────────────────────────────────────────────────
   Same-site path allowlist for `?next=` (and `state.from`) handoffs.

   Used by `LoginPage` / `RegisterPage` / `RequireAuth` to decide whether
   the redirect-after-login target is safe to navigate to. An attacker
   who can craft a URL like
       https://futsal-turniri.com/prijava?next=//evil.tld/phish
   would, without this guard, get the user dumped onto attacker-controlled
   origin after a real login on our domain. React-router historically
   accepted `//host`, `\\host`, backslash variants, and even `javascript:`
   URIs in `navigate()` - combined with several published advisories in
   the 7.0.0–7.14.2 range - so we treat any non-trivial input as suspect
   and fall back to a known-good route.

   Accepted shapes:
     • An empty string / null → no redirect
     • A leading "/" path on our SAME origin, with no protocol injection,
       no protocol-relative prefix, and no backslash trick.

   Rejected:
     • Absolute URLs (`http://...`, `https://...`)
     • Protocol-relative URLs (`//evil.tld/...`)
     • Backslash variants Windows / IE / WebKit normalise to host changes
       (`/\\evil.tld`, `\\evil.tld`)
     • Dangerous schemes (`javascript:`, `data:`, `vbscript:`, mailto:` -
       any colon before the first `/`)
     • Bare-host shapes (`evil.tld/foo`) - we want `/foo` style only
   ────────────────────────────────────────────────────────────────────── */

export function isSafeNextPath(raw: string | null | undefined): boolean {
    if (!raw || typeof raw !== "string") return false
    if (raw.length > 2048) return false // reject pathological inputs
    // Must be a path on our origin - i.e. start with a single "/" and
    // NOT be a protocol-relative or backslash-escaped host.
    if (!raw.startsWith("/")) return false
    if (raw.startsWith("//")) return false        // //evil.tld/...
    if (raw.startsWith("/\\")) return false       // /\evil.tld → /\/evil.tld
    if (raw.startsWith("/%2f") || raw.startsWith("/%2F")) return false
    if (raw.startsWith("/%5c") || raw.startsWith("/%5C")) return false
    // A colon before any "/" past index 0 indicates a scheme (javascript:,
    // data:, etc.) sneaking in via path encoding tricks. Reject.
    const firstSlash = raw.indexOf("/", 1)
    const firstColon = raw.indexOf(":")
    if (firstColon !== -1 && (firstSlash === -1 || firstColon < firstSlash)) {
        return false
    }
    // No literal CR / LF - header-injection territory.
    if (/[\r\n]/.test(raw)) return false
    return true
}

/** Pick the first safe candidate from the provided list (typically the
 *  `?next=` query, then a navigation-state `from`), falling back to
 *  the supplied default route. */
export function pickSafeNext(
    candidates: Array<string | null | undefined>,
    fallback: string,
): string {
    for (const c of candidates) {
        if (isSafeNextPath(c)) return c as string
    }
    return fallback
}
