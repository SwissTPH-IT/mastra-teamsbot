# Belegerfassung – Mastra + assistant-ui, vollständig in Docker

Drei Container, ein `docker compose up`:

| Service | Port | Was drin läuft |
|---|---|---|
| `postgres` | 5432 | Postgres 17: Schema `mastra` (von Mastra verwaltet) und Schema `app` (Fachdaten) |
| `mastra` | 4111 | Mastra-Server: Agenten, Workflows, Upload-Endpunkte, Studio-UI |
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

   Der `mastra`-Container führt vor dem Start `npm run db:deploy` aus – dieselbe
   Reihenfolge wie auf Railway (`preDeployCommand`). Die Schemas `app` und
   `mastra` entstehen dabei; nichts davon passiert beim ersten Request.

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
| `index.ts` | Mastra-Instanz: Agenten, Workflows, `chatRoute()`, Upload- und Health-Routen, CORS |
| `agents/receipt-chat-agent.ts` | Gesprächspartner des Frontends; ruft das Extraktions-Tool auf |
| `agents/receipt-agent.ts` | Vision-Agent + `receiptSchema` – tippt den Beleg ab, interpretiert nicht |
| `agents/receipt-correction-agent.ts` | Wendet eine Freitext-Korrektur auf einen Kandidatensatz an |
| `agents/assistant-agent.ts` | Beispiel-Agent aus dem Ausgangs-Stack (Wetter-Tool, Working Memory) |
| `agents/teams-agent.ts` | Der Microsoft-Teams-Bot: Adapter, Handler-Registrierung, DB-Tools, Instructions |
| `channels/teams-receipt-handler.ts` | Teams-Anhang → Review-Workflow; und die Antwort des Nutzers → `run.resume()` |
| `model.ts` | Eine Stelle für die Modellwahl (`MASTRA_MODEL`) |
| `workflows/receipt-extraction-workflow.ts` | Laden → Extrahieren → JSON schreiben. Unverändert, vom Web-Pfad benutzt |
| `workflows/receipt-review-workflow.ts` | Extraktion → Vorlage → (Korrektur → erneute Vorlage)\* → DB-Write |
| `receipts/candidate.ts` | Marker/Strings → typisierter Kandidatensatz; Beträge, Datum, Währung, Confidence |
| `tools/extract-receipt-tool.ts` | Brücke Chat → Extraktions-Workflow: löst `uploadId`s zu Pfaden auf |
| `tools/receipt-db-tools.ts` | `create-` / `list-` / `search-` / `update-receipt` |
| `tools/tool-context.ts` | `requireUserId()` – die einzige Stelle, an der ein Tool an die `user_id` kommt |
| `receipts/upload-store.ts` | Ablage der Uploads, Validierung der `uploadId` |
| `server/receipt-routes.ts` | `POST /receipts/upload`, `GET /receipts/:uploadId/file` |
| `server/health-route.ts` | `GET /healthz` – inklusive `SELECT 1` gegen die Datenbank |
| `storage.ts` | `PostgresStore` im Schema `mastra`, mit `disableInit: true` |

### Datenbank (`src/db/`, `drizzle/`, `scripts/`)

| Datei | Zweck |
|---|---|
| `db/pool.ts` | Der eine `pg.Pool`, den `PostgresStore` und Drizzle sich teilen |
| `db/schema.ts` | Drizzle-Schema, vollständig in `pgSchema('app')` |
| `db/receipts.ts` | Repository. Jede Funktion nimmt `userId` als erstes Pflichtargument |
| `drizzle.config.ts` | `schemaFilter: ['app']` – der Diff sieht die `mastra_*`-Tabellen nie |
| `drizzle/*.sql` | Generierte Migrationen, eingecheckt |
| `scripts/migrate.mjs` | Drizzle-Migrationen + `storage.init()`. Plain ESM, läuft im Laufzeit-Image |
| `scripts/prune.mjs` | Retention über `storage.prune()`. Hier stehen die Policies |
| `tests/suspend-resume.test.ts` | Suspendierter Run überlebt einen Instanz-Neuaufbau |

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

Eine Postgres-Instanz, zwei getrennte Schemas, ein `DATABASE_URL`:

```
Postgres
├── schema "mastra"   von PostgresStore verwaltet
│   ├── mastra_workflow_snapshot   ← hier wartet ein suspendierter Review-Run
│   ├── mastra_threads / _messages / _resources
│   └── mastra_ai_spans, …          (43 Tabellen)
├── schema "app"      von uns über Drizzle migriert
│   ├── receipts            die bestätigten Belege
│   └── pending_reviews     Zeiger Teams-Thread → runId
└── schema "drizzle"  Journal-Tabelle des Migrators
```

`public` bleibt leer. Das ist kein Kosmetikpunkt: der Drizzle-Migrations-Diff ist
über `schemaFilter: ['app']` (`drizzle.config.ts`) auf `app` begrenzt und sieht die
43 `mastra_*`-Tabellen deshalb nie – sonst schlüge er vor, sie zu droppen.

Die Belegbilder liegen weiterhin als Dateien unter `./data/uploads/`; in der
Datenbank steht nur die Referenz.

### Warum der Kandidatensatz in die Datenbank gehört

Zwischen „Beleg gelesen, bitte prüfen" und der Antwort des Nutzers können Stunden
liegen – und dazwischen passiert womöglich ein Railway-Deploy. Der Kandidatensatz
liegt deshalb im Workflow-State und damit in `mastra_workflow_snapshot`, nicht im
Gesprächsverlauf und nicht im Prozessspeicher. Sonst entschiede die Kontextlänge
darüber, ob eine Buchung korrekt landet.

Belegt wird das von `tests/suspend-resume.test.ts`: Run starten, suspendieren,
Mastra-Instanz komplett wegwerfen und neu bauen, aus dem Store fortsetzen – der
wiederhergestellte Kandidatensatz muss identisch sein.

### Ein Pool für alles

`PostgresStore` und Drizzle laufen über denselben `pg.Pool` (`src/db/pool.ts`).
Die Mastra-Referenz beschreibt genau diesen Fall für die Integration mit einem
ORM. Konsequenz: `store.close()` schliesst den Pool **nicht**, der Lifecycle liegt
bei uns.

Die Poolgrösse steht auf 8 (`DB_POOL_MAX`), nicht auf dem `PostgresStore`-Default
von 20: eine kleine Railway-Instanz erlaubt rund 20 Verbindungen insgesamt, und
davon brauchen auch der Migrations-Job und später das Frontend welche.

### Offene Lücke: Objektspeicher

Es gibt keinen. `receipts.file_reference` enthält vorerst
`local:uploads/<uploadId>` – den Pfad im Volume, in dem `upload-store.ts` die
Datei ohnehin ablegt. Binärdaten liegen bewusst **nicht** in der Datenbank.

Das Präfix-Schema (`local:` / später `s3:`) ist so gewählt, dass ein Umzug auf
einen Objektspeicher eine Datenmigration über eine Spalte wird und keine
Schema-Änderung. Bis dahin gilt: **ohne Volume auf `/app/data` sind die
Originalbilder nach jedem Redeploy weg**, auch wenn die Belegdaten in Postgres
überleben.

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

## Microsoft Teams: der Human-in-the-Loop-Flow

Schickt jemand in Teams ein Belegfoto, greift `channels/teams-receipt-handler.ts`
es ab, legt es über denselben `upload-store` wie das Web-Frontend ab und startet
den `receipt-review-workflow`. Der pausiert, legt die gelesenen Werte zur
Kontrolle vor und schreibt **erst nach Bestätigung** in die Datenbank.

```
Teams-Nachricht MIT Bildanhang
  └─► POST /api/agents/teams-agent/channels/teams/webhook
        └─► handleTeamsReceipt
              ├─ requestContext.set('userId', message.author.userId)
              ├─ attachment.fetchData()   Bytes holen (authentifiziert)
              ├─ sha256(bytes)            der Idempotenz-Key
              ├─ storeUpload()            Datei nach <RECEIPT_DATA_DIR>/uploads
              ├─ app.pending_reviews      Zeiger Thread → runId (vor dem Start!)
              └─ run.start()
                    └─ receipt-extraction-workflow   (unverändert)
                    └─ review-candidate  ──► suspend ──► Vorlage im Thread
                                                          "Migros · 2026-03-14 · CHF 42.10
                                                           passt? / Korrektur? / abbrechen?"

Teams-Nachricht OHNE Bildanhang
  └─► handleTeamsReceipt
        ├─ offener pending_review für diesen Thread?
        │    ja  → Antwort einordnen, run.resume()
        │           ├─ "passt"      → persist-receipt → app.receipts  ✅
        │           ├─ Korrektur    → Freitext anwenden → ERNEUT vorlegen
        │           └─ "abbrechen"  → nichts gespeichert
        └─ nein → Standard-Handler: der Agent antwortet, mit den DB-Tools
```

### Warum nach einer Korrektur nochmal nachgefragt wird

Eine Freitext-Korrektur wie „das Datum ist der 3., nicht der 8." muss geparst
werden, und dieses Parsing kann danebengehen. Die erneute Vorlage macht das
Ergebnis sichtbar, bevor es persistent wird. Nach `RECEIPT_MAX_CORRECTION_ROUNDS`
Runden (Default 3) bricht der Workflow ohne Speichern ab – dann ist nicht das
Parsing das Problem, sondern das Foto.

Die Einordnung der Antwort (`classifyReply` im Handler) ist bewusst
deterministisch und nicht per Modell: ob eine Buchung geschrieben wird, soll nicht
davon abhängen, wie ein LLM gerade gelaunt ist. Nur eine kurze, eindeutige
Zustimmung zählt als Zustimmung; „ja, aber das Datum stimmt nicht" ist eine
Korrektur. Im Zweifel eine Rückfrage zu viel statt einer falschen Buchung.

### Mandantentrennung

Die `user_id` kommt aus `message.author.userId` – aus dem signierten
Bot-Framework-Payload, serverseitig. Sie geht über den `RequestContext` (in
Mastra v1 heisst der Mechanismus so, nicht `runtimeContext`) an Workflow-Steps
und Agent-Tools.

```
message.author.userId
  └─ ctx.requestContext.set('userId', …)      im Channel-Handler
       ├─ run.start({ requestContext })        → Workflow-Steps
       └─ defaultHandler(...)                  → Agent → Tools
            └─ requireUserId(ctx)              src/mastra/tools/tool-context.ts
                 └─ listReceipts(userId, …)    src/db/receipts.ts
```

In **keinem** `inputSchema` eines Tools steht eine `userId` – das Modell kann sie
also nicht setzen. Jede Repository-Funktion nimmt sie als erstes Pflichtargument
und hängt sie an jedes `WHERE`, auch bei `updateReceipt`: eine fremde `receiptId`
trifft dadurch 0 Zeilen statt einer fremden Zeile. Bittet ein Nutzer den Agenten
um die Belege eines Kollegen, ist das keine Frage der Zurückhaltung des Modells –
es geht schlicht nicht.

### Die DB-Tools

Ein kleiner, eng typisierter Satz. Bewusst **kein** Tool, das beliebiges SQL
ausführt.

| Tool | Zweck |
|---|---|
| `create-receipt` | Schreibt einen bestätigten Datensatz. Upsert gegen `(user_id, file_hash)`, nie ein blindes Insert. |
| `list-receipts` | Die zuletzt erfassten Belege, optional auf einen Zeitraum eingegrenzt. |
| `search-receipts` | Suche nach Händler, Kategorie, Belegart, Referenznummer; Zeitraum und Betragsspanne optional. |
| `update-receipt` | Korrektur an einem bereits gespeicherten Beleg. |

Fachdaten laufen ausschliesslich über Drizzle. `store.db` / `store.pool` werden
nicht angefasst – die Referenz bezeichnet den Direktzugriff ausdrücklich als
Umgehung der Storage-Logik für Low-Level-Sonderfälle.

### Was der Web-Pfad davon merkt: nichts

Der bestehende `receipt-workflow` heisst jetzt `receipt-extraction-workflow` und
ist inhaltlich unverändert – er suspendiert nicht und schreibt weiterhin seine
JSON-Datei. Das Frontend und `extract-receipt-tool.ts` sprechen weiter ihn an.
Der Review-Workflow ruft ihn als ersten Schritt auf. Extraktionslogik gibt es
damit weiterhin an genau einer Stelle.

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

Drei Services pro Environment – zwei davon aus **demselben** Repo, unterschieden
nur durch ihre Config-Datei:

```
Railway-Projekt
├── Environment "staging"
│   ├── Postgres        Datenbank-Service, Backups an
│   ├── mastra-agent    Repo → railway.json         (Default)
│   └── mastra-prune    Repo → railway.prune.json   (Settings → Config File)
└── Environment "production"
    └── … dieselben drei, eigene Datenbank
```

| | `mastra-agent` | `mastra-prune` |
|---|---|---|
| Config-Datei | `railway.json` (Default) | `/railway.prune.json` (explizit setzen!) |
| Start | Server | `scripts/prune.mjs`, terminiert |
| `preDeployCommand` | Migrationen | – |
| Health-Check | `/healthz` | – |
| Cron | – | `0 3 * * *` |
| Volume | `/app/data` | – |
| `DATABASE_URL` | `${{ Postgres.DATABASE_URL }}` | dieselbe Referenz |

### 1. Postgres anlegen

**New → Database → PostgreSQL.** Danach in den Variablen des Agent-Service:

```
DATABASE_URL = ${{ Postgres.DATABASE_URL }}
```

Als **Referenz-Variable**, nicht als kopierter Connection String: Railway
rotiert das Passwort beim Neuaufbau des Datenbank-Service, ein kopierter String
wird dann still ungültig.

Unter **Postgres → Settings → Backups** die Backups aktivieren. Ohne das ist eine
versehentliche Migration nicht rückholbar.

### 2. Agent-Service

Baut über das `Dockerfile` (siehe `railway.json`). Wichtig sind drei Einträge
dort:

| Feld | Wert | Warum |
|---|---|---|
| `startCommand` | `node .mastra/output/scripts/migrate.mjs && node .mastra/output/index.mjs` | Migration **und** Start in einem Befehl – siehe unten |
| `healthcheckPath` | `/healthz` | prüft zusätzlich die Datenbankverbindung. **Nicht** `/health` – der Pfad ist von Mastra belegt und liefert `{"success":true}` ohne DB-Prüfung |

#### Warum die Migration im `startCommand` steht und nicht im `preDeployCommand`

Railways `preDeployCommand` ist der lehrbuchmässige Ort dafür. In diesem Projekt hat
er sich als unzuverlässig erwiesen: konfiguriert, aber im Deploy nicht ausgeführt.
Der Agent startete gegen eine leere Datenbank und crashte in einer Endlosschleife
mit `relation "mastra.mastra_schedules" does not exist` – Mastra liest beim Boot
`mastra_schedules` und `mastra_workflow_definitions` und bricht ab, wenn sie fehlen.

Das Tückische daran: laut Railway-Doku stoppt ein **fehlgeschlagener** Pre-Deploy den
Deploy („the deployment will not proceed"). Ein **übersprungener** stoppt nichts – der
Fehler taucht erst im Runtime-Log des crashenden Containers auf, nicht als
Deploy-Fehler.

Im `startCommand` ist die Reihenfolge dagegen erzwungen: `&&` startet den Server nur,
wenn die Migration mit Exit-Code 0 durchgelaufen ist. Sie läuft dadurch bei jedem
Container-Start erneut – das ist unkritisch, weil beide Teile idempotent sind
(Drizzle führt nur neue Migrationen aus, `storage.init()` legt nur fehlende Tabellen
an) und zusammen rund eine Sekunde brauchen. Nebeneffekt: es ist derselbe Befehl wie
in `docker-compose.yml`, lokal und auf Railway läuft also dasselbe.

Der `healthcheckTimeout` steht auf 180 Sekunden, damit die Migration beim allerersten
Deploy (43 Tabellen plus Indizes) nicht in den Health-Check läuft.

Der Agent selbst migriert nichts: `PostgresStore` läuft mit `disableInit: true`
(`src/mastra/storage.ts`). Das ist das in der
[Mastra-Referenz](https://mastra.ai/reference/storage/postgresql) beschriebene
CI/CD-Muster.

Ein **Volume auf `/app/data`** mounten – dort liegen die Belegbilder. Ohne das
sind sie nach jedem Redeploy weg, auch wenn die Belegdaten in Postgres
überleben. Siehe „Offene Lücke: Objektspeicher".

### 3. Prune-Service (Cron)

Zweiter Service aus **demselben Repo** – gleiches Image, anderer Start-Befehl.

> **Der Punkt, an dem es sonst schiefgeht:** Railway liest per Default die
> `railway.json` im Repo-Root, und laut Doku gilt *„Configuration defined in code
> will always override values from the dashboard."* Ein zweiter Service aus
> demselben Repo würde also `startCommand` und `healthcheckPath` des Agenten
> erben – und ein im Dashboard gesetzter
> Start-Befehl würde daran **nichts** ändern. Der Cron-Job startete dann den
> Server statt des Prune-Skripts, liefe nie zu Ende, und weil Railway einen
> neuen Lauf überspringt, solange der vorherige noch läuft, liefe er genau
> einmal und danach nie wieder.

Deshalb hat dieser Service eine eigene Config-Datei, `railway.prune.json`:

```json
{
  "deploy": {
    "startCommand": "node .mastra/output/scripts/prune.mjs",
    "cronSchedule": "0 3 * * *",
    "restartPolicyType": "NEVER"
  }
}
```

Keine Migration im Start-Befehl (die gehört zum Agent-Deploy, nicht zu jedem
nächtlichen Lauf), kein `healthcheckPath` (der Job hört auf keinem Port), und
`restartPolicyType: NEVER` – ein Cron-Job soll terminieren, nicht neu starten.
`scripts/prune.mjs` schliesst seinen Pool im `finally`, beendet sich also sauber,
wie Railway es für Cron-Services verlangt.

**Einrichtung:**

1. **New → GitHub Repo**, dasselbe Repo wählen. Service z. B. `mastra-prune` nennen.
2. **Settings → Config-as-code / Railway Config File:** `/railway.prune.json`
   eintragen. Der Pfad ist absolut ab Repo-Root und folgt dem Root Directory
   **nicht** – das steht so in der Railway-Monorepo-Doku.
3. **Variables:** `DATABASE_URL = ${{ Postgres.DATABASE_URL }}`, optional
   `RETENTION_SPANS` / `RETENTION_SNAPSHOTS` / `RETENTION_MESSAGES`.
4. Kein Volume, keine Domain, kein Health-Check.

Der Zeitplan steht in `cronSchedule` und damit im Repo, nicht im Dashboard – aus
demselben Grund: Config-as-Code gewinnt ohnehin. Railways Minimum ist 5 Minuten,
Zeitzone ist UTC.

Ungebremst wachsen zu lassen ist keine Option: die Span-Tabellen wachsen um
Grössenordnungen schneller als die Belege – pro Beleg fallen Dutzende Spans an,
pro Beleg entsteht genau eine Zeile in `app.receipts`. Die Policies stehen in
`scripts/prune.mjs` und sind über `RETENTION_*` justierbar, ohne den Agenten neu
zu deployen. `app.receipts` hat bewusst keine Retention.

### 4. Staging und Produktion

Zwei Railway-Environments mit je **eigenem** Postgres-Service. Der Ablauf:

1. Nach `staging` deployen. `preDeployCommand` fährt die Migration dort.
2. Prüfen: `GET /healthz` muss `{"status":"ok","database":"up"}` liefern, und ein
   Beleg muss in Teams durchlaufen (Vorlage → „passt" → Zeile in `app.receipts`).
3. Erst dann nach `production` promoten.

Eine Migration, die auf Staging durchläuft, läuft auf Produktion durch – solange
beide Environments dieselbe Postgres-Major-Version fahren. Der lokale
Compose-Service ist deshalb ebenfalls auf `postgres:17-alpine` festgenagelt.

**Reihenfolge beim allerersten Deploy:** zuerst Postgres, dann `mastra-agent`
(dessen `startCommand` legt beide Schemas an), erst danach `mastra-prune`.
Der Prune-Job auf einer leeren Datenbank würde sonst über fehlende Tabellen
stolpern.

**Hinweis zur Haltbarkeit:** Railway markiert Config-as-Code (`railway.json`) als
deprecated, mit Umstellung auf Infrastructure as Code bis **1. Dezember 2026**.
Bis dahin funktioniert das Setup wie beschrieben; danach werden beide Dateien in
das neue Format zu überführen sein.

### Umgebungsvariablen

| Variable | Pflicht | Zweck |
|---|---|---|
| `DATABASE_URL` | **ja** | Postgres. Auf Railway als `${{ Postgres.DATABASE_URL }}` |
| `MASTRA_MODEL` | ja | Modell als `<provider>/<model>`, muss vision-fähig sein |
| `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | ja (der passende) | Key des Providers aus `MASTRA_MODEL` |
| `TEAMS_APP_ID` | für Teams | App-(Client-)ID der Azure Bot Registration |
| `TEAMS_APP_PASSWORD` | für Teams | Client Secret dazu |
| `TEAMS_APP_TENANT_ID` | für Teams | Tenant-ID; Pflicht wegen `appType: "SingleTenant"` |
| `DB_POOL_MAX` | nein | Poolgrösse, Default 8. Höher nur mit grösserer Instanz |
| `RECEIPT_MAX_CORRECTION_ROUNDS` | nein | Korrekturrunden vor dem Abbruch, Default 3 |
| `RETENTION_SPANS` / `_SNAPSHOTS` / `_MESSAGES` | nein | nur für den Prune-Service |
| `PORT` | nein | setzt Railway selbst; lokal Default 4111 |
| `MASTRA_HOST` | nein | Default `0.0.0.0` |
| `RECEIPT_DATA_DIR` | nein | Verzeichnis für die Belegbilder; Default `/app/data` |
| `FRONTEND_ORIGIN` | nur Variante B | CORS-Origins, Komma-getrennt |
| `TEST_DATABASE_URL` | nur für Tests | ohne die Variable wird der Suspend/Resume-Test übersprungen |
| `MASTRA_TELEMETRY_DISABLED` | nein | `1` schaltet anonyme Telemetrie ab |

Dieselbe Liste steht als Vorlage in `.env.example`.

### Vor dem Livegang beachten

- **Studio ist ungeschützt.** `mastra build --studio` liefert sie unter `/` mit
  aus und sie hat vollen Zugriff auf Agenten und Workflows – inklusive der
  Möglichkeit, einen Workflow mit beliebigem RequestContext zu starten. Damit
  wäre die Mandantentrennung umgehbar. Für eine öffentliche Railway-Domain
  entweder Auth davorlegen oder ohne `--studio` bauen.
- **Der Upload-Endpunkt ist offen** (`POST /receipts/upload`).
- **Die Belegbilder liegen im Dateisystem**, nicht in Postgres. Ein Redeploy ohne
  Volume verliert sie.
