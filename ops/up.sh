#!/usr/bin/env bash
#
# Thin wrapper around the production `docker compose ... up -d --build`.
#
# It does exactly what the raw compose command does, but shows the
# "Nadogradnja u tijeku" maintenance page for the duration of the
# rebuild/restart and clears it afterwards — even if the build fails or you
# Ctrl-C (via the EXIT trap).
#
# WHY a wrapper: `docker compose` has no pre/post-up hooks, so the raw command
# can't toggle the maintenance flag by itself. Run THIS instead of the raw
# command whenever you want the maintenance page.
#
# Usage (from the repo root on the prod server):
#   ./ops/up.sh              # rebuild + restart the whole stack
#   ./ops/up.sh backend      # rebuild + restart only the backend service
#   ./ops/up.sh edge backend # any extra args are passed straight to compose
#
# Difference vs ./ops/deploy.sh: deploy.sh is the full release flow (git pull
# + rebuild + image prune). up.sh is just the guarded compose up — no git pull,
# no prune — a drop-in replacement for a manual `docker compose up -d --build`.
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

echo "🐳 Rebuild + restart…"
"${COMPOSE[@]}" up -d --build "$@"

# EXIT trap clears the flag → maintenance OFF.
