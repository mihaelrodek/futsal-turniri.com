import React, { useEffect, useMemo, useRef, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Card,
    chakra,
    Field,
    Flex,
    Heading,
    HStack,
    IconButton,
    Image,
    Input,
    NativeSelect,
    Skeleton,
    Spinner,
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
import { deleteAvatar, getProfile, syncProfile, updateLanguage, updateProfile, uploadAvatar } from "../api/userMe"
import { checkUsernameAvailable } from "../api/auth"
import AvatarPreview from "../components/AvatarPreview"
import AvatarCropDialog from "../components/AvatarCropDialog"
import { showError } from "../toaster"
import { useAuth } from "../auth/AuthContext"
import AdminDashboardTab from "../components/AdminDashboardTab"
import SpectoConnectionCard from "../components/SpectoConnectionCard"
import AdminPlayersListTab from "../components/AdminPlayersListTab"
import AdminTeamDatabaseTab from "../components/AdminTeamDatabaseTab"
import MyRecordingsTab from "../components/MyRecordingsTab"
import AdminRecordingRequestsTab from "../components/AdminRecordingRequestsTab"
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

    const [activeTeam, setActiveTeam] = useState<string | null>(null) // team name (case preserved)
    const [search, setSearch] = useState("")

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
                setActiveTeam(null)
                setSearch("")
                const data = await getPublicProfile(slug)
                if (cancelled) return
                setProfile(data)
                if (data.teams.length > 0) setActiveTeam(data.teams[0].name)
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

    /** Tournaments filtered to the active team, then optionally to the search query. */
    const filteredTournaments = useMemo<MyTournamentParticipation[]>(() => {
        if (!profile) return []
        const q = search.trim().toLowerCase()
        return profile.tournaments
            .filter((tp) => activeTeam == null || teamKey(tp.teamName) === teamKey(activeTeam))
            .filter((tp) => {
                if (!q) return true
                const blob = `${tp.tournamentName} ${tp.tournamentLocation ?? ""}`.toLowerCase()
                return blob.includes(q)
            })
    }, [profile, activeTeam, search])

    // Owner detection - backend deliberately doesn't ship the target UID, so
    // we compare slugs. mySlug is populated after /user/me/sync runs.
    const isOwner = !!profile && !!user?.uid && !!mySlug && mySlug === profile.slug

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
            {/* Profile header - the identity card. Only for VISITORS here -
                the owner's own name/avatar lives in the desktop sidebar and,
                on mobile, in the persistent header above the tab bar, so it
                never needs repeating inside a tab. */}
            {!isOwner && (
                <ProfileHeader
                    profile={profile}
                    isOwner={isOwner}
                />
            )}

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

            {/* === KARIJERA card - always above the Turniri tab. Visible to
                  everyone, owner or visitor. Hidden until career fetch
                  resolves and the user has actually played anything. === */}
            {(!isOwner || profileTab === "turniri") && career && career.tournamentsPlayed > 0 && (
                <CareerStatsCard career={career} />
            )}

            {/* === TURNIRI tab (default, shown for everyone) === */}
            {(!isOwner || profileTab === "turniri") && (
                <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                    <Card.Body p={{ base: "4", md: "5" }}>
                        <VStack align="stretch" gap="3">
                            <HStack justify="space-between" wrap="wrap" gap="2">
                                <Heading size="md">
                                    {t.pages.publicProfilePage.tournamentsTab.heading}
                                    {activeTeam ? <chakra.span color="fg.muted"> - {activeTeam}</chakra.span> : null}
                                </Heading>
                                {activeTeam && profile.teams.length > 0 && (
                                    <Badge variant="subtle" colorPalette="pitch">
                                        {t.pages.publicProfilePage.tournamentsTab.countBadge(filteredTournaments.length)}
                                    </Badge>
                                )}
                            </HStack>

                            {/* Team picker - filter chips */}
                            {profile.teams.length === 0 ? (
                                <Box
                                    borderWidth="1px"
                                    borderColor="border.emphasized"
                                    borderStyle="dashed"
                                    rounded="md"
                                    py="6"
                                    px="4"
                                    textAlign="center"
                                >
                                    <Text color="fg.muted" fontSize="sm">
                                        {t.pages.publicProfilePage.tournamentsTab.emptyNoTournaments}
                                    </Text>
                                </Box>
                            ) : (
                                <HStack gap="2" wrap="wrap">
                                    {profile.teams.map((p) => (
                                        <TeamChip
                                            key={p.name}
                                            team={p}
                                            active={activeTeam != null && teamKey(activeTeam) === teamKey(p.name)}
                                            onClick={() => setActiveTeam(p.name)}
                                        />
                                    ))}
                                </HStack>
                            )}

                            {/* Partner link for the currently selected team.
                                Rendered as a separate clickable element
                                because nesting it inside the chip button is
                                an HTML anti-pattern (button-in-button). */}
                            {activeTeam && (() => {
                                const cur = profile.teams.find(
                                    (p) => teamKey(p.name) === teamKey(activeTeam),
                                )
                                if (!cur || !cur.partnerSlug) return null
                                return (
                                    <HStack gap="2" fontSize="sm" color="fg.muted">
                                        <FiShare2 size={14} />
                                        <Text>
                                            {t.pages.publicProfilePage.tournamentsTab.coOwnerLabel}{" "}
                                            <RouterLink
                                                to={`/profil/${cur.partnerSlug}`}
                                                style={{
                                                    color: "var(--chakra-colors-blue-fg)",
                                                    fontWeight: 500,
                                                }}
                                            >
                                                {cur.partnerName || cur.partnerSlug}
                                            </RouterLink>
                                        </Text>
                                    </HStack>
                                )
                            })()}

                            {/* Tournament list - only after a team is picked */}
                            {activeTeam && (
                                <>
                                    <Box borderTopWidth="1px" borderColor="border.emphasized" mx="-4" my="1" />
                                    <Input
                                        size="sm"
                                        placeholder={t.pages.publicProfilePage.tournamentsTab.searchPlaceholder}
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                    {filteredTournaments.length === 0 ? (
                                        <Box
                                            borderWidth="1px"
                                            borderColor="border.emphasized"
                                            borderStyle="dashed"
                                            rounded="md"
                                            py="6"
                                            px="4"
                                            textAlign="center"
                                        >
                                            <Text color="fg.muted" fontSize="sm">
                                                {t.pages.publicProfilePage.tournamentsTab.noResults}
                                            </Text>
                                        </Box>
                                    ) : (
                                        <VStack align="stretch" gap="2.5">
                                            {filteredTournaments.map((t) => (
                                                <TournamentRow
                                                    key={`${t.tournamentUuid}-${t.teamId}`}
                                                    slug={profile.slug}
                                                    row={t}
                                                />
                                            ))}
                                        </VStack>
                                    )}
                                </>
                            )}
                        </VStack>
                    </Card.Body>
                </Card.Root>
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
    // For the "blurred phone → click to log in" affordance below.
    const navigate = useNavigate()

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

    const phoneEl = profile.phone ? (
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

    // ── Card variant: mobile body (owner) + any visitor view. Editing
    //    (owner) doesn't happen here - it's the ProfileDetailsSection panel
    //    rendered right below, automatically, on the "Profil" tab. ──
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
   CareerStatsCard - aggregate W/D/L + goals across every team the user
   has played as. Rendered at the top of the Turniri tab.

   Visible to everyone (owner and visitors). When `tournamentsPlayed`
   comes back as 0 the parent doesn't render this at all, so we don't
   have to special-case empty-state inside.
   ────────────────────────────────────────────────────────────────────── */
function CareerStatsCard({ career }: { career: CareerStats }) {
    const t = useTranslation()
    const winRate = career.matchesPlayed > 0
        ? Math.round((career.matchesWon / career.matchesPlayed) * 100)
        : 0
    const goalDiff = career.goalsFor - career.goalsAgainst
    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "5" }}>
                <VStack align="stretch" gap="4">
                    <HStack justify="space-between" wrap="wrap" gap="2">
                        <Heading size="md">{t.pages.publicProfilePage.career.heading}</Heading>
                        {career.topTeamName && (
                            <Badge variant="subtle" colorPalette="pitch" fontSize="xs">
                                {career.topTeamName}
                            </Badge>
                        )}
                    </HStack>

                    {/* Headline stats - 4-up grid that wraps to 2-up on
                        narrow screens. Bricolage / mono digits set them
                        apart from prose. */}
                    <Box
                        display="grid"
                        gridTemplateColumns={{ base: "repeat(2, 1fr)", md: "repeat(4, 1fr)" }}
                        gap={{ base: "3", md: "4" }}
                    >
                        <CareerStat label={t.pages.publicProfilePage.career.tournaments} value={career.tournamentsPlayed} sub={career.tournamentsWon > 0 ? t.pages.publicProfilePage.career.tournamentsWon(career.tournamentsWon) : null} />
                        <CareerStat label={t.pages.publicProfilePage.career.matches} value={career.matchesPlayed} sub={career.matchesPlayed > 0 ? t.pages.publicProfilePage.career.winRate(winRate) : null} />
                        <CareerStat label={t.pages.publicProfilePage.career.goals} value={career.goalsFor} sub={t.pages.publicProfilePage.career.goalsAgainst(career.goalsAgainst)} />
                        <CareerStat
                            label={t.pages.publicProfilePage.career.goalDiff}
                            value={goalDiff > 0 ? `+${goalDiff}` : `${goalDiff}`}
                            valueColor={goalDiff > 0 ? "pitch.600" : goalDiff < 0 ? "accent.red" : "fg"}
                            sub={null}
                        />
                    </Box>

                    {/* W/D/L breakdown bar. Width proportional to count.
                        Skip when nothing finished yet to keep things tidy. */}
                    {career.matchesPlayed > 0 && (
                        <VStack align="stretch" gap="1.5">
                            <Box
                                h="8px"
                                rounded="full"
                                overflow="hidden"
                                bg="bg.subtle"
                                display="flex"
                            >
                                <Box
                                    flex={career.matchesWon}
                                    bg="pitch.500"
                                />
                                <Box
                                    flex={career.matchesDrawn}
                                    bg="border.emphasized"
                                />
                                <Box
                                    flex={career.matchesLost}
                                    bg="accent.red"
                                    opacity={0.7}
                                />
                            </Box>
                            <HStack
                                gap="3"
                                fontFamily="mono"
                                fontSize="11px"
                                fontWeight={700}
                                color="fg.muted"
                                letterSpacing="0.1em"
                            >
                                <HStack gap="1">
                                    <Box w="8px" h="8px" rounded="full" bg="pitch.500" />
                                    <Text>{t.pages.publicProfilePage.career.wonAbbrev(career.matchesWon)}</Text>
                                </HStack>
                                <HStack gap="1">
                                    <Box w="8px" h="8px" rounded="full" bg="border.emphasized" />
                                    <Text>{t.pages.publicProfilePage.career.drawnAbbrev(career.matchesDrawn)}</Text>
                                </HStack>
                                <HStack gap="1">
                                    <Box w="8px" h="8px" rounded="full" bg="accent.red" opacity={0.7} />
                                    <Text>{t.pages.publicProfilePage.career.lostAbbrev(career.matchesLost)}</Text>
                                </HStack>
                            </HStack>
                        </VStack>
                    )}

                    {/* Recent tournaments - quick scrollable strip. */}
                    {career.recent.length > 0 && (
                        <VStack align="stretch" gap="2">
                            <Text
                                fontFamily="mono"
                                fontSize="11px"
                                fontWeight={800}
                                letterSpacing="0.15em"
                                color="fg.muted"
                            >
                                {t.pages.publicProfilePage.career.recentTournamentsLabel}
                            </Text>
                            <VStack align="stretch" gap="1.5">
                                {career.recent.map((r, i) => (
                                    <HStack
                                        key={`${r.tournamentSlug ?? i}-${i}`}
                                        justify="space-between"
                                        px="3"
                                        py="2"
                                        rounded="md"
                                        bg="bg.subtle"
                                        borderLeftWidth="3px"
                                        borderColor={
                                            r.result === "Pobjeda"
                                                ? "pitch.500"
                                                : r.result === "Eliminacija"
                                                  ? "accent.red"
                                                  : "border.emphasized"
                                        }
                                    >
                                        <VStack align="start" gap="0" flex="1" minW="0">
                                            <Text
                                                fontSize="sm"
                                                fontWeight={600}
                                                truncate
                                            >
                                                {r.tournamentName ?? "-"}
                                            </Text>
                                            <Text fontSize="xs" color="fg.muted" truncate>
                                                {r.teamName ?? "-"}
                                            </Text>
                                        </VStack>
                                        <Badge
                                            variant="subtle"
                                            colorPalette={
                                                r.result === "Pobjeda"
                                                    ? "pitch"
                                                    : r.result === "Eliminacija"
                                                      ? "red"
                                                      : "gray"
                                            }
                                            fontSize="10px"
                                        >
                                            {r.result}
                                        </Badge>
                                    </HStack>
                                ))}
                            </VStack>
                        </VStack>
                    )}
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}

function CareerStat({
    label,
    value,
    sub,
    valueColor,
}: {
    label: string
    value: number | string
    sub: string | null
    valueColor?: string
}) {
    return (
        <VStack align="start" gap="0.5">
            <Text
                fontFamily="mono"
                fontSize="10px"
                fontWeight={800}
                letterSpacing="0.15em"
                color="fg.muted"
            >
                {label.toUpperCase()}
            </Text>
            <Text
                fontSize={{ base: "22px", md: "28px" }}
                fontWeight={800}
                color={valueColor ?? "fg"}
                lineHeight={1}
                letterSpacing="-0.02em"
            >
                {value}
            </Text>
            {sub && (
                <Text fontSize="xs" color="fg.muted">
                    {sub}
                </Text>
            )}
        </VStack>
    )
}

function TeamChip({
    team,
    active,
    onClick,
}: {
    team: TeamSummary
    active: boolean
    onClick: () => void
}) {
    const t = useTranslation()
    return (
        <Button
            size="sm"
            variant={active ? "solid" : "outline"}
            colorPalette={active ? "blue" : "gray"}
            onClick={onClick}
            rounded="full"
            px="3.5"
        >
            <HStack gap="1.5">
                <Text fontWeight="medium">{team.name}</Text>
                <Text fontSize="xs" opacity={0.85}>
                    · {team.tournamentCount}
                </Text>
                {team.wins > 0 && (
                    <HStack gap="0.5" color={active ? "yellow.200" : "yellow.fg"}>
                        <FaTrophy size={10} />
                        <Text fontSize="xs">{team.wins}</Text>
                    </HStack>
                )}
                {team.partnerSlug && (
                    // Tiny "shared" indicator - the actual partner link
                    // renders below the chip strip so it stays accessible
                    // (no nested clickable inside the button).
                    <Box color={active ? "blue.100" : "blue.fg"} title={t.pages.publicProfilePage.tournamentsTab.partnerSharedTitle}>
                        <FiShare2 size={11} />
                    </Box>
                )}
            </HStack>
        </Button>
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
                    {!row.pendingApproval && (
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
                                <MatchRow key={`${m.roundNumber ?? "?"}-${i}`} m={m} />
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

function MatchRow({ m }: { m: TeamMatchHistory["matches"][number] }) {
    const t = useTranslation()
    const finished = m.status === "FINISHED" || m.status === "COMPLETED"
    const wonLabel = m.isBye
        ? t.pages.publicProfilePage.matchRow.bye
        : m.won === true ? t.pages.publicProfilePage.matchRow.win
        : m.won === false ? t.pages.publicProfilePage.matchRow.loss
        : finished ? t.pages.publicProfilePage.matchRow.resolved : t.pages.publicProfilePage.matchRow.inProgress
    const wonColor = m.won === true ? "green" : m.won === false ? "red" : "gray"

    return (
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
        >
            <Badge variant="outline" colorPalette="pitch" size="sm">
                {t.pages.publicProfilePage.matchRow.round(m.roundNumber ?? "?")}
            </Badge>
            {m.tableNo != null && (
                <Text color="fg.muted" fontSize="xs">{t.pages.publicProfilePage.matchRow.table(m.tableNo)}</Text>
            )}
            <Text flex="1" minW="0" lineClamp={1}>
                {t.pages.publicProfilePage.matchRow.vs} <chakra.b>{m.opponentName ?? (m.isBye ? "-" : "?")}</chakra.b>
            </Text>
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
