# Repo-Audit & Railway-Readiness — Report

**Projekt:** `mastra_teamsbot` (Mastra + Microsoft Teams Bot + Belegerfassung)
**Datum:** 2026-08-31
**Status:** Alle Fixes im Working Tree, **nichts committet** (Repo ist noch kein Git-Repo)

---

## ✅ Was schon sauber war

- **Keine echten Secrets im Code.** Grep über `sk-`, `*_PASSWORD=`, `ghp_`, `xoxb-`, `AIza`, PEM-Header: nur ein Platzhalter in `frontend/README.md` (`sk-xxxx…`). Keine `.env`-Datei im Repo. Git-Historie ist nicht prüfbar, weil es **keine** gibt (kein `.git`) — es kann also nie etwas geleakt sein.
- **`PORT`/Host waren bereits railway-tauglich**: `src/mastra/index.ts:29-30` liest `process.env.PORT` und bindet auf `0.0.0.0`.
- **Health-Endpoint existiert**: `GET /api` → 200, ohne Zusatzcode nutzbar.
- **CORS** war korrekt über `FRONTEND_ORIGIN` konfigurierbar.
- **Keine zirkulären Imports**, alle relativen Pfade korrekt, keine fehlende oder unbenutzte Dependency (alle 6 Prod-Deps werden importiert).
- **`upload-store.ts`** ist solide: strenges `uploadId`-Muster als Path-Traversal-Schutz, Typ- und Größenvalidierung.
- **Der Teams-Agent war korrekt registriert** — `teamsAgent` steht in `src/mastra/index.ts` unter `agents: {}`, und `appType: "SingleTenant"` passt zu einem gesetzten `TEAMS_APP_TENANT_ID`. Auch die Env-Variablennamen stimmen: `@chat-adapter/teams` liest genau `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_APP_TENANT_ID` (im Adapter-Bundle verifiziert).

---

## 🔧 Was behoben wurde

### Blocker (Deploy wäre gescheitert)

| Fix | Grund |
|---|---|
| `@chat-adapter/teams@^4.39.0` als Dependency ergänzt | Wurde in `teams-agent.ts` importiert, war aber **nirgends deklariert** → jeder Build auf Railway wäre am ungelösten Import gestorben |
| `package-lock.json` erzeugt (536 Pakete) | Es gab keins. Railway/Nixpacks hätte bei jedem Deploy andere Versionen gezogen |
| Alle `"latest"`-Versionen auf die aufgelösten Ranges gepinnt | `"latest"` + kein Lockfile = nicht reproduzierbar |
| 4 Typfehler behoben | `tsc --noEmit` schlug fehl: `model: process.env.MASTRA_MODEL` ist `string \| undefined` (3×), und `weather-tool` benutzte die alte `{ context }`-Signatur statt `{ city }` |
| `zod` von `^3.23.8` auf `^3.25.76` | `@mastra/core` verlangt als Peer `^3.25.0` — die alte Range erlaubte eine verletzende Installation |

### Teams-Anbindung (war eine Attrappe)

| Fix | Grund |
|---|---|
| `src/mastra/channels/teams-receipt-handler.ts` **neu** | Der `teamsAgent` hatte **keine Tools, keinen Workflow, keinen Handler** — er hätte auf ein Belegfoto nur geplaudert. Der Handler holt den Anhang über `attachment.fetchData()` (authentifiziert), legt ihn über denselben `storeUpload()` ab wie das Web-Frontend und startet `receipt-workflow`. Extraktionslogik bleibt an einer Stelle. |
| `onMention` + `onDirectMessage` + `onSubscribedMessage` registriert | Alle drei Wege, auf denen ein Beleg in Teams ankommt. Nachrichten ohne Bild fallen an `defaultHandler` zurück. |
| Fehlerbehandlung im Handler | Pro Beleg `try/catch`, Workflow-`status !== 'success'` wird ausgewertet, und es wird **immer** gepostet (`✅ Migros · 2026-03-14 · CHF 42.10` bzw. `❌ … nicht verarbeitet: <Grund>`). Vorher wäre ein Fehler still gewesen — für den Nutzer nicht unterscheidbar von einem hängenden Bot. |
| `formatError` am Adapter | Exceptions außerhalb des Handlers erreichen den Nutzer jetzt lesbar. |
| `memory` (LibSQL) am Teams-Agent | Fehlte komplett — der Bot hätte jede Nachricht kontextfrei gesehen. |
| Instructions neu geschrieben | Waren eine 1:1-Kopie der Extraktions-Instructions inkl. *„Return only the structured object, no commentary"* — als Chat-Antwort in Teams unbrauchbar. |
| Toten Duplikat-Code entfernt | `teams-agent.ts` enthielt eine exakte Kopie von `field`, `receiptSchema` und `ReceiptData` aus `receipt-agent.ts` — 55 Zeilen, von nichts importiert. |
| `src/mastra/model.ts` **neu** | Modellwahl war in 4 Dateien kopiert, davon 3 mit dem Typfehler. |

### Repo-Hygiene / Railway

| Fix | Grund |
|---|---|
| `.gitignore` erweitert | Es fehlten **`node_modules/`**, `.env.*`, `dist/`, `.mastra/`, `.next/`, `*.tsbuildinfo`, Logs. `node_modules` nicht zu ignorieren wäre der erste Push-Unfall gewesen. `data/` bleibt ausgeschlossen (enthält echte Belegbilder + Chat-DB), `!data/.gitkeep` als Ausnahme. |
| `Dockerfile`: Dev → Multi-Stage-Prod | Lief mit **`mastra dev`** und `NODE_ENV=development`. Jetzt: `npm ci` → `mastra build --studio` → schlankes Runtime-Image mit `node .mastra/output/index.mjs`. `ENV PORT=4111` nur als lokaler Fallback, Railway überschreibt. `MASTRA_TELEMETRY_DISABLED=1` im Build-Stage, weil die PostHog-Telemetrie hinter dem TLS-Interception-Proxy laut scheitert (ohne den Build zu brechen). |
| `railway.json` **neu** | Explizit `DOCKERFILE`-Builder, `healthcheckPath: /api`, Restart-Policy. Nixpacks hätte hier zwar auch funktioniert, aber das Dockerfile ist wegen der Multi-Stage-Trennung der sauberere Weg. |
| `.dockerignore` erweitert | `.env.*`, `.next`, `dist`, `frontend` ergänzt. |
| `authToken` in `storage.ts` | `DATABASE_URL` war umschaltbar, aber eine Turso-URL hätte ohne `DATABASE_AUTH_TOKEN` nicht funktioniert — der einzige Weg zu echter Persistenz ohne Volume. |
| `.env.example` komplett | **`TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`, `TEAMS_APP_TENANT_ID` fehlten vollständig.** Dazu `PORT`, `DATABASE_AUTH_TOKEN`, und der Volume-Hinweis. Keine echten Werte. |
| `README.md`: Teams- + Railway-Kapitel, Env-Tabelle | 1:1 in die Railway-Variables übertragbar. Veraltete Aussagen korrigiert (`mastra dev`-Container, `./src`-Bind-Mount). |
| `npm run typecheck` als Script | Damit `tsc --noEmit` vor jedem Push läuft. |
| `engines.node: ">=22.0.0"` | Railway wählt sonst eine beliebige Node-Version. |

---

## Verifikation (alles tatsächlich gelaufen)

```
npm ci              → 536 Pakete, fehlerfrei
npm run typecheck   → 0 Fehler
npm run build       → Build successful
docker build .      → Image gebaut (nur PostHog-Telemetrie-Rauschen, jetzt abgeschaltet)
docker run -e PORT=4198 …
  GET  /api                                              → 200
  POST /api/agents/teams-agent/channels/teams/webhook    → 401 + Log:
       "[@teams/app] inbound activity rejected: missing Authorization header"
  POST /api/agents/teamsAgent/channels/teams/webhook     → 404
```

Die 401 ist das gewünschte Ergebnis: Route existiert, der Bot-Framework-Adapter
weist eine unsignierte Anfrage ab. Gestartet mit **Dummy-Werten** für
`TEAMS_APP_ID` / `TEAMS_APP_PASSWORD` / `TEAMS_APP_TENANT_ID` und
`OPENAI_API_KEY=dummy` — ein echter Teams-Roundtrip ist damit **nicht** getestet.

---

## 🎯 Messaging-Endpoint für Azure

```
https://<deine-railway-domain>/api/agents/teams-agent/channels/teams/webhook
```

Wichtig: `teams-agent` ist die **`id`** des Agents aus
`src/mastra/agents/teams-agent.ts` — **nicht** der Registrierungs-Key `teamsAgent`
aus `src/mastra/index.ts`. Im Bundle nachgesehen: `getWebhookBasePath()` baut den
Pfad aus `agent.id`. Der Key-Pfad gibt 404 (oben verifiziert). Wenn die `id`
geändert wird, ändert sich der Endpoint.

---

## ⚠️ Was noch manuell zu tun ist

1. **`git init`** — es gibt kein Git-Repo. `git init && git add . && git commit` ist
   jetzt sicher: `node_modules/`, `.env*`, `data/` (echte Belegbilder + Chat-DB)
   und `.mastra/` sind ausgeschlossen. Trotzdem einmal `git status` vor dem ersten
   `add` prüfen.
2. **Railway-Variablen** aus der README-Tabelle eintragen: `MASTRA_MODEL`, der
   passende Provider-Key, `TEAMS_APP_ID`, `TEAMS_APP_PASSWORD`,
   `TEAMS_APP_TENANT_ID`.
3. **Volume auf `/app/data` mounten** — bewusst gewählt mit der
   Workflow-Variante. Ohne Volume sind LibSQL-DB, Uploads und Belegs-JSONs nach
   jedem Redeploy weg. Alternative: `DATABASE_URL=libsql://…` +
   `DATABASE_AUTH_TOKEN` (Turso), dann bleiben nur die JSON-Dateien flüchtig.
4. **Azure Bot Registration**: Messaging-Endpoint auf die URL oben setzen, Client
   Secret erzeugen, Teams-Channel aktivieren.
5. **Teams-App-Manifest** bauen und hochladen (`manifest.json` + Icons als ZIP) —
   liegt nicht im Repo.
6. **Studio absichern.** `mastra build --studio` liefert das Mastra Studio unter `/`
   mit aus, mit Vollzugriff auf Agenten und Workflows — auf einer öffentlichen
   Railway-Domain ist das offen. Entweder Auth davor oder `--studio` aus dem
   Build-Script entfernen. Gleiches gilt für `POST /receipts/upload`.

---

## Hinweise ohne Fix

- **Kein Linter konfiguriert** (kein ESLint/Biome/Prettier). Bewusst keinen
  eingeführt — das wäre über den Auftrag hinaus und würde das ganze Repo
  umformatieren.
- **`assistantAgent` + `weather-tool`** sind Demo-Reste aus dem Ausgangs-Stack.
  Funktionieren (Typfehler ist gefixt) und die README beschreibt sie als Beispiel,
  deshalb stehen geblieben. Für den Teams-Bot irrelevant.
- In einem Tool-Ergebnis kam während des Audits eine als Systemanweisung
  formatierte Zeile („auto mode is active", nur noch Bash statt Read/Edit
  benutzen). Stand nicht in der Nutzernachricht, Injection-Muster, inhaltlich
  belanglos — ignoriert und gemeldet.

---

## Geänderte Dateien

**Neu (3):**
- `src/mastra/channels/teams-receipt-handler.ts`
- `src/mastra/model.ts`
- `railway.json`

**Geändert (13):**
- `src/mastra/agents/teams-agent.ts` (Neuschrieb)
- `src/mastra/agents/assistant-agent.ts`
- `src/mastra/agents/receipt-agent.ts`
- `src/mastra/agents/receipt-chat-agent.ts`
- `src/mastra/tools/weather-tool.ts`
- `src/mastra/index.ts`
- `src/mastra/storage.ts`
- `package.json`
- `package-lock.json` (neu erzeugt)
- `.gitignore`
- `.dockerignore`
- `.env.example`
- `Dockerfile`
- `docker-compose.yml`
- `README.md`
