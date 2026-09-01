# Multi-Stage: der Build braucht die devDependencies (mastra CLI, tsc),
# das Laufzeit-Image nicht.
FROM node:22-slim AS build

WORKDIR /app

# Der Build ruft sonst PostHog-Telemetrie auf. Hinter einem TLS-Interception-Proxy
# scheitert das laut und ohne Nutzen (der Build läuft trotzdem durch).
ENV MASTRA_TELEMETRY_DISABLED=1

# Abhängigkeiten zuerst (Docker-Layer-Caching). `npm ci` statt `npm install`,
# damit der Build reproduzierbar am Lockfile hängt.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

# Erzeugt .mastra/output – ein eigenständiges Bundle inkl. eigenem
# package-lock.json und installierten Prod-Abhängigkeiten.
RUN npx mastra build --studio


FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

# 0.0.0.0 ist zwingend: sonst ist der Server nur im Container selbst erreichbar
# und Railways Proxy bekommt keine Verbindung.
ENV MASTRA_HOST=0.0.0.0

COPY --from=build /app/.mastra/output ./.mastra/output

# Fallback für lokale Läufe. Auf Railway wird PORT von der Plattform gesetzt
# und überschreibt das hier; src/mastra/index.ts liest process.env.PORT.
ENV PORT=4111
EXPOSE 4111

# Mount-Punkt fuer das persistente Railway-Storage: LibSQL-DB, Uploads und
# Belegs-JSONs. Hier steht absichtlich nur ein mkdir - die Docker-Anweisung
# dafuer lehnt Railway ab; eingehaengt wird beim Container-Start ueber den
# Mount Path (/app/data) aus den Service-Settings.
RUN mkdir -p /app/data

CMD ["node", ".mastra/output/index.mjs"]
