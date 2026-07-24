# AI Context — futsal-turniri.com

> **Read this first.** It is the orientation brief for an AI agent joining this repo:
> the working agreements, the shape of the codebase, and the traps that have already
> cost time. It is deliberately *global* — it does not describe every file.
>
> Deeper reading, only when a task needs it:
> - `APP_OVERVIEW.md` — full product/design handoff (routes, roles, UI, design system)
> - `DEPLOY.md`, `DEPLOY_v3.md` — deployment
> - `SEO_SETUP.md` — SEO/SSR previews
> - `SpectoStream-Events.postman_collection.json` — the live-stream API contract
>
> Last updated: 2026-07-24. Current branch: `main`.

---

## 1. Working agreements (respect these — they are not negotiable)

| Rule | Detail |
|---|---|
| **Language** | The user writes and expects answers in **Croatian, terse**. Code/comments/docs are in English. The product UI is Croatian. |
| **Just implement** | Don't interrogate the user with option menus. Make the reasonable call, implement it, and state the assumption in one line. |
| **Never commit or push** | The user commits manually. Never run `git commit` / `git push` unless *explicitly* asked in that message. |
| **Never commit secrets** | The real SpectoStream API key (`sps_…`) lives **only** in git-ignored `.env`, `backend/.env`, `.env.prod`. Never in `application.properties`, never in `.env.example`, never in a doc. |
| **Do NOT run `mvn` or `docker`** | The user runs the backend from IntelliJ dev-mode. Starting Maven/Docker collides with it. **Backend changes are verified by careful reading** (and brace/paren balance), not by compiling. The user restarts with Stop + Run. |
| **Do NOT occupy port 5181** | That's the user's Vite HMR dev server. Browsing/inspecting `localhost:5181` is fine; starting a competing server on it is not. |
| **Frontend verification** | Always run: `cd frontend && npx tsc -b --noEmit` — target exit 0. This is the only automated gate available. |
| **Backend changes need a restart** | After editing Java, tell the user plainly: *"Treba Stop + Run backenda."* Dev-mode hot reload does not reliably pick up new endpoints/signatures. |

---

## 2. What the product is

A platform for **amateur / county-level futsal & small-sided football tournaments in Croatia**.
One organizer with a phone runs the whole lifecycle:

`create tournament → teams register → group/bracket draw → schedule matches → run matches live (zapisnik = referee console) → live standings/stats → live video stream with overlays → public sharing (QR, PDF export, embeds)`

Positioning: *Sofascore + Veo for grassroots football*.

**Roles:** anonymous visitor (watch everything) · registered user (create, claim player/team) · organizer / co-organizer (manage + zapisnik) · platform **admin** (global dashboard, live-stream control).

---

## 3. Stack & layout

```
backend/    Quarkus 3.15 / Java 21 · JAX-RS · Hibernate ORM + Panache · PostgreSQL · Liquibase
frontend/   React 19 + TypeScript + Vite · Chakra UI v3 · react-router v7 · TanStack Query
ops/, scripts/, docker-compose*.yaml, Caddyfile   infra
```

Backend package root: `backend/src/main/java/hr/mrodek/apps/futsal_turniri/`
→ `controller/` (26 JAX-RS resources) · `services/` · `repository/` · `model/` · `dtos/` · `enums/` · `integrations/` · `realtime/`

Frontend: `frontend/src/`
→ `pages/` (routed screens) · `components/` (~51, incl. tournament tabs) · `tournament/` (detail sections) · `api/` (typed HTTP modules) · `ui/pitch.tsx` (design primitives) · `system.ts` (Chakra theme) · `utils/`

Other: **Firebase OIDC** auth (role `admin`) · **MinIO** private bucket, images proxied through `/api/resources/{id}/image` · **WebSocket** live updates with a visibility-aware polling fallback · **PWA** service worker · Caddy reverse proxy (also rewrites crawler UAs to SSR preview endpoints).

Local infra ports (docker-compose): Postgres `5436`, MinIO `9012`/`9013`. Frontend dev `5181`.

---

## 4. Domain model — the concepts that matter

- **`TournamentFormat`**: `GROUPS_KNOCKOUT` (round-robin groups → single-elimination bracket) or `KNOCKOUT_ONLY` (bracket only). There are only these two.
- **`MatchStage`**: `GROUP`, `ROUND_OF_32`, `ROUND_OF_16`, `QUARTER_FINAL`, `SEMI_FINAL`, `THIRD_PLACE`, `FINAL`.
- **`MatchStatus`**: `SCHEDULED` → `LIVE` → `FINISHED` (plus paused/half states on the match entity).
- **Zapisnik** (`ZapisnikModePage`) — the live referee console: clock, goals, cards, fouls, substitutions. It is the *source of truth* for live events and drives both the app's realtime layer and the stream overlay.
- **`app_settings`** — a simple key/value table used for site-wide config editable from the admin dashboard (stream connection, home-page banner state). Adding a setting needs **no migration**.
- Migrations are **Liquibase**, not Flyway: `backend/src/main/resources/db/changelog/` with `changelog-master.xml` including one XML per change.

---

## 5. Subsystems + the traps in each

### 5.1 SpectoStream live-stream integration *(most recent large work)*

`integrations/spectostream/SpectoStreamService.java` + `controller/SpectoStreamController.java` (per-tournament) + `controller/SpectoAdminController.java` (site-wide admin) + `frontend/src/api/spectoStream.ts` + `frontend/src/components/SpectoConnectionCard.tsx`.

The platform (`https://stream.safeflow.hr`) receives events: `match_start`, `period_start/end`, `match_end`, `goal`, `goal_cancelled`, `card`, `clock_sync`, `lineup`, `timer_start/stop`, `stream_start/end`, `custom_message`. Contract = the Postman collection in the repo root.

**Traps:**
- **JPA off-thread rule.** The dispatch and clock threads have **no persistence context**. Anything read from an entity or from settings must be resolved **on the request thread** and passed in as plain strings. Violating this throws lazy-init/no-session errors at runtime, invisible at compile time.
- **Single daemon FIFO dispatch thread** guarantees event ordering (`match_start` before `lineup` / `period_start`). Don't parallelize it.
- Idempotency keys are deterministic; `occurred_at` is captured at submit time, not at send time.
- Period auto-end: a `ScheduledExecutorService` fires an exact `period_end` so the platform clock stops precisely at e.g. 10:00 / 20:00. The timer task deliberately does **not** evict its own map entry (a same-millisecond resume would evict its replacement).
- Connection settings are **DB-first** (`app_settings`) and win over `.env` — so the key can be rotated without a restart. The API key is **write-only** over HTTP: the GET returns only whether one is set, its source, and the last four characters.
- `match_end` is what clears lineups on the platform — `match_start` does not.
- Zero-length halves (free-running clock) must **not** send `period_start`.

### 5.2 Scheduling, knockout labels, multi-day planner

`services/SchedulingService.java`, `services/KnockoutService.java`, `frontend/src/components/MultiDaySchedulePlanner.tsx`, `frontend/src/utils/knockoutCodes.ts`.

- Empty bracket slots show **derived labels**, not "TBD": rounds are coded `Š` (1/16), `O` (1/8), `ČF`, `PF`, `F`, and matches read e.g. `W Š1 vs W Š2` / `L …`.
- `indexInStage` is the **1-based index among same-stage matches ordered by `id`**. The frontend must sort by `matchId` to produce identical codes — any other sort silently diverges.
- Round order is user-reorderable; `applyReservedKickoffs` re-applies reserved kickoff times **per stage**, otherwise regeneration silently reverts a custom order.
- The multi-day planner reconstructs days from existing matches using a **6-hour gap** heuristic (`GAP_NEW_DAY_MS`), *not* calendar dates — after-midnight matches belong to the previous evening's session. Counts must absorb any remainder into the last day so every match is shown when editing.

### 5.3 Branding, QR codes, PDF export

- Theme lives in `frontend/src/system.ts` (Chakra v3 **semantic tokens**, each with `_light`/`_dark` twins). Current brand: `pitch.500` = **`#17A79D`** (cyan/teal), dark `bg.canvas` = `#0B1522`, dark `bg.panel`/navbar = `#111F31`, logo tile = `#EDF0F3` in both modes.
- The logo mark is inline SVG in `frontend/src/components/Logo.tsx` (detailed net grid + ball with teal panels, driven by `currentColor`). The same artwork is reproduced in Java2D in `services/QrCodeRenderer.java` for QR centre marks and in `frontend/src/components/TournamentExport.tsx` for PDFs — **change one, change all three**.
- **Caching is layered** and will make you think a fix didn't apply: `Cache-Control: max-age=86400, s-maxage=86400` on `qr.png` + an in-memory `RenderCache` with no TTL + the PWA service worker. Bump the `?v=` query param when rendered assets change.
- PDF/PNG export paginates on a **pixel budget** (`SCHED_ROW_PX`, `SCHED_FIRST_PX`, `SCHED_REST_PX`) — the first-page budget must be computed from the actual (possibly wrapped) header, or the last row gets clipped. Requirement: **no match may ever be cut off**.

### 5.4 Permissions

`assertCanEdit` = `admin ∨ owner ∨ co-editor`, applied consistently across the tournament controllers; the frontend mirrors it with one `canEdit` flag. When an organizer reports "I can't click X", the cause is almost always a **UI `disabled` gate or pre-filled state**, not missing rights — verify before changing permissions.

---

## 6. State of the work (as of 2026-07-24)

Recently landed (uncommitted or freshly committed, backend restart pending):
- Full SpectoStream admin panel: connect to an **existing** stream by id, save URL/key to DB, verify reachability, start/stop broadcast (also drives the home-page banner), push lineups, standalone countdown timer.
- `match_start` sends both teams' **kit colours**; `match_end` / `stream_start` announce the **next fixture**; **lineups** are pushed automatically on `match_start` and `stream_start` plus manually from the admin card.
- Automatic exact `period_end` so the platform clock stops on the second.
- Full logo rebrand (cyan `#17A79D`) propagated to navbar, splash, PWA install, favicons, QR marks and PDF export.
- Knockout slot labels (`W Š1 vs W Š2`) for both formats; round reordering; multi-day schedule edit fixes; export clipping fix.

Open / known follow-ups:
- **Rotate the SpectoStream API key** — the current one was exposed in a screenshot/chat.
- Undecided: whether the overlay countdown should fire **automatically** from the zapisnik (start/pause/finish) instead of only from the manual buttons.
- Optional, not requested: restoring the ads/`LiveStreamAdminTab` card, switching the OS app icon to the light tile.

---

## 7. Croatian glossary (UI terms you'll meet in code and requests)

| HR | EN |
|---|---|
| turnir / natjecanje | tournament / competition |
| ekipa, igrač, sudac | team, player, referee |
| zapisnik | live match console (match record) |
| raspored | schedule / fixtures |
| ždrijeb (ručni ždrijeb) | draw (manual draw) |
| skupina / grupa | group |
| eliminacijska faza | knockout stage |
| osmina / četvrtfinale / polufinale / finale | R16 / QF / SF / final |
| poluvrijeme, produžeci | half, extra time |
| kotizacija | entry fee |
| uživo | live |
| prijava / odjava | sign up / sign out |
| pokreni / zaustavi | start / stop |
| spremi, uredi, obriši | save, edit, delete |
