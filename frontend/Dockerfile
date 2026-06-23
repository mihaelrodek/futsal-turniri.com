# syntax=docker/dockerfile:1.7
#
# "Edge" image — builds the Vite SPA and serves it via Caddy.
# Caddy also reverse-proxies /api/* to the backend container, terminates
# TLS via Let's Encrypt, and routes crawler User-Agents to the SSR preview
# endpoints. One container, one config file, no cross-volume gymnastics.
#
# Build context: the REPO ROOT (so we can COPY the Caddyfile that lives
# at the project root). docker-compose.prod.yaml takes care of this.
#
#   docker build -t futsal-edge -f frontend/Dockerfile .
#
# Required build args (Vite inlines them at build time):
#   VITE_API_URL                — defaults to /api (same-origin via Caddy)
#   VITE_FIREBASE_API_KEY
#   VITE_FIREBASE_AUTH_DOMAIN
#   VITE_FIREBASE_PROJECT_ID
#   VITE_FIREBASE_APP_ID

# ─────────────────────────── Stage 1: build ───────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

# Cache npm install — separate layer, only invalidates when package*.json change.
COPY frontend/package.json frontend/package-lock.json* ./
# --legacy-peer-deps: @g-loot/react-tournament-brackets declares a React 18
# peer but runs fine on React 19. The local install + lockfile were built
# with this flag (see frontend/.npmrc); `npm ci` enforces strict peers by
# default, so we set it explicitly here too or the image build fails.
RUN npm ci --legacy-peer-deps

# Copy the rest of the frontend source.
COPY frontend/ ./

# Vite reads VITE_* env vars at build time and inlines the values into
# the bundle. They're not secrets (Firebase web config is public per
# Firebase's docs), but they DO need to be set or auth will silently
# misconfigure itself.
ARG VITE_API_URL=/api
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_APP_ID
ENV VITE_API_URL=$VITE_API_URL \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID

RUN npm run build
# → /app/dist contains the static SPA bundle.

# ─────────────────────────── Stage 2: serve ───────────────────────────
FROM caddy:2-alpine

# Caddyfile lives at the repo root (build context). It defines TLS,
# the /api proxy, and the crawler routing for OG previews. Baked into
# the image so a deploy is just "rebuild + restart".
COPY Caddyfile /etc/caddy/Caddyfile

# Static SPA bundle.
COPY --from=build /app/dist /srv

EXPOSE 80 443
