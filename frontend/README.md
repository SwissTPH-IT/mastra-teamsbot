# Belege – Weboberfläche

Read-only-Oberfläche auf die erfassten Belegdaten: ansehen, durchsuchen,
als CSV exportieren. Sie ist die Sicht des Finanzteams **über alle Nutzer**.

Erfasst wird nichts hier. Belege kommen über Microsoft Teams herein, der
Human-in-the-Loop-Flow des Agenten legt sie dem Nutzer vor, und erst nach
seiner Bestätigung entsteht eine Zeile in `app.receipts`. Diese Oberfläche
liest diese Zeilen – nicht mehr.

## Was sie bewusst nicht ist

- **Kein Upload.** Der Weg läuft über Teams.
- **Kein Chat, kein assistant-ui, kein LLM-Aufruf.** Auf dieser Seite des Flows
  gibt es keinen AI-Use-Case, und eine Chat-Oberfläche zwischen Nutzer und
  Tabelle macht das Filtern langsamer, nicht schneller. Die Datenzugriffsschicht
  (`lib/receipts/`) ist von der UI getrennt, damit AI-Funktionen später ein
  Zusatz sein können und keine Neuentwicklung.
- **Nicht schreibend.** Es gibt keine Bearbeitungsfunktion und keinen
  schreibenden Endpunkt. Korrekturen laufen über den Teams-Flow, wo der
  Korrektur-Agent und die Bestätigungsrunde sitzen.
- **Nicht der Eigentümer des Schemas.** Keine Migrationen, keine Tabellen-
  definition. Beides gehört dem Agent-Repo.

## Kein Login – und warum das hier vertretbar war

Diese Oberfläche ist **unauthentifiziert**. Es gibt kein Login, keine Rollen,
keine Session und keinen Entra-ID-Anschluss. Das ist eine bewusste Entscheidung
für diese Version, nicht ein Vergessen:

- Die Zielgruppe ist ein kleines, festes Finanzteam.
- Der Zugang wird über die Erreichbarkeit geregelt, nicht über Identität.
- Auth wäre in dieser Version der grössere Teil der Arbeit gewesen, ohne dass
  der Funktionsumfang (lesen und exportieren) davon abhängt.

**Was das heisst:** wer die URL hat, sieht die Belegdaten aller Nutzer. Die
Mandantentrennung des Teams-Bots gilt hier ausdrücklich nicht – das Frontend ist
eine übergreifende Ansicht mit dem Nutzer als Datenfeld, nicht als
Berechtigungsgrenze.

**Damit Auth ohne Umbau nachrüstbar bleibt**, gibt es drei Vorkehrungen:

1. `lib/receipts/scope.ts` – jede Abfrage nimmt einen `ReceiptScope` als erstes
   Pflichtargument. Er bedeutet heute immer „alle Nutzer". Kommt Auth dazu, wird
   nur `resolveScope()` ersetzt; kein Aufrufer ändert sich.
2. `lib/receipts/where.ts` – die **einzige** Stelle, an der aus Scope und Filtern
   eine WHERE-Bedingung wird. Keine Filterlogik in Komponenten.
3. Der Export-Endpunkt nutzt dieselbe Query-Schicht wie die Ansicht
   (`streamReceipts` → `buildReceiptWhere`). Ein späterer Berechtigungsfilter
   kann daran nicht vorbeilaufen.

## Aufbau

```
app/
  belege/page.tsx            Tabelle: Filterleiste + Ergebnis (Server Component)
  belege/[id]/page.tsx       Detailansicht, inkl. Belegbild
  api/export/route.ts        CSV, serverseitig gestreamt
  api/healthz/route.ts       Health-Check inkl. Datenbank
  api/belege/[id]/bild/      Proxy auf das Belegbild beim Agenten
lib/
  db/client.ts               eigener kleiner Pool + Drizzle
  receipts/scope.ts          ReceiptScope        ← Einhängepunkt für Auth
  receipts/query-params.ts   URL ⇄ Abfrage
  receipts/where.ts          buildReceiptWhere   ← die eine Filterstelle
  receipts/queries.ts        list / count / get / stream
  receipts/format.ts         Intl-Formatierung (de-CH, Europe/Zurich)
  export/csv.ts              CSV-Serialisierung
  export/formats.ts          Format-Registry (heute nur csv)
```

Die gesamte UI besteht aus **Server Components**; es gibt keine
`"use client"`-Komponente außer der Fehlergrenze (`app/belege/error.tsx`, die
muss eine sein). Möglich ist das, weil der komplette Filter-, Sortier- und
Seitenzustand in der URL steht: die Filterleiste ist ein `GET`-Formular, die
Spaltenköpfe und die Paginierung sind Links. Damit sind Ansichten teilbar, der
Zurück-Button funktioniert, und es gibt keinen Client-Zustand, der mit der URL
synchron gehalten werden müsste.

Aus demselben Grund **kein TanStack Table**: Paginierung, Sortierung und
Filterung laufen serverseitig, es bleibt nichts, was eine Tabellen-Bibliothek
leisten könnte. Käme später clientseitige Spaltenauswahl oder Row-Selection
dazu, wäre sie ein Zusatz an einer Stelle.

### Das Schema wird importiert, nicht dupliziert

`app`-Schema und Migrationen gehören dem Agent-Repo (`src/db/schema.ts`,
`drizzle/`). Das Frontend importiert es:

```ts
import { receipts } from "mastra-teamsbot/db/schema";
```

Möglich über einen **npm-Workspace** im Repo-Root (`"workspaces": ["frontend"]`)
plus `transpilePackages: ['mastra-teamsbot']` in `next.config.ts`. Zwei Gründe
für diesen Weg statt eines Pfad-Alias auf `../src/db`:

- Ein Import ausserhalb der Next-Projektwurzel bräuchte
  `experimental.externalDir`, und das ist seit Next 15 defekt
  ([vercel/next.js#81177](https://github.com/vercel/next.js/issues/81177)).
- npm hoistet `drizzle-orm` dadurch nach `/node_modules` – es gibt genau **eine**
  Kopie. Bei zwei Kopien kämen die Tabellenobjekte aus der einen und der
  Drizzle-Client aus der anderen; das sind nominell verschiedene Typen und fällt
  erst beim Query-Bauen auf.

Auf `mastra_*`-Tabellen greift das Frontend nie zu. Das ist Framework-Zustand
von Mastra, kein Datenmodell.

## Entwickeln

```bash
docker compose up postgres -d          # im Repo-Root
npm install                            # im Repo-Root – Workspace-Install
DATABASE_URL=postgres://mastra:mastra@localhost:5432/mastra \
  npm run db:deploy                    # im Repo-Root, legt die Schemas an

cd frontend
cp .env.example .env.local
npm run dev                            # http://localhost:3000
```

`npm install` läuft im **Repo-Root**, nicht in `frontend/` – es ist ein
Workspace. Ein `npm install` in `frontend/` legt ein eigenes `node_modules` an
und hebelt genau das Hoisting aus, auf dem die einzelne `drizzle-orm`-Kopie
beruht.

Vor dem Pushen: `npm run typecheck && npm run build && npm run lint`.

## Zeitzonen und Zahlen

Die zwei Fallen, die hier zählen:

- **`receipt_date` ist ein `date`, `created_at` ein `timestamptz`.** Ein
  Kalendertag durch eine Zeitzonenkonvertierung zu schicken verschiebt ihn –
  `"2026-01-01"` wird als UTC-Mitternacht gelesen. Belegdaten werden deshalb
  direkt aus dem `YYYY-MM-DD`-String formatiert, nur Zeitstempel gehen durch
  `Intl.DateTimeFormat` mit `timeZone: 'Europe/Zurich'`. Siehe
  `lib/receipts/format.ts`.
- **Der Zeitraumfilter liegt auf dem Belegdatum, nicht auf dem
  Erfassungszeitpunkt.** Ein Beleg vom 31.12. kann am 3.1. erfasst worden sein,
  und für die Buchhaltung ist der 31.12. der relevante Tag.
- **`numeric` kommt als String aus Postgres** (node-postgres parst es
  absichtlich nicht, ein double hält den Wert nicht exakt). Für die Anzeige geht
  er durch `Intl.NumberFormat('de-CH')`, im CSV bleibt er unangetastet – dort
  wird nur der Dezimalpunkt getauscht.

## CSV-Export

`GET /api/export?<dieselben Filter wie die Ansicht>[&format=csv][&delimiter=…]`

Serverseitig erzeugt und gestreamt: der Export läuft durch dieselbe
Query-Schicht wie die Ansicht (und damit durch denselben – heute leeren –
Berechtigungsfilter), und ein Export über mehrere Jahre scheitert nicht am
Browser. Geholt wird in Bändern von 1000 Zeilen per Keyset-Paginierung; ein
grosses `OFFSET` würde die übersprungenen Zeilen jedes Mal mitlesen, und
zwischen zwei Bändern eingefügte Zeilen würden das Fenster verschieben, sodass
Zeilen doppelt oder gar nicht in der Datei landen.

Angewendet werden **alle** gesetzten Filter, nicht nur der Zeitraum – deshalb
steht die Trefferzahl auf dem Knopf („412 Belege exportieren"). Es ist dieselbe
Zahl wie in der Paginierung, aus derselben Funktion.

Zwei Details für Excel mit CH/DE-Locale:

- **UTF-8 mit BOM.** Ohne rät Excel die Kodierung nach Codepage und zerlegt jedes
  „ö" – und Händlernamen sind voll davon.
- **Semikolon als Trennzeichen, Komma als Dezimaltrennzeichen.** Sonst landet die
  ganze Zeile in einer Spalte. Über `?delimiter=comma` bzw. `?delimiter=tab`
  umschaltbar, falls die Datei woanders weiterverarbeitet wird; bei Komma als
  Trennzeichen bleibt der Dezimalpunkt ein Punkt, sonst wäre „1,50" nicht von
  zwei Spalten zu unterscheiden.

Dateiname mit Zeitraum, z. B. `belege_2026-01-01_2026-03-31.csv`.

Ein `.xlsx`-Export ist absehbar gewünscht. `lib/export/formats.ts` ist die
Registry dafür – ein zweites Format kommt daneben, ohne den Route Handler oder
die Query-Schicht anzufassen. Implementiert ist jetzt nur CSV.

## Umgebungsvariablen

| Variable               | Pflicht         | Zweck                                                                                              |
| ---------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | **ja**          | Dieselbe Postgres-Instanz wie der Agent. Auf Railway als `${{ Postgres.DATABASE_URL }}`            |
| `MASTRA_URL`           | für Belegbilder | Adresse des Agent-Service; nur `/api/belege/<id>/bild` braucht sie. Serverseitig, nicht im Browser |
| `FRONTEND_DB_POOL_MAX` | nein            | Poolgrösse, Default 3                                                                              |
| `PORT`                 | nein            | setzt Railway selbst; lokal 3000                                                                   |
| `HOSTNAME`             | nein            | im Container `0.0.0.0` (setzt das Dockerfile)                                                      |

Dieselbe Liste als Vorlage in `.env.example`. Zum Deployment siehe
`../README.md`, Abschnitt „Deployment auf Railway".
