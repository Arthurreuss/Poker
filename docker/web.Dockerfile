# Prod-Image des Frontends (WP-003). Build: compose.prod.yml.
# Stage 1: `vite build` → statische Dateien. Stage 2: nginx (unprivilegiert, Port 8080) liefert sie aus
# und leitet /api/ und /ws an den Server weiter (docker/nginx/default.conf.template).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY apps/web apps/web
# App-Version (Commit) für das Feedback (WP-024); .git ist nicht im Build-Kontext, scripts/prod.sh setzt sie.
ARG APP_VERSION=
RUN APP_VERSION="$APP_VERSION" npm run build -w @poker/web

FROM nginxinc/nginx-unprivileged:1.30.5-alpine AS runtime
# API_UPSTREAM (host:port des Servers) wird beim Start per envsubst in die Konfiguration eingesetzt.
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
# Security-Header (WP-022), per include in jedem location-Block.
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
