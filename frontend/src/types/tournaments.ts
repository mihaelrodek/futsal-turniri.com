export type RewardType = "FIXED" | "PERCENTAGE";
export type TournamentStatus = "DRAFT" | "STARTED" | "FINISHED";
export type TournamentFormat = "GROUPS_KNOCKOUT" | "KNOCKOUT_ONLY";
export type BracketFill = "BYES" | "WILDCARDS";

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
    winnerName?: string | null;
    registeredTeams?: number | null;
    /** True when this tournament currently has a match in progress. */
    liveMatch?: boolean;
    /** Set when an admin featured this tournament; null otherwise. The home
     *  list sorts featured tournaments first (before live ones). */
    featuredAt?: string | null;
};

export type TournamentDetails = {
    id: string; // UUID
    uuid: string;
    /** Pretty URL slug, e.g. "1-futsal-open-22-04-2026". Null on legacy rows. */
    slug?: string | null;
    name: string;
    location?: string | null;
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
    bracketFill?: BracketFill | null;

    contactName?: string | null;
    contactPhone?: string | null;

    /** Futsal play system: "4+1" | "5+1" | "3vs3" | free-text custom. */
    gameSystem?: string | null;
    /** External organizer link (Facebook event, club page, …). */
    websiteUrl?: string | null;

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

    // Creator info — populated server-side from the verified Firebase ID token.
    createdByUid?: string | null;
    createdByName?: string | null;

    /** True when this tournament currently has a match in progress. */
    liveMatch?: boolean;

    /** ISO timestamp at which an admin promoted this tournament to the
     *  "tournament of the day" daily highlight on /uzivo. {@code null}
     *  when not featured. Admin UI uses it to label the toggle button. */
    featuredAt?: string | null;
};

export type CreateTournamentPayload = {
    // required
    name: string;

    // optional basics
    location?: string | null;
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
    websiteUrl?: string | null;

    // rewards — each place has an amount + optional free-text note ("Ostalo").
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
