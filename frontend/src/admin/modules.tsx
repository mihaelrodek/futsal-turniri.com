import type { ReactNode } from "react"
import type { IconType } from "react-icons"
import {
    FiAward,
    FiCamera,
    FiClipboard,
    FiFilm,
    FiMail,
    FiMessageSquare,
    FiRadio,
    FiShield,
    FiUserCheck,
    FiUsers,
} from "react-icons/fi"

import AdminDashboardTab from "../components/AdminDashboardTab"
import AdminPlayersListTab from "../components/AdminPlayersListTab"
import AdminTeamDatabaseTab from "../components/AdminTeamDatabaseTab"
import SpectoConnectionCard from "../components/SpectoConnectionCard"
import AdminRecordingRequestsTab from "../components/AdminRecordingRequestsTab"
import AdminRecordingsLibraryTab from "../components/AdminRecordingsLibraryTab"
import AdminCameraInquiriesTab from "../components/AdminCameraInquiriesTab"
import AdminPlayerClaimRequestsTab from "../components/AdminPlayerClaimRequestsTab"
import AdminContactMessagesTab from "../components/AdminContactMessagesTab"
import AdminMailerTab from "../components/AdminMailerTab"

/* ──────────────────────────────────────────────────────────────────────────
   The admin console's module registry - the single source of truth for what
   the /admin dashboard offers and what /admin/{slug} renders.

   These eight screens used to be tabs crammed into the owner's own profile
   page (`/profil`, gated on `isOwner && isAdmin`). They are now first-class
   modules behind their own routes: the dashboard lists them as cards, and
   opening a card mounts exactly the same component - none of them takes
   props, which is what makes a registry this small possible.

   Labels and descriptions deliberately live in i18n (keyed by `key` under
   `pages.adminConsole.modules`), not here, so all three dictionaries stay
   the only place copy is written.
   ────────────────────────────────────────────────────────────────────── */

/** Stable identity of a module - also its i18n key. */
export type AdminModuleKey =
    | "turniri"
    | "igraci"
    | "ekipe"
    | "stream"
    | "zahtjeviSnimke"
    | "bazaSnimki"
    | "ponude"
    | "zahtjeviIgraci"
    | "poruke"
    | "mailer"

export type AdminModule = {
    key: AdminModuleKey
    /** URL segment: /admin/{slug}. Croatian, like every other public route. */
    slug: string
    icon: IconType
    /** Mounted by AdminModulePage. Every admin screen is prop-less. */
    render: () => ReactNode
}

export const ADMIN_MODULES: AdminModule[] = [
    { key: "turniri", slug: "turniri", icon: FiAward, render: () => <AdminDashboardTab /> },
    { key: "igraci", slug: "igraci", icon: FiUsers, render: () => <AdminPlayersListTab /> },
    { key: "ekipe", slug: "ekipe", icon: FiShield, render: () => <AdminTeamDatabaseTab /> },
    { key: "stream", slug: "stream", icon: FiRadio, render: () => <SpectoConnectionCard /> },
    {
        key: "zahtjeviSnimke",
        slug: "zahtjevi-snimke",
        icon: FiClipboard,
        render: () => <AdminRecordingRequestsTab />,
    },
    { key: "bazaSnimki", slug: "baza-snimki", icon: FiFilm, render: () => <AdminRecordingsLibraryTab /> },
    { key: "ponude", slug: "ponude", icon: FiCamera, render: () => <AdminCameraInquiriesTab /> },
    {
        key: "zahtjeviIgraci",
        slug: "zahtjevi-igraci",
        icon: FiUserCheck,
        render: () => <AdminPlayerClaimRequestsTab />,
    },
    { key: "poruke", slug: "poruke", icon: FiMessageSquare, render: () => <AdminContactMessagesTab /> },
    { key: "mailer", slug: "posalji-mail", icon: FiMail, render: () => <AdminMailerTab /> },
]

export function findAdminModule(slug: string | undefined): AdminModule | undefined {
    if (!slug) return undefined
    return ADMIN_MODULES.find((m) => m.slug === slug)
}

/** Dashboard sections. The flat grid stopped reading as a hierarchy once it
 *  passed a handful of cards: everything about running a competition belongs
 *  together, the broadcast is its own thing, and the whole paid-recording
 *  pipeline (request → library → quote lead) is a fourth. Titles live in
 *  i18n under `pages.adminConsole.groups`. */
export type AdminGroupKey = "upravljanje" | "prijenos" | "snimke" | "komunikacija"

export type AdminGroup = { key: AdminGroupKey; modules: AdminModule[] }

const GROUP_ORDER: { key: AdminGroupKey; keys: AdminModuleKey[] }[] = [
    { key: "upravljanje", keys: ["turniri", "igraci", "ekipe", "zahtjeviIgraci"] },
    { key: "snimke", keys: ["zahtjeviSnimke", "bazaSnimki", "ponude"] },
    // Inbound (contact form) and outbound (manual mail) belong together: both
    // are "someone has to write to a person", not tournament administration.
    { key: "komunikacija", keys: ["poruke", "mailer"] },
    // Last: a single card, and the one an admin opens least often.
    { key: "prijenos", keys: ["stream"] },
]

export const ADMIN_MODULE_GROUPS: AdminGroup[] = GROUP_ORDER.map((g) => ({
    key: g.key,
    modules: g.keys
        .map((k) => ADMIN_MODULES.find((m) => m.key === k))
        .filter((m): m is AdminModule => m != null),
}))
