# Build-Kontext ist das REPO-ROOT, nicht frontend/ - das Frontend ist ein
# npm-Workspace dieses Repos und importiert das Drizzle-Schema aus src/db.
# Entsprechend: `docker build -f frontend/Dockerfile .` (docker-compose setzt
# das ueber `context: .`, Railway baut ohnehin vom Repo-Root).

FROM node:22-slim AS build

WORKDIR /repo

# Abhaengigkeiten zuerst (Docker-Layer-Caching). Beide Manifeste plus das
# Lockfile: `npm ci` in einem Workspace-Repo braucht die package.json jedes
# Mitglieds, sonst bricht es gegen das Lockfile ab.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
RUN npm ci

# Nur das DB-Verzeichnis aus dem Agent-Repo, nicht src/ komplett: mehr braucht
# das Frontend nicht, und alles Weitere wuerde den Cache unnoetig invalidieren.
COPY src/db ./src/db
COPY frontend ./frontend

# Der Build braucht keinen DATABASE_URL: alle Seiten sind force-dynamic und der
# Pool entsteht erst beim ersten Request (siehe lib/db/client.ts).
RUN npm run build --workspace frontend


FROM node:22-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
# 0.0.0.0 ist zwingend: sonst ist der Server nur im Container selbst erreichbar
# und Railways Proxy bekommt keine Verbindung.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# output: 'standalone' (frontend/next.config.ts) erzeugt einen Baum mit genau
# den node_modules, die zur Laufzeit gebraucht werden - nicht das gehoistete
# node_modules des ganzen Workspace mit allen Mastra-Abhaengigkeiten des
# Agenten. Die Struktur spiegelt outputFileTracingRoot, deshalb liegt der Server
# unter frontend/.
COPY --from=build /repo/frontend/.next/standalone ./
# Die statischen Assets kopiert Next nicht selbst mit.
COPY --from=build /repo/frontend/.next/static ./frontend/.next/static

EXPOSE 3000

# Kein `npm run start`: im Standalone-Baum gibt es kein npm-Skript.
CMD ["node", "frontend/server.js"]
