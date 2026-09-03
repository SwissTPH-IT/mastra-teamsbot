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
COPY scripts ./scripts
COPY drizzle ./drizzle

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

# Migrations- und Prune-Job in das Build-Artefakt hinein. Beide sind plain ESM
# und ziehen ihre Abhängigkeiten (pg, drizzle-orm, @mastra/pg) aus dem
# node_modules, das `mastra build` in .mastra/output ohnehin installiert – kein
# zweites node_modules, kein tsx im Laufzeit-Image.
# Die Pfade sind so gewählt, dass migrate.mjs seinen Migrationsordner über
# `../drizzle` findet, genau wie im Repo.
COPY --from=build /app/scripts ./.mastra/output/scripts
COPY --from=build /app/drizzle ./.mastra/output/drizzle

# Fallback für lokale Läufe. Auf Railway wird PORT von der Plattform gesetzt
# und überschreibt das hier; src/mastra/index.ts liest process.env.PORT.
ENV PORT=4111
EXPOSE 4111

# Mount-Punkt fuer das persistente Railway-Storage: die hochgeladenen Belege.
# Threads, Memory, Traces und Workflow-Snapshots liegen in Postgres, nicht mehr
# hier. Hier steht absichtlich nur ein mkdir - die Docker-Anweisung dafuer lehnt
# Railway ab; eingehaengt wird beim Container-Start ueber den Mount Path
# (/app/data) aus den Service-Settings.
RUN mkdir -p /app/data

# Migration UND Start, verkettet mit &&: der Server startet nur, wenn die
# Migration mit Exit-Code 0 durchgelaufen ist.
#
# Das steht bewusst hier im Image und nicht nur in railway.json. Auf Railway
# wurde erst ein preDeployCommand und danach ein startCommand aus der
# railway.json stillschweigend nicht ausgefuehrt - der Agent startete gegen
# eine leere Datenbank und crashte in einer Endlosschleife mit
# 42P01 "relation mastra.mastra_schedules does not exist".
#
# Im Dockerfile-CMD greift es auch dann, wenn die Plattform-Config nicht
# angewendet wird: das ist der Standardbefehl des Images. railway.json setzt
# denselben Befehl noch einmal, das ist dieselbe Zeile, kein Widerspruch.
#
# Beide Teile sind idempotent (Drizzle fuehrt nur neue Migrationen aus,
# storage.init() legt nur fehlende Tabellen an), der Lauf kostet ~1 Sekunde.
CMD ["sh", "-c", "node .mastra/output/scripts/migrate.mjs && node .mastra/output/index.mjs"]
