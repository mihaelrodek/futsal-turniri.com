export type RewardType = "FIXED" | "PERCENTAGE";
export type TournamentStatus = "DRAFT" | "STARTED" | "FINISHED";
export type TournamentFormat = "GROUPS_KNOCKOUT" | "KNOCKOUT_ONLY";
export type BracketFill = "BYES" | "WILDCARDS";
/** Playing surface - purely descriptive, shown as a coloured stat tile.
 *  Default ASFALT (server-side, see TournamentMapper.applyDefaults). */
export type Surface = "TRAVA" | "UMJETNA_TRAVA" | "ASFALT" | "DVORANA";
/** Which goals count toward the best-scorer race (ranking + award
 *  suggestion). KNOCKOUT (default) = group-stage goals don't count. */
export type ScorerScope =
    | "ALL"
    | "KNOCKOUT"
    | "ROUND_OF_32"
    | "ROUND_OF_16"
    | "QUARTERFINAL"
    | "SEMIFINAL";

export type TournamentCard = {
    id: number;                // numeric PK
    uuid: string;                // UUID
    /** Pretty URL slug, e.g. "1-futsal-open-22-04-2026". Null on legacy rows. */
    slug?: string | null;
    name: string;
    location?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    bannerUrl?: string | null;
    startAt?: string | null;
    maxTeams?: number | null;
    format?: TournamentFormat | null;
    entryPrice?: number | null;
    /** Total prize fund in euros (sum of 1st–4th place). Null when none set. */
    prizeTotal?: number | null;
    winnerName?: string | null;
    registeredTeams?: number | null;
    /** Lifecycle status (DRAFT / STARTED / FINISHED). Drives the "u tijeku"
     *  home-list badge for a started tournament even between live matches. */
    status?: TournamentStatus | null;
    /** True when this tournament currently has a match in progress. */
    liveMatch?: boolean;
    /** True when at least one match here was played to a result. False on a
     *  tournament that was created (maybe even drawn into groups) and then
     *  marked finished without a single result - the finished listing says so,
     *  because such a card otherwise promises standings that don't exist. */
    anyResult?: boolean;
    /** Set when an admin featured this tournament; null otherwise. The home
     *  list sorts featured tournaments first (before live ones). */
    featuredAt?: string | null;
    /** Admin-set "not publicly visible". Only the creator/admin ever receive
     *  hidden rows - the card renders greyed-out with a badge. */
    hidden?: boolean;
};

export type TournamentDetails = {
    id: string; // UUID
    uuid: string;
    /** Pretty URL slug, e.g. "1-futsal-open-22-04-2026". Null on legacy rows. */
    slug?: string | null;
    name: string;
    location?: string | null;
    /** Geocoded coordinates of `location` - seed the edit-mode map picker
     *  so the saved spot shows as a marker immediately. */
    latitude?: number | null;
    longitude?: number | null;
    details?: string | null;
    startAt?: string | null;

    // NOTE: with resources table this might become derived; server may still expose it for now.
    bannerUrl?: string | null;

    entryPrice?: number | null;
    maxTeams?: number | null;
    status?: string | null;

    // --- Format (Phase E) ---
    format?: TournamentFormat | null;
    groupCount?: number | null;
    advancePerGroup?: number | null;
    /** How many best "third-placed" teams also advance (0 = off). */
    bestThirdCount?: number | null;
    bracketFill?: BracketFill | null;

    contactName?: string | null;
    contactPhone?: string | null;

    /** Futsal play system: "4+1" | "5+1" | "3vs3" | free-text custom. */
    gameSystem?: string | null;
    /** Playing surface. Always set (server defaults to ASFALT). */
    surface?: Surface | null;
    /** External organizer link (Facebook event, club page, …). */
    websiteUrl?: string | null;
    /** Public organizer display name (udruga, klub…). When set, shown as
     *  the organizer on the detail page instead of createdByName. */
    organizerName?: string | null;

    rewardType?: RewardType | null;
    rewardFirst?: number | null;
    rewardFirstNote?: string | null;
    rewardSecond?: number | null;
    rewardSecondNote?: string | null;
    rewardThird?: number | null;
    rewardThirdNote?: string | null;
    rewardFourth?: number | null;
    rewardFourthNote?: string | null;

    additionalOptions?: string[];
    winnerName?: string | null;
    /** Silver-place team name, set via PATCH /tournaments/{uuid}/podium. */
    secondPlaceName?: string | null;
    /** Bronze-place team name, set via PATCH /tournaments/{uuid}/podium. */
    thirdPlaceName?: string | null;

    /** Individual awards (uppercase player names), set via POST /awards. */
    bestGoalkeeperName?: string | null;
    bestPlayerName?: string | null;
    bestScorerName?: string | null;

    // Creator info - populated server-side from the verified Firebase ID token.
    createdByUid?: string | null;
    createdByName?: string | null;

    /** True when this tournament currently has a match in progress. */
    liveMatch?: boolean;

    /** ISO timestamp at which an admin promoted this tournament to the
     *  "tournament of the day" daily highlight on /uzivo. {@code null}
     *  when not featured. Admin UI uses it to label the toggle button. */
    featuredAt?: string | null;

    /** Admin-set "not publicly visible". Only the creator/admin ever see a
     *  hidden tournament - the details page shows a banner + greyed page. */
    hidden?: boolean;

    /** Which goals count toward the best-scorer race. Default KNOCKOUT
     *  (group-stage goals excluded); set via PUT /{uuid}/scorer-scope. */
    scorerScope?: ScorerScope | null;

    /** Opt-in: render accumulated team fouls on every event timeline of this
     *  tournament. Off by default; set via PUT /{uuid}/fouls-in-timeline.
     *  Switching it off hides the FOUL events, never deletes them. */
    showFoulsInTimeline?: boolean;

    /** ISO timestamp of a pending deletion request (tournament archived,
     *  awaiting the platform admin's final confirm). Null = active. Drives
     *  the pending-deletion banner + disables re-requesting. */
    archivedAt?: string | null;
};

export type CreateTournamentPayload = {
    // required
    name: string;

    // optional basics
    location?: string | null;
    /** Exact map-pin coordinates from LocationMapPicker / an autocomplete
     *  suggestion. When BOTH are set the backend stores them as-is and skips
     *  its own (coarser) forward geocoding of `location`. */
    latitude?: number | null;
    longitude?: number | null;
    details?: string | null;
    startAt?: string | null;          // ISO with offset
    status?: TournamentStatus | null; // default DRAFT (server-side safe)

    // limits
    maxTeams: number | null;          // null = no cap (e.g. open-entry tournament)

    // format (Phase E)
    format: TournamentFormat;                  // GROUPS_KNOCKOUT (default) | KNOCKOUT_ONLY
    groupCount?: number | null;                // GROUPS_KNOCKOUT only
    advancePerGroup?: number | null;           // GROUPS_KNOCKOUT only
    bracketFill?: BracketFill | null;          // GROUPS_KNOCKOUT only

    // pricing
    entryPrice: number;              // not null, default 0

    // contact
    contactName?: string | null;
    contactPhone?: string | null;

    // Futsal play system + external organizer link (both optional).
    gameSystem?: string | null;
    // Playing surface. Omit/null defaults to ASFALT server-side.
    surface?: Surface | null;
    websiteUrl?: string | null;

    // Public organizer display name (udruga, klub…) - optional; replaces
    // the creator's account name on the public detail page when set.
    organizerName?: string | null;

    // rewards - each place has an amount + optional free-text note ("Ostalo").
    // rewardType is legacy; always "FIXED" now (percent/fixed toggle removed).
    rewardType?: RewardType | null;
    rewardFirst?: number | null;
    rewardFirstNote?: string | null;
    rewardSecond?: number | null;
    rewardSecondNote?: string | null;
    rewardThird?: number | null;
    rewardThirdNote?: string | null;
    rewardFourth?: number | null;
    rewardFourthNote?: string | null;

    // media via resources table (optional linkage at create time)
    resourceId?: number | null;
};
