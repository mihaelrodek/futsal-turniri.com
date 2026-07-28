// Shared contract for the FIFA-style futsal match report (zapisnik) export.
// Data is assembled once (data.ts) and rendered by two independent backends:
// xlsx.ts (ExcelJS) and pdf.ts (HTML replica -> html-to-image -> jsPDF).

export type ZapisnikLang = "hr" | "en";

export interface ZapisnikPlayer {
  /** Jersey number as text ("" when unknown). */
  number: string;
  name: string;
  captain: boolean;
  /** Not in the data model; provided manually via the export dialog. */
  goalkeeper: boolean;
  yellow: boolean;
  red: boolean;
}

export interface ZapisnikGoal {
  /** Running score after this goal, e.g. "1:0". */
  runningScore: string;
  /** Scorer jersey number; "" for unknown scorer; "AG"/"OG" for own goals. */
  scorerNumber: string;
  /** Minute as text, from match start. */
  minute: string;
  /** 6m/10m penalty tick — model cannot distinguish, always false for now. */
  penalty: boolean;
}

export interface ZapisnikTeamBlock {
  name: string;
  /** Max PLAYER_ROWS entries are rendered; assemble sorted by sortOrder. */
  players: ZapisnikPlayer[];
  foulsFirst: number;
  foulsSecond: number;
  timeoutFirst: boolean;
  timeoutSecond: boolean;
}

/** Officials are free-entry from the export dialog — none exist in the model. */
export interface ZapisnikOfficials {
  referee1: string;
  referee2: string;
  referee3: string;
  delegate: string;
  timekeeper: string;
}

export interface ZapisnikData {
  lang: ZapisnikLang;
  tournamentName: string;
  /** Stage/group label, e.g. "Skupina A" or "Četvrtfinale". */
  competition: string;
  round: string;
  /** Formatted "23. 01. 2026." */
  date: string;
  /** Formatted "12:30". */
  startTime: string;
  venueTown: string;
  hall: string;
  /** Playing surface; defaults to hall/indoor label. */
  surface: string;
  matchType: string;
  host: ZapisnikTeamBlock;
  guest: ZapisnikTeamBlock;
  /** "5 : 1" */
  finalScore: string;
  /** "1 : 1" — derived from goal minutes vs half length; "" when underivable. */
  halftimeScore: string;
  /** Chronological; max GOAL_SLOTS rendered. */
  goals: ZapisnikGoal[];
  officials: ZapisnikOfficials;
}

/** Fixed capacities of the printed form. */
export const PLAYER_ROWS = 14;
export const GOAL_SLOTS = 36; // 2 strips x 18
export const FOUL_BOXES_PER_HALF = 11; // 5 thin + 6 medium (bonus)
export const OFFICIALS_ROWS = 6;
