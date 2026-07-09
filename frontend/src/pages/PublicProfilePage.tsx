import React, { useEffect, useMemo, useRef, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Card,
    chakra,
    Dialog,
    Field,
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
    FiCalendar,
    FiChevronDown,
    FiChevronRight,
    FiEdit2,
    FiMapPin,
    FiMoon,
    FiPhone,
    FiShare2,
    FiSun,
    FiTrash2,
} from "react-icons/fi"
import { useColorMode } from "../color-mode"
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
import { deleteAvatar, getProfile, syncProfile, updateColorMode, updateProfile, uploadAvatar } from "../api/userMe"
import { checkUsernameAvailable } from "../api/auth"
import AvatarPreview from "../components/AvatarPreview"
import { showError } from "../toaster"
import { useAuth } from "../auth/AuthContext"
import AdminDashboardTab from "../components/AdminDashboardTab"
import AdminPlayersListTab from "../components/AdminPlayersListTab"
import { useDocumentHead } from "../hooks/useDocumentHead"

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

export default function PublicProfilePage() {
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
    // see Turniri only.
    const [profileTab, setProfileTab] = useState<"turniri" | "postavke" | "dashboard" | "popis-igraca">("turniri")

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
                    setError("Profil nije pronađen.")
                } else {
                    setError(e?.message ?? "Greška pri dohvaćanju profila.")
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
            .filter((t) => activeTeam == null || teamKey(t.teamName) === teamKey(activeTeam))
            .filter((t) => {
                if (!q) return true
                const blob = `${t.tournamentName} ${t.tournamentLocation ?? ""}`.toLowerCase()
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
                            <Text>{error ?? "Profil nije dostupan."}</Text>
                        </HStack>
                        <HStack mt="4">
                            <Button size="sm" variant="ghost" onClick={() => navigate(-1)}>Natrag</Button>
                            <Button size="sm" variant="solid" colorPalette="pitch" asChild>
                                <RouterLink to="/turniri">Na turnire</RouterLink>
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

    return (
        <VStack
            align="stretch"
            gap="4"
            maxW="900px"
            mx="auto"
            w="full"
        >
            {/* Profile header is always visible - it's the identity card.
                Avatar, name, and (for the owner) inline edit affordances
                sit above the tab strip so they don't get hidden when the
                user is on a non-default tab. */}
            <ProfileHeader
                profile={profile}
                isOwner={isOwner}
                onProfileChanged={refreshProfile}
            />

            {/* Tabs. Postavke + Računi are owner-only - visitors viewing
                someone else's profile just see Turniri (no tab strip at all
                when there's only one option). */}
            {isOwner && (
                <HStack gap="2" wrap="wrap">
                    <Button
                        size="sm"
                        variant={profileTab === "turniri" ? "solid" : "ghost"}
                        colorPalette="pitch"
                        onClick={() => setProfileTab("turniri")}
                    >
                        Turniri
                    </Button>
                    <Button
                        size="sm"
                        variant={profileTab === "postavke" ? "solid" : "ghost"}
                        onClick={() => setProfileTab("postavke")}
                    >
                        Postavke
                    </Button>
                    {/* Admin-only Dashboard tab - for retroactively attaching
                        legacy tournament teams to registered users. Gated on
                        the Firebase role=admin custom claim; non-admins never
                        see the button. */}
                    {isAdmin && (
                        <Button
                            size="sm"
                            variant={profileTab === "dashboard" ? "solid" : "ghost"}
                            colorPalette="purple"
                            onClick={() => setProfileTab("dashboard")}
                        >
                            Dashboard
                        </Button>
                    )}
                    {/* Admin-only Popis igrača tab - full list of all
                        registered users with a one-click jump to their
                        profile page. Same admin-claim gate as Dashboard. */}
                    {isAdmin && (
                        <Button
                            size="sm"
                            variant={profileTab === "popis-igraca" ? "solid" : "ghost"}
                            colorPalette="purple"
                            onClick={() => setProfileTab("popis-igraca")}
                        >
                            Popis igrača
                        </Button>
                    )}
                </HStack>
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
                                    Turniri
                                    {activeTeam ? <chakra.span color="fg.muted"> - {activeTeam}</chakra.span> : null}
                                </Heading>
                                {activeTeam && profile.teams.length > 0 && (
                                    <Badge variant="subtle" colorPalette="pitch">
                                        {filteredTournaments.length} turnira
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
                                        Igrač nije odigrao niti jedan turnir.
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
                                            Suvlasnik:{" "}
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
                                        placeholder="Pretraga: naziv turnira ili lokacija…"
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
                                                Nema turnira za odabrane filtere.
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

            {/* === POSTAVKE tab - owner-only: app preferences (theme, etc.) === */}
            {isOwner && profileTab === "postavke" && <SettingsCard />}

            {/* === DASHBOARD tab - admin-only, on own profile === */}
            {isOwner && isAdmin && profileTab === "dashboard" && (
                <AdminDashboardTab />
            )}

            {/* === POPIS IGRAČA tab - admin-only, on own profile === */}
            {isOwner && isAdmin && profileTab === "popis-igraca" && (
                <AdminPlayersListTab />
            )}
        </VStack>
    )
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function ProfileHeader({
    profile,
    isOwner,
    onProfileChanged,
}: {
    profile: PublicProfile
    isOwner: boolean
    onProfileChanged: () => Promise<void> | void
}) {
    const [editOpen, setEditOpen] = useState(false)
    const [uploading, setUploading] = useState(false)
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    // For the "blurred phone → click to log in" affordance below.
    const navigate = useNavigate()

    function onPickAvatar() {
        fileInputRef.current?.click()
    }

    async function onAvatarChosen(e: React.ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0]
        // Reset value so picking the same file again still fires onChange.
        e.target.value = ""
        if (!f) return
        try {
            setUploading(true)
            await uploadAvatar(f)
            await onProfileChanged()
            window.dispatchEvent(new CustomEvent("futsal:profile-updated"))
        } catch (err: any) {
            showError(
                "Slika nije učitana",
                String(
                    err?.response?.data?.message
                        ?? err?.response?.data
                        ?? err?.message
                        ?? "Pokušaj ponovno.",
                ),
            )
        } finally {
            setUploading(false)
        }
    }

    async function onRemoveAvatar() {
        if (!confirm("Ukloniti profilnu sliku?")) return
        try {
            setUploading(true)
            await deleteAvatar()
            await onProfileChanged()
            window.dispatchEvent(new CustomEvent("futsal:profile-updated"))
        } catch (err: any) {
            showError(
                "Brisanje slike nije uspjelo",
                String(err?.response?.data ?? err?.message ?? "Pokušaj ponovno."),
            )
        } finally {
            setUploading(false)
        }
    }

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "5", md: "5" }}>
                <VStack align="stretch" gap="3">
                    <HStack gap="3" align="start">
                        {/* Avatar - image when uploaded, initials otherwise.
                            Wrapped in AvatarPreview so hovering / tapping
                            the circle opens a full-screen lightbox of the
                            picture. The wrapper is a no-op when there's no
                            avatarUrl, so initials stay un-clickable. */}
                        <Box position="relative" flexShrink={0}>
                            <AvatarPreview
                                src={profile.avatarUrl}
                                alt={profile.displayName ?? "Profilna slika"}
                            >
                                <Box
                                    w="48px"
                                    h="48px"
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
                                    {profile.avatarUrl ? (
                                        <Image
                                            src={profile.avatarUrl}
                                            alt={profile.displayName ?? "Profilna slika"}
                                            w="100%"
                                            h="100%"
                                            objectFit="cover"
                                        />
                                    ) : (
                                        initialsOf(profile.displayName)
                                    )}
                                </Box>
                            </AvatarPreview>
                            {isOwner && (
                                <>
                                    <IconButton
                                        aria-label={profile.avatarUrl ? "Promijeni profilnu sliku" : "Učitaj profilnu sliku"}
                                        title={profile.avatarUrl ? "Promijeni profilnu sliku" : "Učitaj profilnu sliku"}
                                        size="2xs"
                                        position="absolute"
                                        bottom="-2px"
                                        right="-2px"
                                        rounded="full"
                                        colorPalette="pitch"
                                        variant="solid"
                                        loading={uploading}
                                        onClick={onPickAvatar}
                                    >
                                        <FiEdit2 />
                                    </IconButton>
                                    <chakra.input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        display="none"
                                        onChange={onAvatarChosen}
                                    />
                                </>
                            )}
                        </Box>
                        <VStack align="stretch" gap="0.5" flex="1" minW="0">
                            <HStack gap="1" align="center" minW="0">
                                <Heading size="md" lineHeight="short" lineClamp={2} flex="1" minW="0">
                                    {profile.displayName ?? "Bezimeni igrač"}
                                </Heading>
                                {isOwner && (
                                    <IconButton
                                        aria-label="Uredi ime"
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => setEditOpen(true)}
                                        title="Uredi ime"
                                    >
                                        <FiEdit2 />
                                    </IconButton>
                                )}
                            </HStack>
                            {isOwner && profile.avatarUrl && (
                                <Button
                                    size="2xs"
                                    variant="ghost"
                                    colorPalette="red"
                                    onClick={onRemoveAvatar}
                                    loading={uploading}
                                    alignSelf="flex-start"
                                >
                                    <FiTrash2 /> Ukloni profilnu sliku
                                </Button>
                            )}
                        </VStack>
                    </HStack>

                    {profile.phone ? (
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
                            title="Prijavi se da vidiš broj"
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
                                (prijavi se)
                            </chakra.span>
                        </chakra.button>
                    ) : null}
                </VStack>
            </Card.Body>

            {isOwner && (
                <EditProfileDialog
                    open={editOpen}
                    onClose={() => setEditOpen(false)}
                    onSaved={async () => {
                        setEditOpen(false)
                        await onProfileChanged()
                    }}
                />
            )}
        </Card.Root>
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

function EditProfileDialog({
    open,
    onClose,
    onSaved,
}: {
    open: boolean
    onClose: () => void
    onSaved: () => Promise<void> | void
}) {
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

    // Re-seed every time the dialog opens - covers cancel-and-reopen and the
    // case where the underlying profile was changed elsewhere in the meantime.
    useEffect(() => {
        if (!open) return
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
    }, [open])

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
            setError("Ime i prezime su obavezni.")
            return
        }
        if (!usernameValid) {
            setError("Odaberi dostupno korisničko ime.")
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
                onClose()
                navigate(`/profil/${newSlug}`, { replace: true })
                return
            }
            await onSaved()
        } catch (e: any) {
            const status = e?.response?.status
            if (status === 409) setError("Korisničko ime je zauzeto. Odaberi drugo.")
            else if (status === 400) setError("Korisničko ime je prekratko (najmanje 3 znaka).")
            else setError(e?.response?.data ?? e?.message ?? "Greška pri spremanju.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(e) => { if (!e.open && !saving) onClose() }}
        >
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="md">
                    <form onSubmit={onSubmit}>
                        <Dialog.Header>Uredi profil</Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="4">
                                <HStack gap="3" align="start">
                                    <Field.Root required>
                                        <Field.Label>Ime <Field.RequiredIndicator /></Field.Label>
                                        <Input
                                            size="sm"
                                            autoFocus
                                            value={firstName}
                                            onChange={(e) => setFirstName(e.target.value)}
                                            placeholder="Marko"
                                        />
                                    </Field.Root>
                                    <Field.Root required>
                                        <Field.Label>Prezime <Field.RequiredIndicator /></Field.Label>
                                        <Input
                                            size="sm"
                                            value={lastName}
                                            onChange={(e) => setLastName(e.target.value)}
                                            placeholder="Marković"
                                        />
                                    </Field.Root>
                                </HStack>

                                <Field.Root required>
                                    <Field.Label>Korisničko ime <Field.RequiredIndicator /></Field.Label>
                                    <Input
                                        size="sm"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        placeholder="marko-markovic"
                                    />
                                    {uStatus.state === "checking" && (
                                        <Field.HelperText>Provjeravam dostupnost…</Field.HelperText>
                                    )}
                                    {uStatus.state === "unchanged" && (
                                        <Field.HelperText>Tvoje trenutno korisničko ime.</Field.HelperText>
                                    )}
                                    {uStatus.state === "ok" && (
                                        <Field.HelperText color="green.fg">✓ „{uStatus.normalized}" je dostupno</Field.HelperText>
                                    )}
                                    {uStatus.state === "taken" && (
                                        <Field.HelperText color="red.fg">„{uStatus.normalized}" je zauzeto — odaberi drugo</Field.HelperText>
                                    )}
                                    {uStatus.state === "short" && (
                                        <Field.HelperText color="red.fg">Prekratko (najmanje 3 znaka).</Field.HelperText>
                                    )}
                                    {uStatus.state === "idle" && (
                                        <Field.HelperText>Mijenjanjem se mijenja i adresa profila (/profil/…).</Field.HelperText>
                                    )}
                                </Field.Root>

                                <Field.Root>
                                    <Field.Label>
                                        Broj telefona{" "}
                                        <chakra.span color="fg.muted" fontSize="xs">(opcionalno)</chakra.span>
                                    </Field.Label>
                                    {loadingPhone ? (
                                        <Skeleton h="9" />
                                    ) : (
                                        <HStack gap="2">
                                            <NativeSelect.Root size="sm" w="120px" flexShrink={0}>
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
                                                placeholder="91 234 5678"
                                                value={phone}
                                                // Strip non-digits (and non-spaces) so the saved
                                                // value never contains stray "(", "-", or "+"
                                                // characters - the country dial code lives in a
                                                // separate select.
                                                onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
                                            />
                                        </HStack>
                                    )}
                                </Field.Root>

                                {error && (
                                    <Box borderWidth="1px" borderColor="red.muted" bg="red.subtle" rounded="md" p="2">
                                        <Text fontSize="sm" color="red.fg">{error}</Text>
                                    </Box>
                                )}
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>
                                Odustani
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette="pitch"
                                type="submit"
                                loading={saving}
                                disabled={saving || loadingPhone || !firstName.trim() || !lastName.trim() || !usernameValid}
                            >
                                Spremi
                            </Button>
                        </Dialog.Footer>
                    </form>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
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
    const winRate = career.matchesPlayed > 0
        ? Math.round((career.matchesWon / career.matchesPlayed) * 100)
        : 0
    const goalDiff = career.goalsFor - career.goalsAgainst
    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "5" }}>
                <VStack align="stretch" gap="4">
                    <HStack justify="space-between" wrap="wrap" gap="2">
                        <Heading size="md">Karijera</Heading>
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
                        <CareerStat label="Turniri" value={career.tournamentsPlayed} sub={career.tournamentsWon > 0 ? `${career.tournamentsWon} pobjeda` : null} />
                        <CareerStat label="Utakmice" value={career.matchesPlayed} sub={career.matchesPlayed > 0 ? `${winRate}% omjer` : null} />
                        <CareerStat label="Golovi" value={career.goalsFor} sub={`Primljeno: ${career.goalsAgainst}`} />
                        <CareerStat
                            label="Razlika"
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
                                    <Text>P {career.matchesWon}</Text>
                                </HStack>
                                <HStack gap="1">
                                    <Box w="8px" h="8px" rounded="full" bg="border.emphasized" />
                                    <Text>N {career.matchesDrawn}</Text>
                                </HStack>
                                <HStack gap="1">
                                    <Box w="8px" h="8px" rounded="full" bg="accent.red" opacity={0.7} />
                                    <Text>I {career.matchesLost}</Text>
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
                                POSLJEDNJI TURNIRI
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
                    <Box color={active ? "blue.100" : "blue.fg"} title="Podijeljeno s partnerom">
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
                setError(e?.response?.data ?? e?.message ?? "Greška pri dohvaćanju mečeva.")
            } finally {
                setLoading(false)
            }
        }
    }

    let badge: { palette: string; label: string; icon?: React.ReactNode } | null = null
    if (row.isWinner) {
        badge = { palette: "yellow", label: "Pobjednik", icon: <FaTrophy size={11} color="#F5C518" /> }
    } else if (row.pendingApproval) {
        badge = { palette: "yellow", label: "Čeka odobrenje" }
    } else if (row.eliminated) {
        badge = { palette: "red", label: "Eliminiran" }
    } else if (row.tournamentStatus === "STARTED") {
        badge = { palette: "green", label: "Aktivan" }
    } else if (row.tournamentStatus === "FINISHED") {
        badge = { palette: "gray", label: "Završen" }
    } else {
        badge = { palette: "blue", label: "Najavljen" }
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
                        <Badge variant="subtle" colorPalette="gray" size="sm">{row.wins}W – {row.losses}L</Badge>
                    )}
                    {row.extraLife && <Badge variant="subtle" colorPalette="red" size="sm">Život</Badge>}
                </HStack>
            </Box>

            {open && (
                <Box borderTopWidth="1px" borderColor="border.emphasized" bg="bg.subtle" p="3">
                    {loading ? (
                        <HStack gap="2" color="fg.muted"><Spinner size="xs" /><Text fontSize="sm">Učitavanje…</Text></HStack>
                    ) : error ? (
                        <Text fontSize="sm" color="red.fg">{error}</Text>
                    ) : !history || history.matches.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted">Nema odigranih mečeva.</Text>
                    ) : (
                        <VStack align="stretch" gap="1.5">
                            {history.matches.map((m, i) => (
                                <MatchRow key={`${m.roundNumber ?? "?"}-${i}`} m={m} />
                            ))}
                            <HStack pt="2" justify="flex-end">
                                <Button size="xs" variant="ghost" asChild>
                                    <RouterLink to={`/turniri/${row.tournamentSlug ?? row.tournamentUuid}`}>
                                        Otvori turnir
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
    const finished = m.status === "FINISHED" || m.status === "COMPLETED"
    const wonColor = m.won === true ? "green" : m.won === false ? "red" : "gray"
    const wonLabel = m.isBye
        ? "Bye"
        : m.won === true ? "Pobjeda"
        : m.won === false ? "Poraz"
        : finished ? "Riješeno" : "U tijeku"

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
                Kolo {m.roundNumber ?? "?"}
            </Badge>
            {m.tableNo != null && (
                <Text color="fg.muted" fontSize="xs">Stol {m.tableNo}</Text>
            )}
            <Text flex="1" minW="0" lineClamp={1}>
                vs <chakra.b>{m.opponentName ?? (m.isBye ? "-" : "?")}</chakra.b>
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
 * Postavke tab - app-level preferences. Right now just the theme
 * toggle (which used to live on the navbar). Theme is persisted per
 * user via PUT /user/me/profile colorMode, so the choice follows
 * the user across devices. ThemeSync handles the read direction on
 * login.
 */
function SettingsCard() {
    const { colorMode, setColorMode } = useColorMode()

    const setTheme = async (mode: "light" | "dark") => {
        // Flip the local theme immediately for an instant visual response,
        // then persist to the backend. We're not waiting on the network
        // before flipping - the response only confirms the save.
        setColorMode(mode)
        try {
            await updateColorMode(mode)
        } catch {
            // Network failed - local theme is still right; the next login
            // will resync via ThemeSync.
        }
    }

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "5" }}>
                <VStack align="stretch" gap="4">
                    <Box>
                        <Heading size="sm">Postavke</Heading>
                        <Text fontSize="xs" color="fg.muted">
                            Personalizirane postavke aplikacije i tvog profila.
                        </Text>
                    </Box>

                    <Box>
                        <Text fontSize="sm" fontWeight="medium" mb="2">Tema</Text>
                        <HStack gap="2" wrap="wrap">
                            <Button
                                size="sm"
                                variant={colorMode === "light" ? "solid" : "outline"}
                                colorPalette={colorMode === "light" ? "blue" : "gray"}
                                onClick={() => setTheme("light")}
                            >
                                <FiSun /> Svijetla
                            </Button>
                            <Button
                                size="sm"
                                variant={colorMode === "dark" ? "solid" : "outline"}
                                colorPalette={colorMode === "dark" ? "blue" : "gray"}
                                onClick={() => setTheme("dark")}
                            >
                                <FiMoon /> Tamna
                            </Button>
                        </HStack>
                    </Box>
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}
