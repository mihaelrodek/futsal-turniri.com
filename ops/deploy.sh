#!/usr/bin/env bash
#
# Deploy futsal-turniri.com — shows the "Nadogradnja u tijeku" maintenance
# page for the whole update, then clears it (even if the deploy fails).
#
# Usage (run from the repo root on the prod server):
#   ./ops/deploy.sh
#
# What it does:
#   1. touch ops/maintenance/ENABLED  → Caddy starts serving the 503 page.
#   2. git pull + rebuild + restart the stack (backend migrations run here).
#   3. rm ops/maintenance/ENABLED     → back to normal (via EXIT trap, so it
#      clears even on error / Ctrl-C).
#
# Note: the maintenance page is served by the *running* edge container. The
# very first time you introduce this, the currently-running edge doesn't know
# about it yet, so that one deploy has the usual brief blip; every deploy after
# it shows the page. When a deploy rebuilds the edge image itself (frontend
# change), there's still a ~1-3 s connection blip while the container swaps —
# unavoidable with a single edge — but the flag stays ON across the swap.
set -euo pipefail

cd "$(dirname "$0")/.."

FLAG="ops/maintenance/ENABLED"
COMPOSE=(docker compose -f docker-compose.prod.yaml --env-file .env.prod)

mkdir -p ops/maintenance

maintenance_off() {
    rm -f "$FLAG"
    echo "✅ Maintenance OFF — site je opet dostupan."
}
trap maintenance_off EXIT

echo "🛠  Maintenance ON — prikazuje se 'Nadogradnja u tijeku'."
touch "$FLAG"
# Small pause so in-flight requests land on the maintenance page before we
# start tearing containers down.
sleep 2

echo "⬇️  git pull…"
git pull --ff-only

echo "🐳 Rebuild + restart…"
"${COMPOSE[@]}" up -d --build

echo "🧹 Prune old images…"
docker image prune -f

# EXIT trap clears the flag → maintenance OFF.
