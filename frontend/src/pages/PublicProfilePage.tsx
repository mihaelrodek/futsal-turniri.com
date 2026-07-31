import React, { useEffect, useMemo, useRef, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Card,
    chakra,
    Field,
    Flex,
    Grid,
    Heading,
    HStack,
    IconButton,
    Image,
    Input,
    NativeSelect,
    Skeleton,
    Spinner,
    Tabs,
    Text,
    VStack,
} from "@chakra-ui/react"
import { getFirebase } from "../firebase"
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom"
import { FaTrophy } from "react-icons/fa"
import {
    FiAlertCircle,
    FiAtSign,
    FiCalendar,
    FiChevronDown,
    FiChevronRight,
    FiDownload,
    FiEdit2,
    FiFileText,
    FiFolder,
    FiGrid,
    FiInbox,
    FiList,
    FiMapPin,
    FiPhone,
    FiRadio,
    FiUser,
    FiUserCheck,
    FiShare2,
    FiShield,
    FiTrash2,
    FiUsers,
    FiVideo,
} from "react-icons/fi"
import { PillTabBar } from "../ui/pitch"
import ThemeSwitch from "../components/ThemeSwitch"
import {
    getCareerStats,
    getTeamMatchHistory,
    getPublicProfile,
    type CareerStats,
    type TeamMatchHistory,
    type TeamSummary,
    type PublicProfile,
} from "../api/publicProfile"
import type { MyTournamentParticipation } from "../api/userMe"
import {
    deleteAvatar,
    getProfile,
    syncProfile,
    updateLanguage,
    updateProfile,
    uploadAvatar,
} from "../api/userMe"
import { checkUsernameAvailable } from "../api/auth"
import AvatarPreview from "../components/AvatarPreview"
import AvatarCropDialog from "../components/AvatarCropDialog"
import PlayerSilhouette from "../components/PlayerSilhouette"
import { toPng } from "html-to-image"
import { showError } from "../toaster"
import { useAuth } from "../auth/AuthContext"
import AdminDashboardTab from "../components/AdminDashboardTab"
import SpectoConnectionCard from "../components/SpectoConnectionCard"
import AdminPlayersListTab from "../components/AdminPlayersListTab"
import AdminTeamDatabaseTab from "../components/AdminTeamDatabaseTab"
import MyRecordingsTab from "../components/MyRecordingsTab"
import AdminRecordingRequestsTab from "../components/AdminRecordingRequestsTab"
import AdminPlayerClaimRequestsTab from "../components/AdminPlayerClaimRequestsTab"
import { MyPlayerClaimRequests, PlayerClaimRequestDialog } from "../components/PlayerClaimDialogs"
import { PLAYER_CLAIMS_CHANGED_EVENT } from "../components/PlayerClaimFirstRun"
import {
    getMyPlayerClaimRequests,
    getPlayerClaimState,
    type PlayerClaimRequest as PlayerClaimRequestRow,
    type PlayerClaimState as PlayerClaimStateRow,
} from "../api/playerClaims"
import AdminRecordingsLibraryTab from "../components/AdminRecordingsLibraryTab"
import AdminCameraInquiriesTab from "../components/AdminCameraInquiriesTab"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { LOCALE_LABELS, setLocale, useLocale, useTranslation, type Locale } from "../i18n"

/** Country dial codes shared with FindTeam / CreateTournament. */
const PHONE_COUNTRIES = [
    { value: "+385", label: "🇭🇷 +385" },
    { value: "+386", label: "🇸🇮 +386" },
    { value: "+43",  label: "🇦🇹 +43" },
    { value: "+49",  label: "🇩🇪 +49" },
    { value: "+387", label: "🇧🇦 +387" },
    { value: "+381", label: "🇷🇸 +381" },
] as const

function formatDate(iso?: string | null): string {
    if (!iso) return "-"
    return new Intl.DateTimeFormat("hr-HR", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(new Date(iso))
}

/** Two-letter initials for the user avatar (falls back to single letter or `?`). */
function initialsOf(name?: string | null): string {
    if (!name) return "?"
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return "?"
    if (parts.length === 1) return parts[0][0]!.toUpperCase()
    return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase()
}

/** Lower-cased trimmed name match - same key the backend groups teams by. */
function teamKey(name: string): string {
    return name.trim().toLowerCase()
}

/** Payment flow (Stripe Checkout) is live end-to-end - the user-facing
 *  "Moje snimke" tab is shown. The admin tabs (Zahtjevi za snimke, Baza
 *  snimki) are untouched. */
const RECORDING_REQUEST_ENABLED = true

type ProfileTabKey =
    | "profil"
    | "turniri"
    | "moje-snimke"
    | "dashboard"
    | "popis-igraca"
    | "baza-ekipa"
    | "live-stream"
    | "zahtjevi-snimke"
    | "baza-snimki"
    | "zahtjevi-ponude"
    | "zahtjevi-igraci"

/** Icon per tab, shared between the desktop sidebar and (implicitly, via
 *  the same lookup) anywhere else a tab needs one. */

const PROFILE_TAB_ICONS: Record<ProfileTabKey, React.ReactNode> = {
    // "profil" isn't its own desktop sidebar nav row (the sidebar's identity
    // block + pencil switches to it instead), but the icon map covers every key.
    profil: <FiUser size={15} />,
    turniri: <FiList size={15} />,
    "moje-snimke": <FiVideo size={15} />,
    dashboard: <FiGrid size={15} />,
    "popis-igraca": <FiUsers size={15} />,
    "baza-ekipa": <FiShield size={15} />,
    "live-stream": <FiRadio size={15} />,
    "zahtjevi-snimke": <FiInbox size={15} />,
    "baza-snimki": <FiFolder size={15} />,
    "zahtjevi-ponude": <FiFileText size={15} />,
    "zahtjevi-igraci": <FiUserCheck size={15} />,
}

/** One desktop-sidebar navigation row - same shape/spacing as
 *  TournamentDetailsPage's SidebarNavItem. `palette` switches the active
 *  fill from pitch-green (user-facing tabs) to purple (admin-only tabs),
 *  mirroring the purple accent the admin tab buttons already used. */
function ProfileNavItem({
    icon,
    label,
    active,
    onClick,
    palette = "pitch",
}: {
    icon?: React.ReactNode
    label: string
    active: boolean
    onClick: () => void
    palette?: "pitch" | "purple"
}) {
    const activeBg = palette === "purple" ? "purple.solid" : "pitch.500"
    const activeColor = palette === "purple" ? "purple.contrast" : "white"
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            display="flex"
            alignItems="center"
            gap="2.5"
            w="full"
            textAlign="left"
            pl="3"
            pr="3"
            py="2"
            rounded="lg"
            fontSize="14px"
            fontWeight={active ? 700 : 600}
            bg={active ? activeBg : "transparent"}
            color={active ? activeColor : "fg.muted"}
            cursor="pointer"
            transition="background 120ms"
            _hover={{ bg: active ? activeBg : "bg.subtle" }}
        >
            {icon}
            {label}
        </chakra.button>
    )
}

export default function PublicProfilePage() {
    const t = useTranslation()
    const { slug } = useParams<{ slug: string }>()
    const { user, mySlug, isAdmin, loading: authLoading } = useAuth()
    const navigate = useNavigate()

    const [profile, setProfile] = useState<PublicProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [career, setCareer] = useState<CareerStats | null>(null)

    const [search, setSearch] = useState("")

    // Manual (admin-approved) player-claim requests of the profile owner.
    const [claimRequests, setClaimRequests] = useState<PlayerClaimRequestRow[]>([])
    const [claimRequestsVersion, setClaimRequestsVersion] = useState(0)
    const [requestDialogOpen, setRequestDialogOpen] = useState(false)
    const requestDialogAutoOpened = useRef(false)

    // Profile page tabs. Postavke (+ admin-only Dashboard / Popis igrača)
    // only show for the profile owner; visitors viewing someone else's page
    // see Turniri only. Owner always lands on "profil" (account details +
    // settings) - the natural landing tab on both mobile and desktop, since
    // it's the owner's own account-details view.
    const [profileTab, setProfileTab] = useState<ProfileTabKey>("profil")
    // Mobile-only: whether the "Administracija" pill has expanded the row
    // of admin tabs beneath the primary tab row.
    const [mobileAdminOpen, setMobileAdminOpen] = useState(false)

    // Per-route SEO. We deliberately do NOT include the user's phone in any
    // meta tag - phone display is a product call on the page itself, but
    // there's no need to make it any more discoverable than it already is.
    const totalTournaments = profile?.tournaments?.length ?? 0
    const totalWins = (profile?.teams ?? []).reduce((sum, p) => sum + (p.wins ?? 0), 0)
    const profileCanonical = slug ? `https://futsal-turniri.com/profil/${slug}` : undefined
    const profileDescription = profile?.displayName
        ? `${profile.displayName} - povijest nastupa na Futsal turnirima. ${totalTournaments} turnira, ${totalWins} pobjeda.`
        : undefined

    // Person JSON-LD for Googlebot. Mirrors what ProfilePreviewController
    // emits for non-JS crawlers so structured-data validators see one
    // consistent record per URL regardless of which path rendered it.
    const profileJsonLd = useMemo(() => {
        if (!profile?.displayName || !profileCanonical) return undefined
        const items: object[] = []
        const person: Record<string, unknown> = {
            "@context": "https://schema.org",
            "@type": "Person",
            name: profile.displayName,
            url: profileCanonical,
            description: profileDescription,
            knowsAbout: ["Futsal", "Mali nogomet", "Nogomet"],
            interactionStatistic: [
                {
                    "@type": "InteractionCounter",
                    interactionType: "https://schema.org/RegisterAction",
                    userInteractionCount: totalTournaments,
                },
                {
                    "@type": "InteractionCounter",
                    interactionType: "https://schema.org/WinAction",
                    userInteractionCount: totalWins,
                },
            ],
        }
        if (slug) {
            person.identifier = slug
            person.alternateName = slug
        }
        if (profile.avatarUrl) person.image = profile.avatarUrl
        items.push(person)

        // BreadcrumbList - gives Google an "Igrači › {name}" trail.
        // There's no top-level "Igrači" index page yet, but the schema
        // still helps Google understand the URL hierarchy and is cheap
        // to ship pre-emptively.
        items.push({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
                {
                    "@type": "ListItem",
                    position: 1,
                    name: "Igrači",
                    item: "https://futsal-turniri.com/",
                },
                {
                    "@type": "ListItem",
                    position: 2,
                    name: profile.displayName,
                    item: profileCanonical,
                },
            ],
        })
        return items
    }, [profile?.displayName, profile?.avatarUrl, profileCanonical, profileDescription, slug, totalTournaments, totalWins])

    useDocumentHead({
        title: profile?.displayName
            ? `${profile.displayName} - Futsal igrač | futsal-turniri.com`
            : "Futsal igrač - futsal-turniri.com",
        description: profileDescription,
        ogTitle: profile?.displayName ?? undefined,
        ogDescription: profile?.displayName
            ? `Povijest nastupa na Futsal turnirima - ${totalTournaments} turnira, ${totalWins} pobjeda.`
            : undefined,
        ogImage: profile?.avatarUrl ?? undefined,
        ogType: "profile",
        canonical: profileCanonical,
        jsonLd: profileJsonLd,
    })

    // Why this depends on `authLoading` + `user?.uid` as well as `slug`:
    //
    // The backend redacts the phone number for anonymous viewers (the
    // "Prijavi se da vidiš broj" affordance is driven by the `hasPhone`
    // flag the API returns). If we fire this fetch before Firebase has
    // restored the persisted session, the request goes anonymous and we
    // get back a redacted record - even if the user IS logged in on
    // this device. Then `setProfile` stores that stale anonymous record
    // and the page shows the blurred phone permanently for this session.
    //
    // Fix: don't fetch until `authLoading` is false (the initial auth
    // probe finished), and re-fetch whenever `user?.uid` flips
    // (login/logout while the page is open). With this, a logged-in
    // user lands on the profile, the request goes out with their
    // Bearer token, and the backend returns the real phone.
    useEffect(() => {
        if (!slug) return
        if (authLoading) return
        let cancelled = false
        ;(async () => {
            try {
                setLoading(true)
                setError(null)
                setSearch("")
                const data = await getPublicProfile(slug)
                if (cancelled) return
                setProfile(data)
            } catch (e: any) {
                if (cancelled) return
                if (e?.response?.status === 404) {
                    setError(t.pages.publicProfilePage.errors.notFound)
                } else {
                    setError(e?.message ?? t.pages.publicProfilePage.errors.generic)
                }
                setProfile(null)
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => { cancelled = true }
    }, [slug, authLoading, user?.uid])

    // Career stats - separate request so a slow stats query doesn't hold
    // up the main profile render. Silent on error (we just hide the card).
    useEffect(() => {
        if (!slug) return
        let cancelled = false
        getCareerStats(slug)
            .then((c) => { if (!cancelled) setCareer(c) })
            .catch(() => { if (!cancelled) setCareer(null) })
        return () => { cancelled = true }
    }, [slug])

    // Owner detection - backend deliberately doesn't ship the target UID, so
    // we compare slugs. mySlug is populated after /user/me/sync runs.
    const isOwner = !!profile && !!user?.uid && !!mySlug && mySlug === profile.slug

    // Does an exact name match still exist for this account, and did the
    // person answer "nisam igrač"? The automatic linking itself happens
    // app-level (PlayerClaimFirstRun, so it also fires right after
    // registration) - here this only decides whether to volunteer the manual,
    // admin-approved request dialog.
    const claimState = usePlayerClaimState(isOwner ? user?.uid : undefined, !!profile)

    // App-level auto-claim just linked something - refetch so the new team
    // shows up without a reload. `refreshProfile` is a hoisted function
    // declaration further down, so it's already callable here.
    useEffect(() => {
        const onChanged = () => {
            refreshProfile()
            setClaimRequestsVersion((v) => v + 1)
        }
        window.addEventListener(PLAYER_CLAIMS_CHANGED_EVENT, onChanged)
        return () => window.removeEventListener(PLAYER_CLAIMS_CHANGED_EVENT, onChanged)
    }, [])

    // The owner's own manual claim requests (the admin-approved path). Only
    // fetched for the owner - nobody else may see them.
    useEffect(() => {
        if (!isOwner) { setClaimRequests([]); return }
        let cancelled = false
        getMyPlayerClaimRequests()
            .then((rows) => { if (!cancelled) setClaimRequests(rows) })
            .catch(() => { if (!cancelled) setClaimRequests([]) })
        return () => { cancelled = true }
    }, [isOwner, user?.uid, claimRequestsVersion])

    // Nothing matched automatically and nothing is queued - offer the manual
    // request dialog, and open it once by itself when the owner lands on
    // Turniri, which is where they'd expect their history to be.
    const hasOpenOrGrantedRequest = claimRequests.some(
        (r) => r.status === "PENDING" || r.status === "APPROVED",
    )
    // Nothing matched, nothing linked, nothing queued - this person's history
    // is invisible unless they ask for it manually.
    const needsManualClaim =
        isOwner
        && claimState != null
        && claimState.suggestions.length === 0
        && (profile?.teams.length ?? 0) === 0
        && !hasOpenOrGrantedRequest

    useEffect(() => {
        if (!needsManualClaim || profileTab !== "turniri") return
        // Someone who said "nisam igrač" gets no unsolicited dialog - but the
        // button below stays, so they can still start one themselves.
        if (claimState?.optedOut) return
        if (requestDialogAutoOpened.current) return
        requestDialogAutoOpened.current = true
        setRequestDialogOpen(true)
    }, [needsManualClaim, profileTab, claimState?.optedOut])

    if (loading) {
        return (
            <VStack align="stretch" gap="4" maxW="780px" mx="auto">
                <Skeleton h="120px" rounded="xl" />
                <Skeleton h="60px" rounded="xl" />
                <Skeleton h="200px" rounded="xl" />
            </VStack>
        )
    }

    if (error || !profile) {
        return (
            <VStack align="stretch" gap="4" maxW="780px" mx="auto">
                <Card.Root variant="outline" rounded="xl" borderColor="red.muted">
                    <Card.Body p="5">
                        <HStack gap="3" align="center" color="red.fg">
                            <FiAlertCircle />
                            <Text>{error ?? t.pages.publicProfilePage.errors.unavailable}</Text>
                        </HStack>
                        <HStack mt="4">
                            <Button size="sm" variant="ghost" onClick={() => navigate(-1)}>{t.common.back}</Button>
                            <Button size="sm" variant="solid" colorPalette="pitch" asChild>
                                <RouterLink to="/turniri">{t.pages.publicProfilePage.toTournamentsButton}</RouterLink>
                            </Button>
                        </HStack>
                    </Card.Body>
                </Card.Root>
            </VStack>
        )
    }

    async function refreshProfile() {
        try {
            const fresh = await getPublicProfile(profile!.slug)
            setProfile(fresh)
        } catch { /* ignore */ }
    }

    // Sidebar / mobile tab navigation config - user-facing tabs first,
    // admin-only tabs grouped separately (rendered below a divider on
    // desktop, in their own labelled pill row on mobile). Only ever shown
    // to the profile owner; a visitor has nothing to switch between.
    const adminPillLabel = t.pages.publicProfilePage.adminPillLabel
    const userTabs: Array<{ key: ProfileTabKey; label: string }> = [
        { key: "turniri", label: t.pages.publicProfilePage.tabs.tournaments },
        // Recording requests of THIS user (any signed-in account) - request
        // status, cancel, and the download link once a recording is delivered.
        ...(RECORDING_REQUEST_ENABLED
            ? [{ key: "moje-snimke" as ProfileTabKey, label: t.pages.publicProfilePage.tabs.myRecordings }]
            : []),
    ]
    // Admin-only tabs, gated on the Firebase role=admin custom claim.
    const adminTabs: Array<{ key: ProfileTabKey; label: string }> = isAdmin
        ? [
            { key: "dashboard", label: t.pages.publicProfilePage.tabs.dashboard },
            { key: "popis-igraca", label: t.pages.publicProfilePage.tabs.playersList },
            { key: "baza-ekipa", label: t.pages.publicProfilePage.tabs.teamDatabase },
            { key: "live-stream", label: t.pages.publicProfilePage.tabs.liveStream },
            { key: "zahtjevi-snimke", label: t.pages.publicProfilePage.tabs.recordingRequests },
            { key: "baza-snimki", label: t.pages.publicProfilePage.tabs.recordingsLibrary },
            { key: "zahtjevi-ponude", label: t.pages.publicProfilePage.tabs.cameraInquiries },
            { key: "zahtjevi-igraci", label: t.pages.publicProfilePage.tabs.playerClaimRequests },
        ]
        : []

    // Mobile: ONE primary pill row - Profil first, then the user tabs, then
    // a single "Administracija" pill that expands the admin row below it
    // on tap (instead of always showing a second crowded row).
    const mobileTabs: Array<{ key: ProfileTabKey; label: string }> = [
        { key: "profil", label: t.pages.publicProfilePage.tabs.profile },
        ...userTabs,
    ]
    const isOnAdminTab = adminTabs.some((tab) => tab.key === profileTab)
    const mobileLabels = [
        ...mobileTabs.map((tab) => tab.label),
        ...(adminTabs.length > 0 ? [adminPillLabel] : []),
    ]
    const activeMobileLabel = isOnAdminTab || mobileAdminOpen
        ? adminPillLabel
        : (mobileTabs.find((tab) => tab.key === profileTab)?.label ?? "")
    const adminTabLabels = adminTabs.map((tab) => tab.label)
    const activeAdminLabel = adminTabs.find((tab) => tab.key === profileTab)?.label ?? ""

    /** Everything but the shell: identity card + whichever tab is active.
     *  Shared between the visitor (no nav) and owner (sidebar/pill nav)
     *  render paths so the tab content itself never has to know which
     *  shell it's sitting in. */
    const bodyContent = (
        <>
            {/* NOTE: the small visitor identity card (ProfileHeader, "card"
                variant) used to sit here. It's gone on purpose - the spotlight
                card below IS the player's identity/detail display now, and it
                carries the name, photo and phone itself. ProfileHeader still
                renders in its "sidebar" variant for the owner's desktop nav. */}

            {/* === PROFIL panel - owner-only. Account details + app settings
                  (Postavke folded in here rather than getting its own tab).
                  This is what the desktop sidebar pencil switches the main
                  column to, and what mobile's "Profil" tab shows automatically. === */}
            {isOwner && profileTab === "profil" && (
                <>
                    <ProfileDetailsSection onSaved={refreshProfile} />
                    <SettingsCard />
                </>
            )}

            {/* === PLAYER SPOTLIGHT - "FIFA card"-style header, and the whole
                  identity + career summary in one: photo, name, phone,
                  tournaments/matches/goals, W-D-L and best placement. Renders
                  even with an empty career (zeros) - it's the profile's main
                  display, not a stats-only extra. === */}
            {(!isOwner || profileTab === "turniri") && profile && (
                <PlayerSpotlightCard
                    profile={profile}
                    career={career}
                    isOwner={isOwner}
                    onAddPhoto={() => setProfileTab("profil")}
                />
            )}

            {/* === Manual player claim - the owner's own requests plus the
                  "ask to be linked" CTA. Only for the owner, on Turniri:
                  a visitor has nothing to claim here. === */}
            {isOwner && profileTab === "turniri" && (
                <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                    <Card.Body p={{ base: "4", md: "5" }}>
                        <VStack align="stretch" gap="3">
                            {needsManualClaim && (
                                <Text fontSize="sm" color="fg.muted">
                                    {t.components.playerClaim.myRequests.noMatchHint}
                                </Text>
                            )}
                            {/* Always available to the owner - including after
                                "nisam igrač", which only silences the
                                automatic prompt, never this button. */}
                            <HStack>
                                <Button
                                    size="sm"
                                    variant={needsManualClaim ? "solid" : "outline"}
                                    colorPalette="pitch"
                                    onClick={() => setRequestDialogOpen(true)}
                                >
                                    <FiUserCheck />
                                    {t.components.playerClaim.myRequests.openDialogButton}
                                </Button>
                            </HStack>
                            <MyPlayerClaimRequests
                                requests={claimRequests}
                                onChanged={() => setClaimRequestsVersion((v) => v + 1)}
                            />
                        </VStack>
                    </Card.Body>
                </Card.Root>
            )}

            {/* === Ekipe / Turniri card - just the two tabs now; the career
                  headline stats moved up into the spotlight card. === */}
            {(!isOwner || profileTab === "turniri") && (
                <KarijeraCard
                    profile={profile}
                    search={search}
                    setSearch={setSearch}
                />
            )}

            {/* === MOJE SNIMKE tab - owner-only: recording requests === */}
            {RECORDING_REQUEST_ENABLED && isOwner && profileTab === "moje-snimke" && <MyRecordingsTab />}

            {/* === DASHBOARD tab - admin-only, on own profile === */}
            {isOwner && isAdmin && profileTab === "dashboard" && (
                <AdminDashboardTab />
            )}

            {/* === POPIS IGRAČA tab - admin-only, on own profile === */}
            {isOwner && isAdmin && profileTab === "popis-igraca" && (
                <AdminPlayersListTab />
            )}

            {/* === BAZA EKIPA tab - admin-only, on own profile === */}
            {isOwner && isAdmin && profileTab === "baza-ekipa" && (
                <AdminTeamDatabaseTab />
            )}

            {/* === LIVE STREAM tab - admin-only, on own profile === */}
            {/* "Live stream" tab now hosts the SpectoStream connection card
                (attach an EXISTING platform stream to a tournament + preview
                its player). The old home-page banner admin (LiveStreamAdminTab)
                was replaced per product request - the component file remains. */}
            {isOwner && isAdmin && profileTab === "live-stream" && (
                <SpectoConnectionCard />
            )}

            {/* === ZAHTJEVI ZA SNIMKE tab - admin-only, on own profile === */}
            {isOwner && isAdmin && profileTab === "zahtjevi-snimke" && (
                <AdminRecordingRequestsTab />
            )}

            {/* === BAZA SNIMKI tab - admin-only, on own profile === */}
            {isOwner && isAdmin && profileTab === "baza-snimki" && (
                <AdminRecordingsLibraryTab />
            )}

            {/* === ZAHTJEVI ZA PONUDU tab - admin-only, on own profile ===
                  "Zatraži ponudu" leads for the custom camera package. === */}
            {isOwner && isAdmin && profileTab === "zahtjevi-ponude" && (
                <AdminCameraInquiriesTab />
            )}

            {/* === ZAHTJEVI ZA IGRAČA tab - admin-only: manual "this roster
                  player is me" claims waiting for a human decision. === */}
            {isOwner && isAdmin && profileTab === "zahtjevi-igraci" && (
                <AdminPlayerClaimRequestsTab />
            )}

            {/* The manual request dialog - owner-only, outside the tab switch
                so it survives a tab change while it's open. (The automatic
                "is this you?" confirm is app-level, in PlayerClaimFirstRun.) */}
            {isOwner && (
                <PlayerClaimRequestDialog
                    open={requestDialogOpen}
                    onClose={() => setRequestDialogOpen(false)}
                    onSubmitted={() => setClaimRequestsVersion((v) => v + 1)}
                />
            )}
        </>
    )

    // Visitor viewing someone else's profile: no nav at all (there's only
    // ever the Turniri card to show them) - keep the original narrow,
    // centered single-column layout.
    if (!isOwner) {
        return (
            <VStack align="stretch" gap="4" maxW="900px" mx="auto" w="full">
                {bodyContent}
            </VStack>
        )
    }

    // Owner shell - mirrors TournamentDetailsPage's structure exactly:
    // a compact sticky mobile bar (base → lg) carrying a mini identity row
    // + pill tab bar(s), and a fixed left sidebar on desktop (lg+) that
    // never moves with the page scroll.
    return (
        <>
            {/* ── Mobile / tablet shell (base → lg): ONE compact sticky bar -
                mini avatar/name row (view-only - editing lives in the Profil
                tab below) + pill tab bar(s). Sticky lives on THIS box (parent
                is the page-tall route outlet), same trap as
                TournamentDetailsPage: a sticky child one level down would
                unpin the moment this short box scrolled past. Hidden on lg+,
                where the sidebar carries all of it. ── */}
            <Box
                display={{ base: "block", lg: "none" }}
                position="sticky"
                top={{ base: "52px", md: "56px" }}
                zIndex={100}
                bg="bg.canvas"
                mt={{ base: "-20px", md: "-28px" }}
                pt={{ base: "28px", md: "36px" }}
                pb="2"
            >
                <HStack gap="2.5" align="center" mb="2" px="0.5">
                    <AvatarPreview
                        src={profile.avatarUrl}
                        alt={profile.displayName ?? t.pages.publicProfilePage.avatarAlt}
                    >
                        <Box
                            w="34px"
                            h="34px"
                            rounded="full"
                            overflow="hidden"
                            bg="blue.subtle"
                            color="blue.fg"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            fontWeight="bold"
                            fontSize="xs"
                            flexShrink={0}
                        >
                            {profile.avatarUrl ? (
                                <Image
                                    src={profile.avatarUrl}
                                    alt={profile.displayName ?? t.pages.publicProfilePage.avatarAlt}
                                    w="100%"
                                    h="100%"
                                    objectFit="cover"
                                />
                            ) : (
                                initialsOf(profile.displayName)
                            )}
                        </Box>
                    </AvatarPreview>
                    <Text fontWeight={700} fontSize="15px" lineClamp={1}>
                        {profile.displayName ?? t.pages.publicProfilePage.unnamedPlayer}
                    </Text>
                </HStack>

                {/* One primary row: Profil, user tabs, then a single
                    "Administracija" pill. Tapping it expands the admin
                    row below instead of always showing two crowded rows. */}
                <PillTabBar
                    tabs={mobileLabels}
                    active={activeMobileLabel}
                    onChange={(label) => {
                        if (label === adminPillLabel) {
                            setMobileAdminOpen((v) => !v)
                            return
                        }
                        const next = mobileTabs.find((tab) => tab.label === label)
                        if (next) {
                            setMobileAdminOpen(false)
                            setProfileTab(next.key)
                        }
                    }}
                    padding="4px"
                    mb={(mobileAdminOpen || isOnAdminTab) && adminTabs.length > 0 ? "2" : "0"}
                />

                {(mobileAdminOpen || isOnAdminTab) && adminTabs.length > 0 && (
                    <PillTabBar
                        tabs={adminTabLabels}
                        active={activeAdminLabel}
                        onChange={(label) => {
                            const next = adminTabs.find((tab) => tab.label === label)
                            if (next) setProfileTab(next.key)
                        }}
                        size="sm"
                        padding="4px"
                        mb="0"
                    />
                )}
            </Box>

            {/* ── Desktop shell (lg+): FIXED sidebar left, content right - same
                construction as TournamentDetailsPage: a flow placeholder Box
                reserves the 230px column, the actual nav Flex inside it is
                position:FIXED (bound only by the viewport, so it can never
                move with page scroll), and only ITS OWN content scrolls once
                taller than the space between the navbar and viewport bottom. ── */}
            <Flex align="flex-start" gap={{ base: "0", lg: "5" }}>
                <Box w="230px" flexShrink={0} display={{ base: "none", lg: "block" }}>
                    <Flex
                        direction="column"
                        w="230px"
                        position="fixed"
                        top="85px"
                        bottom="12px"
                        overflowY="auto"
                        css={{
                            scrollbarWidth: "thin",
                            scrollbarColor: "var(--chakra-colors-border-emphasized) transparent",
                            "&::-webkit-scrollbar": { width: "6px" },
                            "&::-webkit-scrollbar-track": { background: "transparent" },
                            "&::-webkit-scrollbar-thumb": {
                                background: "var(--chakra-colors-border-emphasized)",
                                borderRadius: "999px",
                            },
                            overscrollBehavior: "contain",
                        }}
                        gap="2.5"
                        pb="1"
                    >
                        <Flex
                            direction="column"
                            flexShrink={0}
                            bg="bg.panel"
                            borderWidth="1px"
                            borderColor="border.emphasized"
                            rounded="2xl"
                            p="3"
                            gap="0.5"
                        >
                            {/* Identity block - the user's own profile card is
                                the FIRST thing in the menu. The pencil switches
                                the main content column to the "profil" panel
                                instead of expanding inline here. */}
                            <ProfileHeader
                                profile={profile}
                                isOwner={isOwner}
                                variant="sidebar"
                                onEditClick={() => setProfileTab("profil")}
                            />
                            <Box
                                borderTopWidth="1px"
                                borderColor="border.emphasized"
                                mt="2"
                                mb="2"
                            />
                            {userTabs.map((tab) => (
                                <ProfileNavItem
                                    key={tab.key}
                                    icon={PROFILE_TAB_ICONS[tab.key]}
                                    label={tab.label}
                                    active={profileTab === tab.key}
                                    onClick={() => setProfileTab(tab.key)}
                                />
                            ))}

                            {/* Admin group - visually separated from the
                                user-facing tabs above by a divider + small
                                caption, and by the purple (vs. pitch-green)
                                active fill on each row. */}
                            {adminTabs.length > 0 && (
                                <>
                                    <Box
                                        borderTopWidth="1px"
                                        borderColor="border.emphasized"
                                        mt="2"
                                        pt="2.5"
                                        pb="0.5"
                                        px="1.5"
                                    >
                                        <Text
                                            fontFamily="mono"
                                            fontSize="10px"
                                            fontWeight={800}
                                            letterSpacing="0.12em"
                                            color="fg.muted"
                                        >
                                            {t.pages.publicProfilePage.adminSectionCaption}
                                        </Text>
                                    </Box>
                                    {adminTabs.map((tab) => (
                                        <ProfileNavItem
                                            key={tab.key}
                                            icon={PROFILE_TAB_ICONS[tab.key]}
                                            label={tab.label}
                                            active={profileTab === tab.key}
                                            onClick={() => setProfileTab(tab.key)}
                                            palette="purple"
                                        />
                                    ))}
                                </>
                            )}
                        </Flex>
                    </Flex>
                </Box>

                <VStack align="stretch" gap="4" flex="1" minW="0">
                    {bodyContent}
                </VStack>
            </Flex>
        </>
    )
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function ProfileHeader({
    profile,
    isOwner,
    variant = "card",
    onEditClick,
}: {
    profile: PublicProfile
    isOwner: boolean
    /** "card" = standalone card (mobile body / visitor); "sidebar" = compact
     *  block at the top of the owner's desktop sidebar menu. */
    variant?: "card" | "sidebar"
    /** Sidebar-only: the pencil doesn't edit inline here anymore - it hands
     *  off to the parent, which switches the main content column to the
     *  "profil" panel (ProfileDetailsSection). */
    onEditClick?: () => void
}) {
    const t = useTranslation()

    // Avatar - image when uploaded, initials otherwise. Wrapped in
    // AvatarPreview so hovering / tapping the circle opens a full-screen
    // lightbox of the picture. View-only here (both variants, owner or not)
    // - changing the picture lives exclusively in ProfileDetailsSection now,
    // on the "Profil" tab, so it's never edited from two different places.
    const avatarSize = variant === "sidebar" ? "40px" : { base: "40px", md: "48px" }
    const avatarEl = (
        <Box position="relative" flexShrink={0}>
            <AvatarPreview
                src={profile.avatarUrl}
                alt={profile.displayName ?? t.pages.publicProfilePage.avatarAlt}
            >
                <Box
                    w={avatarSize}
                    h={avatarSize}
                    rounded="full"
                    overflow="hidden"
                    bg="blue.subtle"
                    color="blue.fg"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    fontWeight="bold"
                    fontSize={variant === "sidebar" ? "sm" : { base: "sm", md: "md" }}
                >
                    {profile.avatarUrl ? (
                        <Image
                            src={profile.avatarUrl}
                            alt={profile.displayName ?? t.pages.publicProfilePage.avatarAlt}
                            w="100%"
                            h="100%"
                            objectFit="cover"
                        />
                    ) : (
                        initialsOf(profile.displayName)
                    )}
                </Box>
            </AvatarPreview>
        </Box>
    )

    const phoneEl = <ProfilePhoneLink profile={profile} />

    // ── Sidebar variant: the FIRST item of the owner's desktop menu - a
    //    compact identity row; the pencil expands the edit fields inline,
    //    right here in the sidebar (no modal). ──
    if (variant === "sidebar") {
        return (
            <VStack align="stretch" gap="1.5" px="1" pt="1">
                <HStack gap="2.5" align="center" minW="0">
                    {avatarEl}
                    <HStack gap="1" align="center" flex="1" minW="0">
                        <Text
                            fontWeight={700}
                            fontSize="14px"
                            lineHeight="short"
                            lineClamp={2}
                            flex="1"
                            minW="0"
                        >
                            {profile.displayName ?? t.pages.publicProfilePage.unnamedPlayer}
                        </Text>
                        {isOwner && (
                            <IconButton
                                aria-label={t.pages.publicProfilePage.editProfileAria}
                                size="xs"
                                variant="ghost"
                                onClick={onEditClick}
                                title={t.pages.publicProfilePage.editProfileAria}
                            >
                                <FiEdit2 />
                            </IconButton>
                        )}
                    </HStack>
                </HStack>
                {phoneEl}
            </VStack>
        )
    }

    // ── Card variant: mobile body (owner). A visitor no longer gets this at
    //    all - PlayerSpotlightCard is their identity display. ──
    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "3", md: "5" }}>
                <VStack align="stretch" gap={{ base: "2", md: "3" }}>
                    <HStack gap={{ base: "2", md: "3" }} align="start">
                        {avatarEl}
                        <VStack align="stretch" gap="0.5" flex="1" minW="0">
                            <Heading
                                size={{ base: "sm", md: "md" }}
                                lineHeight="short"
                                lineClamp={2}
                            >
                                {profile.displayName ?? t.pages.publicProfilePage.unnamedPlayer}
                            </Heading>
                        </VStack>
                    </HStack>

                    {phoneEl}
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}

/**
 * The profile's phone affordance: a tel: link when the backend actually
 * returned the number, the blurred "log in to see it" placeholder when it
 * only told us one exists, nothing at all otherwise. Shared by the sidebar
 * identity block and the spotlight card, which are the two places a phone
 * number shows up.
 */
function ProfilePhoneLink({ profile }: { profile: PublicProfile }) {
    const t = useTranslation()
    const navigate = useNavigate()

    return profile.phone ? (
                        <chakra.a
                            href={`tel:${(profile.phoneCountry ?? "")}${profile.phone}`.replace(/\s+/g, "")}
                            color="blue.fg"
                            fontSize="sm"
                            fontWeight="medium"
                            display="inline-flex"
                            alignItems="center"
                            gap="1.5"
                            _hover={{ textDecoration: "underline" }}
                        >
                            <FiPhone size={13} />
                            {/* Show the country flag too - the dial code by itself looks like
                                a generic prefix; the flag tells you the country at a glance. */}
                            {profile.phoneCountry && (
                                <chakra.span aria-hidden mr="0.5">
                                    {flagFor(profile.phoneCountry)}
                                </chakra.span>
                            )}
                            {profile.phoneCountry ? `${profile.phoneCountry} ` : ""}{profile.phone}
                        </chakra.a>
                    ) : profile.hasPhone ? (
                        // Anonymous viewer: backend redacted phone (null) but
                        // told us hasPhone=true. Show a blurred CSS placeholder
                        // that links to /prijava with a redirect back to this
                        // profile so the user lands here logged-in afterward.
                        <chakra.button
                            type="button"
                            onClick={() =>
                                navigate("/prijava", {
                                    state: { from: { pathname: window.location.pathname } },
                                })
                            }
                            color="blue.fg"
                            fontSize="sm"
                            fontWeight="medium"
                            display="inline-flex"
                            alignItems="center"
                            gap="1.5"
                            cursor="pointer"
                            bg="transparent"
                            border="0"
                            p="0"
                            title={t.pages.publicProfilePage.phone.loginToViewTitle}
                            _hover={{ textDecoration: "underline" }}
                        >
                            <FiPhone size={13} />
                            <chakra.span
                                style={{ filter: "blur(5px)", userSelect: "none" }}
                                aria-hidden
                            >
                                +385 99 123 4567
                            </chakra.span>
                            <chakra.span fontSize="xs" color="fg.muted">
                                {t.pages.publicProfilePage.phone.loginToViewSuffix}
                            </chakra.span>
                        </chakra.button>
                    ) : null
}

/**
 * Owner-only "Profil" panel - the main-content destination the desktop
 * sidebar pencil switches to, and what mobile's "Profil" tab shows
 * automatically. Defaults to a read-only summary of the account data with
 * an edit pencil that swaps in the actual EditProfileForm.
 */
function ProfileDetailsSection({ onSaved }: { onSaved: () => Promise<void> | void }) {
    const t = useTranslation()
    const [editing, setEditing] = useState(false)
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<{
        firstName: string
        lastName: string
        username: string
        phoneCountry: string | null
        phone: string | null
        avatarUrl: string | null
    } | null>(null)

    // Avatar upload/remove - this is the ONLY place the picture can be
    // changed from (the sidebar/header identity blocks are view-only, see
    // ProfileHeader). Same upload/remove logic that used to live there.
    const [avatarBusy, setAvatarBusy] = useState(false)
    const avatarInputRef = useRef<HTMLInputElement | null>(null)
    // Picking a file only stages it - AvatarCropDialog lets the user
    // position the face inside the circle before anything is uploaded.
    const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null)

    function onPickAvatar() {
        avatarInputRef.current?.click()
    }

    function onAvatarChosen(e: React.ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0]
        e.target.value = "" // reset so picking the same file again still fires onChange
        if (!f) return
        setPendingAvatarFile(f)
    }

    async function onAvatarCropConfirmed(croppedFile: File) {
        try {
            setAvatarBusy(true)
            await uploadAvatar(croppedFile)
            setPendingAvatarFile(null)
            await load()
            await onSaved()
            window.dispatchEvent(new CustomEvent("futsal:profile-updated"))
        } catch (err: any) {
            showError(
                t.pages.publicProfilePage.avatar.uploadErrorTitle,
                String(
                    err?.response?.data?.message
                        ?? err?.response?.data
                        ?? err?.message
                        ?? t.pages.publicProfilePage.avatar.genericRetry,
                ),
            )
        } finally {
            setAvatarBusy(false)
        }
    }

    async function onRemoveAvatar() {
        if (!confirm(t.pages.publicProfilePage.avatar.removeConfirm)) return
        try {
            setAvatarBusy(true)
            await deleteAvatar()
            await load()
            await onSaved()
            window.dispatchEvent(new CustomEvent("futsal:profile-updated"))
        } catch (err: any) {
            showError(
                t.pages.publicProfilePage.avatar.removeErrorTitle,
                String(err?.response?.data ?? err?.message ?? t.pages.publicProfilePage.avatar.genericRetry),
            )
        } finally {
            setAvatarBusy(false)
        }
    }

    async function load() {
        setLoading(true)
        try {
            const p = await getProfile()
            setData({
                firstName: p.firstName ?? "",
                lastName: p.lastName ?? "",
                username: p.slug ?? "",
                phoneCountry: p.phoneCountry ?? null,
                phone: p.phone ?? null,
                avatarUrl: p.avatarUrl ?? null,
            })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { load() }, [])

    if (editing) {
        return (
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "5" }}>
                    <EditProfileForm
                        bordered={false}
                        onCancel={() => setEditing(false)}
                        onSaved={async () => {
                            setEditing(false)
                            await load()
                            await onSaved()
                        }}
                    />
                </Card.Body>
            </Card.Root>
        )
    }

    return (
        <>
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "5" }}>
                <VStack align="stretch" gap="4">
                    <HStack justify="space-between" align="start">
                        <HStack gap="3" align="center">
                            <Box position="relative" flexShrink={0}>
                                <AvatarPreview
                                    src={data?.avatarUrl}
                                    alt={t.pages.publicProfilePage.avatarAlt}
                                >
                                    <Box
                                        w="56px"
                                        h="56px"
                                        rounded="full"
                                        overflow="hidden"
                                        bg="blue.subtle"
                                        color="blue.fg"
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                        fontWeight="bold"
                                        fontSize="md"
                                    >
                                        {data?.avatarUrl ? (
                                            <Image src={data.avatarUrl} alt={t.pages.publicProfilePage.avatarAlt} w="100%" h="100%" objectFit="cover" />
                                        ) : (
                                            initialsOf(`${data?.firstName ?? ""} ${data?.lastName ?? ""}`.trim())
                                        )}
                                    </Box>
                                </AvatarPreview>
                                <IconButton
                                    aria-label={data?.avatarUrl ? t.pages.publicProfilePage.avatar.changeAria : t.pages.publicProfilePage.avatar.uploadAria}
                                    title={data?.avatarUrl ? t.pages.publicProfilePage.avatar.changeAria : t.pages.publicProfilePage.avatar.uploadAria}
                                    size="2xs"
                                    position="absolute"
                                    bottom="-2px"
                                    right="-2px"
                                    rounded="full"
                                    colorPalette="pitch"
                                    variant="solid"
                                    loading={avatarBusy}
                                    onClick={onPickAvatar}
                                >
                                    <FiEdit2 />
                                </IconButton>
                                <chakra.input
                                    ref={avatarInputRef}
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    display="none"
                                    onChange={onAvatarChosen}
                                />
                            </Box>
                            <Box>
                                <Heading size="sm">{t.pages.publicProfilePage.details.heading}</Heading>
                                <Text fontSize="xs" color="fg.muted">
                                    {t.pages.publicProfilePage.details.description}
                                </Text>
                                {data?.avatarUrl && (
                                    <Button
                                        size="2xs"
                                        variant="ghost"
                                        colorPalette="red"
                                        mt="1"
                                        onClick={onRemoveAvatar}
                                        loading={avatarBusy}
                                    >
                                        <FiTrash2 /> {t.pages.publicProfilePage.avatar.removeLabel}
                                    </Button>
                                )}
                            </Box>
                        </HStack>
                        <Button size="xs" variant="outline" onClick={() => setEditing(true)}>
                            <FiEdit2 /> {t.common.edit}
                        </Button>
                    </HStack>
                    {loading || !data ? (
                        <VStack align="stretch" gap="2">
                            <Skeleton h="14" rounded="lg" />
                            <Skeleton h="14" rounded="lg" />
                            <Skeleton h="14" rounded="lg" />
                        </VStack>
                    ) : (
                        <VStack align="stretch" gap="0">
                            <DetailRow
                                icon={<FiUser size={15} />}
                                label={t.pages.publicProfilePage.details.nameLabel}
                                value={`${data.firstName} ${data.lastName}`.trim() || "-"}
                            />
                            <DetailRow
                                icon={<FiAtSign size={15} />}
                                label={t.pages.publicProfilePage.details.usernameLabel}
                                value={data.username || "-"}
                            />
                            <DetailRow
                                icon={<FiPhone size={15} />}
                                label={t.pages.publicProfilePage.details.phoneLabel}
                                value={data.phone ? `${data.phoneCountry ? data.phoneCountry + " " : ""}${data.phone}` : t.pages.publicProfilePage.details.notSet}
                                isLast
                            />
                        </VStack>
                    )}
                </VStack>
            </Card.Body>
        </Card.Root>
        <AvatarCropDialog
            file={pendingAvatarFile}
            busy={avatarBusy}
            onCancel={() => setPendingAvatarFile(null)}
            onConfirm={onAvatarCropConfirmed}
        />
        </>
    )
}

/** One row of the Profil panel's read-only data summary - icon tile + a
 *  small uppercase label above the actual value. */
function DetailRow({
    icon,
    label,
    value,
    isLast = false,
}: {
    icon: React.ReactNode
    label: string
    value: string
    isLast?: boolean
}) {
    return (
        <HStack
            gap="3"
            py="3"
            borderBottomWidth={isLast ? "0" : "1px"}
            borderColor="border.emphasized"
            align="center"
        >
            <Flex
                w="36px"
                h="36px"
                rounded="lg"
                bg="bg.subtle"
                color="pitch.500"
                align="center"
                justify="center"
                flexShrink={0}
            >
                {icon}
            </Flex>
            <VStack align="stretch" gap="0" flex="1" minW="0">
                <Text
                    fontSize="11px"
                    fontWeight={700}
                    letterSpacing="0.06em"
                    color="fg.muted"
                    textTransform="uppercase"
                >
                    {label}
                </Text>
                <Text fontSize="sm" fontWeight={600} lineClamp={1}>
                    {value}
                </Text>
            </VStack>
        </HStack>
    )
}

/** Map a dial code like "+385" to the matching flag emoji, or "" if unknown. */
function flagFor(dialCode: string | null | undefined): string {
    if (!dialCode) return ""
    const c = PHONE_COUNTRIES.find((x) => x.value === dialCode)
    if (!c) return ""
    // The label is e.g. "🇭🇷 +385" - the first space splits flag from prefix.
    const parts = c.label.split(" ")
    return parts[0] ?? ""
}

type UsernameStatus =
    | { state: "idle" }
    | { state: "unchanged" }
    | { state: "checking" }
    | { state: "ok"; normalized: string }
    | { state: "taken"; normalized: string }
    | { state: "short" }

/** Client-side approximation of the backend slug rule (backend is authoritative). */
function slugify(s: string): string {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "d")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
}

/**
 * Inline profile-edit fields (name, username, phone) - expands in place
 * under the identity row (sidebar or card) instead of opening a modal.
 * `compact` stacks the name fields vertically for the narrow sidebar.
 */
function EditProfileForm({
    compact = false,
    bordered = true,
    onCancel,
    onSaved,
}: {
    compact?: boolean
    /** false when embedded standalone in its own Card (ProfileDetailsSection) -
     *  the separator border only makes sense when sitting under another block. */
    bordered?: boolean
    onCancel: () => void
    onSaved: () => Promise<void> | void
}) {
    const t = useTranslation()
    const navigate = useNavigate()
    const [firstName, setFirstName] = useState("")
    const [lastName, setLastName] = useState("")
    const [username, setUsername] = useState("")
    const originalUsernameRef = useRef("")
    const [country, setCountry] = useState<string>("+385")
    const [phone, setPhone] = useState("")
    const [saving, setSaving] = useState(false)
    const [loadingPhone, setLoadingPhone] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [uStatus, setUStatus] = useState<UsernameStatus>({ state: "idle" })

    // Seed on mount - the form is unmounted on cancel/save, so a reopen
    // always re-fetches the current values (covers the case where the
    // underlying profile was changed elsewhere in the meantime).
    useEffect(() => {
        setError(null)
        setUStatus({ state: "idle" })
        setLoadingPhone(true)
        ;(async () => {
            try {
                const p = await getProfile()
                setFirstName(p.firstName ?? "")
                setLastName(p.lastName ?? "")
                setUsername(p.slug ?? "")
                originalUsernameRef.current = p.slug ?? ""
                setCountry(p.phoneCountry || "+385")
                setPhone(p.phone ?? "")
            } catch {
                setCountry("+385")
                setPhone("")
            } finally {
                setLoadingPhone(false)
            }
        })()
    }, [])

    // Debounced username-availability check. Skipped when unchanged from the
    // current username (which would otherwise report as "taken" by yourself).
    useEffect(() => {
        const u = username.trim()
        if (!u) { setUStatus({ state: "idle" }); return }
        if (slugify(u) === slugify(originalUsernameRef.current)) {
            setUStatus({ state: "unchanged" })
            return
        }
        if (slugify(u).length < 3) { setUStatus({ state: "short" }); return }
        setUStatus({ state: "checking" })
        let cancelled = false
        const id = window.setTimeout(async () => {
            try {
                const res = await checkUsernameAvailable(u)
                if (cancelled) return
                if (res.tooShort) setUStatus({ state: "short" })
                else if (res.available) setUStatus({ state: "ok", normalized: res.normalized })
                else setUStatus({ state: "taken", normalized: res.normalized })
            } catch {
                if (!cancelled) setUStatus({ state: "idle" })
            }
        }, 400)
        return () => { cancelled = true; clearTimeout(id) }
    }, [username])

    const usernameValid = uStatus.state === "ok" || uStatus.state === "unchanged"

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!firstName.trim() || !lastName.trim()) {
            setError(t.pages.publicProfilePage.editForm.validationNameRequired)
            return
        }
        if (!usernameValid) {
            setError(t.pages.publicProfilePage.editForm.validationUsernameUnavailable)
            return
        }
        try {
            setSaving(true)
            setError(null)
            const displayName = `${firstName.trim()} ${lastName.trim()}`.trim()
            // Firebase displayName is the source of truth - update it first so a
            // subsequent token refresh carries the new name.
            const [{ auth }, { updateProfile: fbUpdateProfile }] =
                await Promise.all([getFirebase(), import("firebase/auth")])
            const fbUser = auth.currentUser
            if (fbUser && fbUser.displayName !== displayName) {
                await fbUpdateProfile(fbUser, { displayName })
            }
            await syncProfile(displayName)
            const updated = await updateProfile({
                phoneCountry: phone.trim() ? country : null,
                phone: phone.trim() || null,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                username: username.trim(),
            })
            // Changing the username moves the public URL - navigate to the new
            // /profil/{slug} so the page doesn't 404 on the old slug.
            const newSlug = updated.slug ?? null
            if (newSlug && newSlug !== originalUsernameRef.current) {
                onCancel()
                navigate(`/profil/${newSlug}`, { replace: true })
                return
            }
            await onSaved()
        } catch (e: any) {
            const status = e?.response?.status
            if (status === 409) setError(t.pages.publicProfilePage.editForm.saveErrorUsernameTaken)
            else if (status === 400) setError(t.pages.publicProfilePage.editForm.saveErrorUsernameTooShort)
            else setError(e?.response?.data ?? e?.message ?? t.pages.publicProfilePage.editForm.saveErrorGeneric)
        } finally {
            setSaving(false)
        }
    }

    // The name fields sit side by side in the wide card, stacked in the
    // narrow sidebar (`compact`).
    const NameFields = compact ? VStack : HStack

    return (
        <Box
            borderTopWidth={bordered ? "1px" : "0"}
            borderColor="border.emphasized"
            pt={bordered ? "3" : "0"}
            mt={bordered ? "1" : "0"}
        >
            <form onSubmit={onSubmit}>
                <VStack align="stretch" gap="3">
                    <Text fontWeight={700} fontSize="sm">{t.pages.publicProfilePage.editForm.heading}</Text>
                                <NameFields gap={compact ? "3" : "3"} align={compact ? "stretch" : "start"}>
                                    <Field.Root required>
                                        <Field.Label>{t.pages.publicProfilePage.editForm.firstNameLabel} <Field.RequiredIndicator /></Field.Label>
                                        <Input
                                            size="sm"
                                            autoFocus
                                            value={firstName}
                                            onChange={(e) => setFirstName(e.target.value)}
                                            placeholder={t.pages.publicProfilePage.editForm.firstNamePlaceholder}
                                        />
                                    </Field.Root>
                                    <Field.Root required>
                                        <Field.Label>{t.pages.publicProfilePage.editForm.lastNameLabel} <Field.RequiredIndicator /></Field.Label>
                                        <Input
                                            size="sm"
                                            value={lastName}
                                            onChange={(e) => setLastName(e.target.value)}
                                            placeholder={t.pages.publicProfilePage.editForm.lastNamePlaceholder}
                                        />
                                    </Field.Root>
                                </NameFields>

                                <Field.Root required>
                                    <Field.Label>{t.pages.publicProfilePage.editForm.usernameLabel} <Field.RequiredIndicator /></Field.Label>
                                    <Input
                                        size="sm"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        placeholder={t.pages.publicProfilePage.editForm.usernamePlaceholder}
                                    />
                                    {uStatus.state === "checking" && (
                                        <Field.HelperText>{t.pages.publicProfilePage.editForm.usernameChecking}</Field.HelperText>
                                    )}
                                    {uStatus.state === "unchanged" && (
                                        <Field.HelperText>{t.pages.publicProfilePage.editForm.usernameUnchanged}</Field.HelperText>
                                    )}
                                    {uStatus.state === "ok" && (
                                        <Field.HelperText color="green.fg">{t.pages.publicProfilePage.editForm.usernameAvailable(uStatus.normalized)}</Field.HelperText>
                                    )}
                                    {uStatus.state === "taken" && (
                                        <Field.HelperText color="red.fg">{t.pages.publicProfilePage.editForm.usernameTaken(uStatus.normalized)}</Field.HelperText>
                                    )}
                                    {uStatus.state === "short" && (
                                        <Field.HelperText color="red.fg">{t.pages.publicProfilePage.editForm.usernameTooShort}</Field.HelperText>
                                    )}
                                    {uStatus.state === "idle" && (
                                        <Field.HelperText>{t.pages.publicProfilePage.editForm.usernameIdleHelp}</Field.HelperText>
                                    )}
                                </Field.Root>

                                <Field.Root>
                                    <Field.Label>
                                        {t.pages.publicProfilePage.editForm.phoneLabel}{" "}
                                        <chakra.span color="fg.muted" fontSize="xs">{t.common.optionalTag}</chakra.span>
                                    </Field.Label>
                                    {loadingPhone ? (
                                        <Skeleton h="9" />
                                    ) : (
                                        <NameFields gap="2" align="stretch" w="full">
                                            <NativeSelect.Root size="sm" w={compact ? "full" : "120px"} flexShrink={0}>
                                                <NativeSelect.Field
                                                    value={country}
                                                    onChange={(e) => setCountry((e.target as HTMLSelectElement).value)}
                                                >
                                                    {PHONE_COUNTRIES.map((c) => (
                                                        <option key={c.value} value={c.value}>{c.label}</option>
                                                    ))}
                                                </NativeSelect.Field>
                                            </NativeSelect.Root>
                                            <Input
                                                flex="1"
                                                size="sm"
                                                type="tel"
                                                inputMode="numeric"
                                                pattern="[0-9 ]*"
                                                placeholder={t.pages.publicProfilePage.editForm.phonePlaceholder}
                                                value={phone}
                                                // Strip non-digits (and non-spaces) so the saved
                                                // value never contains stray "(", "-", or "+"
                                                // characters - the country dial code lives in a
                                                // separate select.
                                                onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
                                            />
                                        </NameFields>
                                    )}
                                </Field.Root>

                                {error && (
                                    <Box borderWidth="1px" borderColor="red.muted" bg="red.subtle" rounded="md" p="2">
                                        <Text fontSize="sm" color="red.fg">{error}</Text>
                                    </Box>
                                )}

                    <HStack justify="flex-end" gap="2">
                        <Button size="sm" variant="ghost" type="button" onClick={onCancel} disabled={saving}>
                            {t.common.cancel}
                        </Button>
                        <Button
                            size="sm"
                            variant="solid"
                            colorPalette="pitch"
                            type="submit"
                            loading={saving}
                            disabled={saving || loadingPhone || !firstName.trim() || !lastName.trim() || !usernameValid}
                        >
                            {t.common.save}
                        </Button>
                    </HStack>
                </VStack>
            </form>
        </Box>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   PlayerSpotlightCard - "FIFA Ultimate Team card"-style header for the
   Turniri tab, but re-skinned in the app's own colours/tokens rather than
   FIFA's gold-chrome look: a horizontal split, photo on the left (~1/3,
   full-bleed, PlayerSilhouette placeholder when no avatar is set) and the
   profile's own achievements on the right (~2/3) - tournaments played,
   career GOALS (this specific person's scorer tally, not the team's match
   score), and a podium tally (or a "no podium yet" badge). Fully theme-
   reactive (semantic tokens only), and downloadable as a PNG via the same
   html-to-image mechanism TournamentExport.tsx uses for posters/schedules.
   Same visibility rule as CareerStatsCard right below it - everyone, hidden
   until there's a real play to show. Same gold/silver/bronze palette as the
   all-time team medal table on /statistika (StatsPage.tsx MEDAL_COLORS).
   ────────────────────────────────────────────────────────────────────── */
const SPOTLIGHT_MEDAL_COLORS = { gold: "#f5c842", silver: "#c0c5cc", bronze: "#cd8654" } as const

function PlayerSpotlightCard({
    profile,
    career,
    isOwner,
    onAddPhoto,
}: {
    profile: PublicProfile
    /** Null while the (separate, slower) career request is still in flight, or
     *  when it failed - the card still renders, with zeros. */
    career: CareerStats | null
    isOwner: boolean
    /** Owner-only: jump to the "Profil" panel, where the avatar is uploaded. */
    onAddPhoto: () => void
}) {
    const t = useTranslation()
    const s = t.pages.publicProfilePage.spotlight
    const c = t.pages.publicProfilePage.career
    const cardRef = useRef<HTMLDivElement>(null)
    const [downloading, setDownloading] = useState(false)

    const best = career?.bestPlacement ?? null
    const bestPlacementText =
        best === 1 ? s.firstPlace
        : best === 2 ? s.secondPlace
        : best === 3 ? s.thirdPlace
        : s.noBestPlacement
    const bestPlacementColor =
        best === 1 ? SPOTLIGHT_MEDAL_COLORS.gold
        : best === 2 ? SPOTLIGHT_MEDAL_COLORS.silver
        : best === 3 ? SPOTLIGHT_MEDAL_COLORS.bronze
        : undefined

    async function handleDownload() {
        if (!cardRef.current) return
        setDownloading(true)
        try {
            // html-to-image bakes in COMPUTED colours (not CSS variables), so
            // reading the card's own resolved background here is what makes
            // the exported PNG match whichever theme (light/dark) is active
            // right now, without hand-picking a colour ourselves.
            const bg = getComputedStyle(cardRef.current).backgroundColor
            const dataUrl = await toPng(cardRef.current, {
                pixelRatio: 2,
                backgroundColor: bg,
                cacheBust: true,
                // Anything marked data-no-export stays out of the shared PNG -
                // the phone number and the download button itself.
                filter: (node) => !(node instanceof HTMLElement) || node.dataset.noExport !== "1",
            })
            const a = document.createElement("a")
            a.href = dataUrl
            a.download = `${profile.slug || "igrac"}-kartica.png`
            document.body.appendChild(a)
            a.click()
            a.remove()
        } catch {
            showError(s.downloadErrorTitle, s.downloadErrorDescription)
        } finally {
            setDownloading(false)
        }
    }

    return (
        <Box
            ref={cardRef}
            position="relative"
            borderWidth="1px"
            borderColor="border.emphasized"
            rounded="xl"
            shadow="sm"
            overflow="hidden"
            bg="bg.panel"
        >
            <Grid templateColumns="minmax(96px, 1fr) 2fr" minH={{ base: "240px", md: "300px" }}>
                {/* Left ~1/3 - full-bleed photo, or the silhouette placeholder
                    on a tinted panel when no avatar is set. Tall enough that
                    a portrait photo isn't cropped down to a sliver. */}
                <Box position="relative" bg="pitch.subtle" overflow="hidden">
                    {profile.avatarUrl ? (
                        <Image
                            src={profile.avatarUrl}
                            alt={profile.displayName ?? t.pages.publicProfilePage.avatarAlt}
                            position="absolute"
                            inset="0"
                            w="full"
                            h="full"
                            objectFit="cover"
                        />
                    ) : (
                        // No avatar: silhouette, plus an "add a photo" button
                        // for the OWNER ONLY (it jumps to the Profil panel,
                        // where the upload lives). A visitor - signed in or
                        // not - just gets the silhouette: they can't add
                        // someone else's photo, so the prompt would only read
                        // as a broken control on a stranger's profile.
                        <Flex position="absolute" inset="0" direction="column" align="center" justify="center" gap="2" p="3">
                            <PlayerSilhouette size="55%" color="pitch.400" />
                            {isOwner && (
                                <Button size="xs" variant="outline" colorPalette="pitch" onClick={onAddPhoto}>
                                    {s.addPhoto}
                                </Button>
                            )}
                        </Flex>
                    )}
                </Box>

                {/* Right ~2/3 - name + the whole career summary as a plain
                    label:value list (no chips/tiles). */}
                <VStack align="stretch" justify="center" gap="3" p={{ base: "4", md: "6" }} minW="0">
                    <Text fontSize={{ base: "lg", md: "2xl" }} fontWeight="black" color="fg.ink" truncate>
                        {profile.displayName ?? s.fallbackName}
                    </Text>

                    <VStack align="stretch" gap="1.5">
                        <SpotlightRow label={s.tournamentsLabel} value={career?.tournamentsPlayed ?? 0} />
                        <SpotlightRow label={s.matchesLabel} value={career?.matchesPlayed ?? 0} />
                        <SpotlightRow label={s.goalsLabel} value={career?.playerGoals ?? 0} />
                        <HStack justify="space-between" gap="2">
                            <Text fontSize="sm" color="fg.muted">{s.recordLabel}:</Text>
                            <HStack gap="2.5" fontFamily="mono" fontSize="xs" fontWeight={800} letterSpacing="0.06em">
                                <HStack gap="1">
                                    <Box w="8px" h="8px" rounded="full" bg="pitch.500" flexShrink={0} />
                                    <Text color="fg.ink">{c.wonAbbrev(career?.matchesWon ?? 0)}</Text>
                                </HStack>
                                <HStack gap="1">
                                    <Box w="8px" h="8px" rounded="full" bg="border.emphasized" flexShrink={0} />
                                    <Text color="fg.ink">{c.drawnAbbrev(career?.matchesDrawn ?? 0)}</Text>
                                </HStack>
                                <HStack gap="1">
                                    <Box w="8px" h="8px" rounded="full" bg="accent.red" opacity={0.7} flexShrink={0} />
                                    <Text color="fg.ink">{c.lostAbbrev(career?.matchesLost ?? 0)}</Text>
                                </HStack>
                            </HStack>
                        </HStack>
                        <HStack justify="space-between" gap="2">
                            <Text fontSize="sm" color="fg.muted">{s.bestPlacementLabel}:</Text>
                            <HStack gap="1.5">
                                {bestPlacementColor && <Box w="8px" h="8px" rounded="full" bg={bestPlacementColor} flexShrink={0} />}
                                <Text fontSize="sm" fontWeight={800} color="fg.ink">{bestPlacementText}</Text>
                            </HStack>
                        </HStack>
                    </VStack>

                    {/* Contact - it used to live in the visitor identity card
                        that this one replaced, so it moves here. Kept OUT of
                        the exported PNG (data-no-export) - a downloadable,
                        shareable image shouldn't carry a phone number. */}
                    <Box data-no-export="1">
                        <ProfilePhoneLink profile={profile} />
                    </Box>
                </VStack>
            </Grid>

            <IconButton
                aria-label={s.downloadAria}
                title={s.downloadAria}
                size="xs"
                variant="solid"
                colorPalette="pitch"
                position="absolute"
                top="2"
                right="2"
                loading={downloading}
                onClick={handleDownload}
                data-no-export="1"
            >
                <FiDownload />
            </IconButton>
        </Box>
    )
}

/** One "label: value" line of the spotlight card's stat list. */
function SpotlightRow({ label, value }: { label: string; value: number | string }) {
    return (
        <HStack justify="space-between" gap="2">
            <Text fontSize="sm" color="fg.muted">{label}:</Text>
            <Text fontSize="sm" fontWeight={800} color="fg.ink">{value}</Text>
        </HStack>
    )
}


/* ──────────────────────────────────────────────────────────────────────────
   KarijeraCard - now just the two tabs under the spotlight card: "Ekipe"
   (every team this profile has played for; tapping one expands the
   tournaments played with THAT team inline) and "Turniri" (the full
   tournament history, searchable, regardless of team).

   The old behaviour where tapping a team jumped you to the Turniri tab is
   gone on purpose - each tab is now self-contained. The career headline
   stats that used to sit on top of this card moved into
   PlayerSpotlightCard.

   Visible to everyone, owner or visitor.
   ────────────────────────────────────────────────────────────────────── */
function KarijeraCard({
    profile,
    search,
    setSearch,
}: {
    profile: PublicProfile
    search: string
    setSearch: (v: string) => void
}) {
    const t = useTranslation()
    const tt = t.pages.publicProfilePage.tournamentsTab
    const [tab, setTab] = useState<"ekipe" | "turniri">("turniri")

    /** Full tournament history, search-filtered. Not team-filtered anymore -
     *  per-team lists live inside the Ekipe tab's expanded rows. */
    const searchedTournaments = useMemo<MyTournamentParticipation[]>(() => {
        const q = search.trim().toLowerCase()
        if (!q) return profile.tournaments
        return profile.tournaments.filter((tp) => {
            const blob = `${tp.tournamentName} ${tp.tournamentLocation ?? ""} ${tp.teamName}`.toLowerCase()
            return blob.includes(q)
        })
    }, [profile.tournaments, search])

    const emptyBox = (label: string) => (
        <Box borderWidth="1px" borderColor="border.emphasized" borderStyle="dashed" rounded="md" py="6" px="4" textAlign="center">
            <Text color="fg.muted" fontSize="sm">{label}</Text>
        </Box>
    )

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "5" }}>
                <Tabs.Root
                    value={tab}
                    onValueChange={(d) => setTab(d.value as "ekipe" | "turniri")}
                    variant="line"
                >
                    <Tabs.List>
                        <Tabs.Trigger value="ekipe">{tt.teamsTabLabel}</Tabs.Trigger>
                        <Tabs.Trigger value="turniri">{tt.heading}</Tabs.Trigger>
                    </Tabs.List>

                    <Tabs.Content value="ekipe">
                        <VStack align="stretch" gap="2.5" pt="1">
                            {profile.teams.length === 0
                                ? emptyBox(tt.emptyNoTournaments)
                                : profile.teams.map((team) => (
                                    <TeamAccordionRow
                                        key={team.name}
                                        slug={profile.slug}
                                        team={team}
                                        tournaments={profile.tournaments.filter(
                                            (tp) => teamKey(tp.teamName) === teamKey(team.name),
                                        )}
                                    />
                                ))}
                        </VStack>
                    </Tabs.Content>

                    <Tabs.Content value="turniri">
                        <VStack align="stretch" gap="3" pt="1">
                            <HStack justify="space-between" wrap="wrap" gap="2">
                                <Input
                                    size="sm"
                                    flex="1"
                                    minW="200px"
                                    placeholder={tt.searchPlaceholder}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                                <Badge variant="subtle" colorPalette="pitch">
                                    {tt.countBadge(searchedTournaments.length)}
                                </Badge>
                            </HStack>

                            {profile.tournaments.length === 0 ? (
                                emptyBox(tt.emptyNoTournaments)
                            ) : searchedTournaments.length === 0 ? (
                                emptyBox(tt.noResults)
                            ) : (
                                <VStack align="stretch" gap="2.5">
                                    {searchedTournaments.map((row) => (
                                        <TournamentRow
                                            key={`${row.tournamentUuid}-${row.teamId}`}
                                            slug={profile.slug}
                                            row={row}
                                        />
                                    ))}
                                </VStack>
                            )}
                        </VStack>
                    </Tabs.Content>
                </Tabs.Root>
            </Card.Body>
        </Card.Root>
    )
}

/** One team in the "Ekipe" tab: a header row that expands to the tournaments
 *  this profile played with that team (each of those still expands further
 *  into its own match history, via TournamentRow). */
function TeamAccordionRow({
    slug,
    team,
    tournaments,
}: {
    slug: string
    team: TeamSummary
    tournaments: MyTournamentParticipation[]
}) {
    const t = useTranslation()
    const tt = t.pages.publicProfilePage.tournamentsTab
    const [open, setOpen] = useState(false)

    return (
        <Box borderWidth="1px" borderColor="border.emphasized" rounded="md" shadow="sm" overflow="hidden">
            <Box
                as="button"
                onClick={() => setOpen((v) => !v)}
                w="100%"
                p="3"
                textAlign="left"
                _hover={{ bg: "bg.subtle" }}
                transition="background 0.1s"
            >
                <HStack justify="space-between" gap="3">
                    <HStack gap="2" flex="1" minW="0">
                        {open ? <FiChevronDown /> : <FiChevronRight />}
                        <Text fontWeight="semibold" lineHeight="short" truncate>{team.name}</Text>
                        {team.partnerSlug && (
                            <Box color="blue.fg" title={tt.partnerSharedTitle} flexShrink={0}>
                                <FiShare2 size={11} />
                            </Box>
                        )}
                    </HStack>
                    <HStack gap="2" flexShrink={0}>
                        {team.wins > 0 && (
                            <HStack gap="1" color="yellow.fg">
                                <FaTrophy size={11} />
                                <Text fontSize="xs" fontWeight={700}>{team.wins}</Text>
                            </HStack>
                        )}
                        <Badge variant="subtle" colorPalette="pitch" size="sm">
                            {tt.countBadge(team.tournamentCount)}
                        </Badge>
                    </HStack>
                </HStack>
            </Box>

            {open && (
                <Box borderTopWidth="1px" borderColor="border.emphasized" bg="bg.subtle" p="3">
                    <VStack align="stretch" gap="2.5">
                        {/* Partner link - a separate element rather than part of
                            the header button (button-in-button is invalid HTML). */}
                        {team.partnerSlug && (
                            <HStack gap="2" fontSize="sm" color="fg.muted">
                                <FiShare2 size={14} />
                                <Text>
                                    {tt.coOwnerLabel}{" "}
                                    <RouterLink
                                        to={`/profil/${team.partnerSlug}`}
                                        style={{ color: "var(--chakra-colors-blue-fg)", fontWeight: 500 }}
                                    >
                                        {team.partnerName || team.partnerSlug}
                                    </RouterLink>
                                </Text>
                            </HStack>
                        )}

                        {tournaments.length === 0 ? (
                            <Text fontSize="sm" color="fg.muted">{tt.emptyNoTournaments}</Text>
                        ) : (
                            tournaments.map((row) => (
                                <TournamentRow
                                    key={`${row.tournamentUuid}-${row.teamId}`}
                                    slug={slug}
                                    row={row}
                                />
                            ))
                        )}
                    </VStack>
                </Box>
            )}
        </Box>
    )
}

/** A tournament row that toggles open to fetch + show match-by-match history. */
function TournamentRow({
    slug,
    row,
}: {
    slug: string
    row: MyTournamentParticipation
}) {
    const t = useTranslation()
    const [open, setOpen] = useState(false)
    const [history, setHistory] = useState<TeamMatchHistory | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function toggle() {
        const next = !open
        setOpen(next)
        if (next && !history && !loading) {
            try {
                setLoading(true)
                setError(null)
                setHistory(await getTeamMatchHistory(slug, row.teamId))
            } catch (e: any) {
                setError(e?.response?.data ?? e?.message ?? t.pages.publicProfilePage.tournamentRow.matchHistoryError)
            } finally {
                setLoading(false)
            }
        }
    }

    let badge: { palette: string; label: string; icon?: React.ReactNode } | null = null
    if (row.isWinner) {
        badge = { palette: "yellow", label: t.pages.publicProfilePage.tournamentRow.winner, icon: <FaTrophy size={11} color="#F5C518" /> }
    } else if (row.pendingApproval) {
        badge = { palette: "yellow", label: t.pages.publicProfilePage.tournamentRow.pendingApproval }
    } else if (row.eliminated) {
        badge = { palette: "red", label: t.pages.publicProfilePage.tournamentRow.eliminated }
    } else if (row.tournamentStatus === "STARTED") {
        badge = { palette: "green", label: t.pages.publicProfilePage.tournamentRow.active }
    } else if (row.tournamentStatus === "FINISHED") {
        badge = { palette: "gray", label: t.pages.publicProfilePage.tournamentRow.finished }
    } else {
        badge = { palette: "blue", label: t.pages.publicProfilePage.tournamentRow.upcoming }
    }

    return (
        <Box
            borderWidth="1px"
            borderColor="border.emphasized"
            rounded="md"
            shadow="sm"
            overflow="hidden"
        >
            <Box
                as="button"
                onClick={toggle}
                w="100%"
                p="3"
                textAlign="left"
                _hover={{ bg: "bg.subtle" }}
                transition="background 0.1s"
            >
                <HStack justify="space-between" gap="3" wrap="wrap" mb="1.5">
                    <HStack gap="2" flex="1" minW="0">
                        {open ? <FiChevronDown /> : <FiChevronRight />}
                        <Text fontWeight="semibold" lineHeight="short">
                            {row.tournamentName}
                        </Text>
                    </HStack>
                    {badge && (
                        <Badge variant="solid" colorPalette={badge.palette as any} size="sm">
                            <HStack gap="1">
                                {badge.icon}
                                {badge.label}
                            </HStack>
                        </Badge>
                    )}
                </HStack>
                <HStack gap="3" wrap="wrap" fontSize="xs" color="fg.muted" pl="6">
                    {row.tournamentStartAt && (
                        <HStack gap="1"><FiCalendar /><Text>{formatDate(row.tournamentStartAt)}</Text></HStack>
                    )}
                    {row.tournamentLocation && (
                        <HStack gap="1"><FiMapPin /><Text>{row.tournamentLocation}</Text></HStack>
                    )}
                    {!row.pendingApproval && row.wins != null && row.losses != null && (
                        <Badge variant="subtle" colorPalette="gray" size="sm">{t.pages.publicProfilePage.tournamentRow.record(row.wins, row.losses)}</Badge>
                    )}
                    {row.extraLife && <Badge variant="subtle" colorPalette="red" size="sm">{t.pages.publicProfilePage.tournamentRow.extraLife}</Badge>}
                </HStack>
            </Box>

            {open && (
                <Box borderTopWidth="1px" borderColor="border.emphasized" bg="bg.subtle" p="3">
                    {loading ? (
                        <HStack gap="2" color="fg.muted"><Spinner size="xs" /><Text fontSize="sm">{t.pages.publicProfilePage.loadingMatches}</Text></HStack>
                    ) : error ? (
                        <Text fontSize="sm" color="red.fg">{error}</Text>
                    ) : !history || history.matches.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted">{t.pages.publicProfilePage.noMatchesPlayed}</Text>
                    ) : (
                        <VStack align="stretch" gap="1.5">
                            {history.matches.map((m, i) => (
                                <MatchRow
                                    key={`${m.matchId ?? m.roundNumber ?? "?"}-${i}`}
                                    m={m}
                                    tournamentRef={row.tournamentSlug ?? row.tournamentUuid}
                                />
                            ))}
                            <HStack pt="2" justify="flex-end">
                                <Button size="xs" variant="ghost" asChild>
                                    <RouterLink to={`/turniri/${row.tournamentSlug ?? row.tournamentUuid}`}>
                                        {t.pages.publicProfilePage.openTournament}
                                    </RouterLink>
                                </Button>
                            </HStack>
                        </VStack>
                    )}
                </Box>
            )}
        </Box>
    )
}

function MatchRow({
    m,
    tournamentRef,
}: {
    m: TeamMatchHistory["matches"][number]
    /** Slug (preferred) or uuid of the tournament the match belongs to. */
    tournamentRef: string | null
}) {
    const t = useTranslation()
    const mr = t.pages.publicProfilePage.matchRow
    const finished = m.status === "FINISHED" || m.status === "COMPLETED"
    const wonLabel = m.isBye
        ? mr.bye
        : m.won === true ? mr.win
        : m.won === false ? mr.loss
        : finished ? mr.resolved : mr.inProgress
    const wonColor = m.won === true ? "green" : m.won === false ? "red" : "gray"

    // A bye has no match page worth opening, and a row from an older payload
    // may not carry a matchId - both stay non-clickable.
    const to = !m.isBye && m.matchId != null && tournamentRef
        ? `/turniri/${tournamentRef}/utakmica/${m.matchId}`
        : null

    const body = (
        <HStack
            gap="2.5"
            wrap="wrap"
            borderWidth="1px"
            borderColor="border.emphasized"
            bg="bg"
            rounded="sm"
            px="2.5"
            py="1.5"
            fontSize="sm"
            w="100%"
            textAlign="left"
            transition="background 0.1s"
            _hover={to ? { bg: "bg.subtle", borderColor: "pitch.500" } : undefined}
        >
            <Badge variant="outline" colorPalette="pitch" size="sm">
                {mr.round(m.roundNumber ?? "?")}
            </Badge>
            {m.tableNo != null && (
                <Text color="fg.muted" fontSize="xs">{mr.table(m.tableNo)}</Text>
            )}
            <Text flex="1" minW="0" lineClamp={1}>
                {mr.vs} <chakra.b>{m.opponentName ?? (m.isBye ? "-" : "?")}</chakra.b>
            </Text>

            {/* This person's own contribution in the match - goals first, then
                cards. Hidden entirely when there's nothing to show. */}
            <PlayerMatchMarks m={m} />

            {(m.ourScore != null || m.opponentScore != null) && (
                <Text fontFamily="mono" fontWeight="semibold">
                    {m.ourScore ?? 0} : {m.opponentScore ?? 0}
                </Text>
            )}
            <Badge variant="solid" colorPalette={wonColor as any} size="sm">
                {wonLabel}
            </Badge>
        </HStack>
    )

    if (!to) return body
    return (
        <RouterLink to={to} style={{ display: "block", width: "100%" }} title={mr.openMatch}>
            {body}
        </RouterLink>
    )
}

/** The little "⚽×2 · 🟨" strip: what the profile's player did in one match. */
function PlayerMatchMarks({ m }: { m: TeamMatchHistory["matches"][number] }) {
    const t = useTranslation()
    const mr = t.pages.publicProfilePage.matchRow
    const goals = m.goals ?? 0
    const ownGoals = m.ownGoals ?? 0
    const yellow = m.yellowCards ?? 0
    const red = m.redCards ?? 0
    if (goals + ownGoals + yellow + red === 0) return null

    return (
        <HStack gap="1.5" flexShrink={0}>
            {goals > 0 && (
                <HStack gap="0.5" title={mr.goalsTitle(goals)}>
                    <Text as="span" fontSize="sm" lineHeight="1">⚽</Text>
                    {goals > 1 && <Text fontSize="xs" fontWeight={800} color="fg.muted">×{goals}</Text>}
                </HStack>
            )}
            {ownGoals > 0 && (
                <HStack gap="0.5" title={mr.ownGoalsTitle(ownGoals)}>
                    <Text as="span" fontSize="sm" lineHeight="1" opacity={0.6}>⚽</Text>
                    <Text fontSize="xs" fontWeight={800} color="accent.red">AG{ownGoals > 1 ? `×${ownGoals}` : ""}</Text>
                </HStack>
            )}
            {yellow > 0 && (
                <HStack gap="0.5" title={mr.yellowCardsTitle(yellow)}>
                    <Box w="9px" h="12px" rounded="1px" bg="#f5c842" flexShrink={0} />
                    {yellow > 1 && <Text fontSize="xs" fontWeight={800} color="fg.muted">×{yellow}</Text>}
                </HStack>
            )}
            {red > 0 && (
                <HStack gap="0.5" title={mr.redCardsTitle(red)}>
                    <Box w="9px" h="12px" rounded="1px" bg="accent.red" flexShrink={0} />
                    {red > 1 && <Text fontSize="xs" fontWeight={800} color="fg.muted">×{red}</Text>}
                </HStack>
            )}
        </HStack>
    )
}

/* -------------------------------------------------------------------------- */
/* Owner-only edit cards                                                       */
/* -------------------------------------------------------------------------- */

/**
 * App-level preferences, rendered inside the Profil panel (no separate
 * tab). Right now just the theme toggle (which used to live on the
 * navbar). Theme is persisted per user via PUT /user/me/profile colorMode,
 * so the choice follows the user across devices. ThemeSync handles the
 * read direction on login.
 */
function SettingsCard() {
    const t = useTranslation()
    const activeLocale = useLocale()

    // This card only ever renders for the profile owner (isOwner-gated at
    // the call site), so a signed-in user is guaranteed here - unlike the
    // navbar's LanguagePicker, no `if (user)` check is needed before saving.
    const pickLanguage = (loc: Locale) => {
        setLocale(loc)
        updateLanguage(loc).catch(() => {
            // Network failed - local switch is still right; the next login
            // elsewhere will resync via LocaleSync.
        })
    }

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "5" }}>
                <VStack align="stretch" gap="4">
                    <Box>
                        <Heading size="sm">{t.pages.publicProfilePage.settings.heading}</Heading>
                        <Text fontSize="xs" color="fg.muted">
                            {t.pages.publicProfilePage.settings.description}
                        </Text>
                    </Box>

                    <Box>
                        <Text fontSize="sm" fontWeight="medium" mb="2">{t.pages.publicProfilePage.settings.themeLabel}</Text>
                        <ThemeSwitch size="lg" />
                    </Box>

                    <Box>
                        <Text fontSize="sm" fontWeight="medium" mb="2">{t.pages.publicProfilePage.settings.languageLabel}</Text>
                        <HStack gap="2" wrap="wrap">
                            {(["hr", "en", "sl"] as const).map((loc) => (
                                <Button
                                    key={loc}
                                    size="sm"
                                    variant={activeLocale === loc ? "solid" : "outline"}
                                    colorPalette={activeLocale === loc ? "blue" : "gray"}
                                    onClick={() => pickLanguage(loc)}
                                >
                                    <chakra.span mr="1">{LOCALE_LABELS[loc].flag}</chakra.span> {LOCALE_LABELS[loc].name}
                                </Button>
                            ))}
                        </HStack>
                        <Text fontSize="xs" color="fg.muted" mt="2">
                            {t.pages.publicProfilePage.settings.languageSyncNote}
                        </Text>
                    </Box>
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}

/* ─── "Jesi li ti ovaj igrač?" - the profile's read-only half ────────────
   The claiming itself lives app-level in PlayerClaimFirstRun (mounted in
   App.tsx), so it can also fire on the very first page after registering.
   All the profile needs to know is whether an exact-name match still exists
   for this account, and whether they answered "nisam igrač": when nothing
   matches and nothing is linked, the manual admin-approved request is
   offered instead. Read-only - this probe never mutates anything. */
function usePlayerClaimState(uid: string | undefined, ready: boolean) {
    const [state, setState] = useState<PlayerClaimStateRow | null>(null)

    useEffect(() => {
        if (!uid || !ready) { setState(null); return }
        let cancelled = false
        getPlayerClaimState()
            .then((s) => { if (!cancelled) setState(s) })
            .catch(() => { if (!cancelled) setState(null) })
        return () => { cancelled = true }
    }, [uid, ready])

    return state
}
