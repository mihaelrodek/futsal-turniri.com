// src/types/teams.ts
export type TeamShort = {
    id: number;           // Long in backend
    name: string;
    isEliminated: boolean;
    submittedByUid?: string | null;
    pendingApproval?: boolean;
    /** Public slug of the user who self-registered the team (null for organizer-added). */
    submittedBySlug?: string | null;
    /** Display name of the submitter, mirrored from Firebase. */
    submittedByName?: string | null;
    /** Firebase UID of the partner who claimed co-ownership via the share link. */
    coSubmittedByUid?: string | null;
    coSubmittedBySlug?: string | null;
    coSubmittedByName?: string | null;
    /** Opaque token for the /claim-team/{token} URL -- only sent to the primary submitter. */
    claimToken?: string | null;
    /** Jersey colour ("#rrggbb", lowercase) chosen by the organizer on the
     *  Ekipe tab; null = not set. Shown as a colour chip next to the team. */
    jerseyColor?: string | null;
    /** Shorts (hlače) colour ("#rrggbb"), chosen separately from the jersey;
     *  null = not set. Together they render a two-tone kit chip. */
    shortsColor?: string | null;
    /** Who filed the registration form, when it came in without an account.
     *  ORGANIZER-ONLY - the backend nulls these for every other viewer, so a
     *  submitter's phone number never travels in the public team list. */
    registeredByName?: string | null;
    /** Phone or e-mail exactly as typed by the submitter. Organizer-only. */
    registeredContact?: string | null;
    /** The submitter's message to the organizer. Organizer-only. */
    registrationNote?: string | null;
};

// Local-only helper for brand-new rows before the server assigns an id.
// We'll strip id when sending (id: null on create/update payload).
export type TeamDraft = Omit<TeamShort, "id"> & { id?: number };
