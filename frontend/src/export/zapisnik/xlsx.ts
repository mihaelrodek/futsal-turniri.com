// ExcelJS renderer for the FIFA-style futsal match report (zapisnik).
// Replicates the reference print form on one sheet, A1:AQ72, A4 portrait.
// All values are written as text; labels come from the language dictionary.

import ExcelJS from "exceljs";
import type { ZapisnikData, ZapisnikGoal, ZapisnikPlayer } from "./types";
import {
  FOUL_BOXES_PER_HALF,
  GOAL_SLOTS,
  OFFICIALS_ROWS,
  PLAYER_ROWS,
} from "./types";
import { zapisnikLabels } from "./spec";

const LAST_ROW = 72;
const LAST_COL = 43; // AQ

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Border edge styles used by the form.
const HAIR: Partial<ExcelJS.Border> = { style: "hair" };
const THIN: Partial<ExcelJS.Border> = { style: "thin" };
const MEDIUM: Partial<ExcelJS.Border> = { style: "medium" };
const DOTTED: Partial<ExcelJS.Border> = { style: "dotted" };

const hairBottom: Partial<ExcelJS.Borders> = { bottom: HAIR };
const hairTopBottom: Partial<ExcelJS.Borders> = { top: HAIR, bottom: HAIR };
const thinBottom: Partial<ExcelJS.Borders> = { bottom: THIN };
const thinRight: Partial<ExcelJS.Borders> = { right: THIN };
const thinBox: Partial<ExcelJS.Borders> = {
  top: THIN,
  left: THIN,
  bottom: THIN,
  right: THIN,
};
const mediumBottom: Partial<ExcelJS.Borders> = { bottom: MEDIUM };
const mediumBox: Partial<ExcelJS.Borders> = {
  top: MEDIUM,
  left: MEDIUM,
  bottom: MEDIUM,
  right: MEDIUM,
};
const dottedBottom: Partial<ExcelJS.Borders> = { bottom: DOTTED };
const dottedTopBottom: Partial<ExcelJS.Borders> = { top: DOTTED, bottom: DOTTED };

interface CellOpts {
  /** Font size in pt; defaults to the 8pt label size. */
  size?: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  wrap?: boolean;
  border?: Partial<ExcelJS.Borders>;
}

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseRef(ref: string): { row: number; col: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bad cell ref: ${ref}`);
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

export async function generateZapisnikXlsx(data: ZapisnikData): Promise<Blob> {
  const labels = zapisnikLabels(data.lang);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ZAPISNIK");

  // ---- Page / print setup -------------------------------------------------
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: "portrait",
    scale: 87,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: { left: 0.44, right: 0, top: 0.12, bottom: 0, header: 0.12, footer: 0 },
  };
  ws.pageSetup.printArea = "A1:AQ72";
  ws.views = [{ state: "normal", showGridLines: false }];

  // ---- Column widths ------------------------------------------------------
  const widthOf = (c: number): number => {
    if (c <= 2) return 2.66; // A-B
    if (c <= 18) return 2.44; // C-R
    if (c === 19) return 2.66; // S
    if (c <= 21) return 2.44; // T-U
    if (c <= 23) return 2.66; // V-W
    if (c <= 42) return 2.44; // X-AP
    return 9.11; // AQ
  };
  for (let c = 1; c <= LAST_COL; c++) ws.getColumn(c).width = widthOf(c);

  // ---- Row heights --------------------------------------------------------
  const rowHeights: Record<number, number> = {
    1: 13.8, 2: 15.75, 3: 15, 4: 15.75, 5: 15.75, 10: 12.75, 13: 8.25,
    14: 17.4, 15: 7.5, 16: 15, 17: 12, 18: 15,
    47: 13.8, 48: 13.8, 49: 13.8, 50: 3, 59: 3, 60: 12.75,
    68: 7.2, 69: 16.5, 70: 13.2, 71: 16.5, 72: 12,
  };
  for (let r = 6; r <= 9; r++) rowHeights[r] = 15;
  for (let r = 11; r <= 12; r++) rowHeights[r] = 15;
  for (let r = 19; r <= 45; r += 2) rowHeights[r] = 3; // player spacers
  for (let r = 20; r <= 46; r += 2) rowHeights[r] = 15; // player rows
  for (let r = 51; r <= 58; r++) rowHeights[r] = 15;
  for (let r = 61; r <= 67; r++) rowHeights[r] = 16.5;
  for (let r = 1; r <= LAST_ROW; r++) ws.getRow(r).height = rowHeights[r];

  // ---- White background over the whole form -------------------------------
  const whiteFill: ExcelJS.Fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFFFFF" },
  };
  for (let r = 1; r <= LAST_ROW; r++) {
    for (let c = 1; c <= LAST_COL; c++) ws.getCell(r, c).fill = whiteFill;
  }

  // ---- Cell helpers -------------------------------------------------------
  const applyBorder = (range: string, border: Partial<ExcelJS.Borders>): void => {
    const [from, to] = range.split(":");
    const start = parseRef(from);
    const end = to ? parseRef(to) : start;
    for (let r = start.row; r <= end.row; r++) {
      for (let c = start.col; c <= end.col; c++) ws.getCell(r, c).border = border;
    }
  };

  const setCell = (ref: string, value: string, opts: CellOpts = {}): void => {
    const cell = ws.getCell(ref);
    cell.value = value;
    cell.font = { name: "Arial", size: opts.size ?? 8, bold: opts.bold ?? false };
    cell.alignment = {
      horizontal: opts.align ?? "left",
      vertical: "middle",
      wrapText: opts.wrap ?? false,
    };
    if (opts.border) cell.border = opts.border;
  };

  const mergeAndSet = (range: string, value: string, opts: CellOpts = {}): void => {
    ws.mergeCells(range);
    setCell(range.split(":")[0], value, opts);
    if (opts.border) applyBorder(range, opts.border);
  };

  /** Single-cell tick box ("X" or empty). */
  const tickBox = (
    ref: string,
    ticked: boolean,
    border: Partial<ExcelJS.Borders> = thinBox,
  ): void => {
    setCell(ref, ticked ? "X" : "", { size: 8, bold: true, align: "center", border });
  };

  // ---- Header (rows 1-12) -------------------------------------------------
  mergeAndSet("AF2:AH2", labels.date, { size: 8 });
  mergeAndSet("AJ2:AO2", data.date, {
    size: 10, bold: true, align: "center", border: dottedBottom,
  });
  mergeAndSet("AF3:AH3", labels.round, { size: 8 });
  mergeAndSet("AJ3:AO3", data.round, {
    size: 10, bold: true, align: "center", border: dottedTopBottom,
  });
  mergeAndSet("AF4:AI4", labels.competition, { size: 8 });
  mergeAndSet("AJ4:AO4", data.competition, {
    size: 10, bold: true, align: "center", border: dottedBottom,
  });

  mergeAndSet("A4:AE4", data.tournamentName, {
    size: 18, bold: true, align: "center", wrap: true,
  });
  mergeAndSet("A5:AE5", labels.formTitle, { size: 12, bold: true, align: "center" });

  mergeAndSet("AF5:AJ5", labels.startGame, { size: 8 });
  mergeAndSet("AK5:AN5", data.startTime, {
    size: 9, bold: true, align: "center", border: dottedBottom,
  });
  setCell("AO5", labels.startSuffix, { size: 8 });

  mergeAndSet("A6:E6", labels.matchType, { size: 8 });
  mergeAndSet("F6:R6", data.matchType, {
    size: 9, bold: true, align: "center", border: hairBottom,
  });
  mergeAndSet("S6:AE6", "", { border: hairBottom });

  mergeAndSet("A7:E7", labels.betweenTeams, { size: 8 });
  mergeAndSet("F7:R7", data.host.name, {
    size: 10, bold: true, align: "center", border: hairTopBottom,
  });
  setCell("S7", "-", { size: 10, bold: true, align: "center", border: hairTopBottom });
  mergeAndSet("T7:AE7", data.guest.name, {
    size: 10, bold: true, align: "center", border: hairTopBottom,
  });

  mergeAndSet("A8:E8", labels.venueTown, { size: 8 });
  mergeAndSet("F8:N8", data.venueTown, {
    size: 9, bold: true, align: "center", border: hairBottom,
  });
  mergeAndSet("O8:S8", labels.hall, { size: 8 });
  mergeAndSet("T8:AE8", data.hall, {
    size: 9, bold: true, align: "center", border: hairBottom,
  });

  mergeAndSet("A9:E9", labels.weatherLighting, { size: 8 });
  mergeAndSet("F9:N9", "", { border: hairBottom });
  mergeAndSet("O9:S9", labels.surface, { size: 8 });
  mergeAndSet("T9:AE9", data.surface, {
    size: 10, bold: true, align: "center", border: hairBottom,
  });

  // Score box (top right).
  mergeAndSet("AI8:AP8", labels.result, { size: 12, bold: true, align: "center" });
  mergeAndSet("AI9:AL9", labels.resultFinal, {
    size: 10, bold: true, align: "center", border: mediumBottom,
  });
  mergeAndSet("AM9:AP9", labels.resultHalftime, {
    size: 10, bold: true, align: "center", border: mediumBottom,
  });
  mergeAndSet("AI10:AL11", data.finalScore, {
    size: 16, bold: true, align: "center", border: mediumBox,
  });
  mergeAndSet("AM10:AP11", data.halftimeScore, {
    size: 14, bold: true, align: "center", border: mediumBox,
  });

  // Referees + captions.
  setCell("A10", labels.referees, { size: 8 });
  mergeAndSet("D10:L10", data.officials.referee1, {
    size: 9, bold: true, align: "center", border: hairBottom,
  });
  mergeAndSet("N10:W10", data.officials.referee2, {
    size: 9, bold: true, align: "center", border: hairBottom,
  });
  mergeAndSet("Y10:AG10", data.officials.referee3, {
    size: 9, bold: true, align: "center", border: hairBottom,
  });
  mergeAndSet("C11:L11", labels.refereeCaption, { size: 7, align: "center" });
  mergeAndSet("M11:W11", labels.secondRefereeCaption, { size: 7, align: "center" });
  mergeAndSet("Y11:AG11", labels.thirdRefereeCaption, { size: 7, align: "center" });

  mergeAndSet("A12:C12", labels.delegate, { size: 8 });
  mergeAndSet("D12:N12", data.officials.delegate, {
    size: 9, bold: true, align: "center", border: hairBottom,
  });
  mergeAndSet("O12:T12", labels.timekeeper, { size: 8 });
  mergeAndSet("U12:AE12", data.officials.timekeeper, {
    size: 9, bold: true, align: "center", border: hairBottom,
  });

  // ---- Teams (rows 14-46) -------------------------------------------------
  mergeAndSet("A14:AN14", labels.teams, { size: 14, bold: true, align: "center" });

  setCell("A16", labels.host, { size: 8 });
  mergeAndSet("E16:S16", data.host.name, {
    size: 12, bold: true, align: "center", border: hairBottom,
  });
  setCell("V16", labels.guests, { size: 8 });
  mergeAndSet("Z16:AN16", data.guest.name, {
    size: 12, bold: true, align: "center", border: hairBottom,
  });

  setCell("A17", labels.cards, { size: 8 });
  applyBorder("A17:B17", thinBottom);
  mergeAndSet("V17:W17", labels.cards, { size: 8, border: thinBottom });

  setCell("A18", labels.yellowCol, { size: 8, align: "center", border: thinBox });
  setCell("B18", labels.redCol, { size: 8, align: "center", border: thinBox });
  mergeAndSet("Q18:S18", labels.regNumber, { size: 8 });
  setCell("V18", labels.yellowCol, { size: 8, align: "center", border: thinBox });
  setCell("W18", labels.redCol, { size: 8, align: "center", border: thinBox });
  mergeAndSet("AL18:AN18", labels.regNumber, { size: 8 });

  const playerName = (p: ZapisnikPlayer): string => {
    let s = p.name;
    if (p.goalkeeper) s += ` ${labels.gkMark}`;
    if (p.captain) s += ` ${labels.captainMark}`;
    return s;
  };

  const hostPlayers = data.host.players.slice(0, PLAYER_ROWS);
  const guestPlayers = data.guest.players.slice(0, PLAYER_ROWS);
  for (let i = 0; i < PLAYER_ROWS; i++) {
    const r = 20 + 2 * i;
    const hp: ZapisnikPlayer | undefined = hostPlayers[i];
    const gp: ZapisnikPlayer | undefined = guestPlayers[i];

    tickBox(`A${r}`, hp?.yellow === true);
    tickBox(`B${r}`, hp?.red === true);
    mergeAndSet(`C${r}:D${r}`, hp?.number ?? "", {
      size: 12, bold: true, align: "center",
    });
    mergeAndSet(`E${r}:S${r}`, hp ? playerName(hp) : "", {
      size: 10, bold: true, align: "left", border: hairBottom,
    });

    tickBox(`V${r}`, gp?.yellow === true);
    tickBox(`W${r}`, gp?.red === true);
    mergeAndSet(`X${r}:Y${r}`, gp?.number ?? "", {
      size: 12, bold: true, align: "center",
    });
    mergeAndSet(`Z${r}:AN${r}`, gp ? playerName(gp) : "", {
      size: 10, bold: true, align: "left", border: hairBottom,
    });
  }

  // ---- Accumulated fouls (rows 47-49) -------------------------------------
  mergeAndSet("E47:S47", labels.fouls, { size: 9, align: "center" });
  mergeAndSet("X47:AN47", labels.fouls, { size: 9, align: "center" });
  mergeAndSet("A48:C48", labels.firstHalf, { size: 10, bold: true });
  mergeAndSet("A49:C49", labels.secondHalf, { size: 10, bold: true });

  const HOST_FOUL_THIN = ["D", "E", "F", "G", "H"];
  const HOST_FOUL_MEDIUM: ReadonlyArray<readonly [string, string | null]> = [
    ["I", "J"], ["K", "L"], ["M", "N"], ["O", "P"], ["Q", "R"], ["S", null],
  ];
  const GUEST_FOUL_THIN = ["Y", "Z", "AA", "AB", "AC"];
  const GUEST_FOUL_MEDIUM: ReadonlyArray<readonly [string, string | null]> = [
    ["AD", "AE"], ["AF", "AG"], ["AH", "AI"], ["AJ", "AK"], ["AL", "AM"], ["AN", null],
  ];

  const foulRow = (
    r: number,
    count: number,
    thin: readonly string[],
    medium: ReadonlyArray<readonly [string, string | null]>,
  ): void => {
    const n = Math.min(count, FOUL_BOXES_PER_HALF);
    thin.forEach((c, idx) => tickBox(`${c}${r}`, idx < n));
    medium.forEach(([c1, c2], idx) => {
      const ticked = 5 + idx < n;
      if (c2) {
        mergeAndSet(`${c1}${r}:${c2}${r}`, ticked ? "X" : "", {
          size: 8, bold: true, align: "center", border: mediumBox,
        });
      } else {
        tickBox(`${c1}${r}`, ticked, mediumBox);
      }
    });
  };

  foulRow(48, data.host.foulsFirst, HOST_FOUL_THIN, HOST_FOUL_MEDIUM);
  foulRow(49, data.host.foulsSecond, HOST_FOUL_THIN, HOST_FOUL_MEDIUM);
  foulRow(48, data.guest.foulsFirst, GUEST_FOUL_THIN, GUEST_FOUL_MEDIUM);
  foulRow(49, data.guest.foulsSecond, GUEST_FOUL_THIN, GUEST_FOUL_MEDIUM);
  ws.mergeCells("T48:X48");
  ws.mergeCells("T49:X49");

  // ---- Time out (row 51) --------------------------------------------------
  mergeAndSet("A51:C51", labels.timeOut, { size: 8 });
  mergeAndSet("F51:I51", labels.firstHalf, { size: 10, bold: true });
  tickBox("L51", data.host.timeoutFirst);
  mergeAndSet("O51:Q51", labels.secondHalf, { size: 10, bold: true });
  tickBox("S51", data.host.timeoutSecond);
  mergeAndSet("V51:X51", labels.timeOut, { size: 8 });
  mergeAndSet("AA51:AC51", labels.firstHalf, { size: 10, bold: true });
  tickBox("AG51", data.guest.timeoutFirst);
  mergeAndSet("AJ51:AL51", labels.secondHalf, { size: 10, bold: true });
  tickBox("AN51", data.guest.timeoutSecond);

  // ---- Goal grid (rows 53-58): two strips of 18 slots ---------------------
  const goals = data.goals.slice(0, GOAL_SLOTS);
  const strips = [
    { resultRow: 53, scorerRow: 54, penaltyRow: 55, offset: 0 },
    { resultRow: 56, scorerRow: 57, penaltyRow: 58, offset: 18 },
  ];
  for (const strip of strips) {
    mergeAndSet(`A${strip.resultRow}:D${strip.resultRow}`, labels.goalResult, {
      size: 8, border: thinRight,
    });
    setCell(`A${strip.scorerRow}`, labels.goalScorerMin, { size: 8 });
    setCell(`A${strip.penaltyRow}`, labels.goalPenalty, { size: 10 });

    for (let k = 0; k < 18; k++) {
      const goal: ZapisnikGoal | undefined = goals[strip.offset + k];
      const c1 = colLetter(5 + 2 * k); // E, G, I, ..., AM
      const c2 = colLetter(6 + 2 * k);
      mergeAndSet(`${c1}${strip.resultRow}:${c2}${strip.resultRow}`,
        goal ? goal.runningScore : ":", {
          size: 11, bold: true, align: "center", border: thinBox,
        });
      setCell(`${c1}${strip.scorerRow}`, goal ? goal.scorerNumber : "", {
        size: 10, bold: true, align: "center", border: thinBox,
      });
      setCell(`${c2}${strip.scorerRow}`, goal ? goal.minute : "", {
        size: 10, bold: true, align: "center", border: thinBox,
      });
      mergeAndSet(`${c1}${strip.penaltyRow}:${c2}${strip.penaltyRow}`,
        goal?.penalty ? "X" : "", {
          size: 8, bold: true, align: "center", border: thinBox,
        });
    }
  }

  // ---- Club officials (rows 60-66, paper fill-in) -------------------------
  mergeAndSet("P60:X60", labels.officialsHeader, { size: 8, align: "center" });
  for (let i = 0; i < OFFICIALS_ROWS; i++) {
    const r = 61 + i;
    mergeAndSet(`A${r}:K${r}`, "", { size: 7, bold: true, border: hairTopBottom });
    mergeAndSet(`L${r}:M${r}`, labels.licNumber, { size: 8 });
    mergeAndSet(`N${r}:P${r}`, "", { border: hairTopBottom });
    mergeAndSet(`X${r}:AH${r}`, "", { size: 7, bold: true, border: hairTopBottom });
    mergeAndSet(`AJ${r}:AK${r}`, labels.licNumber, { size: 8 });
    mergeAndSet(`AL${r}:AN${r}`, "", { border: hairTopBottom });
  }

  // ---- Signatures (rows 67-72) --------------------------------------------
  mergeAndSet("A67:C67", labels.signDelegate, { size: 8 });
  mergeAndSet("D67:L67", "", { border: hairBottom });
  mergeAndSet("D68:L68", labels.signatureCaption, { size: 7, align: "center" });

  mergeAndSet("M67:P67", labels.signHost, { size: 8 });
  mergeAndSet("Q67:X67", "", { border: hairBottom });
  mergeAndSet("Q68:X68", labels.signatureCaption, { size: 7, align: "center" });
  setCell("M69", labels.signGuests, { size: 8 });
  mergeAndSet("Q69:X69", "", { border: hairBottom });
  mergeAndSet("Q70:X70", labels.signatureCaption, { size: 7, align: "center" });

  mergeAndSet("Y67:AA67", labels.signReferee, { size: 8 });
  mergeAndSet("AD67:AN67", "", { border: hairBottom });
  mergeAndSet("AD68:AN68", labels.signatureCaption, { size: 7, align: "center" });
  mergeAndSet("Y69:AC69", labels.signAssReferee, { size: 8 });
  mergeAndSet("AD69:AN69", "", { border: hairBottom });
  mergeAndSet("AD70:AN70", labels.signatureCaption, { size: 7, align: "center" });
  mergeAndSet("Y71:AC71", labels.signAssReferee, { size: 8 });
  mergeAndSet("AD71:AN71", "", { border: hairBottom });
  mergeAndSet("AD72:AN72", labels.signatureCaption, { size: 7, align: "center" });

  mergeAndSet("A72:K72", "", { border: hairTopBottom });

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer as unknown as BlobPart], { type: XLSX_MIME });
}
