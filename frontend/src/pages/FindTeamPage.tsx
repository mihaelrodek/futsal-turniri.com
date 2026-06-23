/**
 * TODO (futsal rework): carried over from the bela "find a partner" flow
 * and mechanically renamed Pair -> Team. The internal logic still reflects
 * the old "find ONE partner" model. Rework into the proper futsal
 * "Pronadi igraca/ekipu" feature (players looking for a team, and teams
 * looking for players) when that feature is designed.
 */
import React, { useEffect, useMemo, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Card,
    chakra,
    Field,
    HStack,
    IconButton,
    Input,
    NativeSelect,
    Skeleton,
    Text,
    Textarea,
    VStack,
} from "@chakra-ui/react"
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext"
import { showError } from "../toaster"
import {
    FiCalendar,
    FiCheck,
    FiChevronDown,
    FiChevronRight,
    FiEdit2,
    FiFilter,
    FiMapPin,
    FiPhone,
    FiTrash2,
    FiUserPlus,
    FiUsers,
} from "react-icons/fi"

import type { TournamentCard } from "../types/tournaments"
import { fetchTournaments } from "../api/tournaments"
import {
    createTeamRequest,
    deleteTeamRequest,
    listTeamRequests,
    matchTeamRequest,
    updateTeamRequest,
    type TeamRequest,
} from "../api/teamRequests"
import { getProfile } from "../api/userMe"

/** Country dial codes — kept in sync with ProfilePage / CreateTournamentPage. */
const PHONE_COUNTRIES = [
    { value: "+385", label: "🇭🇷 +385" },
    { value: "+386", label: "🇸🇮 +386" },
    { value: "+43",  label: "🇦🇹 +43" },
    { value: "+49",  label: "🇩🇪 +49" },
    { value: "+387", label: "🇧🇦 +387" },
    { value: "+381", label: "🇷🇸 +381" },
] as const

/** Parse a stored phone string ("+385 91 234 5678") back into country + local parts. */
function splitPhone(stored?: string | null): { country: string; local: string } {
    if (!stored) return { country: "+385", local: "" }
    const trimmed = stored.trim()
    for (const c of PHONE_COUNTRIES) {
        if (trimmed.startsWith(c.value)) {
            return { country: c.value, local: trimmed.slice(c.value.length).trim() }
        }
    }
    return { country: "+385", local: trimmed }
}

type TournamentLite = TournamentCard & { uuid: string }

function formatDateTime(iso?: string | null) {
    if (!iso) return ""
    const d = new Date(iso)
    const date = new Intl.DateTimeFormat("hr-HR", {
        day: "2-digit", month: "short", year: "numeric",
    }).format(d)
    const time = new Intl.DateTimeFormat("hr-HR", {
        hour: "2-digit", minute: "2-digit",
    }).format(d)
    return `${date} • ${time}`
}

function TeamAvatar({ name, matched }: { name: string; matched?: boolean }) {
    const initials = (name || "?")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]?.toUpperCase())
        .join("") || "?"
    return (
        <Box
            w="34px"
            h="34px"
            rounded="full"
            bg={matched ? "green.subtle" : "blue.subtle"}
            color={matched ? "green.fg" : "blue.fg"}
            display="flex"
            alignItems="center"
            justifyContent="center"
            fontWeight="semibold"
            fontSize="xs"
            flexShrink={0}
        >
            {initials}
        </Box>
    )
}

export default function FindTeamPage() {
    const { user, isAdmin } = useAuth()
    const navigate = useNavigate()
    const location = useLocation()

    // Tournament list (used for the form + lookup of tournament info)
    const [tournaments, setTournaments] = useState<TournamentLite[]>([])
    const [loadingTournaments, setLoadingTournaments] = useState(true)

    // Team requests
    const [requests, setRequests] = useState<TeamRequest[]>([])
    const [loadingRequests, setLoadingRequests] = useState(true)
    const [requestsError, setRequestsError] = useState<string | null>(null)

    // Filters
    const [statusFilter, setStatusFilter] = useState<"all" | "open" | "matched">("open")
    const [tournamentFilter, setTournamentFilter] = useState<string>("") // empty = all
    const [search, setSearch] = useState("")

    // Form. `editingUuid` set => we're editing an existing request, otherwise
    // we're creating a new one.
    const [formOpen, setFormOpen] = useState(false)
    const [editingUuid, setEditingUuid] = useState<string | null>(null)
    const [selectedTournamentUuid, setSelectedTournamentUuid] = useState<string>("")
    const [playerName, setPlayerName] = useState("")
    // Prefill name from the Firebase profile when the form opens for create.
    // We only seed when blank so we never overwrite anything already typed,
    // and we explicitly skip seeding when editing (the server gave us values).
    useEffect(() => {
        if (!formOpen) return
        if (editingUuid) return
        if (!user) return
        if (playerName.trim()) return
        const seed = user.displayName?.trim() || user.email?.split("@")[0] || ""
        if (seed) setPlayerName(seed)
    }, [formOpen, user, playerName, editingUuid])
    const [phoneCountry, setPhoneCountry] = useState<string>("+385")
    const [phone, setPhone] = useState("")
    const [note, setNote] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [formError, setFormError] = useState<string | null>(null)

    // Prefill phone from the user's saved profile when opening the form for
    // create. Skipped when editing (we use the request's phone instead) and
    // when the user has already typed something.
    useEffect(() => {
        if (!formOpen) return
        if (editingUuid) return
        if (!user) return
        if (phone.trim()) return
        let cancelled = false
        ;(async () => {
            try {
                const p = await getProfile()
                if (cancelled) return
                if (p.phone && !phone.trim()) {
                    setPhone(p.phone)
                    if (p.phoneCountry) setPhoneCountry(p.phoneCountry)
                }
            } catch {
                /* non-fatal — leave fields blank */
            }
        })()
        return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formOpen, user, editingUuid])

    // ---- data loading ----
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                setLoadingTournaments(true)
                const data = await fetchTournaments("upcoming")
                if (!cancelled) {
                    setTournaments(data as TournamentLite[])
                    if (data.length > 0 && !selectedTournamentUuid) {
                        setSelectedTournamentUuid((data[0] as any).uuid)
                    }
                }
            } catch {
                if (!cancelled) setTournaments([])
            } finally {
                if (!cancelled) setLoadingTournaments(false)
            }
        })()
        return () => { cancelled = true }
    }, [])

    async function refreshRequests() {
        try {
            setLoadingRequests(true)
            setRequestsError(null)
            const data = await listTeamRequests(
                statusFilter === "all" ? undefined : statusFilter,
            )
            setRequests(data)
        } catch (e: any) {
            setRequestsError(e?.message ?? "Greška pri dohvaćanju zahtjeva.")
            setRequests([])
        } finally {
            setLoadingRequests(false)
        }
    }

    useEffect(() => { refreshRequests() }, [statusFilter])

    // Apply client-side filters
    const filteredRequests = useMemo(() => {
        const q = search.trim().toLowerCase()
        return requests.filter((r) => {
            if (tournamentFilter && r.tournamentUuid !== tournamentFilter) return false
            if (q) {
                const blob = `${r.playerName} ${r.tournamentName} ${r.note ?? ""} ${r.tournamentLocation ?? ""}`
                    .toLowerCase()
                if (!blob.includes(q)) return false
            }
            return true
        })
    }, [requests, search, tournamentFilter])

    const openCount = useMemo(
        () => requests.filter((r) => r.status === "OPEN").length,
        [requests],
    )

    function resetForm() {
        setEditingUuid(null)
        setPlayerName("")
        setPhone("")
        setPhoneCountry("+385")
        setNote("")
        setFormError(null)
    }

    /** Open the form pre-populated with an existing request's values. */
    function startEdit(r: TeamRequest) {
        setEditingUuid(r.uuid)
        setSelectedTournamentUuid(r.tournamentUuid)
        setPlayerName(r.playerName)
        const split = splitPhone(r.phone)
        setPhoneCountry(split.country)
        setPhone(split.local)
        setNote(r.note ?? "")
        setFormError(null)
        setFormOpen(true)
        // Scroll the form into view on small screens.
        setTimeout(() => {
            window.scrollTo({ top: 0, behavior: "smooth" })
        }, 0)
    }

    const onSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
        e.preventDefault()
        setFormError(null)
        if (!selectedTournamentUuid) {
            setFormError("Odaberi turnir.")
            return
        }
        if (!playerName.trim()) {
            setFormError("Ime je obavezno.")
            return
        }
        try {
            setSubmitting(true)
            const fullPhone = phone.trim() ? `${phoneCountry} ${phone.trim()}` : ""
            if (editingUuid) {
                const updated = await updateTeamRequest(editingUuid, {
                    playerName: playerName.trim(),
                    phone: fullPhone,
                    note: note.trim() || null,
                })
                setRequests((rs) => rs.map((r) => (r.uuid === updated.uuid ? updated : r)))
            } else {
                const created = await createTeamRequest(selectedTournamentUuid, {
                    playerName: playerName.trim(),
                    phone: fullPhone,
                    note: note.trim() || null,
                })
                setRequests((rs) => [created, ...rs])
            }
            resetForm()
            setFormOpen(false)
        } catch (e: any) {
            setFormError(
                e?.response?.data
                    ?? e?.message
                    ?? (editingUuid ? "Neuspjelo spremanje izmjena." : "Neuspjelo objavljivanje zahtjeva."),
            )
        } finally {
            setSubmitting(false)
        }
    }

    async function onMatch(uuid: string) {
        try {
            const updated = await matchTeamRequest(uuid)
            setRequests((rs) => rs.map((r) => (r.uuid === uuid ? updated : r)))
        } catch (e: any) {
            showError(
                "Greška",
                String(e?.response?.data ?? e?.message ?? "Neuspjelo označavanje."),
            )
        }
    }
    async function onDelete(uuid: string) {
        if (!confirm("Obrisati zahtjev?")) return
        try {
            await deleteTeamRequest(uuid)
            setRequests((rs) => rs.filter((r) => r.uuid !== uuid))
        } catch (e: any) {
            showError(
                "Greška pri brisanju",
                String(e?.response?.data ?? e?.message ?? "Zahtjev nije obrisan."),
            )
        }
    }

    const selectedTournament = useMemo(
        () => tournaments.find((t) => t.uuid === selectedTournamentUuid),
        [tournaments, selectedTournamentUuid],
    )

    return (
        <VStack align="stretch" gap="4">
            {/* Action bar — title removed; just the toggle button.
                Anonymous users get bounced to /login on click; logged-in
                users toggle the form open. */}
            <HStack justify="flex-end" gap="3" wrap="wrap">
                <Button
                    size="sm"
                    variant="solid"
                    colorPalette="pitch"
                    onClick={() => {
                        if (!user) {
                            navigate("/prijava", {
                                state: { from: `${location.pathname}${location.search}` },
                            })
                            return
                        }
                        if (formOpen) {
                            // Closing the form — also drops any in-progress edit.
                            resetForm()
                            setFormOpen(false)
                        } else {
                            setFormOpen(true)
                        }
                    }}
                >
                    {formOpen ? <FiChevronDown /> : <FiChevronRight />}
                    {formOpen
                        ? " Sakrij formu"
                        : " Objavi zahtjev"}
                </Button>
            </HStack>

            {/* Post a request form */}
            {formOpen && (
                <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                    <Card.Header pb="2" pt="4" px={{ base: "4", md: "5" }}>
                        <HStack gap="2.5" align="center">
                            <Box color="blue.500">
                                {editingUuid ? <FiEdit2 /> : <FiUserPlus />}
                            </Box>
                            <Card.Title fontSize="md">
                                {editingUuid ? "Uredi zahtjev" : "Tražim ekipu"}
                            </Card.Title>
                        </HStack>
                    </Card.Header>
                    <Card.Body pt="3" pb="4" px={{ base: "4", md: "5" }}>
                        <form onSubmit={onSubmit}>
                            <VStack align="stretch" gap="4">
                                <Field.Root required>
                                    <Field.Label>Turnir <Field.RequiredIndicator /></Field.Label>
                                    <NativeSelect.Root size="sm" disabled={!!editingUuid}>
                                        <NativeSelect.Field
                                            value={selectedTournamentUuid}
                                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                                setSelectedTournamentUuid(e.target.value)
                                            }
                                        >
                                            {loadingTournaments ? (
                                                <option value="">Učitavanje…</option>
                                            ) : editingUuid ? (
                                                // While editing we always render the request's
                                                // tournament so the value stays valid even when
                                                // it isn't in the upcoming list anymore.
                                                <>
                                                    {!tournaments.some((t) => t.uuid === selectedTournamentUuid) && (
                                                        <option value={selectedTournamentUuid}>
                                                            {requests.find((r) => r.uuid === editingUuid)?.tournamentName ?? selectedTournamentUuid}
                                                        </option>
                                                    )}
                                                    {tournaments.map((t) => (
                                                        <option key={t.uuid} value={t.uuid}>
                                                            {t.name}
                                                        </option>
                                                    ))}
                                                </>
                                            ) : tournaments.length === 0 ? (
                                                <option value="">Nema nadolazećih turnira</option>
                                            ) : (
                                                tournaments.map((t) => (
                                                    <option key={t.uuid} value={t.uuid}>
                                                        {t.name}
                                                    </option>
                                                ))
                                            )}
                                        </NativeSelect.Field>
                                    </NativeSelect.Root>
                                    {editingUuid && (
                                        <Field.HelperText>
                                            Turnir nije moguće promijeniti — obriši zahtjev i kreiraj novi za drugi turnir.
                                        </Field.HelperText>
                                    )}
                                    {selectedTournament && (
                                        <Field.HelperText>
                                            <HStack gap="2" wrap="wrap" fontSize="xs">
                                                {selectedTournament.location && (
                                                    <HStack gap="1">
                                                        <FiMapPin size={11} />
                                                        <Text>{selectedTournament.location}</Text>
                                                    </HStack>
                                                )}
                                                {selectedTournament.startAt && (
                                                    <HStack gap="1">
                                                        <FiCalendar size={11} />
                                                        <Text>{formatDateTime(selectedTournament.startAt)}</Text>
                                                    </HStack>
                                                )}
                                            </HStack>
                                        </Field.HelperText>
                                    )}
                                </Field.Root>

                                <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }} gap="4">
                                    <Field.Root required>
                                        <Field.Label>Tvoje ime <Field.RequiredIndicator /></Field.Label>
                                        <Input
                                            placeholder="npr. Marko"
                                            value={playerName}
                                            onChange={(e) => setPlayerName(e.target.value)}
                                        />
                                    </Field.Root>
                                    <Field.Root>
                                        <Field.Label>
                                            Broj telefona{" "}
                                            <chakra.span color="fg.muted" fontSize="xs">(opcionalno)</chakra.span>
                                        </Field.Label>
                                        <HStack gap="2">
                                            <NativeSelect.Root size="sm" w="120px" flexShrink={0}>
                                                <NativeSelect.Field
                                                    value={phoneCountry}
                                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                                        setPhoneCountry(e.target.value)
                                                    }
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
                                                // Digits + spaces only — country dial code lives
                                                // in the adjacent select.
                                                onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ""))}
                                            />
                                        </HStack>
                                    </Field.Root>
                                </Box>

                                <Field.Root>
                                    <Field.Label>Napomena (opcionalno)</Field.Label>
                                    <Textarea
                                        placeholder="Iskustvo, način igranja, prijevoz..."
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                        rows={3}
                                    />
                                </Field.Root>

                                {formError && (
                                    <Box
                                        borderWidth="1px"
                                        borderColor="red.muted"
                                        bg="red.subtle"
                                        rounded="md"
                                        p="3"
                                    >
                                        <Text color="red.fg" fontSize="sm">{String(formError)}</Text>
                                    </Box>
                                )}

                                <HStack justify="flex-end" gap="2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => { resetForm(); setFormOpen(false) }}
                                        disabled={submitting}
                                    >
                                        Odustani
                                    </Button>
                                    <Button
                                        type="submit"
                                        variant="solid"
                                        colorPalette="pitch"
                                        size="sm"
                                        loading={submitting}
                                        disabled={!selectedTournamentUuid || submitting}
                                    >
                                        {editingUuid ? (
                                            <><FiCheck /> Spremi</>
                                        ) : (
                                            <><FiUserPlus /> Objavi zahtjev</>
                                        )}
                                    </Button>
                                </HStack>
                            </VStack>
                        </form>
                    </Card.Body>
                </Card.Root>
            )}

            {/* Filters bar */}
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body py="3" px={{ base: "3", md: "4" }}>
                    <Box
                        display="grid"
                        gridTemplateColumns={{ base: "1fr", md: "1fr 1fr 1fr" }}
                        gap="3"
                    >
                        <Box>
                            <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb="1">
                                Pretraga
                            </Text>
                            <Input
                                size="sm"
                                placeholder="Pretraži po imenu, lokaciji…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </Box>
                        <Box>
                            <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb="1">
                                Status
                            </Text>
                            <NativeSelect.Root size="sm">
                                <NativeSelect.Field
                                    value={statusFilter}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                        setStatusFilter(e.target.value as "all" | "open" | "matched")
                                    }
                                >
                                    <option value="open">Aktivni</option>
                                    <option value="matched">Spareni</option>
                                    <option value="all">Svi</option>
                                </NativeSelect.Field>
                            </NativeSelect.Root>
                        </Box>
                        <Box>
                            <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb="1">
                                Turnir
                            </Text>
                            <NativeSelect.Root size="sm">
                                <NativeSelect.Field
                                    value={tournamentFilter}
                                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                                        setTournamentFilter(e.target.value)
                                    }
                                >
                                    <option value="">Svi turniri</option>
                                    {tournaments.map((t) => (
                                        <option key={t.uuid} value={t.uuid}>
                                            {t.name}
                                        </option>
                                    ))}
                                </NativeSelect.Field>
                            </NativeSelect.Root>
                        </Box>
                    </Box>
                </Card.Body>
            </Card.Root>

            {/* Stats line */}
            <HStack gap="6" wrap="wrap" px="1">
                <HStack gap="2">
                    <FiUsers />
                    <Text fontSize="sm" color="fg.muted">
                        <chakra.b>{filteredRequests.length}</chakra.b>
                        {requests.length !== filteredRequests.length && (
                            <> od {requests.length}</>
                        )} zahtjeva
                    </Text>
                </HStack>
                {statusFilter !== "open" && (
                    <Text fontSize="sm" color="fg.muted">
                        <chakra.b>{openCount}</chakra.b> aktivnih ukupno
                    </Text>
                )}
            </HStack>

            {/* Request grid */}
            {loadingRequests ? (
                <Box
                    display="grid"
                    gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }}
                    gap="3"
                >
                    <Skeleton h="120px" rounded="lg" />
                    <Skeleton h="120px" rounded="lg" />
                </Box>
            ) : requestsError ? (
                <Box
                    borderWidth="1px"
                    borderColor="red.muted"
                    bg="red.subtle"
                    rounded="md"
                    p="4"
                >
                    <Text color="red.fg" fontSize="sm">{requestsError}</Text>
                </Box>
            ) : filteredRequests.length === 0 ? (
                <Box
                    borderWidth="1px"
                    borderColor="border.emphasized"
                    borderStyle="dashed"
                    rounded="xl"
                    py="10"
                    px="6"
                >
                    <VStack gap="2">
                        <Box color="fg.muted"><FiFilter size={24} /></Box>
                        <Text fontWeight="medium">
                            {requests.length === 0 ? "Još nema zahtjeva" : "Nema rezultata"}
                        </Text>
                        <Text color="fg.muted" fontSize="sm" textAlign="center">
                            {requests.length === 0
                                ? "Budi prvi koji traži ekipu — klikni \"Objavi zahtjev\" gore."
                                : "Nijedan zahtjev ne odgovara odabranim filterima."}
                        </Text>
                    </VStack>
                </Box>
            ) : (
                <Box
                    display="grid"
                    gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }}
                    gap="3"
                >
                    {filteredRequests.map((r) => {
                        // Edit/Spareno/Delete are only available to the original
                        // poster or to admins. Everyone else sees the card
                        // read-only with the contact info exposed.
                        const isOwner = !!user?.uid && user.uid === r.createdByUid
                        const canManage = isOwner || isAdmin
                        return (
                            <RequestCard
                                key={r.uuid}
                                r={r}
                                canManage={canManage}
                                onEdit={() => startEdit(r)}
                                onMatch={() => onMatch(r.uuid)}
                                onDelete={() => onDelete(r.uuid)}
                            />
                        )
                    })}
                </Box>
            )}
        </VStack>
    )
}

function RequestCard({
    r,
    canManage,
    onEdit,
    onMatch,
    onDelete,
}: {
    r: TeamRequest
    canManage: boolean
    onEdit: () => void
    onMatch: () => void
    onDelete: () => void
}) {
    const matched = r.status === "MATCHED"
    return (
        <Box
            borderWidth="1px"
            borderColor={matched ? "green.muted" : "border.emphasized"}
            rounded="lg"
            shadow="sm"
            p="3"
            bg={matched ? "green.subtle" : "bg"}
            opacity={matched ? 0.92 : 1}
            display="flex"
            flexDirection="column"
            gap="2"
        >
            {/* Top row: avatar + name + status */}
            <HStack gap="2" align="center">
                <TeamAvatar name={r.playerName} matched={matched} />
                <Box flex="1" minW="0">
                    <Text fontWeight="semibold" lineHeight="short" truncate>
                        {r.playerName}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                        {new Intl.DateTimeFormat("hr-HR", {
                            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                        }).format(new Date(r.createdAt))}
                    </Text>
                </Box>
                <Badge variant="solid" colorPalette={matched ? "green" : "blue"} size="sm">
                    {matched ? "Spareni" : "Tražim"}
                </Badge>
            </HStack>

            {/* Tournament link */}
            <RouterLink
                to={`/turniri/${r.tournamentSlug ?? r.tournamentUuid}`}
                style={{ textDecoration: "none" }}
            >
                <Box
                    borderWidth="1px"
                    borderColor="border.emphasized"
                    rounded="md"
                    px="2.5"
                    py="1.5"
                    bg="bg.subtle"
                    _hover={{ bg: "bg.muted" }}
                    transition="background 0.1s ease"
                >
                    <Text fontSize="sm" fontWeight="medium" truncate>{r.tournamentName}</Text>
                    <HStack gap="2" mt="0.5" wrap="wrap" fontSize="xs" color="fg.muted">
                        {r.tournamentLocation && (
                            <HStack gap="1">
                                <FiMapPin size={11} />
                                <Text>{r.tournamentLocation}</Text>
                            </HStack>
                        )}
                        {r.tournamentStartAt && (
                            <HStack gap="1">
                                <FiCalendar size={11} />
                                <Text>{formatDateTime(r.tournamentStartAt)}</Text>
                            </HStack>
                        )}
                    </HStack>
                </Box>
            </RouterLink>

            {/* Note */}
            {r.note && (
                <Text fontSize="sm" color="fg.muted">{r.note}</Text>
            )}

            {/* Footer: phone + actions (only the poster or an admin can act).
                Phone is rendered as a tel: link so tapping on a phone dials. */}
            <HStack justify="space-between" gap="2" wrap="wrap" mt="auto">
                {r.phone ? (
                    <chakra.a
                        href={`tel:${r.phone.replace(/\s+/g, "")}`}
                        display="inline-flex"
                        alignItems="center"
                        gap="1.5"
                        color="blue.fg"
                        fontSize="sm"
                        fontWeight="medium"
                        _hover={{ textDecoration: "underline" }}
                    >
                        <FiPhone />
                        {r.phone}
                    </chakra.a>
                ) : (
                    <Box />
                )}
                {canManage && (
                    <HStack gap="1.5">
                        {!matched && (
                            <Button size="xs" variant="solid" colorPalette="green" onClick={onMatch}>
                                <FiCheck /> Spareno
                            </Button>
                        )}
                        <IconButton
                            aria-label="Uredi zahtjev"
                            size="xs"
                            variant="ghost"
                            onClick={onEdit}
                            title="Uredi zahtjev"
                        >
                            <FiEdit2 />
                        </IconButton>
                        <IconButton
                            aria-label="Obriši zahtjev"
                            size="xs"
                            variant="ghost"
                            colorPalette="red"
                            onClick={onDelete}
                            title="Obriši zahtjev"
                        >
                            <FiTrash2 />
                        </IconButton>
                    </HStack>
                )}
            </HStack>
        </Box>
    )
}
