#!/bin/bash
# render-match.sh — all overlay states for one match, ready for the Resolve timeline.
# Current match: QF "Tri Hrvatska viteza" — Ogrevanje Zamuda 1:1 Primavita (0:2 pens).
# Team names + kit colors come from BASE in render-overlay.sh.
#
# Layout in Resolve:
#   V2 = board states (01-08), cut at each goal / penalty
#   V3 = chip-* goal chips, ~10 s at the goal moment, on top of the V2 board
set -euo pipefail
cd "$(dirname "$0")"

OUT="${1:-./match-zamuda-primavita}"
mkdir -p "$OUT"

r() { ./render-overlay.sh "$2" "$OUT/$1.png"; }

LU_HOME='A. Trstenjak,M. Vindiš,M. Senekovič,M. Pšaid,N. Vajda,R. Šnofl,U. Goričan,U. Seneković,V. Škerget'
LU_AWAY='8:D. Kantužar,10:S. Kavaš,22:T. Pihler,23:J. Matijašić,80:A. Goznik,96:Ž. Krajnc,J. Žerjav,T. Poredski,Ž. Zupanič'

# --- pre-match ----------------------------------------------------------------
# EDIT kickoff time if you want it shown (default renders "--:--").
r 00-najava        'announce=1&board=0&kickoff=12:30'
r 00-sastavi       "lineups=1&board=0&lineupHome=$LU_HOME&lineupAway=$LU_AWAY"

# --- board states (V2) --------------------------------------------------------
r 01-0-0-1st       'hg=0&ag=0&clock=&period=1'
r 02-0-0-2nd       'hg=0&ag=0&clock=&period=2'
r 03-1-0           'hg=1&ag=0&clock=&period=2'
r 04-1-1           'hg=1&ag=1&clock=&period=2'

# --- penalties (clock/period hidden, shootout tally under the score) ----------
P='hg=1&ag=1&clock=&period='
r 05-pen-0-0       "pens=0:0&$P"
r 06-pen-0-1       "pens=0:1&$P"
r 07-pen-0-2       "pens=0:2&$P"

# --- goal chips (V3, ~10 s each; board=0 keeps the chip aligned to the board) -
# hg/ag must match the V2 state underneath so the hidden board has the same width.
r chip-pihler-ag   'board=0&hg=1&ag=0&clock=&period=2&scorers=T. Pihler (ag)'
r chip-pihler      'board=0&hg=1&ag=1&clock=&period=2&scorersAway=T. Pihler'

# --- end card -----------------------------------------------------------------
r 08-kraj          'summary=1&hg=1&ag=1&pens=0:2&board=0&sumGoals=T. Pihler (ag)&sumGoalsAway=T. Pihler'

echo "Done -> $OUT"

# --- penalty chips (V3, ~10 s at each kick; Primavita shoots right/away side) -
r chip-pen-goal    'board=0&hg=1&ag=1&pens=0:0&clock=&period=&penGoalAway=Penal'
r chip-pen-miss    'board=0&hg=1&ag=1&pens=0:0&clock=&period=&penMiss=Promašaj'

# --- end of regulation, penalties pending (between 04 and 05) -----------------
r 04b-cekaju-penali 'summary=1&hg=1&ag=1&board=0&sumNote=Čekaju se penali&sumGoals=T. Pihler (ag)&sumGoalsAway=T. Pihler'
