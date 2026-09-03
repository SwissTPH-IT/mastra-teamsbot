# Belegerfassung – Mastra + Microsoft Teams, vollständig in Docker

Drei Container, ein `docker compose up`:

| Service | Port | Was drin läuft |
|---|---|---|
| `postgres` | 5432 | Postgres 17: Schema `mastra` (von Mastra verwaltet) und Schema `app` (Fachdaten) |
| `mastra` | 4111 | Mastra-Server: Agenten, Workflows, Teams-Webhook, Upload-Endpunkte, Studio-UI |
| `frontend` | 3000 | Next.js: die Weboberfläche auf die erfassten Belegdaten |

**Zwei Zugänge mit zwei Zielgruppen** – und der Unterschied prägt das Datenmodell:

| | Wer | Was | Mandantentrennung |
|---|---|---|---|
| **Microsoft Teams** | Endnutzer | Beleg einreichen, Vorschlag bestätigen oder korrigieren | hart verdrahtet: jeder sieht nur seine eigenen Belege |
| **Weboberfläche** | Finanzteam | die erfassten Daten ansehen, durchsuchen, als CSV exportieren | bewusst keine: übergreifende Ansicht, der Nutzer ist Datenfeld, nicht Berechtigungsgrenze |

Erfasst wird ausschliesslich über Teams. Die Weboberfläche ist **read-only** und
hat **kein Login** – siehe `frontend/README.md`, Abschnitt „Kein Login".

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
   | http://localhost:3000/belege | **Belegtabelle** – die Sicht des Finanzteams |
   | http://localhost:4111 | Mastra Studio – Agenten/Workflow direkt testen, Traces ansehen |
   | http://localhost:4111/swagger-ui | REST-API aller Endpunkte |

   Belege einreichen geht nur über Teams (siehe „Microsoft Teams: der
   Human-in-the-Loop-Flow"). Ohne eingerichtete Bot-Registration bleibt die
   Tabelle leer – zum Ausprobieren lässt sich der Extraktions-Workflow im Studio
   direkt starten.

## Der Ablauf

```
Teams ─► POST /api/agents/teams-agent/channels/teams/webhook
           └─ handleTeamsReceipt ─► receipt-review-workflow
                                      ├─ Bild ablegen        → data/uploads/<uploadId>
                                      ├─ receipt-extraction-workflow (verschachtelt)
                                      │    ├─ load-receipt      Datei → Data-URL
                                      │    ├─ extract-receipt   Vision-Agent → receiptSchema
                                      │    └─ write-receipt-json data/receipts/<id>.json
                                      ├─ review-candidate ─► suspend ─► Vorlage im Thread
                                      │      ▲                              │
                                      │      └──── run.resume() ◄───────────┘
                                      └─ persist-receipt    → app.receipts

Browser ─► /belege ──────────► app.receipts (lesend, Drizzle, serverseitig)
           /api/export ──────► app.receipts (lesend, gestreamt als CSV)
           /api/belege/<id>/bild ─► GET /receipts/<uploadId>/file  (Proxy auf den Agenten)
```

Der entscheidende Punkt: **das Bild reist nie durch den Chat-Kontext.** Die Datei
wird abgelegt und weitergegeben wird nur die `uploadId`. Nur der Vision-Agent
innerhalb des Workflows sieht die Bilddaten – einmal, pro Beleg.

Und: **in die Datenbank wird nichts geschrieben, bevor der Nutzer bestätigt hat.**
Kein Schreiben-und-später-aufräumen. Der Kandidatensatz liegt bis dahin im
Workflow-State und damit in `mastra_workflow_snapshot`.

Die Weboberfläche greift auf denselben Datenbestand zu, aber ausschliesslich
lesend und über eine eigene Query-Schicht (`frontend/lib/receipts/`). Sie
importiert das Drizzle-Schema aus `src/db/schema.ts` und dupliziert es nicht;
Migrationen bleiben hier.

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

Read-only-Oberfläche auf `app.receipts`: Tabelle, Detailansicht, CSV-Export.
Details in `frontend/README.md`; hier nur die Einordnung.

| Datei | Zweck |
|---|---|
| `app/belege/page.tsx` | Die Tabelle: Filterleiste + Ergebnis, Server Component |
| `app/belege/[id]/page.tsx` | Detailansicht eines Belegs inkl. Belegbild |
| `app/api/export/route.ts` | CSV, serverseitig gestreamt, dieselben Filter wie die Ansicht |
| `app/api/healthz/route.ts` | Health-Check inklusive `SELECT 1` |
| `app/api/belege/[id]/bild/route.ts` | Proxy auf `GET /receipts/:uploadId/file` beim Agenten |
| `lib/db/client.ts` | Eigener kleiner Pool (Default 3) + Drizzle |
| `lib/receipts/scope.ts` | `ReceiptScope` – der Einhängepunkt für eine spätere Berechtigung |
| `lib/receipts/where.ts` | `buildReceiptWhere()` – die **eine** Stelle für Filterlogik |
| `lib/receipts/queries.ts` | `listReceipts` / `countReceipts` / `getReceipt` / `streamReceipts` |
| `lib/export/formats.ts` | Format-Registry, damit `.xlsx` später daneben passt |

Drei Dinge, die dabei absichtlich so sind:

- **Das Schema wird importiert, nicht dupliziert.** `frontend/` ist ein
  npm-Workspace dieses Repos und importiert `mastra-teamsbot/db/schema` (also
  `src/db/schema.ts`). Es führt keine Migrationen aus, definiert keine Tabelle
  und greift nie auf `mastra_*` zu.
- **Kein assistant-ui, kein Chat, kein LLM-Aufruf.** Auf dieser Seite des Flows
  gibt es keinen AI-Use-Case; eine Chat-Oberfläche zwischen Nutzer und Tabelle
  macht das Filtern langsamer, nicht schneller. Die Datenzugriffsschicht ist von
  der UI getrennt, damit AI-Funktionen später ein Zusatz wären.
- **Kein Login.** Bewusst noch nicht – siehe `frontend/README.md` und
  „Vor dem Livegang beachten".

Damit sind zwei Backend-Bausteine derzeit **ohne Aufrufer**: `chatRoute()` mit
`receiptChatAgent`/`extract-receipt-tool` und `POST /receipts/upload`. Beide sind
weiterhin über Studio und die REST-API erreichbar und bleiben stehen, bis
entschieden ist, ob der Web-Upload-Pfad zurückkommt. `GET /receipts/:uploadId/file`
wird gebraucht – die Detailansicht holt das Belegbild darüber.

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
davon brauchen auch der Migrations-Job und das Frontend welche.

Das Frontend hat einen **eigenen** Pool (`frontend/lib/db/client.ts`,
`FRONTEND_DB_POOL_MAX`, Default 3) – es ist ein anderer Prozess. Es teilt
lediglich die Instanz und das Schema, nicht den Pool.

### Offene Lücke: Objektspeicher

Es gibt keinen. `receipts.file_reference` enthält vorerst
`local:uploads/<uploadId>` – den Pfad im Volume, in dem `upload-store.ts` die
Datei ohnehin ablegt. Binärdaten liegen bewusst **nicht** in der Datenbank.

Das Präfix-Schema (`local:` / später `s3:`) ist so gewählt, dass ein Umzug auf
einen Objektspeicher eine Datenmigration über eine Spalte wird und keine
Schema-Änderung. Bis dahin gilt: **ohne Volume auf `/app/data` sind die
Originalbilder nach jedem Redeploy weg**, auch wenn die Belegdaten in Postgres
überleben.

## Wie der Browser an die Daten kommt

Gar nicht direkt: die Weboberfläche liest die Datenbank **serverseitig** (Server
Components und Route Handler). Es gibt keinen Datenbankzugriff aus dem Browser
und keinen Connection String im Client-Bundle.

Mit dem Mastra-Server spricht das Frontend nur noch an einer Stelle – für das
Belegbild, das als Datei im Datenverzeichnis des Agenten liegt und nicht in
Postgres. Das läuft über den eigenen Route Handler
`/api/belege/<id>/bild` und damit serverseitig; `MASTRA_URL` ist bewusst keine
`NEXT_PUBLIC_*`-Variable und landet nicht im Browser.

Damit ist `FRONTEND_ORIGIN` / `server.cors` in `src/mastra/index.ts` für den
Normalbetrieb ohne Funktion – kein Browser ruft Mastra direkt auf. Die Freigabe
bleibt stehen, weil sie beim direkten Arbeiten gegen Studio und die REST-API
nützlich ist.

## Entwickeln

**Frontend mit Hot-Reload** (Postgres und Mastra bleiben im Container):

```bash
npm install                  # im REPO-ROOT: frontend/ ist ein npm-Workspace
docker compose up postgres mastra -d
cd frontend
cp .env.example .env.local   # DATABASE_URL=…localhost:5432…, MASTRA_URL=http://localhost:4111
npm run dev                  # http://localhost:3000
```

`npm install` läuft im **Repo-Root**, nicht in `frontend/`. Ein Install in
`frontend/` legt dort ein eigenes `node_modules` an und hebelt das Hoisting aus,
auf dem die einzelne `drizzle-orm`-Kopie beruht – das Frontend importiert das
Drizzle-Schema aus `src/db/schema.ts`, und zwei Kopien der Bibliothek ergeben
zwei nominell verschiedene Typwelten.

**Mastra-Code ändern:** `npm install && npm run dev` außerhalb von Docker gibt
Hot-Reload (`mastra dev`). Das Docker-Image ist ein Produktions-Build
(`mastra build` → `node .mastra/output/index.mjs`), dort also `docker compose up --build`.

**Vor jedem Push:**

```bash
npm run typecheck   # tsc --noEmit                (Repo-Root)
npm run build       # mastra build --studio       (Repo-Root)

cd frontend
npm run typecheck && npm run build && npm run lint
```

## Grenzen und Stellschrauben

- **Dateitypen:** JPG, PNG, WebP, GIF. PDF ist absichtlich nicht dabei – der
  Workflow würde es als Bildteil an das Modell geben, was die meisten Provider
  ablehnen. Erweitern in `src/mastra/receipts/upload-store.ts`
  (`ALLOWED_UPLOAD_TYPES`) und `MIME_BY_EXT` in `server/receipt-routes.ts`.
- **Maximalgröße:** 15 MB pro Bild, an drei Stellen konsistent gehalten
  (`upload-store.ts`, `server.bodySizeLimit`, Teams-Handler).
- **Kein Auth.** Studio, Upload-Endpunkt und die Weboberfläche sind offen. Für
  alles außerhalb von localhost gehört ein Reverse Proxy mit Authentifizierung
  davor.
- **Kein Objektspeicher.** Die Belegbilder liegen als Dateien im
  Datenverzeichnis des Agenten, deshalb der Bild-Proxy im Frontend statt eines
  direkten Links.
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

### Extraktion an genau einer Stelle

Der bestehende `receipt-workflow` heisst `receipt-extraction-workflow` und ist
inhaltlich unverändert – er suspendiert nicht und schreibt weiterhin seine
JSON-Datei. Der Review-Workflow ruft ihn als ersten Schritt auf,
`extract-receipt-tool.ts` ruft ihn direkt. Extraktionslogik gibt es damit an
genau einer Stelle, und sie suspendiert nur dort, wo es einen Kanal für die
Rückfrage gibt (Teams).

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

Vier Services pro Environment – drei davon aus **demselben** Repo, unterschieden
nur durch ihre Config-Datei:

```
Railway-Projekt
├── Environment "staging"
│   ├── Postgres          Datenbank-Service, Backups an
│   ├── mastra-agent      Repo → railway.json            (Default)
│   ├── mastra-prune      Repo → railway.prune.json      (Settings → Config File)
│   └── receipt-frontend  Repo → railway.frontend.json   (Settings → Config File)
└── Environment "production"
    └── … dieselben vier, eigene Datenbank
```

| | `mastra-agent` | `mastra-prune` | `receipt-frontend` |
|---|---|---|---|
| Config-Datei | `railway.json` (Default) | `/railway.prune.json` (explizit setzen!) | `/railway.frontend.json` (explizit setzen!) |
| Dockerfile | `Dockerfile` | `Dockerfile` | `frontend/Dockerfile` |
| Start | Server | `scripts/prune.mjs`, terminiert | Next-Server |
| Migrationen | ja, im `CMD` | – | **nein** |
| Health-Check | `/healthz` | – | `/api/healthz` |
| Cron | – | `0 3 * * *` | – |
| Volume | `/app/data` | – | – |
| `DATABASE_URL` | `${{ Postgres.DATABASE_URL }}` | dieselbe Referenz | dieselbe Referenz |

Die explizite Config-Datei ist bei den letzten beiden **nicht optional**: Railway
liest per Default die `railway.json` im Repo-Root, und Config-as-Code überschreibt
Dashboard-Einstellungen. Ohne eigene Datei würde das Frontend den Start-Befehl und
den Health-Check-Pfad des Agenten erben. Mehr dazu unter „3. Prune-Service".

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

#### Warum die Migration im Dockerfile steht

Der lehrbuchmässige Ort wäre Railways `preDeployCommand`. In diesem Projekt wurde
er konfiguriert und **nicht ausgeführt**; derselbe Befehl als `startCommand` in der
`railway.json` ebenfalls nicht. Der Agent startete beide Male gegen eine leere
Datenbank und crashte in einer Endlosschleife mit
`relation "mastra.mastra_schedules" does not exist` – Mastra liest beim Boot
`mastra_schedules` und `mastra_workflow_definitions` und bricht ab, wenn sie fehlen.

Das Tückische: laut Railway-Doku stoppt ein **fehlgeschlagener** Pre-Deploy den
Deploy („the deployment will not proceed"). Ein **übersprungener** stoppt nichts, und
eine nicht angewandte Config meldet sich gar nicht. Der Fehler taucht erst im
Runtime-Log des crashenden Containers auf, nie als Deploy-Fehler.

Deshalb steht die Migration im **`CMD` des Dockerfiles**:

```dockerfile
CMD ["sh", "-c", "node .mastra/output/scripts/migrate.mjs && node .mastra/output/index.mjs"]
```

Das ist der Standardbefehl des Images und greift auch dann, wenn die
Plattform-Config gar nicht angewandt wird. `railway.json` setzt denselben Befehl
noch einmal als `startCommand` – identische Zeile, kein Widerspruch, nur zwei
Wege zum selben Ergebnis.

Das `&&` erzwingt die Reihenfolge im Prozess statt in der Plattform: der Server
startet nur, wenn die Migration mit Exit-Code 0 durchgelaufen ist. Sie läuft dadurch
bei jedem Container-Start – unkritisch, weil beide Teile idempotent sind (Drizzle
führt nur neue Migrationen aus, `storage.init()` legt nur fehlende Tabellen an) und
zusammen rund eine Sekunde brauchen.

Der `healthcheckTimeout` steht auf 180 Sekunden, damit die Migration beim allerersten
Deploy (43 Tabellen plus Indizes) nicht in den Health-Check läuft.

#### Datenbank von aussen migrieren (Notfall)

Hängt die Datenbank leer fest und du willst nicht auf einen Deploy warten: am
Postgres-Service **Settings → Networking → Public Networking** einschalten. Railway
legt dann einen TCP-Proxy an und befüllt `DATABASE_PUBLIC_URL`. Damit lokal:

```bash
DATABASE_URL="<DATABASE_PUBLIC_URL>" npm run db:deploy
```

Die interne `DATABASE_URL` (`*.railway.internal`) ist von aussen **nicht**
erreichbar – nur aus dem Railway-Netz.

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

### 4. Frontend-Service

Vierter Service aus **demselben Repo**, mit eigener Config-Datei.

1. **New → GitHub Repo**, dasselbe Repo. Service z. B. `receipt-frontend` nennen.
2. **Settings → Railway Config File:** `/railway.frontend.json`. Der Pfad ist
   absolut ab Repo-Root. Ohne diesen Eintrag erbt der Service `railway.json` und
   startet den Agenten.
3. **Variables:**

   ```
   DATABASE_URL = ${{ Postgres.DATABASE_URL }}
   MASTRA_URL   = http://${{ mastra-agent.RAILWAY_PRIVATE_DOMAIN }}:4111
   FRONTEND_DB_POOL_MAX = 3
   ```

   `DATABASE_URL` als **Referenz** auf denselben Postgres-Service – keine zweite
   Datenbank, kein kopierter Connection String. `MASTRA_URL` über Private
   Networking: gebraucht wird sie nur für die Belegbilder, die als Dateien am
   Volume des Agenten liegen.
4. Kein Volume, keine Migration. Health-Check `/api/healthz` (steht in der
   Config-Datei) – er prüft die Datenbankverbindung mit.

**Zur Erreichbarkeit:** die Oberfläche ist unauthentifiziert und zeigt die
Belegdaten **aller** Nutzer. In diesem Setup steht sie unter der generierten
`*.up.railway.app`-Domain – das ist eine bewusste Entscheidung für diese Version
(kleines, festes Finanzteam) und in `frontend/README.md` begründet. Wer die URL
hat, sieht die Daten. Die Vorkehrungen dafür, dass Auth später ohne Umbau
nachrüstbar ist, stehen ebenfalls dort (`lib/receipts/scope.ts`).

**Poolgrösse ernst nehmen:** eine kleine Railway-Postgres-Instanz erlaubt rund 20
Verbindungen. Agent 8 (`DB_POOL_MAX`) + Frontend 3 (`FRONTEND_DB_POOL_MAX`) +
Migrations-/Prune-Job lassen Luft; zwei Environments auf **einer** Instanz wären
schon zu viel – deshalb pro Environment eine eigene Datenbank.

### 5. Staging und Produktion

Zwei Railway-Environments mit je **eigenem** Postgres-Service. Der Ablauf:

1. Nach `staging` deployen. `preDeployCommand` fährt die Migration dort.
2. Prüfen: `GET /healthz` muss `{"status":"ok","database":"up"}` liefern, und ein
   Beleg muss in Teams durchlaufen (Vorlage → „passt" → Zeile in `app.receipts`).
3. Erst dann nach `production` promoten.

Eine Migration, die auf Staging durchläuft, läuft auf Produktion durch – solange
beide Environments dieselbe Postgres-Major-Version fahren. Der lokale
Compose-Service ist deshalb ebenfalls auf `postgres:17-alpine` festgenagelt.

**Reihenfolge beim allerersten Deploy:** zuerst Postgres, dann `mastra-agent`
(dessen `startCommand` legt beide Schemas an), erst danach `mastra-prune` und
`receipt-frontend`. Der Prune-Job auf einer leeren Datenbank würde über fehlende
Tabellen stolpern, und das Frontend migriert nichts – es erwartet `app.receipts`
als bereits vorhanden.

**Hinweis zur Haltbarkeit:** Railway markiert Config-as-Code (`railway.json`) als
deprecated, mit Umstellung auf Infrastructure as Code bis **1. Dezember 2026**.
Bis dahin funktioniert das Setup wie beschrieben; danach werden alle drei Dateien
in das neue Format zu überführen sein.

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
| `FRONTEND_ORIGIN` | nein | CORS-Origins für direkte Browser-Aufrufe an Mastra; im Normalbetrieb ohne Funktion |
| `TEST_DATABASE_URL` | nur für Tests | ohne die Variable wird der Suspend/Resume-Test übersprungen |
| `MASTRA_TELEMETRY_DISABLED` | nein | `1` schaltet anonyme Telemetrie ab |

Dieselbe Liste steht als Vorlage in `.env.example`.

Für den Frontend-Service (`frontend/.env.example`):

| Variable | Pflicht | Zweck |
|---|---|---|
| `DATABASE_URL` | **ja** | Dieselbe Instanz. Auf Railway `${{ Postgres.DATABASE_URL }}` |
| `MASTRA_URL` | für Belegbilder | Adresse des Agent-Service. Auf Railway `http://${{ mastra-agent.RAILWAY_PRIVATE_DOMAIN }}:4111` |
| `FRONTEND_DB_POOL_MAX` | nein | Poolgrösse des Frontends, Default 3 |
| `PORT` | nein | setzt Railway selbst; lokal 3000 |

### Vor dem Livegang beachten

- **Studio ist ungeschützt.** `mastra build --studio` liefert sie unter `/` mit
  aus und sie hat vollen Zugriff auf Agenten und Workflows – inklusive der
  Möglichkeit, einen Workflow mit beliebigem RequestContext zu starten. Damit
  wäre die Mandantentrennung umgehbar. Für eine öffentliche Railway-Domain
  entweder Auth davorlegen oder ohne `--studio` bauen.
- **Der Upload-Endpunkt ist offen** (`POST /receipts/upload`).
- **Die Belegbilder liegen im Dateisystem**, nicht in Postgres. Ein Redeploy ohne
  Volume verliert sie.
- **Die Weboberfläche ist unauthentifiziert** und zeigt die Belegdaten aller
  Nutzer – die Mandantentrennung des Teams-Bots gilt dort ausdrücklich nicht. Für
  diese Version akzeptiert (siehe „4. Frontend-Service" und
  `frontend/README.md`). Wenn der Nutzerkreis wächst, ist das die erste Baustelle;
  `frontend/lib/receipts/scope.ts` ist die dafür vorgesehene Stelle.
