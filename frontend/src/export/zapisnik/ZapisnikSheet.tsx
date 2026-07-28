/* Pure presentational A4 replica (794x1123 px) of a FIFA-style futsal match
   report. Rendered off-DOM by pdf.ts and snapshotted with html-to-image.

   IMPORTANT - every colour is a hard-coded literal (#FFFFFF page, #000 ink),
   mirroring the TournamentExport rule: html-to-image captures *computed*
   colours, so theme tokens would leak the viewer's dark mode into the export.
   No Chakra, no external fonts - plain inline-styled DOM, Arial only. */

import type { CSSProperties, ReactNode } from "react";
import type { ZapisnikData, ZapisnikGoal, ZapisnikPlayer, ZapisnikTeamBlock } from "./types";
import { FOUL_BOXES_PER_HALF, GOAL_SLOTS, OFFICIALS_ROWS, PLAYER_ROWS } from "./types";
import type { ZapisnikLabels } from "./spec";
import { zapisnikLabels } from "./spec";

const INK = "#000";
const PAGE = "#FFFFFF";

/* ── small building blocks ─────────────────────────────────────────────── */

/** Square tick box; renders "X" when on. Emphasized = 2px border. */
function Tick({ on, thick, size = 14 }: { on: boolean; thick?: boolean; size?: number }) {
    return (
        <span
            style={{
                width: size,
                height: size,
                border: `${thick ? 2 : 1}px solid ${INK}`,
                boxSizing: "border-box",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
                flex: "0 0 auto",
            }}
        >
            {on ? "X" : ""}
        </span>
    );
}

/** Label + dotted-underlined value (header right column). */
function DottedLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
    return (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 4 }}>
            <span style={{ whiteSpace: "nowrap" }}>{label}</span>
            <span
                style={{
                    flex: 1,
                    borderBottom: `1px dotted ${INK}`,
                    fontWeight: bold ? 700 : 400,
                    textAlign: "center",
                    minHeight: 13,
                    lineHeight: "13px",
                }}
            >
                {value}
            </span>
        </div>
    );
}

/** Label + solid-underlined value (info lines). Value may be rich children. */
function InfoLine({ label, children }: { label: string; children?: ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 5, flex: 1, minWidth: 0 }}>
            <span style={{ whiteSpace: "nowrap" }}>{label}</span>
            <span
                style={{
                    flex: 1,
                    borderBottom: `1px solid ${INK}`,
                    textAlign: "center",
                    minHeight: 14,
                    lineHeight: "14px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                }}
            >
                {children}
            </span>
        </div>
    );
}

/** Signature entry: bold label + underline, small centred caption below. */
function SignLine({ label, caption }: { label: string; caption: string }) {
    return (
        <div style={{ marginBottom: 5 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</span>
                <span style={{ flex: 1, borderBottom: `1px solid ${INK}`, height: 13 }} />
            </div>
            <div style={{ fontSize: 8, textAlign: "center" }}>{caption}</div>
        </div>
    );
}

/* ── team side column: roster + fouls + time out ───────────────────────── */

function playerDisplayName(p: ZapisnikPlayer, L: ZapisnikLabels): string {
    let name = p.name;
    if (p.goalkeeper) name += ` ${L.gkMark}`;
    if (p.captain) name += ` ${L.captainMark}`;
    return name;
}

function FoulRow({ label, count }: { label: string; count: number }) {
    const marked = Math.min(Math.max(count, 0), FOUL_BOXES_PER_HALF);
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 2, height: 18 }}>
            <span style={{ width: 52, fontSize: 9, flex: "0 0 auto" }}>{label}</span>
            {Array.from({ length: FOUL_BOXES_PER_HALF }, (_, i) => (
                <Tick key={i} on={i < marked} thick={i >= 5} />
            ))}
        </div>
    );
}

function SideColumn({ team, sideLabel, L }: { team: ZapisnikTeamBlock; sideLabel: string; L: ZapisnikLabels }) {
    const rows: (ZapisnikPlayer | undefined)[] = Array.from(
        { length: PLAYER_ROWS },
        (_, i) => team.players[i],
    );
    return (
        <div style={{ flex: 1, minWidth: 0 }}>
            {/* header: side label + team name */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 5, fontSize: 11 }}>
                <span style={{ whiteSpace: "nowrap" }}>{sideLabel}</span>
                <span
                    style={{
                        flex: 1,
                        borderBottom: `1px solid ${INK}`,
                        fontWeight: 700,
                        textAlign: "center",
                        minHeight: 14,
                        lineHeight: "14px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                    }}
                >
                    {team.name}
                </span>
            </div>
            {/* cards caption + Y/R column headers + reg-number header */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 24, marginTop: 2 }}>
                <div style={{ width: 32, textAlign: "center", flex: "0 0 auto" }}>
                    <div style={{ fontSize: 8, lineHeight: "9px" }}>{L.cards}</div>
                    <div style={{ display: "flex", gap: 4, fontSize: 9, fontWeight: 700, lineHeight: "11px" }}>
                        <span style={{ width: 14, textAlign: "center" }}>{L.yellowCol}</span>
                        <span style={{ width: 14, textAlign: "center" }}>{L.redCol}</span>
                    </div>
                </div>
                <span style={{ width: 22, flex: "0 0 auto" }} />
                <span style={{ flex: 1 }} />
                <span style={{ width: 56, fontSize: 8, textAlign: "center", flex: "0 0 auto" }}>{L.regNumber}</span>
            </div>
            {/* player rows */}
            {rows.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, height: 19 }}>
                    <Tick on={!!p?.yellow} />
                    <Tick on={!!p?.red} />
                    <span
                        style={{
                            width: 22,
                            fontSize: 15,
                            fontWeight: 700,
                            textAlign: "center",
                            lineHeight: 1,
                            flex: "0 0 auto",
                        }}
                    >
                        {p?.number ?? ""}
                    </span>
                    <span
                        style={{
                            flex: 1,
                            fontSize: 13,
                            fontWeight: 700,
                            borderBottom: `1px solid ${INK}`,
                            minHeight: 16,
                            lineHeight: "16px",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            minWidth: 0,
                        }}
                    >
                        {p ? playerDisplayName(p, L) : ""}
                    </span>
                    <span style={{ width: 56, borderBottom: `1px solid ${INK}`, height: 16, flex: "0 0 auto" }} />
                </div>
            ))}
            {/* fouls */}
            <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 2 }}>{L.fouls}</div>
                <FoulRow label={L.firstHalf} count={team.foulsFirst} />
                <FoulRow label={L.secondHalf} count={team.foulsSecond} />
            </div>
            {/* time out */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, height: 18 }}>
                <span style={{ fontSize: 10, fontWeight: 700 }}>{L.timeOut}</span>
                <span style={{ fontSize: 9 }}>{L.firstHalf}</span>
                <Tick on={team.timeoutFirst} />
                <span style={{ fontSize: 9, marginLeft: 6 }}>{L.secondHalf}</span>
                <Tick on={team.timeoutSecond} />
            </div>
        </div>
    );
}

/* ── goal grid strip: 18 slots x 3 rows ────────────────────────────────── */

const GOAL_LABEL_W = 86;

function GoalCells({
    slots,
    height,
    render,
}: {
    slots: (ZapisnikGoal | undefined)[];
    height: number;
    render: (g: ZapisnikGoal | undefined) => ReactNode;
}) {
    return (
        <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
            {slots.map((g, i) => (
                <div
                    key={i}
                    style={{
                        flex: 1,
                        height,
                        border: `1px solid ${INK}`,
                        marginLeft: i > 0 ? -1 : 0,
                        boxSizing: "border-box",
                        display: "flex",
                        alignItems: "stretch",
                        justifyContent: "center",
                        overflow: "hidden",
                        minWidth: 0,
                    }}
                >
                    {render(g)}
                </div>
            ))}
        </div>
    );
}

function GoalStrip({ slots, L }: { slots: (ZapisnikGoal | undefined)[]; L: ZapisnikLabels }) {
    const rowLabel: CSSProperties = {
        width: GOAL_LABEL_W,
        fontSize: 8,
        flex: "0 0 auto",
        whiteSpace: "nowrap",
        overflow: "hidden",
    };
    const cellText: CSSProperties = {
        fontSize: 8,
        lineHeight: 1,
        alignSelf: "center",
        whiteSpace: "nowrap",
    };
    return (
        <div>
            {/* running score */}
            <div style={{ display: "flex", alignItems: "center" }}>
                <span style={rowLabel}>{L.goalResult}</span>
                <GoalCells
                    slots={slots}
                    height={15}
                    render={(g) => <span style={cellText}>{g ? g.runningScore : ":"}</span>}
                />
            </div>
            {/* scorer number | minute */}
            <div style={{ display: "flex", alignItems: "center", marginTop: -1 }}>
                <span style={rowLabel}>{L.goalScorerMin}</span>
                <GoalCells
                    slots={slots}
                    height={17}
                    render={(g) => (
                        <span style={{ display: "flex", width: "100%" }}>
                            <span style={{ ...cellText, flex: 1, textAlign: "center", alignSelf: "center" }}>
                                {g?.scorerNumber ?? ""}
                            </span>
                            <span
                                style={{
                                    ...cellText,
                                    flex: 1,
                                    textAlign: "center",
                                    alignSelf: "stretch",
                                    borderLeft: `1px solid ${INK}`,
                                    lineHeight: "15px",
                                }}
                            >
                                {g?.minute ?? ""}
                            </span>
                        </span>
                    )}
                />
            </div>
            {/* 6m/10m penalty */}
            <div style={{ display: "flex", alignItems: "center", marginTop: -1 }}>
                <span style={rowLabel}>{L.goalPenalty}</span>
                <GoalCells
                    slots={slots}
                    height={13}
                    render={(g) => <span style={{ ...cellText, fontWeight: 700 }}>{g?.penalty ? "X" : ""}</span>}
                />
            </div>
        </div>
    );
}

/* ── the sheet ─────────────────────────────────────────────────────────── */

export function ZapisnikSheet({ data }: { data: ZapisnikData }) {
    const L = zapisnikLabels(data.lang);
    const slotsPerStrip = GOAL_SLOTS / 2;
    const strip1: (ZapisnikGoal | undefined)[] = Array.from(
        { length: slotsPerStrip },
        (_, i) => data.goals[i],
    );
    const strip2: (ZapisnikGoal | undefined)[] = Array.from(
        { length: slotsPerStrip },
        (_, i) => data.goals[slotsPerStrip + i],
    );

    return (
        <div
            style={{
                width: 794,
                height: 1123,
                boxSizing: "border-box",
                padding: "22px 26px",
                backgroundColor: PAGE,
                color: INK,
                fontFamily: "Arial, sans-serif",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
            }}
        >
            {/* 1+2 ── header: title (centre) + date/round/competition column */}
            <div style={{ display: "flex", gap: 20 }}>
                <div style={{ flex: 1, textAlign: "center", paddingTop: 6, minWidth: 0 }}>
                    <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.15 }}>{data.tournamentName}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, marginTop: 5 }}>{L.formTitle}</div>
                </div>
                <div style={{ width: 210, flex: "0 0 auto", fontSize: 10 }}>
                    <DottedLine label={L.date} value={data.date} bold />
                    <DottedLine label={L.round} value={data.round} />
                    <DottedLine label={L.competition} value={data.competition} />
                    <div style={{ marginTop: 5 }}>
                        <span>{L.startGame} </span>
                        <span
                            style={{
                                fontWeight: 700,
                                borderBottom: `1px dotted ${INK}`,
                                padding: "0 8px",
                            }}
                        >
                            {data.startTime}
                        </span>
                        <span> {L.startSuffix}</span>
                    </div>
                </div>
            </div>

            {/* 3+4 ── info lines (left) + RESULT box (right) */}
            <div style={{ display: "flex", gap: 20, marginTop: 10, fontSize: 11 }}>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                    <InfoLine label={L.matchType}>{data.matchType}</InfoLine>
                    <InfoLine label={L.betweenTeams}>
                        <span style={{ fontWeight: 700 }}>{data.host.name}</span>
                        {" - "}
                        <span style={{ fontWeight: 700 }}>{data.guest.name}</span>
                    </InfoLine>
                    <div style={{ display: "flex", gap: 14 }}>
                        <InfoLine label={L.venueTown}>{data.venueTown}</InfoLine>
                        <InfoLine label={L.hall}>{data.hall}</InfoLine>
                    </div>
                    <div style={{ display: "flex", gap: 14 }}>
                        <InfoLine label={L.weatherLighting} />
                        <InfoLine label={L.surface}>{data.surface}</InfoLine>
                    </div>
                </div>
                <div style={{ width: 170, flex: "0 0 auto", textAlign: "center" }}>
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{L.result}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 8, marginBottom: 1 }}>{L.resultFinal}</div>
                            <div
                                style={{
                                    border: `2px solid ${INK}`,
                                    boxSizing: "border-box",
                                    height: 34,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 20,
                                    fontWeight: 700,
                                }}
                            >
                                {data.finalScore}
                            </div>
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 8, marginBottom: 1 }}>{L.resultHalftime}</div>
                            <div
                                style={{
                                    border: `1px solid ${INK}`,
                                    boxSizing: "border-box",
                                    height: 34,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 17,
                                    fontWeight: 700,
                                }}
                            >
                                {data.halftimeScore}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* 5 ── officials: referees + delegate + timekeeper */}
            <div style={{ marginTop: 9, fontSize: 11 }}>
                <div style={{ display: "flex", gap: 10 }}>
                    <span style={{ whiteSpace: "nowrap", paddingTop: 1 }}>{L.referees}</span>
                    {[
                        { name: data.officials.referee1, caption: L.refereeCaption },
                        { name: data.officials.referee2, caption: L.secondRefereeCaption },
                        { name: data.officials.referee3, caption: L.thirdRefereeCaption },
                    ].map((r, i) => (
                        <div key={i} style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                            <div
                                style={{
                                    borderBottom: `1px solid ${INK}`,
                                    minHeight: 14,
                                    lineHeight: "14px",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                }}
                            >
                                {r.name}
                            </div>
                            <div style={{ fontSize: 9 }}>{r.caption}</div>
                        </div>
                    ))}
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 3 }}>
                    <InfoLine label={L.delegate}>{data.officials.delegate}</InfoLine>
                    <InfoLine label={L.timekeeper}>{data.officials.timekeeper}</InfoLine>
                </div>
            </div>

            {/* 6-8 ── TEAMS heading + host/guest columns (roster, fouls, time out) */}
            <div style={{ fontSize: 18, fontWeight: 700, textAlign: "center", marginTop: 8, marginBottom: 4 }}>
                {L.teams}
            </div>
            <div style={{ display: "flex", gap: 18 }}>
                <SideColumn team={data.host} sideLabel={L.host} L={L} />
                <SideColumn team={data.guest} sideLabel={L.guests} L={L} />
            </div>

            {/* 9 ── goal grid: 2 strips x 18 slots */}
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
                <GoalStrip slots={strip1} L={L} />
                <GoalStrip slots={strip2} L={L} />
            </div>

            {/* 10 ── club officials: 6 empty lines per side + lic. number */}
            <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 9, textAlign: "center", marginBottom: 3 }}>{L.officialsHeader}</div>
                <div style={{ display: "flex", gap: 26 }}>
                    {[0, 1].map((col) => (
                        <div key={col} style={{ flex: 1, minWidth: 0 }}>
                            {Array.from({ length: OFFICIALS_ROWS }, (_, i) => (
                                <div
                                    key={i}
                                    style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 17 }}
                                >
                                    <span style={{ flex: 1, borderBottom: `1px solid ${INK}`, height: 13 }} />
                                    <span style={{ fontSize: 8, whiteSpace: "nowrap" }}>{L.licNumber}</span>
                                    <span
                                        style={{
                                            width: 54,
                                            borderBottom: `1px solid ${INK}`,
                                            height: 13,
                                            flex: "0 0 auto",
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* 11 ── signatures */}
            <div style={{ display: "flex", gap: 22, marginTop: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <SignLine label={L.signDelegate} caption={L.signatureCaption} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <SignLine label={L.signHost} caption={L.signatureCaption} />
                    <SignLine label={L.signGuests} caption={L.signatureCaption} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <SignLine label={L.signReferee} caption={L.signatureCaption} />
                    <SignLine label={L.signAssReferee} caption={L.signatureCaption} />
                    <SignLine label={L.signAssReferee} caption={L.signatureCaption} />
                </div>
            </div>
        </div>
    );
}
