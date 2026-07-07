# Deploying futsal-turniri.com

Single-server prod deploy on a Hetzner Cloud CX22 (or any VPS with Docker).
Stack: postgres + minio + Quarkus backend + Caddy edge (SPA + reverse proxy + TLS).

## Prerequisites

- A VPS with Docker + Docker Compose v2 installed (see steps 1–6 in the setup
  notes - non-root `deploy` user, UFW open on 22/80/443).
- A domain whose DNS A records point at the VPS (`futsal-turniri.com` and
  `www.futsal-turniri.com` both pointing at the public IP).
- Cloudflare (optional but recommended) set to **DNS-only** (gray cloud) for
  the first deploy so Caddy can complete the Let's Encrypt HTTP-01 challenge
  on its own. Switch the cloud to orange once HTTPS works.

## First-time deploy

On the VPS, as the `deploy` user:

```bash
# 1. Pull the repo
git clone https://github.com/<you>/futsal-turniri.com.git
cd futsal-turniri.com

# 2. Create the prod env file
cp .env.prod.example .env.prod
# Edit .env.prod - set strong random passwords (openssl rand -base64 24),
# the right FIREBASE_PROJECT_ID, and the public URLs.
$EDITOR .env.prod

# 3. Build images and start the stack
docker compose -f docker-compose.prod.yaml --env-file .env.prod up -d --build
```

First boot takes a few minutes - Maven downloads dependencies, npm installs,
Caddy fetches Let's Encrypt certs. After that, watch the logs:

```bash
docker compose -f docker-compose.prod.yaml logs -f backend
docker compose -f docker-compose.prod.yaml logs -f edge
```

The backend should log a "Startup sanity check passed" line if the env vars
look right; if anything is wrong, you'll see a loud warning block.

Hit `https://futsal-turniri.com` in a browser to confirm.

## Updates

```bash
cd futsal-turniri.com
git pull
docker compose -f docker-compose.prod.yaml --env-file .env.prod up -d --build
docker image prune -f       # reclaim disk from old images
```

The backend runs Liquibase migrations at boot, so schema changes apply
automatically as part of the restart.

## Backups

A nightly Postgres dump to local disk plus an off-site copy is the minimum.
On the VPS, as `deploy`:

```bash
# Make a backup directory and a dump script
mkdir -p ~/backups
cat > ~/pg-dump.sh <<'EOF'
#!/bin/bash
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
docker compose -f /home/deploy/futsal-turniri.com/docker-compose.prod.yaml \
    --env-file /home/deploy/futsal-turniri.com/.env.prod \
    exec -T postgres \
    pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > /home/deploy/backups/pg-$TS.sql.gz
# Keep last 14 days
find /home/deploy/backups -name 'pg-*.sql.gz' -mtime +14 -delete
EOF
chmod +x ~/pg-dump.sh

# Add to cron - nightly at 03:00
( crontab -l 2>/dev/null ; echo "0 3 * * * /home/deploy/pg-dump.sh" ) | crontab -
```

For off-site backups, install `rclone`, configure a remote (Backblaze B2 is
~$6/TB-month, basically free at this scale), and add a second cron line:
`30 3 * * * rclone sync /home/deploy/backups remote:futsal-backups`.

The Hetzner volume snapshots (the +20% backup option you ticked at server
creation) are *also* taken weekly - they cover the case where Postgres-level
backups don't help (e.g. you `rm -rf` the whole repo).

## Troubleshooting

**Caddy can't get TLS certs.** Check that DNS actually resolves to the VPS
(`dig futsal-turniri.com +short` should return the public IP) and that ports
80 and 443 are open in UFW. If Cloudflare is in proxy mode (orange cloud),
turn it off until certs are issued - Cloudflare's proxy intercepts the HTTP-01
challenge.

**Backend won't start, complains about Postgres.** `docker compose logs
postgres` - usually means the password in `.env.prod` doesn't match what the
volume was first initialized with. To wipe and redo Postgres only:
`docker compose down && docker volume rm nogometni-turniri_pg_data && docker
compose up -d --build`. (You'll lose data - only do this on first deploy.)

**Liquibase migration errors at boot.** A changeset checksum changed since
the DB last applied it. Don't edit committed changesets in place; add a new
one. If you must, `liquibase clearChecksums` against the running container.

**MinIO gives 403 to the backend.** Wrong `MINIO_ROOT_USER` /
`MINIO_ROOT_PASSWORD` combination, or you changed them between deploys
without wiping the MinIO volume. The bucket is private; no public-read
policy exists by design - all image reads go through the backend.

## Useful commands

```bash
# Status
docker compose -f docker-compose.prod.yaml ps

# Tail logs for one service
docker compose -f docker-compose.prod.yaml logs -f backend

# Shell inside a running container
docker compose -f docker-compose.prod.yaml exec backend sh

# Postgres CLI
docker compose -f docker-compose.prod.yaml exec postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"

# Stop everything (data volumes preserved)
docker compose -f docker-compose.prod.yaml down

# Stop and DELETE all data (full wipe)
docker compose -f docker-compose.prod.yaml down -v
```
