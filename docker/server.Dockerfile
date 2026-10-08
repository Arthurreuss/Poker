# Prod-Image des Game-Servers (WP-003). Build: compose.prod.yml.
# Stage 1 baut ein ESM-Bundle (esbuild, @poker/engine eingebettet, keine Source-Maps),
# Stage 2 installiert nur die Laufzeit-Abhängigkeiten des Servers, Stage 3 ist das schlanke Runtime-Image.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts
COPY tsconfig.base.json ./
COPY packages/engine packages/engine
COPY apps/server apps/server
RUN npm run build -w @poker/server

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Nur Produktions-Abhängigkeiten des Servers; Workspace-Symlinks (@poker/*) werden nicht gebraucht (eingebettet).
# Source-Maps der Fremdpakete und leere Verzeichnisse (Reste ausgelassener Dev-Pakete) fliegen raus.
RUN npm ci --omit=dev --ignore-scripts -w @poker/server \
  && rm -rf node_modules/@poker \
  && find node_modules -name '*.map' -type f -delete \
  && find node_modules -type d -empty -delete \
  && npm cache clean --force

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/apps/server/dist/ ./
# SQL-Migrationen laufen beim Start (D-015); der gebündelte Server findet sie über MIGRATIONS_DIR.
COPY --chown=root:root apps/server/migrations ./migrations
ENV MIGRATIONS_DIR=/app/migrations
USER node
EXPOSE 4321
CMD ["node", "server.mjs"]
