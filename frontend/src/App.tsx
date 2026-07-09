import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import { Box, Container, Flex, Spinner, Text } from '@chakra-ui/react'
import NavBar from './components/NavBar'
import Footer from './components/Footer'
import MobileBottomNav from './components/MobileBottomNav'
import PushBootstrap from './components/PushBootstrap'
import ThemeSync from './components/ThemeSync'
import { RequireAuth } from "./components/RequireAuth"

/* ──────────────────────────────────────────────────────────────────────────
   Eager imports - small components on the critical path. Login/register
   and the tournaments list need to render on the very first paint.
   ────────────────────────────────────────────────────────────────────── */
import TournamentsPage from './pages/TournamentsPage'
import LoginPage from "./pages/LoginPage"
import RegisterPage from "./pages/RegisterPage"
import NotFoundPage from "./pages/NotFoundPage"

/* ──────────────────────────────────────────────────────────────────────────
   Lazy-loaded routes. These either pull in big deps (Leaflet on /karta,
   the bracket library inside TournamentDetailsPage) or are only ever
   needed deep in a flow (CreateTournamentPage, FullscreenTournamentPage
   in a separate tab). Splitting them shaves ~30% off the initial
   bundle so first-paint on mobile 4G is faster.
   ────────────────────────────────────────────────────────────────────── */
const CreateTournamentPage = lazy(() => import('./pages/CreateTournamentPage'))
const TournamentDetailsPage = lazy(() => import('./pages/TournamentDetailsPage'))
const FullscreenTournamentPage = lazy(() => import('./pages/FullscreenTournamentPage'))
const MatchLivePage = lazy(() => import('./pages/MatchLivePage'))
const FindTeamPage = lazy(() => import('./pages/FindTeamPage'))
const LivePage = lazy(() => import('./pages/LivePage'))
const MapPage = lazy(() => import('./pages/MapPage'))
const StatsPage = lazy(() => import('./pages/StatsPage'))
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'))
const GuidePage = lazy(() => import('./pages/GuidePage'))
const ProfileRedirect = lazy(() => import('./pages/ProfileRedirect'))
const PublicProfilePage = lazy(() => import('./pages/PublicProfilePage'))
const ClaimTeamPage = lazy(() => import('./pages/ClaimTeamPage'))
const ClaimNamePage = lazy(() => import('./pages/ClaimNamePage'))
const EmbedTournamentPage = lazy(() => import('./pages/EmbedTournamentPage'))

/** Suspense fallback while a route chunk is being fetched. Sized to
 *  the main content area so the page doesn't jump when the real page
 *  finally mounts. */
function RouteLoading() {
    return (
        <Flex direction="column" align="center" justify="center" py="20" gap="3">
            <Spinner size="lg" color="pitch.500" />
            <Text fontSize="sm" color="fg.muted">Učitavanje…</Text>
        </Flex>
    )
}

/**
 * Legacy English-alias redirects. We can't use <Navigate to="/turniri/:uuid">
 * because react-router doesn't expand path params on Navigate destinations
 * - :uuid would be taken literally. These small components pull the param
 * out of the current URL and forward it to the Croatian canonical path,
 * preserving the query string (?bill=, ?match=, ?next=) which push
 * notifications and OAuth back-links rely on.
 *
 * Servers also handle this via 301 in Caddy; these wrappers exist for the
 * edge case of an in-app <Link to="/profile/..."> that snuck past the
 * codemod, or a typed URL inside the already-loaded SPA where the
 * server-side rule never fires.
 */
function LegacyTournamentRedirect() {
    const { uuid } = useParams()
    const { search } = useLocation()
    return <Navigate to={`/turniri/${uuid ?? ""}${search}`} replace />
}
function LegacyProfileRedirect() {
    const { slug } = useParams()
    const { search } = useLocation()
    return <Navigate to={`/profil/${slug ?? ""}${search}`} replace />
}
function LegacyClaimTeamRedirect() {
    const { token } = useParams()
    const { search } = useLocation()
    return <Navigate to={`/preuzmi-ekipu/${token ?? ""}${search}`} replace />
}
function LegacyClaimNameRedirect() {
    const { token } = useParams()
    const { search } = useLocation()
    return <Navigate to={`/preuzmi-ime/${token ?? ""}${search}`} replace />
}

export default function App() {
    // Embed routes are chrome-less - no nav, no container, no padding.
    // They're meant to be iframed into 3rd-party websites and inherit
    // the host page's background.
    const { pathname } = useLocation()

    // Warm the heaviest "next click" chunk while the browser is idle. From
    // the tournaments list the overwhelmingly common navigation is into a
    // tournament's detail page, so we prefetch that lazy chunk after first
    // paint - opening a tournament then feels instant. Skipped for embeds.
    useEffect(() => {
        if (pathname.startsWith("/embed/")) return
        const prefetch = () => {
            import("./pages/TournamentDetailsPage").catch(() => {})
        }
        const ric = (window as any).requestIdleCallback
        const id = ric ? ric(prefetch, { timeout: 3000 }) : window.setTimeout(prefetch, 1500)
        return () => {
            const cic = (window as any).cancelIdleCallback
            if (ric && cic) cic(id)
            else clearTimeout(id)
        }
    }, [pathname])

    if (pathname.startsWith("/embed/")) {
        return (
            <Suspense fallback={<RouteLoading />}>
                <Routes>
                    <Route
                        path="/embed/turnir/:uuid"
                        element={<EmbedTournamentPage />}
                    />
                </Routes>
            </Suspense>
        )
    }

    // The single-match live page gets its own full-height frame: the app nav
    // stays put (top NavBar on web, bottom nav on mobile), the match header is
    // pinned, and ONLY the timeline scrolls - the page itself never scrolls.
    if (/^\/turniri\/[^/]+\/utakmica\/[^/]+$/.test(pathname)) {
        return (
            <Flex direction="column" h="100dvh" overflow="hidden" bg="bg.canvas">
                <NavBar />
                <PushBootstrap />
                <ThemeSync />
                <Box
                    flex="1"
                    minH="0"
                    overflow="hidden"
                    // Clear the fixed mobile bottom nav (matches the app's <main>
                    // padding); no-op on desktop where there's no bottom bar.
                    pb={{ base: "calc(92px + env(safe-area-inset-bottom, 0px))", md: "0" }}
                >
                    <Suspense fallback={<RouteLoading />}>
                        <Routes>
                            <Route path="/turniri/:uuid/utakmica/:matchId" element={<MatchLivePage />} />
                            <Route path="*" element={<Navigate to="/turniri" replace />} />
                        </Routes>
                    </Suspense>
                </Box>
                <MobileBottomNav />
            </Flex>
        )
    }

    return (
        <>
            <NavBar />
            {/* Auto-subscribes the user to Web Push once we know who they
                are. Also listens for SW notification-click navigation
                messages and routes the SPA without a reload. */}
            <PushBootstrap />
            {/* Pulls the user's saved theme from /user/me/profile on
                login so the choice follows them across devices. */}
            <ThemeSync />
            <Box
                as="main"
                bg="bg.canvas"
                minH="calc(100vh - 80px)"
                // Lift content above the mobile bottom nav (only rendered
                // <md, ~64px tall + iOS safe-area). Desktop has no bottom
                // bar so this is a no-op there.
                // v3 nav is taller because the centre FAB is lifted ~18px
                // above the bar baseline. 92px gives the FAB room without
                // overlapping page content. Safe-area-inset adds iOS PWA
                // home-indicator buffer on top. Desktop adds 52px to clear
                // the web-only sticky footer; mobile has no footer so it
                // only needs the bottom-nav clearance.
                pb={{ base: "calc(92px + env(safe-area-inset-bottom, 0px))", md: "52px" }}
            >
            <Container maxW="1280px" py={{ base: 5, md: 7 }} px={{ base: 4, md: 6 }}>
                {/* All user-facing routes use Croatian slugs. English slugs
                    (/tournaments, /profile, /calendar, …) are kept around
                    purely as <Navigate replace> aliases so existing
                    in-browser links don't break - server-side 301 redirects
                    in Caddy handle the SEO side. */}
                <Suspense fallback={<RouteLoading />}>
                <Routes>
                    <Route path="/" element={<Navigate to="/turniri" replace />} />

                    {/* Croatian (canonical) routes. */}
                    <Route path="/prijava" element={<LoginPage />} />
                    <Route path="/registracija" element={<RegisterPage />} />
                    <Route path="/turniri" element={<TournamentsPage />} />
                    <Route
                        path="/turniri/novi"
                        element={
                            <RequireAuth>
                                <CreateTournamentPage />
                            </RequireAuth>
                        }
                    />
                    <Route path="/turniri/:uuid" element={<TournamentDetailsPage />} />
                    <Route
                        path="/turniri/:uuid/fullscreen"
                        element={<FullscreenTournamentPage />}
                    />
                    {/* A single match's own live page (SofaScore-style) - public,
                        shareable, follows the game live. */}
                    <Route
                        path="/turniri/:uuid/utakmica/:matchId"
                        element={<MatchLivePage />}
                    />
                    <Route path="/uzivo" element={<LivePage />} />
                    {/* The old "Kalendar" page was merged into /uzivo (live
                        matches + a compact upcoming-tournament calendar).
                        /kalendar now redirects there so old links and
                        bookmarks keep working. */}
                    <Route path="/kalendar" element={<Navigate to="/uzivo" replace />} />
                    <Route path="/karta" element={<MapPage />} />
                    <Route path="/statistika" element={<StatsPage />} />
                    {/* English alias for the stats page. */}
                    <Route path="/stats" element={<Navigate to="/statistika" replace />} />
                    <Route path="/privatnost" element={<PrivacyPage />} />
                    <Route path="/vodic" element={<GuidePage />} />
                    <Route path="/pronadi-ekipu" element={<FindTeamPage />} />
                    {/* /profil bounces to /profil/{my-slug} once the backend
                        has synced. /profil/:slug is publicly visible per
                        product decision. */}
                    <Route path="/profil" element={<ProfileRedirect />} />
                    <Route path="/profil/:slug" element={<PublicProfilePage />} />
                    {/* Team-sharing claim landing pages - token routes, not
                        SEO-relevant, but translated for consistency. Old
                        share tokens still resolve via the legacy aliases
                        below. */}
                    <Route path="/preuzmi-ekipu/:token" element={<ClaimTeamPage />} />
                    <Route path="/preuzmi-ime/:token" element={<ClaimNamePage />} />

                    {/* Legacy English aliases - client-side Navigate for any
                        in-app link or typed URL that slips past Caddy's
                        301. We preserve :param segments so the destination
                        gets the same slug/token. NB: <Navigate to=> doesn't
                        forward path params automatically; the wrappers
                        below extract and forward them. */}
                    <Route path="/login" element={<Navigate to="/prijava" replace />} />
                    <Route path="/register" element={<Navigate to="/registracija" replace />} />
                    <Route path="/tournaments" element={<Navigate to="/turniri" replace />} />
                    <Route path="/tournaments/new" element={<Navigate to="/turniri/novi" replace />} />
                    <Route path="/tournaments/:uuid" element={<LegacyTournamentRedirect />} />
                    <Route path="/calendar" element={<Navigate to="/uzivo" replace />} />
                    <Route path="/map" element={<Navigate to="/karta" replace />} />
                    <Route path="/find-team" element={<Navigate to="/pronadi-ekipu" replace />} />
                    <Route path="/profile" element={<Navigate to="/profil" replace />} />
                    <Route path="/profile/:slug" element={<LegacyProfileRedirect />} />
                    <Route path="/claim-team/:token" element={<LegacyClaimTeamRedirect />} />
                    <Route path="/claim-name/:token" element={<LegacyClaimNameRedirect />} />

                    {/* Catch-all - keep last so explicit routes win. */}
                    <Route path="*" element={<NotFoundPage />} />
                </Routes>
                </Suspense>
            </Container>
            </Box>
            {/* Slim sticky brand footer - pinned to the viewport bottom,
                stays visible while scrolling. */}
            <Footer />
            <MobileBottomNav />
        </>
    )
}
