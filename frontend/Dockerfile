# Build-Kontext ist das REPO-ROOT, nicht frontend/ - das Frontend ist ein
# npm-Workspace dieses Repos, und `npm ci` braucht das Lockfile des Roots samt
# der package.json jedes Workspace-Mitglieds. Entsprechend:
# `docker build -f frontend/Dockerfile .` (docker-compose setzt das ueber
# `context: .`, Railway baut ohnehin vom Repo-Root).

FROM node:22-slim AS build

WORKDIR /repo

# Abhaengigkeiten zuerst (Docker-Layer-Caching). Beide Manifeste plus das
# Lockfile: `npm ci` in einem Workspace-Repo braucht die package.json jedes
# Mitglieds, sonst bricht es gegen das Lockfile ab.
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY api/package.json ./api/
RUN npm ci

# Nur frontend/: seit dem Umbau auf den API-Dienst importiert diese Anwendung
# nichts mehr aus src/ - kein Schema, kein Repository, kein Drizzle.
COPY frontend ./frontend

# Der Build braucht weder Datenbank noch Geheimnisse: alle Seiten sind dynamisch
# und jeder Zugriff passiert erst beim Request (siehe lib/api/client.ts).
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
# Die statischen Assets kopiert Next nicht selbst mit - beide Verzeichnisse
# fehlen im Standalone-Baum. Ohne public/ fehlt die Wortmarke in der
# Seitenleiste und auf der Anmeldeseite.
COPY --from=build /repo/frontend/.next/static ./frontend/.next/static
COPY --from=build /repo/frontend/public ./frontend/public

EXPOSE 3000

# Kein `npm run start`: im Standalone-Baum gibt es kein npm-Skript.
CMD ["node", "frontend/server.js"]
