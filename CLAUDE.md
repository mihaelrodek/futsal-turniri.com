# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Deeper reading, only when a task needs it:
- `APP_OVERVIEW.md` — full product/design handoff (routes, roles, UI, design system)
- `DEPLOY.md`, `DEPLOY_v3.md` — deployment · `SEO_SETUP.md` — SEO/SSR previews
- `SpectoStream-Events.postman_collection.json` — the live-stream API contract (authoritative; refreshed 2026-07-27, 12 sections incl. portal/admin, advertising, SSE)
- `SPECTO_REIMPLEMENTATION.md` — executable spec for rebuilding the SpectoStream integration (work items W1–W15, open requests to the platform operator)
- `SPECTO_IDEAS.md` — ranked catalogue of every finding and proposal for that integration

## Working agreements (not negotiable)

| Rule | Detail |
|---|---|
| **Language** | The user writes and expects answers in **Croatian, terse**. Code/comments/docs are English. The product UI is Croatian. |
| **Just implement** | Don't interrogate the user with option menus. Make the reasonable call, implement it, state the assumption in one line. |
| **Never commit or push** | The user commits manually. Never run `git commit` / `git push` unless *explicitly* asked in that message. |
| **Never commit secrets** | The real SpectoStream API key (`sps_…`) lives **only** in git-ignored `.env`, `backend/.env`, `.env.prod`. Never in `application.properties`, never in `.env.example`, never in a doc. |
| **Do NOT run `mvn` or `docker`** | The user runs the backend from IntelliJ dev-mode; starting Maven/Docker collides with it. **Backend changes are verified by careful reading** (and brace/paren balance), not by compiling. |
| **Do NOT occupy port 5181** | That's the user's Vite HMR dev server. Browsing/inspecting `localhost:5181` is fine; starting a competing server on it is not. |
| **Frontend verification** | Always run `cd frontend && npx tsc -b --noEmit` — target exit 0. This is the only automated gate available. |
| **Backend changes need a restart** | After editing Java, tell the user plainly: *"Treba Stop + Run backenda."* Dev-mode hot reload does not reliably pick up new endpoints/signatures. |

## Commands

```bash
# The only automated gate. Target exit 0. Run after every frontend change.
cd frontend && npx tsc -b --noEmit

cd frontend && npm run lint      # eslint
cd frontend && npm run dev       # Vite on :5181, proxies /api + /ws to :8087
cd frontend && npm run build     # tsc -b && vite build
```

Backend: Quarkus dev-mode, started by the user from IntelliJ on port **8087**, HTTP root path `/api`. The test suite is a single `@QuarkusTest` smoke test (`FutsalTurniriApplicationTests.contextLoads`) — no real backend coverage to run, and Maven is disallowed anyway.

Local infra (docker-compose, started by the user): Postgres `5436`, MinIO `9012` (S3) / `9013` (console).

## What the product is

A platform for **amateur / county-level futsal & small-sided football tournaments in Croatia**. One organizer with a phone runs the whole lifecycle:

`create tournament → teams register → group/bracket draw → schedule matches → run matches live (zapisnik = referee console) → live standings/stats → live video stream with overlays → public sharing (QR, PDF export, embeds)`

Positioning: *Sofascore + Veo for grassroots football*.

**Roles:** anonymous visitor (watch everything) · registered user (create, claim player/team) · organizer / co-organizer (manage + zapisnik) · platform **admin** (global dashboard, live-stream control).

## Stack & layout

```
backend/    Quarkus 3.15 / Java 21 · JAX-RS · Hibernate ORM + Panache · PostgreSQL · Liquibase
frontend/   React 19 + TypeScript + Vite · Chakra UI v3 · react-router v7 · TanStack Query
ops/, scripts/, docker-compose*.yaml, Caddyfile   infra
```

Backend package root `backend/src/main/java/hr/mrodek/apps/futsal_turniri/` → `controller/` (26 JAX-RS resources) · `services/` · `repository/` · `model/` · `dtos/` · `enums/` · `integrations/` · `realtime/`.

Frontend `frontend/src/` → `pages/` (routed screens) · `components/` (~51, incl. tournament tabs) · `tournament/` (detail sections) · `api/` (one typed axios module per backend resource) · `hooks/` · `ui/pitch.tsx` (design primitives) · `system.ts` (Chakra theme) · `utils/`.

Cross-cutting pieces that take several files to understand:

- **Auth** — Firebase OIDC verified by Quarkus OIDC (`quarkus.http.auth.proactive=false`, role claim `role`, admin role `admin`). `api/http.ts` attaches the Firebase ID token to every request and owns global toast behaviour — the per-request `silent` / `successMessage` / `errorMessage` / `silentErrorStatuses` opts are declared there by module augmentation, so error UX is centralised rather than per-call.
- **Query cache** — `queryClient.ts` centralises query keys in `qk`; 30 s staleTime, 1 h gcTime, no refetch-on-focus (realtime covers freshness). Bump `CACHE_BUSTER` whenever a cached DTO shape changes, or stale localStorage snapshots get rendered.
- **Realtime** — `realtime/LiveSocket.java` + `LiveBroadcaster.java` push over `/ws/live`, consumed by `hooks/useLiveSocket.ts`, with `hooks/usePolling.ts` as a visibility-aware fallback. The WS path is independent of the `/api` root: Caddy (prod) and Vite (dev) both rewrite `/ws/*` → `/api/ws/*`.
- **Offline-first zapisnik** — `hooks/useOfflineMatchEvents.ts` / `useOfflineMatchFouls.ts` queue goal/card add+delete ops in localStorage under `liveq:v1:{uuid}:{matchId}` with client UUIDs; the backend dedupes on them so a replay never doubles a goal. Rendered events merge the last server snapshot with pending local ops. Fouls, half transitions and the final result still need network.
- **Media** — private MinIO bucket, always proxied through `/api/resources/{id}/image` (HTTP Range / 206 for video). Never a direct bucket URL.
- **Caddy** (`Caddyfile`) is more than a proxy: a maintenance-flag handler that wins over everything, crawler-UA rewrites to backend SSR preview endpoints (`/api/preview/*`, `BrandOgController`), legacy English→Croatian 301s, `/v1/streams/*` pass-through to the stream platform, and a rate limiter explicitly ordered before `reverse_proxy`.
- **PWA** service worker: network-first cache for API reads, so tournament pages work offline read-only.

## Domain model — the concepts that matter

- **`TournamentFormat`**: `GROUPS_KNOCKOUT` (round-robin groups → single-elimination bracket) or `KNOCKOUT_ONLY` (bracket only). There are only these two.
- **`MatchStage`**: `GROUP`, `ROUND_OF_32`, `ROUND_OF_16`, `QUARTER_FINAL`, `SEMI_FINAL`, `THIRD_PLACE`, `FINAL`.
- **`MatchStatus`**: `SCHEDULED` → `LIVE` → `FINISHED` (plus paused/half states on the match entity).
- **Zapisnik** (`ZapisnikModePage`) — the live referee console: clock, goals, cards, fouls, substitutions. It is the *source of truth* for live events and drives both the app's realtime layer and the stream overlay.
- **`app_settings`** — key/value table for site-wide config editable from the admin dashboard (stream connection, home-page banner state). Adding a setting needs **no migration**.
- Migrations are **Liquibase**, not Flyway: `backend/src/main/resources/db/changelog/` with `changelog-master.xml` including one XML per change.

## Subsystems + the traps in each

### SpectoStream live-stream integration

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

### Scheduling, knockout labels, multi-day planner

`services/SchedulingService.java`, `services/KnockoutService.java`, `frontend/src/components/MultiDaySchedulePlanner.tsx`, `frontend/src/utils/knockoutCodes.ts`.

- Empty bracket slots show **derived labels**, not "TBD": rounds are coded `Š` (1/16), `O` (1/8), `ČF`, `PF`, `F`, and matches read e.g. `W Š1 vs W Š2` / `L …`.
- `indexInStage` is the **1-based index among same-stage matches ordered by `id`**. The frontend must sort by `matchId` to produce identical codes — any other sort silently diverges.
- Round order is user-reorderable; `applyReservedKickoffs` re-applies reserved kickoff times **per stage**, otherwise regeneration silently reverts a custom order.
- The multi-day planner reconstructs days from existing matches using a **6-hour gap** heuristic (`GAP_NEW_DAY_MS`), *not* calendar dates — after-midnight matches belong to the previous evening's session. Counts must absorb any remainder into the last day so every match is shown when editing.

### Branding, QR codes, PDF export

- Theme lives in `frontend/src/system.ts` (Chakra v3 **semantic tokens**, each with `_light`/`_dark` twins). Current brand: `pitch.500` = **`#17A79D`** (cyan/teal), dark `bg.canvas` = `#0B1522`, dark `bg.panel`/navbar = `#111F31`, logo tile = `#EDF0F3` in both modes.
- The logo mark is inline SVG in `frontend/src/components/Logo.tsx` (detailed net grid + ball with teal panels, driven by `currentColor`). The same artwork is reproduced in Java2D in `services/QrCodeRenderer.java` for QR centre marks and in `frontend/src/components/TournamentExport.tsx` for PDFs — **change one, change all three**.
- **Caching is layered** and will make you think a fix didn't apply: `Cache-Control: max-age=86400, s-maxage=86400` on `qr.png` + an in-memory `RenderCache` with no TTL + the PWA service worker. Bump the `?v=` query param when rendered assets change.
- PDF/PNG export paginates on a **pixel budget** (`SCHED_ROW_PX`, `SCHED_FIRST_PX`, `SCHED_REST_PX`) — the first-page budget must be computed from the actual (possibly wrapped) header, or the last row gets clipped. Requirement: **no match may ever be cut off**.

### Permissions

`assertCanEdit` = `admin ∨ owner ∨ co-editor`, applied consistently across the tournament controllers; the frontend mirrors it with one `canEdit` flag. When an organizer reports "I can't click X", the cause is almost always a **UI `disabled` gate or pre-filled state**, not missing rights — verify before changing permissions.

## UI conventions

Croatian-only copy; typographic quotes must be curly `„…"` (a straight `"` inside JSX strings has broken builds before). Both light and dark mode are required; colors come from semantic tokens — never hard-code (except the avatar gradient). Chakra v3 can't take raw `@keyframes`, so global keyframes live in `index.html` (`pitchPulse`, `mapLivePing`, `livePillPulse`). Live elements pulse at chip/badge level, **not** whole cards (explicit user preference). Finished tournaments are visually muted (grayscale 0.6 + opacity 0.82). Compact density is the standing preference. Mobile-first for the console (used pitchside), desktop-first for stream viewing. Everything user-facing must stay reachable without login.

## State of the work (as of 2026-07-24)

Recently landed:
- Full SpectoStream admin panel: connect to an **existing** stream by id, save URL/key to DB, verify reachability, start/stop broadcast (also drives the home-page banner), push lineups, standalone countdown timer.
- `match_start` sends both teams' **kit colours**; `match_end` / `stream_start` announce the **next fixture**; **lineups** are pushed automatically on `match_start` and `stream_start` plus manually from the admin card.
- Automatic exact `period_end` so the platform clock stops on the second.
- Full logo rebrand (cyan `#17A79D`) propagated to navbar, splash, PWA install, favicons, QR marks and PDF export.
- Knockout slot labels (`W Š1 vs W Š2`) for both formats; round reordering; multi-day schedule edit fixes; export clipping fix.

Open / known follow-ups:
- **Rotate the SpectoStream API key** — the current one was exposed in a screenshot/chat.
- Undecided: whether the overlay countdown should fire **automatically** from the zapisnik (start/pause/finish) instead of only from the manual buttons.
- Optional, not requested: restoring the ads/`LiveStreamAdminTab` card, switching the OS app icon to the light tile.

## Croatian glossary (UI terms you'll meet in code and requests)

| HR | EN |
|---|---|
| turnir / natjecanje | tournament / competition |
| ekipa, igrač, sudac | team, player, referee |
| zapisnik | live match console (match record) |
| raspored / kolo | schedule / round |
| ždrijeb (ručni ždrijeb) | draw (manual draw) |
| skupina / grupa | group |
| eliminacijska faza | knockout stage |
| osmina / četvrtfinale / polufinale / finale | R16 / QF / SF / final |
| poluvrijeme, produžeci | half, extra time |
| tablica / poredak | standings / ranking |
| strijelci / vječna lista strijelaca | scorers / all-time scorer list |
| kotizacija | entry fee |
| uživo | live |
| prijava / odjava | sign up / sign out |
| pokreni / zaustavi | start / stop |
| spremi, uredi, obriši | save, edit, delete |
