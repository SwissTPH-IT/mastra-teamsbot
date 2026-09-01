# Belegerfassung – Mastra + assistant-ui, vollständig in Docker

Zwei Container, ein `docker compose up`:

| Service | Port | Was drin läuft |
|---|---|---|
| `mastra` | 4111 | Mastra-Server: Agenten, `receipt-workflow`, Upload-Endpunkte, Studio-UI |
| `frontend` | 3000 | Next.js + [assistant-ui](https://www.assistant-ui.com/): das Endnutzer-Interface |

Ein Endnutzer öffnet **http://localhost:3000**, zieht ein Belegfoto ins Eingabefeld
und sieht die extrahierten Daten als Karte im Chat. Nichts weiter zu konfigurieren.

## Voraussetzungen

- Docker + Docker Compose (kein lokales Node.js nötig)
- Ein API-Key für einen Modell-Provider mit Vision-Fähigkeit

## Setup

1. `.env` aus der Vorlage erstellen:

   ```bash
   cp .env.example .env
   ```

2. In `.env` den API-Key eintragen. `MASTRA_MODEL` muss ein **Vision-Modell** sein –
   der Extraktionsagent liest Bilder (z. B. `openrouter/google/gemini-2.5-flash`,
   `openai/gpt-4o-mini`, `anthropic/claude-sonnet-4-5`).

3. Starten:

   ```bash
   docker compose up --build
   ```

4. Öffnen:

   | URL | Zweck |
   |---|---|
   | http://localhost:3000 | **Belegerfassung** – das Interface für Endnutzer |
   | http://localhost:4111 | Mastra Studio – Agenten/Workflow direkt testen, Traces ansehen |
   | http://localhost:4111/swagger-ui | REST-API aller Endpunkte |

## Der Ablauf

```
Browser (assistant-ui)
  │  1. Bild anhängen
  ├─────────► POST /api/uploads            (Next-Proxy)
  │           └─► POST /receipts/upload   (Mastra)  → Datei nach /app/data/uploads
  │                                                     ← { uploadId }
  │  2. Nachricht senden – im Text steht nur
  │     [Beleg] datei="…" uploadId="…"
  ├─────────► POST /api/chat               (Next-Proxy)
  │           └─► POST /chat/receiptChatAgent (Mastra, chatRoute)
  │                 └─► Tool "extractReceipt"
  │                       └─► receipt-workflow
  │                             ├─ load-receipt      Datei → Data-URL
  │                             ├─ extract-receipt   Vision-Agent → receiptSchema
  │                             └─ write-receipt-json /app/data/receipts/<id>.json
  │  3. Tool-Ergebnis wird als Belegkarte gerendert
  ▼
```

Der entscheidende Punkt: **das Bild reist nie durch den Chat-Kontext.** Der Upload
passiert separat, in der Nachricht steht nur die `uploadId`. Nur der Vision-Agent
innerhalb des Workflows sieht die Bilddaten – einmal, pro Beleg.

Mehrere Belege in einer Nachricht sind vorgesehen: der Agent übergibt alle
`uploadId`s in einem Tool-Aufruf, der Workflow läuft pro Bild einmal, und für
jedes Ergebnis erscheint eine eigene Karte.

## Was ist enthalten

### Mastra (`src/mastra/`)

| Datei | Zweck |
|---|---|
| `index.ts` | Mastra-Instanz: Agenten, Workflow, `chatRoute()`, Upload-Routen, CORS |
| `agents/receipt-chat-agent.ts` | Gesprächspartner des Frontends; ruft das Extraktions-Tool auf |
| `agents/receipt-agent.ts` | Vision-Agent + `receiptSchema` – tippt den Beleg ab, interpretiert nicht |
| `agents/assistant-agent.ts` | Beispiel-Agent aus dem Ausgangs-Stack (Wetter-Tool, Working Memory) |
| `agents/teams-agent.ts` | Der Microsoft-Teams-Bot: Adapter, Handler-Registrierung, Instructions |
| `channels/teams-receipt-handler.ts` | Teams-Anhang → `upload-store` → `receipt-workflow` → Antwort im Thread |
| `model.ts` | Eine Stelle für die Modellwahl (`MASTRA_MODEL`) |
| `workflows/receipt-workflow.ts` | Laden → Extrahieren → JSON schreiben |
| `tools/extract-receipt-tool.ts` | Brücke Chat → Workflow: löst `uploadId`s zu Pfaden auf |
| `receipts/upload-store.ts` | Ablage der Uploads, Validierung der `uploadId` |
| `server/receipt-routes.ts` | `POST /receipts/upload`, `GET /receipts/:uploadId/file` |
| `storage.ts` | LibSQL-Dateispeicher im Volume `./data` |

### Frontend (`frontend/`)

| Datei | Zweck |
|---|---|
| `app/assistant.tsx` | Runtime, Attachment-Adapter, Thread mit Beleg-Karte statt Tool-Log |
| `app/api/chat/route.ts` | Proxy auf `chatRoute()` – streamt SSE unverändert durch |
| `app/api/uploads/route.ts` | Proxy für den Datei-Upload |
| `app/api/uploads/[uploadId]/file/route.ts` | Proxy für die Bildvorschau |
| `lib/receipt-uploads.ts` | `AttachmentAdapter`: lädt beim Anhängen hoch, setzt den Marker |
| `components/receipt/receipt-card.tsx` | Die Ergebniskarte (Kopf, Positionen, Summen, Hinweise) |
| `components/receipt/receipt-tool-ui.tsx` | Wählt Karte vs. Standard-Tool-Anzeige |
| `components/receipt/receipt-message-text.tsx` | Macht aus der Markerzeile eine Bildvorschau |
| `components/assistant-ui/*` | Von `npx assistant-ui@latest create` erzeugt, Texte eingedeutscht |

`frontend/.agents/` und `frontend/.claude/` sind Referenzdokumentation, die der
assistant-ui-Scaffolder mitbringt. Für den Betrieb irrelevant (per `.dockerignore`
ausgeschlossen), zum Weiterbauen aber nützlich.

## Persistenz

Alles liegt im Host-Verzeichnis `./data`:

```
data/
├── mastra.db          Threads, Messages, Memory, Traces
├── uploads/           Rohbelege, Dateiname = uploadId
└── receipts/          Ergebnis-JSONs, ein File pro Beleg
```

Überlebt `docker compose down` und Rebuilds. Zum Zurücksetzen des Chatverlaufs
`data/mastra.db*` löschen, zum Aufräumen der Bilder `data/uploads/`.

## Zwei Wege vom Browser zu Mastra

**Variante A – Proxy (aktiv, Standard).** Der Browser spricht nur mit dem
Frontend; die Route Handler unter `app/api/*` reden serverseitig mit
`http://mastra:4111`. Kein CORS, Mastra muss nicht nach außen exponiert sein,
und die Adresse ist eine reine Laufzeitvariable (`MASTRA_URL`).

**Variante B – direkt.** So beschreibt es die
[Mastra-Doku](https://mastra.ai/integrations/agentic-ui/assistant-ui): der
Browser ruft `http://localhost:4111/chat/receiptChatAgent` selbst auf. Dafür ist
`server.cors` in `src/mastra/index.ts` bereits auf `FRONTEND_ORIGIN` gesetzt. In
`app/assistant.tsx` dann:

```tsx
new AssistantChatTransport({ api: process.env.NEXT_PUBLIC_MASTRA_URL! })
```

Nachteil: `NEXT_PUBLIC_*` wird in den Build eingebacken, ein Adresswechsel
erfordert also einen Rebuild. Deshalb ist A voreingestellt.

## Entwickeln

**Frontend mit Hot-Reload** (Mastra bleibt im Container):

```bash
docker compose up mastra
cd frontend
cp .env.example .env.local   # MASTRA_URL=http://localhost:4111
npm install && npm run dev
```

**Mastra-Code ändern:** `npm install && npm run dev` außerhalb von Docker gibt
Hot-Reload (`mastra dev`). Das Docker-Image ist ein Produktions-Build
(`mastra build` → `node .mastra/output/index.mjs`), dort also `docker compose up --build`.

**Vor jedem Push:**

```bash
npm run typecheck   # tsc --noEmit
npm run build       # mastra build --studio
```

## Grenzen und Stellschrauben

- **Dateitypen:** JPG, PNG, WebP, GIF. PDF ist absichtlich nicht dabei – der
  Workflow würde es als Bildteil an das Modell geben, was die meisten Provider
  ablehnen. Erweitern in `src/mastra/receipts/upload-store.ts`
  (`ALLOWED_UPLOAD_TYPES`) und `frontend/lib/receipt-uploads.ts`.
- **Maximalgröße:** 15 MB pro Bild, an drei Stellen konsistent gehalten
  (`upload-store.ts`, `server.bodySizeLimit`, `receipt-uploads.ts`).
- **Kein Auth.** Studio und Upload-Endpunkt sind offen. Für alles außerhalb von
  localhost gehört ein Reverse Proxy mit Authentifizierung davor.
- **Ein Prozess, eine SQLite-Datei.** Für echte Nebenläufigkeit `@mastra/pg`
  statt `@mastra/libsql`.
- **Uploads werden nie gelöscht.** `data/uploads/` wächst monoton; ein
  Aufräum-Job wäre der nächste Schritt.

## Microsoft Teams

Zweiter Weg zum gleichen Workflow: `teamsAgent` hängt über
[`@chat-adapter/teams`](https://chat-sdk.dev/adapters/official/teams) an
`channels.adapters.teams`. Schickt jemand in Teams ein Belegfoto, greift
`channels/teams-receipt-handler.ts` es ab, legt es über denselben `upload-store`
wie das Web-Frontend ab und startet den `receipt-workflow`. Die Antwort landet als
Text im Thread. Nachrichten *ohne* Bild gehen an den Standard-Handler, also an das
Modell.

```
Teams-Nachricht mit Bildanhang
  └─► POST /api/agents/teams-agent/channels/teams/webhook
        └─► handleTeamsReceipt
              ├─ attachment.fetchData()      Bytes holen (authentifiziert)
              ├─ storeUpload()               Datei nach <RECEIPT_DATA_DIR>/uploads
              ├─ receipt-workflow            load → extract → write-json
              └─ thread.post(summary)        "✅ Migros · 2026-03-14 · CHF 42.10"
```

**Messaging-Endpoint für die Azure Bot Registration:**

```
https://<deine-domain>/api/agents/teams-agent/channels/teams/webhook
```

Der Pfadteil `teams-agent` ist die `id` des Agents aus
`src/mastra/agents/teams-agent.ts` – **nicht** der Key `teamsAgent` aus
`src/mastra/index.ts`. Wird die `id` geändert, ändert sich der Endpoint.

Der Adapter ist auf `appType: "SingleTenant"` konfiguriert, `TEAMS_APP_TENANT_ID`
ist damit Pflicht. Für eine Multi-Tenant-App beides gemeinsam umstellen.

## Deployment auf Railway

Railway baut über das `Dockerfile` (siehe `railway.json`): Multi-Stage-Build,
`mastra build --studio`, Start mit `node .mastra/output/index.mjs`. Der Server
liest `process.env.PORT` und bindet auf `0.0.0.0` – beides Voraussetzung dafür,
dass Railways Proxy den Container erreicht. Health-Check ist `GET /api`.

1. Repo mit Railway verbinden.
2. Alle Variablen aus der Tabelle unten in **Variables** eintragen.
3. Ein **Volume** auf `/app/data` mounten – sonst sind LibSQL-DB, Uploads und
   Belegs-JSONs nach jedem Redeploy weg. Alternativ `DATABASE_URL` auf eine
   Turso-URL zeigen lassen (`libsql://…` + `DATABASE_AUTH_TOKEN`).
4. Die von Railway vergebene Domain als Messaging-Endpoint in Azure eintragen
   (Pfad siehe oben).

### Umgebungsvariablen

| Variable | Pflicht | Zweck |
|---|---|---|
| `MASTRA_MODEL` | ja | Modell als `<provider>/<model>`, muss vision-fähig sein |
| `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | ja (der passende) | Key des Providers aus `MASTRA_MODEL` |
| `TEAMS_APP_ID` | für Teams | App-(Client-)ID der Azure Bot Registration |
| `TEAMS_APP_PASSWORD` | für Teams | Client Secret dazu |
| `TEAMS_APP_TENANT_ID` | für Teams | Tenant-ID; Pflicht wegen `appType: "SingleTenant"` |
| `PORT` | nein | setzt Railway selbst; lokal Default 4111 |
| `MASTRA_HOST` | nein | Default `0.0.0.0` |
| `DATABASE_URL` | nein | LibSQL-Ziel; Default `file:/app/data/mastra.db` |
| `DATABASE_AUTH_TOKEN` | nur bei Turso | Token für eine remote libsql-URL |
| `RECEIPT_DATA_DIR` | nein | Verzeichnis für Uploads/JSONs; Default `/app/data` |
| `FRONTEND_ORIGIN` | nur Variante B | CORS-Origins, Komma-getrennt |
| `MASTRA_TELEMETRY_DISABLED` | nein | `1` schaltet anonyme Telemetrie ab |

Dieselbe Liste steht als Vorlage in `.env.example`.

### Vor dem Livegang beachten

- **Studio ist ungeschützt.** `mastra build --studio` liefert sie unter `/` mit
  aus und sie hat vollen Zugriff auf Agenten und Workflows. Für eine öffentliche
  Railway-Domain entweder Auth davorlegen oder ohne `--studio` bauen.
- **Der Upload-Endpunkt ist offen** (`POST /receipts/upload`).
- **Ein Prozess, eine SQLite-Datei.** Für mehrere Replicas `@mastra/pg` oder
  Turso statt einer lokalen Datei.
