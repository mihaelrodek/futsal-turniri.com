# SpectoStream — Reimplementation Spec

Executable specification for rebuilding the SpectoStream broadcast-overlay integration.
Written to be handed to a coding agent. Every work item states the problem, the exact change,
the files involved and its acceptance criteria.

**Contract source of truth:** `SpectoStream-Events.postman_collection.json` (repo root, refreshed 2026-07-27).
Anything not in that collection is either an open request to the platform operator (§9) or a bug.

---

## 0. Constraints (read first)

| Rule | Detail |
|---|---|
| No Maven, no Docker | The user runs the backend from IntelliJ dev-mode. Verify backend changes by careful reading, not by compiling. |
| No commits, no pushes | The user commits manually. |
| Frontend gate | `cd frontend && npx tsc -b --noEmit` must exit 0. This is the only automated check available. |
| Backend restart | After any Java change, tell the user: *"Treba Stop + Run backenda."* |
| Secrets | The `sps_…` API key lives only in git-ignored `.env` / `backend/.env` / `.env.prod`. Never in `application.properties`, `.env.example` or a doc. |
| Migrations | Liquibase, one XML per change in `backend/src/main/resources/db/changelog/`, included from `changelog-master.xml`. Naming pattern: file `teams_jersey_color.xml`, changeSet id `2026-07-11-teams-jersey-color`. |
| UI language | Croatian, curly quotes `„…"`. Colours from semantic tokens in `system.ts`, never hard-coded. |

**Do the work items in the order given.** W1–W5 are correctness fixes on the existing design and are
independent of each other. W6–W9 change the architecture and depend on W1–W5 being in place.
W10–W14 are new features. W15+ are optional.

---

## 1. Current architecture (ground truth)

`backend/…/integrations/spectostream/SpectoStreamService.java` (879 lines) is the whole integration.

- **One stream per tournament.** `Tournaments.spectoStreamId`; every event resolves the stream id from
  the tournament, never from the match. `matchId` appears only inside idempotency keys, never in a payload.
- **Two call shapes.** `provisionTournament()` is synchronous and throws 502 on failure. Every event method
  is fire-and-forget: no-op when unconfigured or unlinked, resolve the stream id + connection settings on the
  request thread, hand a job to a single daemon FIFO thread, retry once, log at WARN, give up.
- **JPA off-thread rule.** The dispatch and clock threads have no persistence context. Everything an entity
  provides must be resolved on the request thread and passed as plain strings.
- **Connection settings are DB-first.** `app_settings` keys `specto_base_url` / `specto_api_key` win over
  `specto.*` config, so the key rotates without a restart. The key is write-only over HTTP.
- **Automatic period end.** `schedulePeriodEnd()` arms a `ScheduledExecutorService` task that fires
  `clock_sync` + `period_end` at the exact half boundary, so the overlay clock freezes on 10:00 rather than
  running until the organizer taps "završi poluvrijeme".

Call sites: `TournamentController.java` (lines ~2060–2900), `KnockoutController.java:228`,
`SpectoAdminController.java`, `SpectoStreamController.java`.

Frontend: `api/spectoStream.ts`, `hooks/useBroadcastDelay.ts`, `hooks/useSpectoStreamId.ts`,
`components/SpectoConnectionCard.tsx`.

---

## 2. Target architecture

Five changes to the shape of the integration:

1. **Commit-safe dispatch.** Events are queued only after the enclosing transaction commits.
2. **One overlay owner.** A tournament's stream is bound to exactly one match at a time; other matches are silent.
3. **Response write-back.** The events POST response is parsed, and its authoritative reveal timestamp drives
   the app's own delayed surfaces instead of a separately-polled `delay_offset_ms`.
4. **Failure visibility.** The last send failure is recorded and surfaced to the admin dashboard.
5. **Bounded, non-blocking dispatch.** No sleep on the sender thread, a circuit breaker, and a queue cap that
   drops display-only events rather than clock/score events.

Everything else — one stream per tournament, FIFO ordering, DB-first settings, the armed period-end timer —
stays as it is. It is sound.

---

## 3. Contract reference — what the app will use

### 3.1 Events endpoint

`POST {base}/v1/streams/{streamId}/events` · `Authorization: Bearer sps_…`

```json
{ "type": "...", "idempotency_key": "...", "occurred_at": "ISO-8601", "payload": { } }
```

Response (per the collection's test script): `{ "event": { … }, "duplicate": true|false }`.

Documented event types (16):

| Group | Types |
|---|---|
| Match | `match_start`, `reset`, `period_start`, `period_end`, `match_end` |
| Play | `goal`, `goal_cancelled`, `exclusion`, `clock_sync`, `clock_visibility` |
| Display | `card`, `substitution`, `lineup`, `custom_message` |
| Stream | `stream_start`, `stream_end` |

### 3.2 Other endpoints the app should start using

| Endpoint | Auth | Why |
|---|---|---|
| `PUT /v1/tournaments/{uuid}` | API key **or** session token | Already used for provisioning. Also the only authenticated call the app can make with just the API key — use it to validate the key (W2). |
| `GET /v1/streams/{id}/state` | public (delayed) / session token (immediate) | Already used by `useBroadcastDelay`. Also a reconciliation source. |
| `GET /v1/streams/{id}/lineups` | public | Verify a pushed lineup landed. |
| `GET /healthz` | public | Cheap reachability probe, separate from key validity. |
| `PATCH /v1/streams/{id}` | **session token** | `delay_offset_ms` (0–120000), `camera_offset_ms` (0–300000), `gate_broadcast`, `delay_auto`. |
| `GET /v1/streams/{id}/stats` | **session token** | Real viewer counts: `current_viewers`, `peak_viewers`, `avg_viewers`, `viewer_minutes`, 180-min series. |
| `GET /v1/streams/{id}/events?limit=` | **session token** | Event history — debugging what the platform actually received. |
| `GET /v1/streams/{id}/requests` | **session token** | Last 100 HTTP requests with headers — debugging rejected sends. |
| `PUT /v1/tournaments/{id}/overlay` | **session token** | Overlay theme: layout, positions, colours, font, logo. |
| `POST /v1/streams/{id}/heartbeat` | public | `{session_id, latency_ms}` → `{ok, viewers}`. |

> **Session-token endpoints need a portal login** (`POST /v1/auth/login` → `ssn_…`, valid 30 days), which the
> app does not currently hold. See W15 before implementing anything in the session-token rows.

---

## 4. Work items

### W1 — Queue events only after commit

**Problem.** Every event method is called from inside a `@Transactional` controller method and queues the HTTP
send immediately. Confirmed call sites inside transaction boundaries:

| Call | file:line | Method |
|---|---|---|
| `matchStart`, `lineup`, `periodStart`, `schedulePeriodEnd` | `TournamentController.java:2124,2128,2131,2136` | `startMatch` |
| `matchEnd` | `TournamentController.java:2203` | `finishMatch` |
| `cancelPeriodEnd`, `matchEnd` | `TournamentController.java:2254,2258` | `resetMatch` |
| `periodEndExact` / `periodEnd` | `TournamentController.java:2433 / 2436-2437` | `endFirstHalf` |
| `periodStart`, `schedulePeriodEnd` | `TournamentController.java:2491,2493` | `startSecondHalf` |
| `cancelPeriodEnd`, `periodPause` | `TournamentController.java:2535,2536` | `pauseMatch` |
| `periodStart`, `schedulePeriodEnd` | `TournamentController.java:2611,2615` | `resumeMatch` |
| `goal`, `card` | `TournamentController.java:2827,2829,2832` | `addMatchEvent` |
| `goalCancelled` | `TournamentController.java:2892` | `deleteMatchEvent` |
| `matchEnd` | `KnockoutController.java:228` | `recordResult` |

Nothing orders the HTTP send against the JTA commit. A rollback after the send leaves a goal on the broadcast
that does not exist in the app.

**Change.** Introduce a CDI event and observe it after commit.

```java
// integrations/spectostream/SpectoDispatchEvent.java
public record SpectoDispatchEvent(String apiBase, String apiKey, String streamId, String type,
                                  String idempotencyKey, String occurredAt, ObjectNode payload,
                                  Long matchEventId) {}
```

In `SpectoStreamService`, replace the body of `enqueueResolved(...)` with a CDI fire:

```java
@Inject Event<SpectoDispatchEvent> bus;

private void enqueueResolved(String apiBase, String apiKeyNow, String streamId, String type,
                             String idempotencyKey, String occurredAt, ObjectNode payload,
                             Long matchEventId) {
    bus.fire(new SpectoDispatchEvent(apiBase, apiKeyNow, streamId, type,
                                     idempotencyKey, occurredAt, payload, matchEventId));
}

void onCommitted(@Observes(during = TransactionPhase.AFTER_SUCCESS) SpectoDispatchEvent e) {
    submit(e);   // the old dispatch.execute(...) body
}
```

**Ordering is preserved.** Observers fire in the order the events were fired, on the same thread, and each
still submits to the one FIFO dispatch thread.

**Two callers are not inside a transaction and must keep working:**
- `sendPeriodEndExact(...)` runs on the **clock thread** with no transaction context. `AFTER_SUCCESS` observers
  never fire outside a transaction, so this path must bypass the bus and call `submit(...)` directly.
- `setClockVisibility` (`TournamentController.java:2631`) is not `@Transactional` — same bypass.

Implement this by keeping two entry points: `enqueueAfterCommit(...)` (fires the CDI event) and
`enqueueNow(...)` (submits directly). Use `TransactionSynchronizationRegistry#getTransactionStatus()` to pick
automatically if you prefer a single entry point, but the explicit two-method version is clearer.

**Acceptance.** No `specto.*` event send can be observed before its transaction commits. `sendPeriodEndExact`
and `clockVisibility` still deliver. Ordering `match_start → lineup → period_start` is unchanged.

---

### W2 — `verify()` must actually validate the API key

**Problem.** `SpectoStreamService.java:367-372` builds the verify request with no `Authorization` header, and
`GET /v1/streams/{id}/state` is a public endpoint. A revoked or wrong key passes verification. The method's own
javadoc claims the opposite. `isConfigured()` only checks that a key is *present*.

**Change.** Verify in two steps and report which one failed:

1. **Reachability** — `GET {base}/healthz`, expect `{ok:true}`. Failure → `"Servis nije dostupan na toj adresi."`
2. **Key validity** — `PUT {base}/v1/tournaments/{tournamentUuid}` with `{"name": <tournament name>}` and the
   `Authorization: Bearer <key>` header. This is the same idempotent upsert used by provisioning; the contract
   states it accepts an API key. `401`/`403` → `"API ključ nije valjan (odbijen od servisa)."`
3. **Stream exists** — keep the existing `GET /v1/streams/{id}/state`, `404` → `"Stream s tim ID-om ne postoji."`

Change the signature to `String verify(Tournaments t, String streamId)` so step 2 has a real UUID and name.
`SpectoAdminController.verify` (`:99`) must pass the tournament; `VerifyRequest` gains `tournamentUuid`.

**Acceptance.** Verifying with a deliberately wrong key returns the key-invalid message, not "ok".

---

### W3 — Bind the overlay to exactly one match

**Problem.** `startMatch` (`TournamentController.java:2062`) has no guard against another match of the same
tournament already being LIVE — it checks only bracket confirmation and that both teams are decided.
`SpectoAdminController.currentMatch()` (`:258`) picks `live.get(0)`. There is one stream per tournament and
`matchId` never appears in any payload, so two pitches running in parallel put `match_start`, `goal`, `card`
and `period_*` from both matches onto the same scoreboard — and B's `match_start` resets A's score.

**Change.** Add an explicit owner.

- New `app_settings` key `specto_active_match:{tournamentId}` → the match id that currently owns the overlay.
  (Key/value, no migration needed — that is what `app_settings` is for.)
- `startMatch`, when `spectoDrives(match)`: if no owner is set, claim it. If an owner is set and it is a
  different, still-LIVE match, **do not relay anything** for this match, and return a flag on the response DTO
  so the zapisnik can show „Prijenos prati drugu utakmicu".
- Every other relay site checks ownership before calling `specto.*`.
- `finishMatch`, `resetMatch`, `KnockoutController.recordResult` release ownership when the owner match ends.
- New endpoint `POST /specto-admin/active-match` `{tournamentUuid, matchId}` so an admin can hand the overlay
  to the other pitch deliberately. Sends `match_start` + `lineup` + `period_start` for the new owner, with the
  current clock value.

**Acceptance.** With two TIMER matches LIVE in one tournament, only one produces outbound events. Handing over
via the admin endpoint switches cleanly.

---

### W4 — Fix the four event-mapping bugs

**W4a — `reset` instead of `match_end` on match reset.**
`TournamentController.java:2227` states "SpectoStream has no `reset` event (and rejects it)". The contract now
documents `reset`: score 0:0, period 0, clock 0 stopped, scorers/cards/exclusions cleared, **teams, lineups and
the next-match announcement kept**. That is exactly what `resetMatch` wants. The current `match_end`
(`:2258`) wipes lineups and leaves the overlay in `ended`. Replace the call, delete the stale comment.

```java
public void reset(Tournaments t, long matchId) {
    if (!isConfigured()) return;
    String streamId = t.getSpectoStreamId();
    if (streamId == null) return;
    cancelPeriodEnd(matchId);
    enqueueAfterCommit(streamId, "reset", "m" + matchId + "-reset-" + Instant.now().getEpochSecond(),
                       Instant.now().toString(), json.createObjectNode());
}
```

**W4b — Penalty shootout must not inflate the score.**
`addMatchEvent` routes `PENALTY_GOAL` through the same `specto.goal(...)` as a regulation goal
(`TournamentController.java:2824,2827`). The platform adds +1 to the visible score for every `goal`, so a
shootout inflates the regulation scoreline. `PENALTY_MISSED` sends nothing (`:2835`), so the two sides are not
even symmetric.

Stop sending `goal` for `PENALTY_GOAL`. Represent the shootout with `custom_message` updates instead
(`„Penali 3:2"`) until a structured shootout event exists (§9, request R4). Update `deleteMatchEvent`
(`:2872-2873`) to match: `wasSpectoGoal` must no longer include `PENALTY_GOAL`.

**W4c — Card retraction.**
`deleteMatchEvent` cancels goals but has no counterpart for cards — there is no `cardCancelled` in the service.
A card deleted in the zapisnik stays on the overlay for the rest of the match. The contract has no
`card_cancelled` type; request it (§9, R3). Interim: no clean fix exists — document the limitation in the
zapisnik UI („karton se ne može povući s prijenosa").

**W4d — Orphaned period-end timers on tournament reset.**
`resetTournament` (`TournamentController.java:831-853`) calls `matchesRepo.deleteByTournament(t)` without
cancelling armed timers. `periodEndTimers` keeps a `ScheduledFuture` keyed by a now-deleted match id, which
later fires `clock_sync` + `period_end` into a live overlay. Call `specto.cancelPeriodEnd(matchId)` for every
match being deleted, and add `specto.cancelAllPeriodEnds(tournamentId)` if the id set is not readily available.

**Acceptance.** Reset leaves the overlay showing 0:0 with lineups intact. A shootout does not change the
regulation score on the broadcast. Resetting a tournament fires no later events.

---

### W5 — Dispatch resilience

**Problem** (`SpectoStreamService.java:793-846`). One FIFO thread, 5 s request timeout, and
`Thread.sleep(1000)` **on that same thread** between attempts → up to 11 s of head-of-line blocking per event.
The queue is unbounded. During a platform outage, events for the next match queue behind the previous one.

**Change.**

- Request timeout 5 s → **3 s**.
- Replace `sleep(1000); continue;` with a re-submission through `clockTimers.schedule(...)` after 1 s, so the
  sender thread is never blocked. Carry an attempt counter on the job.
- **Circuit breaker.** After 3 consecutive failures, open for 30 s: during that window, clock/score events are
  still queued (they carry `occurred_at`, so a late delivery is still correct) and display-only events
  (`custom_message`, `lineup`, `timer_*`, `clock_visibility`) are dropped with a debug log.
- **Queue cap.** Track queue depth; above 200 pending jobs, drop the same display-only set. Never drop
  `match_start`, `period_*`, `goal`, `goal_cancelled`, `card`, `clock_sync`, `match_end`, `reset`, `exclusion`.
- **Restart durability gap** — `periodEndTimers` is in-memory, so a restart silently loses every armed
  auto-period-end. Re-arm on startup: an `@Observes StartupEvent` handler that scans LIVE TIMER matches and
  calls `schedulePeriodEnd` with the boundary recomputed from `liveStartedAt`/`secondHalfStartedAt` + half length.

**Acceptance.** A 60 s platform outage does not delay a goal by more than the outage plus one retry interval.
No `Thread.sleep` on the dispatch thread. Restarting the backend mid-half re-arms the period end.

---

### W6 — Parse the response and record failures

**Problem.** `SpectoStreamService.java:820-823` reads the response body and discards it. Everything is thrown
away: the `event` object (and its server id), the `duplicate` flag, any `visible_at`. On failure the body is
only interpolated into a WARN line — a revoked key produces log noise and nothing else, while the admin
dashboard keeps saying "spojeno".

**Change.**

1. Parse every 2xx body as JSON. Extract `event.id`, `event.visible_at` (if present) and `duplicate`.
2. Record the last outcome per event type in an in-memory `ConcurrentHashMap<String, SendOutcome>`:
   ```java
   public record SendOutcome(String type, int httpStatus, String error, Instant at, boolean duplicate) {}
   ```
3. Extend `ConnectionInfo` with `lastFailure` (type, status, message, when) and `lastSuccessAt`.
   `SpectoConnectionCard.tsx` renders it: „Zadnji event odbijen: HTTP 401 (goal, prije 2 min)".
4. Log `duplicate=true` at DEBUG — it is the signal that an idempotency key collided (see W7).

**Acceptance.** Saving a wrong API key and then scoring a goal makes the admin card show the 401 within one
refresh. Nothing about this blocks or slows the zapisnik.

---

### W7 — Fix the idempotency keys

`Matches.id` and `MatchEvent.id` are global DB sequences, so no key collides across tournaments. Two formats
are still wrong:

| Key | file:line | Problem | Fix |
|---|---|---|---|
| `"m{id}-p{period}-start-{epochSecond}"` | `:467` | Second granularity. Two genuine `periodStart` calls seconds apart get different keys (not deduped); a retry crossing a second boundary would too — except the retry reuses the built body, so only the first half of that matters. The real issue is that it is *neither* fully deterministic *nor* useful. | `"m{id}-p{period}-start-{startInstant.toEpochMilli()}"` where `startInstant` is the half's start instant from the entity, not `now()`. Deterministic across resume/retry. |
| `"m{id}-period_end-{epochSecond}"` | `:481` | Same. | `"m{id}-p{period}-end-fallback"` — one free-running period end per match+period. |
| `"m{id}-clock_visibility-{UUID}"` | `:747` | The `matchId` prefix is decorative; the UUID already makes it unique, so this has no retry protection across independent calls. | `"m{id}-clock_visibility-{visible}-{epochSecond}"`. |

Leave the random-UUID keys on `stream_start`, `stream_end`, `lineup`, `timer_*`, `custom_message` — each of
those is genuinely a new event. Add frontend debounce on the admin buttons instead (W14).

---

### W8 — Reveal in-app events at the broadcast's own timestamp

This replaces the polled-delay guesswork with an authoritative per-event reveal time.

**Problem today.**
- `useBroadcastDelay.ts` polls the platform's public `/state` every 30 s for `delay_offset_ms`, then holds
  events for `createdAt + delay`. Client-vs-server clock skew is only handled by a `±2×delay` sanity guard.
- Only three surfaces respect the delay: `MatchLivePage` header score, `GoalscorersPanel`, the `StreamHero`
  ticker. **The `LiveScoreBug` pinned on the video, the "Sastavi" tab's per-player goal badges, the live group
  standings and the mini-bracket are all undelayed** — they update the instant the organizer taps, spoiling the
  broadcast they sit on top of.
- An event created offline gets `createdAt` stamped at **sync** time (`@CreationTimestamp` on
  `MatchEvent.createdAt`), so a goal synced 5 minutes late is then held for another full delay window.

**Change — backend.**

1. Migration `match_event_specto.xml`: add `specto_event_id varchar(64)` and `visible_at timestamptz` to
   `match_event`.
2. Add `occurredAt` (ISO-8601, optional) to `CreateMatchEventRequest`, and a matching column
   `occurred_at timestamptz`. The zapisnik sends the moment of the tap; the offline queue sends the *original*
   tap time on replay. Fall back to `now()` when absent. This is what `occurred_at` on the outbound event
   should carry — today it is `Instant.now()` at submit (`:639`), which is wrong for any replayed event.
3. In the dispatch thread, on a 2xx for `goal` / `card` / `exclusion`, if the job carries a `matchEventId`,
   open a **new short transaction** (`QuarkusTransaction.requiringNew()`) and write `specto_event_id` and
   `visible_at` onto that row, then fire `notifyLive(match)` so clients refetch. The dispatch thread has no
   ambient persistence context — the new transaction is mandatory, and it must be short.
4. Expose both fields on `MatchEventDto`.
5. Maintain a rolling average of `visible_at − occurred_at` over the last 20 successful sends per stream
   (`observedDelayMs`). Expose it on `GET /tournaments/{uuid}/specto/public` alongside the stream id. This is
   the fallback for events that never got a response (offline, failed send, circuit breaker open).

**Change — frontend.**

`useBroadcastDelay.ts` becomes a resolver with a three-step ladder:

```
revealAt(event) =
    event.visibleAt                      // authoritative, from the platform
  ?? event.occurredAt + observedDelayMs  // rolling average from our own sends
  ?? event.createdAt  + delayOffsetMs    // today's behaviour, from /state
  ?? now                                 // fail open
```

Then apply it to **every** live surface, not three of them:

| Surface | file:line | Today | Required |
|---|---|---|---|
| `MatchLivePage` header score | `MatchLivePage.tsx:372` | delayed | keep |
| `GoalscorersPanel` | `liveMatch.tsx:919` | delayed | keep |
| `StreamHero` ticker | `StreamHero.tsx:402` | delayed | keep |
| `LiveScoreBug` over the video | `StreamHero.tsx:59-113`, `TournamentLivePage.tsx:96` | **raw** | delay |
| "Sastavi" player badges | `MatchLivePage.tsx:1002-1013` | **raw** | delay |
| Live group standings | `liveStandings.ts` | **raw** | delay |
| Mini-bracket scores | `StreamHero.tsx` `MiniMatch` | **raw** | delay |
| Zapisnik (organizer) | `LiveMatchPanel.tsx` | raw | **keep raw** — the organizer is the source, not an audience |

Keep the fail-open rule: any missing input means reveal immediately. A viewer must never lose an event because
the delay lookup broke.

**Acceptance.** With a live stream, a goal appears on the app's public surfaces within ~1 s of appearing in the
video, on every surface, and never before. With the platform unreachable, everything reveals immediately.

---

### W9 — Send `clock_seconds` with goals and cards

`goal` and `card` accept an optional `clock_seconds` for display; the app sends neither, though it has
`MatchEvent.minute` and can compute the exact match second from `liveStartedAt` / `secondHalfStartedAt` /
`livePausedAt` (the same arithmetic `spectoHalfSeconds` and the resume path already use).

Compute the cumulative match second at the moment of the event and add it to both payloads. Cumulative, to
match the overlay's own clock convention: 1st half `0 → halfSecs`, 2nd half `halfSecs → 2×halfSecs`.

---

### W10 — 2-minute exclusion

`exclusion` is documented and supported: `{team, player_name?}`, the platform counts down 2 minutes from
`occurred_at` automatically and shows the short-handed side.

**Two layers. Do both.**

**W10a — automatic on a red card.** In futsal a red card leaves the team a player short for 2 minutes. When
`addMatchEvent` records `RED_CARD` and the match owns the overlay, send `card` (color `red`) **and** then
`exclusion` for the same side and player. Ordering is guaranteed by the FIFO thread.

**W10b — standalone 2-minute exclusion.** Add `EXCLUSION` to `MatchEventType`:

- `backend/…/enums/MatchEventType.java` — new constant, documented as "2-minute exclusion; disciplinary only,
  never affects the score or scorer stats".
- Verify every `switch`/filter over `MatchEventType` handles it: `recomputeScoreFromGoals`
  (`TournamentController.java` ~2020), `MatchEventRepository.findGoalCountsByTournament` (filters `= GOAL`, so
  it is already safe), the frontend timeline renderer, and the awards/stats paths.
- Zapisnik UI: a button next to the card buttons, same player-picker flow, anonymous variant allowed
  (`player_name` is optional in the contract).
- Timeline entry with a 2-minute countdown chip while it is active.
- Relay: `exclusion` with `{team, player_name?, clock_seconds}`.

**Open behaviour to confirm** (§9, R5): in futsal the exclusion ends early if the short-handed team concedes.
The contract documents only "automatically expires 2 minutes from `occurred_at`" and no cancel event. Until
that is answered, do not attempt to end one early — the app's own timeline may show it ended while the overlay
still counts down.

---

### W11 — Kit colours changed mid-match

**Problem.** Kit colours reach the overlay only as a snapshot inside `match_start` (`SpectoStreamService.java:407-410`)
and `putNextMatch` (`:422-441`). `setTeamJerseyColor` (`TournamentController.java:1329`) and
`setTeamShortsColor` (`:1355`) fire no notification of any kind — no `notifyLive`, no cache invalidation, no
relay. A match started before the organizer picked the kits can never get them onto the broadcast, because
re-sending `match_start` would reset the score to 0:0.

**There is no event in the contract that updates team appearance without a reset.** This needs a platform-side
addition — §9, request **R1**. Build the app side now, behind a config flag, so it works the day it ships.

**App-side change (do this regardless):**

1. In `setTeamJerseyColor` / `setTeamShortsColor`, after the write, resolve whether this team is in the match
   that currently owns the overlay (W3). There is **no repository method for "is this team live"** — add one:
   ```java
   // MatchesRepository
   Optional<Matches> findLiveMatchForTeam(Long teamId);
   ```
   (`findAllLiveMatches()` exists at `MatchesRepository.java:141` and can back it; do not filter in the controller.)
2. If it is the owning match, call `specto.teamAppearance(t, matchId, side, jersey, shorts)`.
3. `teamAppearance` sends the new `team_update` event when `specto.team-update.enabled=true`, otherwise logs at
   DEBUG and returns. Requested payload:
   ```json
   { "type": "team_update", "idempotency_key": "m123-team_update-home-1769500000",
     "occurred_at": "2026-07-27T18:14:00Z",
     "payload": { "team": "home", "jersey": "#17a79d", "shorts": "#0b1522" } }
   ```
   Every field except `team` optional; nothing else about the match changes.
4. Also fire `notifyLive` so in-app shirt icons update without a refetch — that is a real gap on its own,
   independent of the broadcast.

**Note on the value format.** `Teams.jerseyColor` / `shortsColor` are `varchar(9)` but both the backend regex
(`#[0-9a-fA-F]{6}`) and the frontend's 13-swatch palette (`TeamsSection.tsx:75`) only ever produce lowercase
6-digit hex. `putColour` (`:446`) already enforces the same. No conversion needed.

---

### W12 — Tournament result on the broadcast

**Problem.** Nothing about the end of a tournament reaches the overlay. `finishTournament`
(`TournamentController.java:498`), `setPodium` (`:581`) and `setAwards` (`:813`) make no `specto.*` call.

**Data available.** All on `Tournaments`, all **plain name strings, not FKs**: `winnerName` (`:235`),
`secondPlaceName` (`:246`), `thirdPlaceName` (`:250`), `bestGoalkeeperName`, `bestPlayerName`, `bestScorerName`.
Third place is optional — `KnockoutService.hasThirdPlace(qualifiers)` returns `qualifiers >= 4`, so a 2–3 team
knockout has none. Top scorers come from `MatchEventRepository.findGoalCountsByTournament(...)` →
`ScorerDto(playerId, playerName, teamName, goals, goalsAll)`, filtering `type = GOAL` only (shootout kicks and
own goals excluded by construction).

**Change — two stages.**

**W12a — works today, no platform change.** On `finishTournament` and on `setPodium`, send a `custom_message`:

```
🏆 <tournament name> · 1. <winner> · 2. <second> · 3. <third>
```

Omit missing places. Cap at 200 characters (the app's own `/specto/message` limit is 200; keep the same bound).
Follow it with `stream_end` only if the admin stops the broadcast — do not couple them.

**W12b — structured, needs the platform.** Request a `tournament_end` event (§9, **R2**) so the overlay can
render a real podium card with kits and a top-scorer list:

```json
{ "type": "tournament_end", "idempotency_key": "t42-tournament_end",
  "occurred_at": "2026-07-27T21:40:00Z",
  "payload": {
    "tournament_name": "Karlovački kup 2026",
    "podium": [
      { "rank": 1, "team_name": "VK Mladost", "team_short": "MLA", "jersey": "#17a79d", "shorts": "#0b1522" },
      { "rank": 2, "team_name": "VK Jug",     "team_short": "JUG", "jersey": "#f59e0b", "shorts": "#111827" },
      { "rank": 3, "team_name": "VK Primorje","team_short": "PRI" }
    ],
    "top_scorers": [
      { "rank": 1, "player_name": "I. Horvat", "team_name": "VK Mladost", "goals": 9 }
    ],
    "awards": { "best_player": "…", "best_goalkeeper": "…", "best_scorer": "…" }
  } }
```

Podium names are free text on `Tournaments`; resolve them back to `Teams` by case-insensitive trimmed name
match (the same thing `setPodium` does) to attach kit colours and short codes. Accept that an unmatched name
simply omits the colour fields.

---

### W13 — Overlay theme from the app's brand

`PUT /v1/tournaments/{id}/overlay` (session token) sets layout `A|B`, `positions.{scoreboard,logo,banner}.{x,y}`
in 0–100 percent, `primary_color`, `secondary_color`, `text_color`, `font`, `team_a_short`, `team_b_short`,
and an optional `logo_data_url` (base64, ≤2 MB).

The app has the values already: brand `pitch.500 = #17A79D`, dark canvas `#0B1522`, and the logo mark as inline
SVG in `components/Logo.tsx` — the same artwork already reproduced in Java2D in `services/QrCodeRenderer.java`
for QR centre marks. Render that Java2D path to a PNG, base64 it, and push the theme once per tournament
(idempotent PUT) when the tournament is linked or when the admin presses a "Primijeni brend na prijenos" button.

**Blocked on W15** — this endpoint needs a portal session token.

---

### W14 — Admin card and dispatch hygiene

- Debounce „Pokreni + prikaži", „Pošalji sastave" and the countdown buttons in `SpectoConnectionCard.tsx`.
  Their idempotency keys are random UUIDs by design, so a double-click really does send two events.
- Surface `lastFailure` from W6.
- `isPlainStreamId` (`SpectoStreamController.java:142`) allows uppercase, `_` and 200 characters; the platform's
  own ids are `^[a-z0-9-]{3,32}$`. Tighten the validation to match, keeping a clear Croatian error.
- `shortCode()` (`SpectoStreamService.java:862`) truncates to 4 characters although the contract allows 6, and
  two similar names collapse to the same code. Use 6 and, when two teams in the same match produce identical
  codes, disambiguate the away side (e.g. append a digit).
- `provisionTournament` runs a blocking 5 s HTTP call inside `@Transactional`
  (`SpectoStreamController.java:106-116`), holding a pooled DB connection for the round trip. Move the HTTP call
  outside the transaction and persist the returned stream id in a short one.

---

### W15 — Portal session token (unlocks W13 and the stats/debug endpoints)

Everything in the "session token" rows of §3.2 needs `POST /v1/auth/login` → `ssn_…` (valid 30 days).

- Store `specto_portal_user` / `specto_portal_password` in `app_settings`, write-only over HTTP, exactly like
  the API key. Add them to the admin connection form.
- Cache the session token in memory with its issue time; re-login on 401 or after 25 days.
- **Security note to state plainly to the user:** `GET /v1/api-keys` returns API keys in **plaintext**. Whoever
  holds a portal login holds every key. Storing portal credentials in `app_settings` therefore raises the blast
  radius of a DB compromise. Get an explicit decision before implementing.

Once it exists: viewer stats (`GET /v1/streams/{id}/stats`), event history and the request log for the admin
debug panel, `PATCH /v1/streams/{id}` for `delay_offset_ms` / `camera_offset_ms`, and W13's overlay theme.

---

## 5. New/changed data model

| Change | Where | Notes |
|---|---|---|
| `match_event.specto_event_id varchar(64)` | new changelog `match_event_specto.xml` | W8 |
| `match_event.visible_at timestamptz` | same | W8 |
| `match_event.occurred_at timestamptz` | same | W8 — organizer's tap time, distinct from `created_at` |
| `MatchEventType.EXCLUSION` | `enums/MatchEventType.java` | W10b — enum only, the column is a string |
| `app_settings: specto_active_match:{tournamentId}` | none | W3 — key/value, no migration |
| `app_settings: specto_portal_user` / `specto_portal_password` | none | W15 |
| `MatchesRepository.findLiveMatchForTeam(Long)` | `repository/MatchesRepository.java` | W11 |

---

## 6. Verification plan

There is no backend test suite (`FutsalTurniriApplicationTests.contextLoads` is a smoke test) and Maven is
disallowed, so verification is manual and by reading.

1. `cd frontend && npx tsc -b --noEmit` → exit 0. **Mandatory after every frontend change.**
2. Re-read every changed Java file for brace/paren balance and for the JPA off-thread rule: nothing on the
   dispatch or clock thread may touch an entity or `AppSettingsRepository`.
3. Ask the user to Stop + Run the backend, then walk one TIMER match end to end against a real stream:
   start → lineup → goal → card → red card + exclusion → pause → resume → half end → 2nd half → finish, and
   confirm each event on `GET /v1/streams/{id}/state` (session token = no delay) and in
   `GET /v1/streams/{id}/requests`.
4. Confirm the reveal ladder (W8) by comparing the app's public timeline with the video, side by side.
5. Confirm W3 by starting a second TIMER match and watching that no events leave for it.

---

## 7. What must NOT change

- One stream per tournament, resolved from `Tournaments.spectoStreamId`.
- Single FIFO dispatch thread. Ordering (`match_start` before `lineup` / `period_start`) depends on it.
- DB-first connection settings, write-only API key.
- The armed automatic period end and its deliberate non-eviction of its own map entry (a same-millisecond
  resume would otherwise evict its replacement).
- Fire-and-forget semantics from the caller's point of view: the zapisnik must never block, fail or slow down
  because the overlay is down.
- `spectoDrives()` gating — SIMPLE matches never touch the overlay.
- Fail-open on the frontend: a broken delay lookup reveals events, it never hides them.

---

## 8. Known behaviours that are correct and often mistaken for bugs

- `occurred_at` is captured at **submit** time, not send time, so a retry replays the original moment. The
  platform runs its overlay clock off `occurred_at`.
- `sendPeriodEndExact` sends `clock_sync` **and** `period_end` with the same timestamp on purpose: the sync
  pins the value, the end freezes it there.
- The manual "završi poluvrijeme" repeats the automatic timer's event with the same deterministic key, so
  whichever lands first wins and the other is a documented no-op.
- `spectoSide()` maps `team1 → "home"` and **anything else, including `null`, to `"away"`**. That is deliberate
  for anonymous events, but it does mean an event on a match with no `team1` silently credits "away".
- Zero-length halves (free-running clock, `spectoHalfSeconds() == 0`) must not send `period_start` boundaries.

---

## 9. Open requests to the platform operator

Send these together. Five of the work items above are blocked or degraded without them.

| # | Request | Blocks | Why |
|---|---|---|---|
| **R0** | Confirm whether `period_pause`, `timer_start`, `timer_stop` are supported. They are **not in the collection** but the app sends all three. If the platform validates `type` against a whitelist, every operator pause and every countdown is silently 4xx-ing right now — `sendWithRetry` logs a WARN and returns. | — | Correctness of an existing feature. If supported, please document them. |
| **R1** | A `team_update` event that changes a side's `jersey` / `shorts` (and optionally `name` / `short`) **without resetting the score**. | W11 | A match started before the kits were picked can never get them onto the broadcast. |
| **R2** | A `tournament_end` event carrying podium, top scorers and awards (shape in W12b). | W12b | End-of-tournament graphics. |
| **R3** | A `card_cancelled` event, mirroring `goal_cancelled`. | W4c | A card retracted in the zapisnik stays on the overlay. |
| **R4** | Penalty-shootout representation: either a `shootout_kick` event (`{team, scored, player_name?}`) plus a running tally, or documented fields on `match_end` for the final `X:Y` on penalties. | W4b | Today a shootout would inflate the regulation score. |
| **R5** | Does `exclusion` end early when the short-handed team concedes (futsal rule)? Is there a cancel event? | W10 | Otherwise the app's timeline and the overlay disagree. |
| **R6** | Does the `POST /events` response include `visible_at` on the returned `event` object? The SSE endpoint mentions it; the events response is documented only as `{event, duplicate}`. | W8 | The whole reveal-sync design degrades to the current polled delay without it. |
| **R7** | Exact semantics of `camera_offset_ms` vs `delay_offset_ms`, and of `delay_auto` and `gate_broadcast`. | W15 | The collection lists them without prose. |
| **R8** | Does `match_end` accept the final score / penalty score, or is the overlay's score purely derived from `goal` events? | W4b | Determines whether a final scoreline can be asserted rather than accumulated. |
