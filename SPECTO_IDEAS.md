# SpectoStream — Ideas & Proposals, Ranked

Every finding and proposal from the audit, ordered. Separate from `SPECTO_REIMPLEMENTATION.md`, which is the
executable spec — this document is the reasoning, the full inventory, and the ideas that did **not** make it
into the spec.

Legend — **Effort**: S (< half a day) · M (1–2 days) · L (more). **Blocked**: needs something outside the repo.

---

## Tier 0 — Bugs. These are wrong today.

### 1. Penalty shootout inflates the score on the broadcast · S
`PENALTY_GOAL` is relayed through the same `specto.goal(...)` call as a regulation goal
(`TournamentController.java:2824,2827`), and the platform adds +1 to the visible score for every `goal` event.
A shootout therefore pushes the regulation scoreline up on the broadcast — a 2:2 that goes to penalties can end
up showing 5:4. `PENALTY_MISSED` sends nothing (`:2835`), so the two sides are not even symmetric.
Worse, the shootout tally (`matches.penalties1/2`) is written by a completely separate path
(`KnockoutService.java:1528-1535`) that never sums the kick events, and is never sent at all.
→ Spec **W4b**. Needs **R4** for a proper representation.

### 2. `resetMatch` puts the overlay in the wrong state · S
`TournamentController.java:2227` says "SpectoStream has no `reset` event (and rejects it)". It does now —
the refreshed contract documents `reset`, which zeroes score/period/clock and clears scorers, cards and
exclusions **while keeping teams, lineups and the next-match announcement**. That is exactly the semantics
`resetMatch` wants. Today it sends `match_end` instead, which wipes the lineups and leaves the overlay
showing `ended`. One-line swap. → **W4a**.

### 3. Armed period-end timers fire after the match is deleted · S
`resetTournament` (`TournamentController.java:831-853`) calls `matchesRepo.deleteByTournament(t)` without
cancelling anything. `periodEndTimers` keeps a `ScheduledFuture` keyed by a match id that no longer exists,
which later fires `clock_sync` + `period_end` into whatever is on the overlay then. → **W4d**.

### 4. `verify()` cannot detect a bad API key · S
`SpectoStreamService.java:367-372` builds the check with **no** `Authorization` header, and
`GET /v1/streams/{id}/state` is public. A revoked key passes verification. The method's own javadoc promises
the opposite. `isConfigured()` only checks the key is present, not valid. With "rotate the exposed key" already
an open task, this is the wrong thing to have broken. → **W2**.

### 5. Two LIVE matches share one scoreboard · M
`startMatch` has no guard against a second LIVE match in the same tournament; `currentMatch()` picks
`live.get(0)` (`SpectoAdminController.java:258`). There is one stream per tournament, and `matchId` never
appears in a payload — only inside idempotency keys. Two pitches running in parallel interleave `goal`, `card`
and `period_*` on the same scoreboard, and B's `match_start` resets A's score to 0:0. → **W3**.

### 6. Events can reach the broadcast before the transaction commits · M
All ten relay sites sit inside `@Transactional` method bodies, and nothing orders the HTTP send against the
JTA commit. A rollback afterwards leaves a goal on the broadcast that does not exist in the app. → **W1**.

### 7. A retracted card stays on the overlay forever · S (blocked)
`deleteMatchEvent` cancels goals (`:2892`) but there is no `cardCancelled` in the service, and no
`card_cancelled` in the contract. → **W4c**, needs **R3**.

### 8. Three event types the app sends are not in the contract · S (blocked)
`period_pause` (`:495`), `timer_start` (`:723`), `timer_stop` (`:733`) appear in **neither** the old nor the
refreshed collection. If the platform validates `type` against a whitelist, every operator pause and every
countdown has been silently 4xx-ing — `sendWithRetry` logs one WARN (`:830`) and returns, and nothing surfaces
it. That would mean the overlay clock keeps running straight through a pause. → **R0**. Ask before anything else.

### 9. A revoked key is invisible · S
`:830` logs a WARN and nothing more. The admin card keeps saying "spojeno" while every event is rejected.
→ **W6**.

---

## Tier 1 — The big structural win

### 10. Reveal in-app events at the broadcast's own timestamp · L
The idea you raised, and it is the most valuable change in this document.

**What happens today.** `useBroadcastDelay.ts` polls the platform's public `/state` every 30 s for
`delay_offset_ms`, then holds an event until `createdAt + delay`. Three problems compound:

- **Only three surfaces respect it.** The `MatchLivePage` header score, `GoalscorersPanel` and the `StreamHero`
  ticker. The `LiveScoreBug` **pinned on top of the video** (`StreamHero.tsx:59-113`,
  `TournamentLivePage.tsx:96`), the "Sastavi" tab's per-player goal badges (`MatchLivePage.tsx:1002-1013`), the
  live group standings (`liveStandings.ts`) and the mini-bracket are all raw. The most prominent score on the
  page — the one physically overlapping the delayed video — spoils the goal it sits on.
- **The timestamp is wrong for anything replayed.** `MatchEvent.createdAt` is `@CreationTimestamp`, stamped at
  INSERT. A goal entered offline and synced five minutes later gets `createdAt = sync time`, so the hold window
  starts then — the app reveals it minutes after the broadcast already showed it. `CreateMatchEventRequest`
  carries no client timestamp at all.
- **It is a guess.** `delay_offset_ms` is a stream-level configuration value, polled on a 30 s interval, with
  only a `±2×delay` sanity guard for client/server clock skew.

**What to do instead.** The events POST already returns `{event, duplicate}` and the app throws the whole body
away (`:820-823`). If the returned event carries `visible_at` — the same field the SSE endpoint uses to gate
public delivery — then the platform is telling us exactly when the viewer will see it. Persist it, push it, and
reveal on it.

```
revealAt(event) =
    event.visibleAt                      // authoritative, from the platform
  ?? event.occurredAt + observedDelayMs  // rolling average of our own last 20 sends
  ?? event.createdAt  + delayOffsetMs    // today's behaviour
  ?? now                                 // fail open
```

The rolling average is the answer to "what about events that never got a response" — offline replays, failed
sends, a circuit breaker that was open. It is measured from our own traffic rather than read from configuration,
so it tracks reality.

Then apply the resolver to **every** public surface, and deliberately to none of the organizer's own screens —
the zapisnik is the source of truth, not an audience.

Also add `occurredAt` to `CreateMatchEventRequest` so the offline queue can replay the original tap time
instead of having the server stamp the sync moment. That single field fixes the outbound `occurred_at` too,
which today is `Instant.now()` at submit (`:639`) for every event including replays.

→ **W8**. Depends on **R6** (does the response carry `visible_at`?). Degrades cleanly to today's behaviour if not.

---

## Tier 2 — Features you asked for

### 11. 2-minute exclusion · M
`exclusion` is documented and supported: `{team, player_name?}`, the platform counts down 2 minutes from
`occurred_at` and shows the short-handed side. The app never sends it. Two layers:

- **Automatic on a red card.** In futsal a red card leaves the team a player short for 2 minutes. `RED_CARD`
  already relays a `card`; follow it with an `exclusion` for the same side and player. Cheap, and it is the
  common case.
- **Standalone.** Add `MatchEventType.EXCLUSION`, a zapisnik button next to the cards, a timeline entry with a
  live 2-minute countdown chip, anonymous variant allowed. Audit every `switch` over `MatchEventType` —
  `recomputeScoreFromGoals` and the scorer query both filter on `GOAL` explicitly, so they are already safe.

Open question **R5**: futsal ends the exclusion early if the short-handed team concedes. The contract documents
only automatic expiry and no cancel event. Until answered, don't try to end one early — the app's timeline and
the overlay would disagree. → **W10**.

### 12. Kit colours changed mid-match · M (blocked)
Exactly the hole you identified. Colours reach the overlay only as a snapshot inside `match_start`
(`:407-410`) and `putNextMatch` (`:422-441`). A match started before the organizer picked the kits can never
get them onto the broadcast, because re-sending `match_start` resets the score to 0:0.

`setTeamJerseyColor` (`TournamentController.java:1329`) and `setTeamShortsColor` (`:1355`) currently fire
**nothing** — no `notifyLive`, no cache invalidation, no relay. The frontend patches its own react-query cache
optimistically (`TeamsSection.tsx:117-131`) and that is the entire side effect. So even in-app, another viewer's
shirt icons are stale until they refetch.

Nothing in the contract updates team appearance without a reset. Needs **R1** — a `team_update` event.
Build the app side now behind a flag; it works the day the platform ships it. Also add the missing `notifyLive`
regardless, and the missing `MatchesRepository.findLiveMatchForTeam(...)` — there is no query today that
answers "is this team in a live match". → **W11**.

### 13. Top 3 on the broadcast at the end of a tournament · M
Nothing about a tournament ending reaches the overlay: `finishTournament` (`:498`), `setPodium` (`:581`),
`setAwards` (`:813`) make no `specto.*` call.

The data exists but is awkward: `winnerName`, `secondPlaceName`, `thirdPlaceName` are **plain name strings** on
`Tournaments` (`:235,:246,:250`), not FKs, so kit colours require resolving the name back to a `Teams` row by
case-insensitive match — the same thing `setPodium` already does. Third place is genuinely optional:
`KnockoutService.hasThirdPlace(qualifiers)` is `qualifiers >= 4`. Top scorers come from
`findGoalCountsByTournament(...)` → `ScorerDto`, filtering `type = GOAL`, so shootout kicks and own goals are
already excluded.

Two stages, and the first needs nothing from the platform:

- **Today:** a `custom_message` — `🏆 <turnir> · 1. <prvi> · 2. <drugi> · 3. <treći>`, ≤200 characters.
  Crude, but it ships this week.
- **Properly:** request a `tournament_end` event carrying a structured podium (with kits), a top-scorer list
  and the awards, so the overlay can render a real end card. → **R2**, spec **W12b**.

---

## Tier 3 — Payload quality

### 14. Send `clock_seconds` with goals and cards · S
Both accept it, optionally, for display. The app sends neither, though it has `MatchEvent.minute` and can
compute the exact cumulative match second from the same arithmetic the resume path already uses. The overlay
could show "Gol · 07:32" instead of a bare name. → **W9**.

### 15. Fix three idempotency keys · S
`Matches.id` and `MatchEvent.id` are global DB sequences, so nothing collides across tournaments — that part is
sound. But:

- `"m{id}-p{p}-start-{epochSecond}"` (`:467`) and `"m{id}-period_end-{epochSecond}"` (`:481`) use **second**
  granularity off `now()`. Two genuine calls seconds apart get different keys; the format is neither
  deterministic nor useful. Key off the half's start instant from the entity instead.
- `"m{id}-clock_visibility-{UUID}"` (`:747`) — the `matchId` prefix is decorative. The UUID already guarantees
  uniqueness, so it has no retry protection at all across independent calls.

The random-UUID keys on `stream_start`, `lineup`, `timer_*`, `custom_message` are correct by design — each is
genuinely a new event. Debounce the buttons instead. → **W7**, **W14**.

### 16. `shortCode()` wastes two characters and can collide · S
`:862` truncates to 4 although the contract allows 6, and two similar team names collapse to the same code
("VK Mladost" and "VK Mladica" both → `VKML`). Use 6 and disambiguate the away side on a collision. → **W14**.

### 17. `isPlainStreamId` is looser than the platform's own format · S
`SpectoStreamController.java:142` allows uppercase, `_` and 200 characters; platform ids are
`^[a-z0-9-]{3,32}$`. → **W14**.

### 18. `stream_start` / `stream_end` send an `occurred_at` the contract's examples omit · S
Harmless if ignored, but worth confirming — these two are documented as delivered immediately, bypassing the
delay pipeline, so a timestamp may be meaningless or may be interpreted. Low priority.

---

## Tier 4 — Resilience & operability

### 19. Head-of-line blocking on the dispatch thread · M
One FIFO thread, 5 s timeout, and `Thread.sleep(1000)` **on that same thread** between attempts → up to 11 s of
blocking per event, with an unbounded queue behind it. During a platform hiccup, goals from the next match sit
behind the previous one's backlog. Fix: 3 s timeout, retry via `clockTimers.schedule` instead of sleeping,
a circuit breaker after 3 consecutive failures, and a queue cap that drops **display-only** events
(`custom_message`, `lineup`, `timer_*`, `clock_visibility`) while never dropping clock or score. → **W5**.

### 20. Armed period-end timers do not survive a restart · S
`periodEndTimers` and `clockTimers` are in-memory. A restart mid-half silently loses the automatic period end;
the clock then free-runs past the whistle until the organizer taps "završi poluvrijeme" manually. The class
javadoc claims a restart still lands on 10:00 — that only holds because a human eventually clicks. Re-arm on
`StartupEvent` by scanning LIVE TIMER matches. → **W5**.

### 21. Nothing is measured · S
No counters for sent/failed/duplicate per event type. Combined with #9, the integration is operationally blind.
Micrometer is available in Quarkus. Pair it with the `duplicate` flag from the response — that flag is the only
way to notice an idempotency key collision. → **W6**.

### 22. `provisionTournament` holds a DB connection across a 5 s HTTP call · S
`SpectoStreamController.java:106-116` runs the blocking upsert inside `@Transactional`, with a pool of 20.
Rare admin action, low real risk, but trivially avoidable: HTTP outside, then a short transaction to persist
the id. → **W14**.

### 23. Use the platform's debug endpoints · S (blocked on W15)
`GET /v1/streams/{id}/requests` returns the last 100 HTTP requests **with headers** — exactly what you need to
prove whether `period_pause` is being rejected (#8). `GET /v1/streams/{id}/events?limit=` returns the event
history. Both need a portal session token.

---

## Tier 5 — Unused platform capability

### 24. Overlay theme from the app's own brand · M (blocked on W15)
`PUT /v1/tournaments/{id}/overlay` sets layout `A|B`, scoreboard/logo/banner positions as screen percentages,
primary/secondary/text colours, font, team short codes, and a base64 logo up to 2 MB. Every tournament currently
broadcasts with the platform's defaults.

The app already has all of it: brand `pitch.500 = #17A79D`, dark canvas `#0B1522`, and the logo mark rendered in
Java2D in `services/QrCodeRenderer.java` for QR centre marks — render that to PNG, base64 it, PUT once per
tournament. Largest visual return in this document for the amount of code. → **W13**.

### 25. Real viewer numbers · M (blocked on W15)
`GET /v1/streams/{id}/stats` gives `current_viewers`, `peak_viewers`, `avg_viewers`, `viewer_minutes` and a
180-minute series.

The app counts viewers itself with `StreamPresenceService` — an in-memory map that is, by its own comment, a
"vanity metric", does not survive a restart, will not survive horizontal scaling, **is not partitioned per
tournament or stream at all** (every session on any page counts toward one global number), and never sees
anyone watching the embed elsewhere. The platform has the real figures. Either replace the local counter or,
cheaper, have the app's player also call the platform's public
`POST /v1/streams/{id}/heartbeat` (`{session_id, latency_ms}` → `{ok, viewers}`) so in-app and embed viewers
land in one number. That one is public — no session token needed.

### 26. Set the delay instead of only reading it · S (blocked on W15)
`PATCH /v1/streams/{id}` exposes `delay_offset_ms` (0–120000) and `camera_offset_ms` (0–300000).
`useBroadcastDelay` already **reads** `delay_offset_ms`; nothing writes it. Fine-tuning `camera_offset_ms`
is how you align the overlay with the video. Needs **R7** — the collection lists both without explaining the
difference, nor what `delay_auto` and `gate_broadcast` do.

### 27. Consume the SSE channel instead of polling · M
`GET /v1/streams/{id}/live?last_event_id=` is a Server-Sent Events stream, public, with backlog replay from an
event id. The app polls `/state` every 30 s for the delay and polls its own banner every 7–30 s. An SSE
subscription would give the app the platform's own view of the match in real time — useful as a reconciliation
source (see #28) and as a way to detect that an event never landed.

### 28. Reconciliation loop · M
With `GET /v1/streams/{id}/state` (or the SSE channel) the app can periodically compare what the overlay thinks
the score and clock are against its own truth, and correct drift with a `clock_sync` or a targeted resend.
Today drift is one-directional and permanent: a lost `period_start` or `period_pause` is never noticed. A
cheaper first step is a plain **periodic `clock_sync`** every 30–60 s while a TIMER match is live — the app
already knows the exact cumulative second, and every missed clock event then self-heals within a minute.
That alone removes most of the class of "overlay clock is 40 seconds off" complaints.

### 29. `substitution` is supported and unused · S
The contract documents it. The app has no substitution data at all — `MatchEventType` has no such constant,
despite `APP_OVERVIEW.md` claiming the zapisnik records substitutions. Either add the event type (and the UI)
or drop the claim from the docs. Low priority; nobody is asking for it.

---

## Tier 6 — Strategic

### 30. Two parallel advertising systems · L
The platform has a full advertising stack: `advertisers`, `ad-creatives` (base64 images ≤5 MB), and `campaigns`
with `active_from`/`active_to`, `priority` 1–10 and slots `ingame_banner`, `halftime`, `pregame`, `postgame`,
`goal-sponsor`, filtered per tournament.

The app has its own: `StreamAdController`, an AD/OVERLAY media library in MinIO, toggled through
`stream_banner_ad` / `stream_banner_overlay` in `app_settings`, rendered as an absolutely-positioned element
over the player in `StreamPlayer.tsx:498-506`.

The difference matters commercially. **The platform's campaigns are burned into the broadcast** — everyone
watching that stream sees them, including on someone else's embedded page. **The app's overlays are a div on our
own page** — only visible to people on futsal-turniri.com, propagating on a 7–30 s poll, and invisible the
moment a tournament is linked to Specto (the player swaps itself for `SpectoEmbed`).

If sponsorship is going to be sold, that is a decision to take now rather than after both systems have grown.
The platform's version reaches more eyeballs and has scheduling and priority built in; the app's version is
already written and needs no portal credentials. Converging is a real project, not a cleanup — but running both
indefinitely means two places to configure the same sponsor.

### 31. Portal credentials raise the blast radius · S — decide before implementing
Nine of the ideas above are gated on a portal session token (`POST /v1/auth/login` → `ssn_…`, 30 days).
Storing `specto_portal_user` / `specto_portal_password` in `app_settings` unlocks them — but
`GET /v1/api-keys` returns API keys **in plaintext**, so a portal login is equivalent to holding every key.
That is a deliberate trade, not an oversight to route around: decide it explicitly. → **W15**.

---

## Ordering, if you want one line

**This week:** #2 `reset`, #4 verify, #1 shootout, #3 orphaned timers, #14 `clock_seconds` — all small, all
correctness. Send **R0** (are `period_pause` / `timer_*` even real?) the same day; it may be the largest silent
failure in the integration.

**Next:** #9 + #21 failure visibility, #6 commit-safety, #19 dispatch resilience, #5 one-match ownership.

**Then the features:** #11 exclusions (unblocked), #13 top-3 via `custom_message` (unblocked), #10 the reveal
resolver (the big one), #12 kit colours once **R1** lands.

**When portal credentials are decided:** #24 overlay theme first — most visible return — then #25 viewer stats
and #23 debug endpoints.

**Separately, as a product decision, not a task:** #30 which advertising system wins.
