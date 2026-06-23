# Deploy runbook — v3 + new features

Tested + ready to ship. Follow the steps in order. Don't skip the smoke tests at the end.

## 0. Local sanity

Run from this machine before pushing:

```bash
# Frontend
cd frontend
npx tsc -b --noEmit                                     # must say nothing
npm run build                                            # must end with "built in N.NNs"

# Backend (via Docker so you don't need local Maven)
cd ../backend
MSYS_NO_PATHCONV=1 docker run --rm \
    -v "$(pwd -W):/workspace" -w /workspace \
    maven:3.9-eclipse-temurin-21 \
    mvn -B -e -ntp -DskipTests package
# must end with BUILD SUCCESS
```

If either fails, fix locally before continuing.

## 1. Commit and push to GitHub

```bash
cd ..                              # repo root
git add -A
git status                         # eyeball — make sure .env.prod and service-account.json are NOT staged

# .gitignore should already block them, but double-check:
git ls-files | grep -iE 'env\.prod$|service-account|secret' && echo "🛑 SECRET LEAK — abort" || echo "✓ no secrets staged"

git commit -m "v3: groups redesign, create wizard, liquid glass nav, fullscreen, notifications

- Groups: compact 2-col grid with W·D·L micro-line, advancing rows tinted
- Create tournament: 4-step wizard (Osnovno → Format → Nagrade → Pregled)
- Mobile bottom nav: 5-tab with centred lifted FAB, iOS liquid-glass effect
- New /turniri/:uuid/fullscreen route for TV/projector use
- Notification bell per tournament, push on goal / half-time / full-time
- Misc: Leaflet z-index clamp, sticky bottom bar respects mobile nav height"

git push origin main
```

## 2. SSH to the Hetzner VPS

```bash
ssh deploy@<your-vps-ip>
cd nogometni-turniri.com
git pull
```

## 3. Rebuild + restart

```bash
# Rebuilds the backend image (Liquibase migrations run on Quarkus boot)
# and restarts everything, picking up the new frontend bundle from
# `frontend/Dockerfile`.
docker compose -f docker-compose.prod.yaml --env-file .env.prod up -d --build

# Watch the backend boot log live:
docker compose -f docker-compose.prod.yaml --env-file .env.prod logs -f backend
```

### What to look for in the boot log

1. **Liquibase changesets applied**. The two new files you should see in the log:
   - `tournaments_featured.xml` (already shipped — should already be applied)
   - `tournament_subscriptions.xml` ← NEW. Look for:
     ```
     INFO  [liquibase.changelog] Custom SQL executed
     INFO  [liquibase.changelog] ChangeSet ... tournament_subscriptions ran successfully
     ```
2. **No "column not found" errors** — if you see anything about `tournaments.featured_at` or `tournament_subscriptions` failing to map, something didn't migrate. Read the stack trace, fix, redeploy.
3. **Quarkus up line** —
   ```
   INFO  [io.quarkus] (main) futsal-turniri 0.0.1-SNAPSHOT ... started in N.NNNs.
   ```

Then:

```bash
docker image prune -f
```

## 4. Smoke tests (from your laptop)

```bash
BASE=https://nogometni-turniri.com

# A. Featured-tournament endpoint exists
curl -sI $BASE/api/tournaments/featured | head -1
#   expect: HTTP/2 204  (or 200 if something is featured)

# B. NEW tournament-subscription endpoint exists.
#    Without a Firebase token this should 401, not 404.
curl -sI -X POST $BASE/api/tournaments/<some-uuid>/subscribe | head -1
#   expect: HTTP/2 401 Unauthorized  (NOT 404 — would mean endpoint missing)

# C. Fullscreen page is reachable on the frontend
curl -sI $BASE/turniri/<some-slug>/fullscreen | head -1
#   expect: HTTP/2 200  (Caddy serves index.html for SPA fallback)

# D. /uzivo is reachable
curl -sI $BASE/uzivo | head -1
#   expect: HTTP/2 200
```

## 5. Manual smoke tests (in a browser)

- Open `/turniri` on a phone-sized window. Bottom nav shows 5 items with a lifted green FAB in the centre. Background blurs the content underneath when you scroll.
- Open a tournament's Detalji tab. Top-right of the title row now has a bell icon — click it. First click should request notification permission, then turn the bell green with a pulsing dot.
- Click "Fullscreen" button in the poster column. Opens a new tab with dark TV layout. ESC or the X button leaves and goes back to the detail page.
- Open Kreiraj turnir. 4-step wizard. Stepper at top is clickable; sticky bottom bar shows Natrag / Dalje (Objavi turnir on step 4). Sticky bar sits above the bottom nav, doesn't overlap.
- Open Ždrijeb → Grupe on a tournament with group stage. Compact 2-col layout (1-col on mobile). Advancing rows have green tint + left border. Points column visually dominant.

## 6. Verify a push notification actually fires

This is the only thing you can't verify with curl:

1. On phone A, log in → open a tournament → click the bell → grant permissions.
2. On phone B (or laptop) logged in as the organiser of that tournament → start a live match → record a goal.
3. Within ~2 seconds phone A should buzz with a notification:
   > ⚽ Gol — `<Tournament name>`
   > `<Team1>` 1:0 `<Team2>`

If nothing arrives: SSH to VPS, `docker compose logs backend | grep -i "push\|notification\|subscribe"`. Common issues:
- VAPID keys not set in `.env.prod` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`)
- User on phone A never subscribed at the OS level (check browser site permissions)
- Service worker not registered (DevTools → Application → Service Workers)

## 7. Rollback (if something explodes)

```bash
cd nogometni-turniri.com
git revert HEAD
docker compose -f docker-compose.prod.yaml --env-file .env.prod up -d --build backend
```

The Liquibase changesets stay applied (the new column + table are harmless if unused). If you want to fully roll back the schema too, that's a separate migration — don't do it under stress.

## Notes for next time

- Bundle size warning ("chunks > 500 kB"). Not blocking but worth a code-split pass eventually (`React.lazy` on `BracketTab`, `MapPage`, `FullscreenTournamentPage`).
- Frontend now depends on `@g-loot/react-tournament-brackets` (peer React 18, runs fine on 19 with `--legacy-peer-deps` already in place via your existing install).
