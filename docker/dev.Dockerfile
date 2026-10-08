# Dev-Image für Server und Web (D-004: node:22-alpine).
# node_modules werden im Image für Linux installiert; compose.dev.yml legt ein anonymes
# Volume über /app/node_modules, damit der Bind-Mount die macOS-Binaries des Hosts nicht hineinträgt.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN npm ci --ignore-scripts && npm cache clean --force

USER node
