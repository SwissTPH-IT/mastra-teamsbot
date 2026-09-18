# API-Dienst, Abrechnungen und Entra-Auth — Implementierungsplan

**Stand:** 2026-09-18 · Basis: Commit `08d1371` · Status: Entwurf, nichts davon umgesetzt

---

## Ziel

Die Fachdaten (`app.*`) bekommen einen eigenen Dienst. Der Agent schreibt und liest
Belege nicht mehr direkt über Drizzle, sondern über HTTP-Endpunkte. Dazu kommen
Abrechnungen, eine Erinnerung nach drei stillen Tagen und ein Login im Web, nach
dem jeder nur noch seine eigenen Belege sieht.

**Nicht-Ziele.** Die Mastra-Datenbank (`mastra.*`, also `mastra_workflow_snapshot`,
Memory, Traces, Schedules) bleibt unangetastet — der Agent behält dafür seinen
eigenen Pool und seine direkte Verbindung. Bestehender Code wird umgehängt, nicht
entfernt. Die Dateiablage (`data/uploads/`) bleibt beim Agenten. Das Frontend liest
weiterhin direkt aus der Datenbank; es bekommt nur einen Login und einen echten
Scope.

## Zielbild

```
Teams ─► Agent (mastra-agent)                         API (receipt-api)
           ├─ receipt-review-workflow                   Hono, Port 4000
           │    persist-receipt ──── POST /receipts ──►  ├─ app.receipts
           ├─ Tools (list/search/update/reports) ─────►  ├─ app.expense_reports
           └─ Reminder-Cron (RUN_MODE=reminders) ─────►  ├─ app.users
                GET /reminders/due                       └─ eigener Pool
           mastra.*  ◄── eigener Pool, unverändert

Browser ─► Frontend (receipt-frontend)
             Entra-Login ─► resolveScope() ─► nur eigene Belege
             liest weiterhin direkt (read-only), eigener Pool
```

Vier Railway-Services statt drei: `mastra-agent`, `receipt-api`, `receipt-frontend`,
`Postgres`. Der Reminder läuft als Cron-Modus des **Agent**-Images, weil nur der
Agent nach Teams posten kann.

---

## Phase 1 — Identität mitschreiben

**Warum zuerst:** `message.author.userId` ist eine Bot-Framework-ID, kein
Entra-Objekt. Ein Browser-Token liefert `oid` und `tid`. Ohne Brücke findet der
angemeldete Nutzer seine in Teams erfassten Belege nicht wieder — und die
Information steht nur in der eingehenden Teams-Activity. Nachträglich ist sie nicht
rekonstruierbar. Das ist der einzige Schritt, der unabhängig vom Rest dringend ist.

Im Teams-Handler (`src/mastra/channels/teams-receipt-handler.ts`) bei **jeder**
Nachricht einen Upsert auf `app.users` ausführen: `teams_user_id`, `aad_object_id`,
`tenant_id`, `display_name` und die Conversation Reference für das spätere
proaktive Posten.

**Abnahme:** nach einer Teams-Nachricht steht eine Zeile in `app.users` mit
gefülltem `aad_object_id`.

---

## Phase 2 — Schema

Alles additiv, eine Migration (`npm run db:generate`), kein destruktiver Schritt.
Ergänzungen in `src/db/schema.ts`:

### `app.users` — die Identität, an der alles hängt

```ts
export const users = appSchema.table('users', {
  /** Die Bot-Framework-ID. Identisch mit receipts.user_id, deshalb hier PK. */
  teamsUserId: text('teams_user_id').primaryKey(),
  /** Entra oid. Die Brücke zum Browser-Login. Null, solange unbekannt. */
  aadObjectId: text('aad_object_id'),
  tenantId: text('tenant_id'),
  displayName: text('display_name'),
  /**
   * Conversation Reference für proaktive Nachrichten. Ohne sie kann der
   * Reminder-Cron niemanden anschreiben: es gibt keine eingehende Activity,
   * auf die er antworten könnte.
   */
  conversationRef: jsonb('conversation_ref'),
  lastRemindedAt: timestamp('last_reminded_at', { withTimezone: true }),
  reminderCount: integer('reminder_count').notNull().default(0),
  createdAt, updatedAt,
}, t => [uniqueIndex('users_aad_object_id_key').on(t.aadObjectId)]);
```

Der Unique-Index auf einer nullbaren Spalte ist zulässig — Postgres erlaubt
beliebig viele `NULL`.

### `app.expense_reports` — die Abrechnung ist die Reise

```ts
export const expenseReports = appSchema.table('expense_reports', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  purpose: text('purpose'),
  destination: text('destination'),
  tripFrom: date('trip_from'),
  tripTo: date('trip_to'),
  status: text('status').notNull().default('draft'),   // draft | closed
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt, updatedAt,
}, t => [
  index('expense_reports_user_idx').on(t.userId, t.createdAt.desc()),
  // Zielseite des zusammengesetzten FK unten.
  uniqueIndex('expense_reports_id_user_key').on(t.id, t.userId),
]);
```

Keine eigene `trips`-Tabelle: eine Reise hat heute genau eine Abrechnung. Wird das
später anders, wandern Titel/Zweck/Zeitraum in eine Reise-Entität und
`expense_reports` bekommt ein `trip_id` — ohne Datenverlust.

### `app.receipts` — eine Spalte

```ts
reportId: text('report_id'),   // NULL = Eingang, noch keiner Abrechnung zugewiesen

// Zusammengesetzter FK: die Abrechnung muss demselben Nutzer gehören wie der
// Beleg. Damit ist eine Zuweisung über Nutzergrenzen hinweg in der Datenbank
// unmöglich, nicht nur im Code.
foreignKey({
  columns: [t.reportId, t.userId],
  foreignColumns: [expenseReports.id, expenseReports.userId],
}).onDelete('set null'),

index('receipts_unassigned_idx').on(t.userId).where(sql`report_id is null`),
index('receipts_report_idx').on(t.reportId),
```

**1:n, keine Join-Tabelle.** Ein Beleg gehört zu höchstens einer Abrechnung; eine
m:n-Beziehung würde denselben Beleg auf zwei Abrechnungen erlauben, also doppelte
Rückerstattung möglich machen. Erst wenn ein Beleg fachlich aufgeteilt werden muss
(Bahnticket Hin/Rück auf zwei Reisen), wird daraus eine `report_items`-Tabelle mit
Betragsanteil.

### `receipts.user_id` wird ein echter Fremdschlüssel

Damit „ein Eintrag ist einem Nutzer zuweisbar“ nicht nur Konvention ist. In
derselben Migration, **vor** dem Constraint, die bestehenden Nutzer anlegen:

```sql
insert into app.users (teams_user_id)
select distinct user_id from app.receipts
on conflict do nothing;

alter table app.receipts
  add constraint receipts_user_fk
  foreign key (user_id) references app.users (teams_user_id);
```

### Ein Blick auf `saveReceipt()`

Der Upsert gegen `(user_id, file_hash)` überschreibt heute bedingungslos. Sobald
Belege in Abrechnungen liegen, darf ein erneut geschickter Beleg keine bereits
abgerechnete Zeile mehr verändern. Deshalb beim `onConflictDoUpdate` ein
`where: isNull(receipts.reportId)`; `returning()` kann dann leer sein, und die API
antwortet mit `409` plus dem Titel der Abrechnung, in der der Beleg schon liegt.

**Abnahme:** `npm run db:generate` erzeugt genau eine Migration, `npm run db:deploy`
läuft lokal gegen die Compose-Datenbank durch, `npm run typecheck` ist grün.

---

## Phase 3 — Der API-Dienst

### Struktur

Ein drittes npm-Workspace neben `frontend/`, nach demselben Muster:
`"workspaces": ["frontend", "api"]` im Root, und in `api/package.json` die
Abhängigkeit `"mastra-teamsbot": "file:.."`.

```
api/
  package.json           hono, @hono/node-server, @hono/zod-openapi, zod, drizzle-orm, pg
  tsconfig.json
  Dockerfile
  src/
    index.ts             Server, Routenregistrierung, /healthz
    auth.ts              Service-Token + Subject-Header
    routes/
      receipts.ts
      reports.ts
      reminders.ts
```

Die Repository-Schicht wird **nicht** kopiert: `src/db/receipts.ts` bleibt, wo sie
ist, und die API importiert sie. Dafür zwei Einträge in den `exports` des Roots:

```json
"exports": {
  "./db/schema": "./src/db/schema.ts",
  "./db/receipts": "./src/db/receipts.ts",
  "./db/reports": "./src/db/reports.ts"
}
```

Der Pool dort ist env-gesteuert (`DB_POOL_MAX`, Default 8) — im API-Service auf `5`
setzen. Eine kleine Railway-Postgres erlaubt rund 20 Verbindungen insgesamt: Agent 8,
API 5, Frontend 3, Rest für Migration und Prune.

Neu zu schreiben ist nur `src/db/reports.ts` (Abrechnungen, Zuweisung, Reminder-Query),
im Stil der bestehenden Datei: **jede Funktion nimmt `userId` als erstes
Pflichtargument** und hängt es an jedes `WHERE`. Ausnahme ist die Reminder-Query,
die bewusst nutzerübergreifend ist.

### Endpunkte

```
POST   /receipts                 bestätigter Beleg (Upsert user_id+file_hash)
GET    /receipts                 ?q= &from= &to= &assigned=true|false &limit=
GET    /receipts/:id
PATCH  /receipts/:id             merchant, receiptDate, totalAmount, currency,
                                 vatAmount, category, receiptType, paymentMethod

POST   /reports                  anlegen + offene Belege zuweisen (eine Transaktion)
GET    /reports                  eigene Abrechnungen
POST   /reports/:id/close

GET    /reminders/due            fällige Nutzer — nutzerübergreifend, nur Service-Token
POST   /reminders/:userId/snooze

GET    /healthz                  Prozess + select 1
```

Ein- und Ausgabeformen sind die vorhandenen: `candidateSchema` hinein,
`receiptViewSchema` (heute in `receipt-db-tools.ts`, wandert nach `api/`) hinaus.
`@hono/zod-openapi` erzeugt daraus Validierung und ein OpenAPI-Dokument.

`POST /reports` legt an und weist in **einer** Transaktion zu — nicht anlegen und
dann N Zuweisungen, die halb durchlaufen können:

```ts
{ title, purpose?, destination?, tripFrom?, tripTo?, assign: 'all-unassigned' | string[] }
```

### Autorisierung

Zwei Header, beide serverseitig gesetzt, keiner davon je vom Modell:

```
Authorization: Bearer <API_SERVICE_TOKEN>    wer ruft   (der Agent)
X-Subject-User: <teams userId>               für wen
```

Die Middleware in `auth.ts` prüft den Token, liest das Subject und legt es in den
Hono-Context. Die Route-Handler reichen es als erstes Argument in die
Repository-Funktionen — dieselbe Mechanik wie heute `requireUserId()`, nur einen
Prozess weiter.

`/reminders/*` akzeptiert **kein** Subject und ist damit der einzige
nutzerübergreifende Pfad. Diese Trennung ist wichtig: ein Nutzerkontext darf dort
nicht durchgereicht werden, sonst gibt es einen Weg um den Mandantenfilter herum.

### Betrieb

- **Dockerfile** analog `frontend/Dockerfile`: Build-Kontext ist das **Repo-Root**
  (die API importiert `src/db`), `COPY package.json package-lock.json`, dann
  `COPY api/package.json ./api/` und `COPY frontend/package.json ./frontend/`, damit
  `npm ci` gegen das Lockfile durchläuft.
- **docker-compose**: Service `api`, `depends_on: postgres`, Healthcheck auf
  `/healthz`, Port 4000.
- **Railway**: neuer Service in `.railway/railway.ts` mit
  `build.dockerfilePath: "api/Dockerfile"`, `deploy.healthcheckPath: "/healthz"`,
  `DATABASE_URL: Postgres.env.DATABASE_URL`, `API_SERVICE_TOKEN: preserve()`,
  `DB_POOL_MAX: "5"`. Beim Agenten kommen `API_URL` (privater Hostname, als Literal
  mit `${{...}}`-Syntax wie `MASTRA_URL` beim Frontend) und derselbe Token dazu.
- **Migrationen** bleiben, wo sie sind: im `CMD` des Agent-Images. Zwei neue
  Tabellen rechtfertigen keinen Umzug. Da alle Änderungen additiv sind, ist die
  Deploy-Reihenfolge der Services unkritisch.

**Abnahme:** `docker compose up --build` bringt vier Container hoch; `curl` gegen
alle Endpunkte liefert erwartete Antworten; ein Aufruf ohne Token gibt `401`, einer
mit fremdem Subject gibt `404` statt fremder Daten.

---

## Phase 4 — Die Mastra-Tools umbauen

Die Schemas bleiben **identisch**, nur die Rümpfe ändern sich. Damit ändern sich
weder die Agent-Instruktionen noch das beobachtbare Verhalten.

```ts
// vorher
execute: async ({ limit, from, to }, context) => {
  const userId = requireUserId(context);
  const rows = await listReceipts(userId, { limit, from, to });
  return { receipts: rows.map(toView), count: rows.length };
}

// nachher
execute: async ({ limit, from, to }, context) => {
  const userId = requireUserId(context);
  return api.get('/receipts', { userId, query: { limit, from, to } });
}
```

Ein kleiner Client (`src/mastra/api-client.ts`) setzt Basis-URL, Token und
`X-Subject-User`, wirft bei `>= 400` mit der Fehlermeldung aus dem Body — die geht
als Tool-Fehler an das Modell zurück, das sie dem Nutzer erklären kann.

Betroffen:

| Stelle | Änderung |
|---|---|
| `workflows/receipt-review-workflow.ts` → `persist-receipt` | `saveReceipt(...)` → `POST /receipts` |
| `tools/receipt-db-tools.ts` | vier Rümpfe → `fetch` |
| neu: `list-reports`, `close-report` | für den Textweg neben der Karte |
| `src/db/receipts.ts` | unverändert, verliert nur seine Aufrufer im Agenten |

`app.pending_reviews` bleibt beim Agenten und weiter direkt über Drizzle: das ist
Zustand des Review-Vorgangs, kein Fachdatum, und liegt fachlich neben dem
Workflow-Snapshot.

**Abnahme:** der komplette Teams-Flow (Foto → Karte → Bestätigen bzw. Dialog →
gespeichert) läuft unverändert; in der Datenbank landet dieselbe Zeile wie vorher.
`tests/suspend-resume.test.ts` bleibt grün.

---

## Phase 5 — Abrechnung und Erinnerung

### Die Regel

Ein Beleg wird bei der Erfassung **keiner** Abrechnung zugewiesen. Gefragt wird
erst, wenn es still wird:

```sql
select user_id, max(created_at) as letzter_beleg, count(*) as offene,
       min(receipt_date) as von, max(receipt_date) as bis
from app.receipts
where report_id is null
group by user_id
having max(created_at) < now() - (:reminder_after_days || ' days')::interval
```

Dazu die Bedingung aus `app.users`, dass `last_reminded_at` älter als dieselbe
Spanne ist und `reminder_count` unter dem Deckel liegt. Frist über
`REMINDER_AFTER_DAYS` (Default 3), Deckel über `REMINDER_MAX_COUNT` (Default 3) —
wie `MAX_CORRECTION_ROUNDS` im Review: irgendwann ist Nachfragen keine Hilfe mehr.
Wer null offene Belege hat, wird nie gefragt.

### Der Cron

`RUN_MODE=reminders` in `scripts/docker-entrypoint.sh` — dasselbe Muster wie der
Prune-Job, weil Start-Kommandos aus der Plattformkonfiguration in diesem Projekt
nachweislich nicht ankamen, Variablen aber schon. Neues Skript
`scripts/reminders.mjs`: `GET /reminders/due`, pro Nutzer eine Karte über die
gespeicherte Conversation Reference posten, `POST /reminders/:userId/snooze`.
Einmal täglich.

### Die Karte

> **Warst du unterwegs?** Seit 3 Tagen ist kein Beleg mehr gekommen. Du hast
> **7 offene Belege** vom 12.–15. September.
> `[ Reise abschliessen ]` `[ Noch unterwegs ]`

„Reise abschliessen“ ist ein Button mit `actionType: 'modal'` — derselbe Weg wie
„Anpassen“ bei der Belegkarte (`msteams: task/fetch`). Der Dialog fragt Titel,
Zweck, Ziel und Zeitraum, **Zeitraum vorbelegt** aus `min`/`max` der Belegdaten.
Absenden ruft `POST /reports` mit `assign: 'all-unassigned'`.

Handler-Registrierung analog `registerReceiptCardHandlers()` in `src/mastra/index.ts`,
mit eigenem Aktions-Präfix `report-reminder:` und der `userId` in der Aktions-ID.
Mastra registriert einen eigenen Catch-all-`onAction` und ignoriert fremde IDs —
Handler sind additiv, deshalb das Präfix.

Kommt danach ein neuer Beleg, ist er wieder unzugewiesen und der Zyklus beginnt von
vorn. Das fällt ohne Zusatzlogik heraus, weil die Regel nur auf `report_id is null`
schaut.

**Offener Punkt, vor dem Bau zu klären:** ob `@chat-adapter/teams` das Posten in
einen Thread **ohne** eingehende Activity anbietet, oder ob man dafür an den
Bot-Framework-Adapter darunter muss. Daran hängt, ob Phase 5 ein halber Tag ist
oder ein Umweg. Die Conversation Reference aus Phase 1 ist in beiden Fällen die
Voraussetzung.

**Abnahme:** ein Nutzer mit Belegen, deren `created_at` künstlich vier Tage
zurückliegt, bekommt beim Cron-Lauf genau eine Karte; ein zweiter Lauf am selben Tag
postet nichts; nach „Reise abschliessen“ liegen alle vorher offenen Belege an der
neuen Abrechnung.

---

## Phase 6 — Entra-Auth im Frontend

### Registrierung

Eine App-Registrierung `receipt-web` im Tenant (Web, Redirect-URI
`https://<host>/api/auth/callback/microsoft-entra-id`, Client Secret). Delegierte
Berechtigung `openid profile email` genügt — das Frontend ruft keine Graph-API.

Eine eigene API-Registrierung braucht es **noch nicht**: das Frontend liest direkt
aus der Datenbank, und der Agent spricht mit der API über den Service-Token. Sie
kommt dazu, sobald die Oberfläche schreiben soll.

### Login

NextAuth (Auth.js) mit dem Entra-Provider, Middleware schützt alle Routen ausser
`/api/healthz`. Aus dem Token werden `oid` und `tid` in die Session übernommen.

### Der Scope

Das ist der ganze Punkt, und er ist bereits vorbereitet:
`frontend/lib/receipts/scope.ts` ist der einzige Ort, der geändert wird. Alle
Abfragen — Liste, Detail, Zählung und **der CSV-Export** — nehmen den Scope als
erstes Pflichtargument und ziehen die Einschränkung automatisch mit, weil
`buildReceiptWhere()` die einzige Stelle ist, die daraus SQL macht.

```ts
export async function resolveScope(): Promise<ReceiptScope> {
  const session = await auth();
  if (!session?.oid) return { userIds: [] };        // leer = sieht nichts

  // Die Brücke: Entra-oid -> Teams-userId. Gefüllt beim Erfassen (Phase 1).
  const rows = await getDb().select({ id: users.teamsUserId })
    .from(users).where(eq(users.aadObjectId, session.oid));

  return { userIds: rows.map(r => r.id) };
}
```

Ein leerer Scope heisst „darf nichts sehen“, nicht „darf alles sehen“ — das setzt
`where.ts` schon heute so um (`sql\`false\``). Wer sich anmeldet, aber nie über
Teams erfasst hat, sieht deshalb eine leere Liste; dazu gehört ein erklärender
Hinweis in der UI statt einer wortlosen Nulltabelle.

**Abnahme:** ohne Login landet jeder Aufruf auf der Anmeldung; nach dem Login zeigt
`/belege` ausschliesslich eigene Belege; der CSV-Export derselben Ansicht enthält
keine fremde Zeile; ein direkter Aufruf von `/belege/<fremde-id>` gibt 404.

---

## Umgebungsvariablen

| Variable | Dienst | Zweck |
|---|---|---|
| `API_URL` | Agent | Basis-URL der API (Railway: privater Hostname) |
| `API_SERVICE_TOKEN` | Agent, API | gemeinsames Geheimnis, `preserve()` |
| `DB_POOL_MAX` | API | 5 |
| `REMINDER_AFTER_DAYS` | Agent | Default 3 |
| `REMINDER_MAX_COUNT` | Agent | Default 3 |
| `RUN_MODE` | Agent-Cron | `reminders` |
| `AUTH_SECRET` | Frontend | NextAuth |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_ISSUER` | Frontend | App-Registrierung |
| `NEXTAUTH_URL` | Frontend | öffentliche URL |

Alle neuen Variablen gehören in `.env.example` und in die Tabelle im `README.md`.

---

## Reihenfolge und Aufwand

| Phase | Inhalt | Aufwand | Danach lauffähig |
|---|---|---|---|
| 1 | Identität mitschreiben | ~1 h | ja, unverändertes Verhalten |
| 2 | Schema | ~0.5 T | ja, Spalten unbenutzt |
| 3 | API-Dienst | ~1.5 T | ja, noch ohne Aufrufer |
| 4 | Tools umhängen | ~1 T | ja, Verhalten identisch |
| 5 | Abrechnung + Reminder | ~1 T (+ offener Punkt) | neues Feature |
| 6 | Entra + Scope | ~1 T | Login aktiv |

Rund eine Woche. Jede Phase ist für sich deploybar; nach jeder muss der Teams-Flow
unverändert funktionieren.

**Phase 1 zuerst und unabhängig vom Rest** — falls der Plan liegen bleibt, ist das
die einzige Information, die verloren geht, wenn man sie nicht sammelt.

---

## Risiken

- **Proaktives Posten nach Teams** (Phase 5) ist der einzige technisch unklare
  Punkt. Klären, bevor Phase 5 beginnt.
- **Upsert auf abgerechnete Belege**: ohne das `where report_id is null` ändert ein
  erneut geschicktes Foto rückwirkend eine abgerechnete Position. In Phase 2
  mitmachen, nicht später.
- **Verbindungsbudget**: vier Prozesse auf einer kleinen Postgres. Summe der Pools
  im Blick behalten (8 + 5 + 3 = 16 von rund 20).
- **Zwei Lesepfade** auf `app.receipts` bleiben bestehen (API und Frontend). Das ist
  bewusst in Kauf genommen, solange das Frontend nur liest. Sobald es schreibt, geht
  es über die API — dann braucht es die API-Registrierung in Entra und einen
  On-Behalf-Of- oder Service-Token-Pfad.

## Ausdrücklich nicht Teil dieses Plans

Objektspeicher für die Belegbilder (bleibt `local:uploads/<id>` am Agent-Volume),
Aufräumen verwaister Uploads, Rollen und Berechtigungen über „eigene Belege“ hinaus,
Audit-Log über Fachdatenänderungen, Umstellung des Frontends auf die API, Entfernen
von `chatRoute()` / `extract-receipt-tool` / `POST /receipts/upload` (haben keinen
Aufrufer, stören aber nicht).
