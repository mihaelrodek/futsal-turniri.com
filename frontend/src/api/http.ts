import axios, { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios"
import { auth } from "../firebase"
import { showError, showSuccess, statusFallback } from "../toaster"

const baseURL = import.meta.env.VITE_API_URL ?? "/api"

/**
 * Per-request flag the call sites can set to opt out of automatic toasts.
 * Useful for high-frequency or background reads (profile sync, polling,
 * health checks) where a toast would just be noise.
 *
 * Usage:
 *   http.get("/foo", { silent: true } as any)
 *   http.post("/bar", body, { silent: true } as any)
 */
type ToastOpts = {
    /** When true, neither success nor error toasts are shown for this call. */
    silent?: boolean
    /** Override the success toast title (e.g. "Turnir je kreiran"). */
    successMessage?: string
    /** Override the error toast title (the body message becomes the description). */
    errorMessage?: string
    /**
     * Suppress the auto-generated error toast for certain failures without
     * suppressing success toasts on the happy path. Useful when the caller
     * already shows its own context-aware UI for specific status codes —
     * e.g. starting a tournament returns 409 INSUFFICIENT_TEAMS and the page
     * shows its own error UI; a generic red toast on top would be noise.
     *
     * Pass `true` to silence ALL error toasts for this call, or an array of
     * HTTP status codes to silence only specific ones.
     */
    silentErrorStatuses?: true | number[]
}

declare module "axios" {
    interface AxiosRequestConfig extends ToastOpts {}
    interface InternalAxiosRequestConfig extends ToastOpts {}
}

export const http = axios.create({
    baseURL,
    headers: { "Content-Type": "application/json" },
})

/**
 * Attach the current Firebase ID token (if any) to every outgoing request.
 * The Firebase SDK caches and auto-refreshes the token internally, so calling
 * `getIdToken()` is cheap and always returns a fresh, unexpired JWT.
 *
 * Anonymous traffic (no signed-in user) is left as-is — the backend's permission
 * policies allow GETs without auth and only require it on writes.
 */
http.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const u = auth.currentUser
    if (u) {
        try {
            const token = await u.getIdToken()
            config.headers = config.headers ?? {}
            ;(config.headers as Record<string, string>)["Authorization"] = `Bearer ${token}`
        } catch {
            // Token fetch failed — let the request go without auth header
            // (server will reject with 401 if the endpoint requires auth, which
            // the UI already handles).
        }
    }
    return config
})

/**
 * Mutation methods get success toasts; reads stay quiet to avoid noise.
 * The set is intentional — adding HEAD/OPTIONS would not be useful, and
 * GETs that fail still surface as error toasts via the response interceptor.
 */
const TOAST_ON_SUCCESS = new Set(["post", "put", "patch", "delete"])

/**
 * Pull a human-friendly message out of a backend error response. Quarkus's
 * default error mappers return JSON like {"message": "..."} for many of our
 * thrown exceptions; some (e.g. BadRequestException with a string body) come
 * back as plain text. Cover both shapes plus a generic fallback.
 */
function extractServerMessage(err: AxiosError): string | null {
    const data = err.response?.data as unknown
    if (typeof data === "string" && data.trim()) return data.trim()
    if (data && typeof data === "object") {
        const d = data as Record<string, unknown>
        if (typeof d.message === "string" && d.message.trim()) return d.message.trim()
        if (typeof d.error === "string" && d.error.trim()) return d.error.trim()
        if (typeof d.detail === "string" && d.detail.trim()) return d.detail.trim()
    }
    return null
}

http.interceptors.response.use(
    (resp: AxiosResponse) => {
        const cfg = (resp.config ?? {}) as InternalAxiosRequestConfig
        if (cfg.silent) return resp
        const method = (cfg.method ?? "get").toLowerCase()
        if (TOAST_ON_SUCCESS.has(method)) {
            showSuccess(cfg.successMessage ?? "Spremljeno.")
        }
        return resp
    },
    (err: AxiosError) => {
        const cfg = (err.config ?? {}) as InternalAxiosRequestConfig
        const status = err.response?.status
        const suppress =
            cfg.silent === true
            || cfg.silentErrorStatuses === true
            || (Array.isArray(cfg.silentErrorStatuses)
                && typeof status === "number"
                && cfg.silentErrorStatuses.includes(status))
        if (!suppress) {
            const serverMsg = extractServerMessage(err)
            const fallback = statusFallback(status)
            // Prefer the explicit per-call title when set; else the server's
            // own message; else a status-derived fallback. Description is the
            // server message when we used a per-call title (so both show).
            if (cfg.errorMessage) {
                showError(cfg.errorMessage, serverMsg ?? fallback)
            } else {
                showError(serverMsg ?? fallback)
            }
        }
        return Promise.reject(err)
    },
)
