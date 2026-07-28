// Label dictionaries for the zapisnik form. Two full sets — the original
// template mixed EN + HR; ours are consistent per language.

import type { ZapisnikLang } from "./types";

export interface ZapisnikLabels {
  formTitle: string;
  date: string;
  round: string;
  competition: string;
  startGame: string;
  startSuffix: string;
  matchType: string;
  betweenTeams: string;
  venueTown: string;
  hall: string;
  weatherLighting: string;
  surface: string;
  surfaceDefault: string;
  result: string;
  resultFinal: string;
  resultHalftime: string;
  referees: string;
  refereeCaption: string;
  secondRefereeCaption: string;
  thirdRefereeCaption: string;
  delegate: string;
  timekeeper: string;
  teams: string;
  host: string;
  guests: string;
  cards: string;
  yellowCol: string;
  redCol: string;
  regNumber: string;
  fouls: string;
  firstHalf: string;
  secondHalf: string;
  timeOut: string;
  goalResult: string;
  goalScorerMin: string;
  goalPenalty: string;
  officialsHeader: string;
  licNumber: string;
  signDelegate: string;
  signHost: string;
  signGuests: string;
  signReferee: string;
  signAssReferee: string;
  signatureCaption: string;
  /** Suffix appended to a goalkeeper's name, e.g. "GK". */
  gkMark: string;
  /** Suffix appended to the captain's name, e.g. "C". */
  captainMark: string;
  /** Scorer-number cell content for own goals. */
  ownGoalMark: string;
}

const HR: ZapisnikLabels = {
  formTitle: "ZAPISNIK UTAKMICE",
  date: "Datum:",
  round: "Kolo:",
  competition: "Natjecanje:",
  startGame: "Početak:",
  startSuffix: "sati",
  matchType: "Vrsta utakmice:",
  betweenTeams: "Između momčadi:",
  venueTown: "Mjesto igranja:",
  hall: "Igralište/dvorana:",
  weatherLighting: "Vrijeme/rasvjeta:",
  surface: "Teren/podloga:",
  surfaceDefault: "dvorana",
  result: "REZULTAT:",
  resultFinal: "Konačni",
  resultHalftime: "Poluvrijeme",
  referees: "Suci:",
  refereeCaption: "(sudac)",
  secondRefereeCaption: "(drugi sudac)",
  thirdRefereeCaption: "(treći sudac)",
  delegate: "Delegat:",
  timekeeper: "Mjeritelj vremena:",
  teams: "MOMČADI",
  host: "Domaći:",
  guests: "Gosti:",
  cards: "Kartoni",
  yellowCol: "Ž",
  redCol: "C",
  regNumber: "Reg. broj:",
  fouls: "PREKRŠAJI",
  firstHalf: "I. poluvr.",
  secondHalf: "II. poluvr.",
  timeOut: "TIME OUT",
  goalResult: "Rezultat:",
  goalScorerMin: "Br. strijelca / min.:",
  goalPenalty: "6m/10m",
  officialsHeader: "službeni predstavnici klubova:",
  licNumber: "Lic. br.:",
  signDelegate: "Delegat:",
  signHost: "Domaći:",
  signGuests: "Gosti:",
  signReferee: "Sudac:",
  signAssReferee: "pom. sudac:",
  signatureCaption: "(potpis)",
  gkMark: "GK",
  captainMark: "C",
  ownGoalMark: "AG",
};

const EN: ZapisnikLabels = {
  formTitle: "MATCH REPORT",
  date: "Date:",
  round: "Round:",
  competition: "Competition:",
  startGame: "Start game:",
  startSuffix: "h",
  matchType: "Match type:",
  betweenTeams: "Between teams:",
  venueTown: "Venue:",
  hall: "Pitch/hall:",
  weatherLighting: "Weather/lighting:",
  surface: "Surface:",
  surfaceDefault: "indoor hall",
  result: "RESULT:",
  resultFinal: "Final",
  resultHalftime: "Half-time",
  referees: "Referees:",
  refereeCaption: "(referee)",
  secondRefereeCaption: "(second referee)",
  thirdRefereeCaption: "(third referee)",
  delegate: "Delegate:",
  timekeeper: "Timekeeper:",
  teams: "TEAMS",
  host: "Host:",
  guests: "Guests:",
  cards: "Cards",
  yellowCol: "Y",
  redCol: "RC",
  regNumber: "Reg. no.:",
  fouls: "FOULS",
  firstHalf: "I Half",
  secondHalf: "II Half",
  timeOut: "TIME OUT",
  goalResult: "Result:",
  goalScorerMin: "N.scorer / min.:",
  goalPenalty: "6m/10m",
  officialsHeader: "official representatives of clubs:",
  licNumber: "Lic. no.:",
  signDelegate: "Delegate:",
  signHost: "Host:",
  signGuests: "Guests:",
  signReferee: "Referee:",
  signAssReferee: "ass. referee:",
  signatureCaption: "(signature)",
  gkMark: "GK",
  captainMark: "C",
  ownGoalMark: "OG",
};

export function zapisnikLabels(lang: ZapisnikLang): ZapisnikLabels {
  return lang === "en" ? EN : HR;
}

/** App UI is Croatian — the default download language. */
export const DEFAULT_ZAPISNIK_LANG: ZapisnikLang = "hr";
