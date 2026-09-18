# Build-Kontext ist das REPO-ROOT, nicht api/ - der Dienst ist ein
# npm-Workspace dieses Repos und importiert das Drizzle-Schema und das
# Repository aus src/db (ueber die exports-Map der Root-package.json).
# Entsprechend: `docker build -f api/Dockerfile .`

FROM node:22-slim

WORKDIR /repo
ENV NODE_ENV=production

# Abhaengigkeiten zuerst (Docker-Layer-Caching). Beide anderen Manifeste muessen
# mit: `npm ci` in einem Workspace-Repo verlangt die package.json jedes
# Mitglieds, sonst bricht es gegen das Lockfile ab. `--workspace api` laesst
# die Abhaengigkeiten des Agenten (Mastra) und des Frontends (Next) draussen.
COPY package.json package-lock.json ./
COPY api/package.json ./api/
COPY frontend/package.json ./frontend/
RUN npm ci --omit=dev --workspace api

# Nur die zwei Verzeichnisse, die der Dienst wirklich braucht. Das ist
# gleichzeitig die dokumentierte Grenze: was hier nicht steht, gehoert dem
# Agenten. candidate.ts importiert den Extraktions-Typ als `import type` -
# das verschwindet beim Transpilieren, @mastra/core wird also nicht gebraucht.
COPY src/db ./src/db
COPY src/mastra/receipts ./src/mastra/receipts
COPY api ./api

# Fallback fuer lokale Laeufe. Auf Railway setzt die Plattform PORT und
# ueberschreibt das hier; api/src/index.ts liest process.env.PORT.
ENV PORT=4000
EXPOSE 4000

# tsx statt eines Bundle-Schritts: der Dienst ist eine Handvoll Dateien, und
# tsx loest die extensionlosen Imports in src/db auf, an denen Nodes eigenes
# Type-Stripping scheitert.
CMD ["/repo/node_modules/.bin/tsx", "api/src/index.ts"]
