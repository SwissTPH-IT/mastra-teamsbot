# Spesen – Weboberfläche

Die Selbstverwaltung der eigenen Belege: ansehen, prüfen, Kategorie und Belegart
korrigieren, als CSV exportieren. Nach dem Login sieht **jeder nur seine
eigenen** Belege.

Erfasst wird hier nichts. Belege kommen über Microsoft Teams herein, der
Human-in-the-Loop-Flow des Agenten legt sie dem Nutzer vor, und erst nach seiner
Bestätigung entsteht eine Zeile in `app.receipts`. Diese Oberfläche ist die Sicht
darauf.

Grundlage ist das Mockup „Swiss TPH Expenses" (`dev/Swiss TPH Expenses.html`).
Umgesetzt ist daraus der Belegteil; die Abrechnungen sind im Entwurf enthalten
und hier **sichtbar ausgegraut** (siehe „Was ausgegraut ist und warum").

## Variante A: die Oberfläche spricht nur mit der API

Der entscheidende Unterschied zur Vorgängerfassung: **keine Datenbankverbindung.**
Kein Pool, kein Drizzle, kein Schema-Import. Alles läuft über den Belegdienst in
`api/`.

```
Browser ─► Frontend (Next.js, Server Components)
             Entra-Login (Auth.js) ──► Session mit `oid`
             │
             └─ lib/api/client.ts ──► receipt-api
                  Authorization: Bearer <API_SERVICE_TOKEN>   wer ruft
                  X-Subject-Aad: <oid aus der Session>        für wen
                                        │
                                        └─ app.users: oid -> teams_user_id
                                           -> jedes WHERE bekommt diese userId
```

Drei Dinge folgen daraus, und sie sind der Grund für den Umbau:

1. **Die Mandantentrennung liegt an einer Stelle.** Früher gab es zwei Lesepfade
   auf `app.receipts` (Agent und Frontend) und damit zwei Orte, an denen ein
   Berechtigungsfilter richtig sein musste. Jetzt entscheidet der Dienst, und die
   Oberfläche kennt die Teams-userId nicht einmal.
2. **Es gibt nichts zu weiten.** Der frühere `ReceiptScope` bedeutete „alle
   Nutzer" und war der Einhängepunkt für später. Den braucht es nicht mehr: es
   gibt keinen Parameter, mit dem diese Anwendung mehr sehen könnte.
3. **Das Verbindungsbudget wird kleiner.** Der eigene Pool (3 Verbindungen von
   rund 20) ist weg.

**Was der Service-Token bedeutet.** Mit ihm darf dieser Prozess im Namen jedes
Nutzers lesen – er ist ein vertrauenswürdiger Dienst, kein Nutzer. Deshalb gilt
in `lib/api/client.ts` eine Regel ohne Ausnahme: als Subject geht ausschliesslich
die `oid` aus der **Session** mit, niemals ein Wert aus einem Browser-Request. Es
gibt bewusst keine Funktion, die ein Subject als Argument nimmt.

Ein eigenes Zugriffstoken für die API (On-Behalf-Of) wäre die strengere Variante
und braucht eine zweite App-Registrierung in Entra („expose an API" plus Scope).
Sie ist nicht angelegt, und solange die Oberfläche nur die eigenen Belege liest
und nur Kategorie und Belegart schreibt, braucht es sie nicht. Der Weg dorthin
ist kurz: `auth.ts` fordert den Scope an, und `client.ts` schickt das Nutzertoken
statt des Service-Tokens – der Dienst kann beides schon (`api/src/auth.ts`).

## Der Login

Auth.js (NextAuth v5) mit dem Entra-Provider, Session als verschlüsseltes Cookie
(JWT-Strategie, keine Session-Tabelle – es gibt keine Datenbank).

- Angefordert werden `openid profile email`. Mehr nicht: diese Oberfläche ruft
  keine Graph-API. Das mitgelieferte Provider-Profil holt das Profilbild über
  Graph; das ist hier durch ein eigenes `profile()` ersetzt.
- Aus dem ID-Token wandern `oid` und `tid` in die Session. `oid` ist die Brücke
  zu `app.users` und damit zu den Belegen.
- Geschützt wird über `proxy.ts` (in Next 16 der Nachfolger von `middleware.ts`)
  mit einer **Positivliste des Öffentlichen**: `/api/healthz`, `/api/auth/*` und
  `/signin`. Alles andere braucht eine Session. Umgekehrt wäre jede neue Route
  versehentlich öffentlich.
- Sitzungsdauer 12 Stunden. Der Default von 30 Tagen passt nicht zu Spesendaten
  einzelner Personen, und es gibt kein Zugriffstoken, dessen Ablauf die Sitzung
  sonst begrenzen würde.

**Wer angemeldet ist, aber im System unbekannt** (kein Eintrag in `app.users` mit
dieser `oid`), bekommt vom Dienst ein `403` und in der Oberfläche eine Erklärung
statt einer leeren Tabelle: die Verknüpfung entsteht beim ersten Beleg im
Teams-Chat. Eine leere Liste wäre an dieser Stelle die falsche Auskunft.

## Aufbau

```
auth.ts                       Auth.js-Konfiguration (Entra, oid/tid)
proxy.ts                      Login-Pflicht mit Positivliste des Öffentlichen
app/
  signin/page.tsx             Anmeldeseite (ein Knopf)
  (app)/layout.tsx            Seitenleiste + Inhalt, verlangt eine Session
  (app)/page.tsx              Startseite: Kennzahl, Abrechnungskacheln, letzte Belege
  (app)/receipts/page.tsx     Liste: Filterleiste, Tabelle, Blätterer
  (app)/receipts/[id]/        Detail: Bild, Prüfhinweis, Felder, Korrektur
  (app)/settlements/page.tsx  Platzhalter, noch nicht gebaut
  api/auth/[...nextauth]/     Anmeldevorgang
  api/export/route.ts         CSV, serverseitig gestreamt
  api/healthz/route.ts        Health-Check inkl. Belegdienst (ohne Login)
  api/receipts/[id]/image/    Proxy auf das Belegbild beim Agenten
lib/
  api/client.ts               Der EINE Weg zu den Daten (server-only)
  api/receipts.ts             Typisierte Aufrufe + der Vertrag mit dem Dienst
  api/stream.ts               Alle Treffer seitenweise, für den Export
  api/guard.ts                Aus einem Fehler des Dienstes wird ein Zustand der UI
  receipts/query-params.ts    URL <-> Abfrage
  receipts/categories.ts      Kategorien und Belegarten, Schlüssel + Aufschrift
  receipts/review.ts          Wann ein Beleg nachgesehen werden muss
  receipts/format.ts          Anzeigeformatierung (Intl)
  export/                     CSV-Serialisierung und Format-Registry
components/
  shell/sidebar.tsx           Navigation, Nutzerblock, Abmelden
  receipts/                   Zeilen, Filterleiste, Blätterer, Zustände, Formular
```

Der Zustand der Ansicht steht vollständig in den **Query-Parametern** und
nirgends sonst: eine gefilterte Liste ist teilbar, der Zurück-Button
funktioniert, und `/api/export` parst exakt dieselben Parameter wie die Seite.
Was in der Tabelle steht, ist damit auch das, was in der Datei landet.

## Was ausgegraut ist und warum

Sichtbar und erkennbar deaktiviert, nicht entfernt: so ist zu sehen, wohin das
gehört, ohne es anklicken zu können.

| Element | Grund |
|---|---|
| Navigationspunkt **Settlements**, die vier Statuskacheln auf der Startseite, „Assign to settlement" | Es gibt weder `app.expense_reports` noch Endpunkte dafür (Plan, Phase 5). Eine „0.00" pro Kachel würde behaupten, es gebe keine Abrechnungen – statt zu sagen, dass es sie noch nicht gibt. |
| **Add expense without receipt** | Entworfen (Betragsgrenze, Begründungspflicht, Fremdwährungsfrage), aber weder im Schema noch im Dienst vorhanden: `app.receipts` verlangt Dateireferenz und Datei-Hash. |
| Filter **Unassigned only**, **With receipt**, **Without receipt** | Brauchen Abrechnungen bzw. selbst eingetragene Belege. |
| Spalte **Assignment** | Bleibt stehen und zeigt „not assigned". Sie später wieder einzusetzen würde die Spaltenbreiten zweimal verschieben. |
| **Capture in Teams** | Ein echter Deep Link braucht die Bot-ID des Tenants. Mit `TEAMS_CHAT_URL` wird der Knopf aktiv, ohne bleibt er deaktiviert – besser als eine geratene URL. |

## Abweichungen vom Mockup

- **Kein Blätterer im Entwurf.** Der Dienst liefert höchstens 200 Zeilen pro
  Aufruf, ein Jahr Belege sind mehr. Der Blätterer ist in der Formensprache der
  Filterleiste gehalten.
- **Kein Export im Entwurf.** Der CSV-Export gehört zur bestehenden Oberfläche;
  ihn wegzulassen wäre ein Rückschritt. Er läuft durch dieselben Filter wie die
  Liste.
- **Kein Suchfeld** – wie im Entwurf. Der Dienst kann suchen, deshalb wird `?q=`
  weiter aus der URL gelesen; ein Eingabefeld gibt es nicht.
- **Rohwerte der Extraktion** zeigt der Entwurf im Detail. Der Dienst gibt sie
  bewusst nicht heraus (`rawExtraction` und der Datei-Hash verlassen ihn nie).
  Stattdessen steht dort ein Satz, damit nicht gesucht wird, was es nicht gibt.
- **Abmelden statt Einstellungen** in der Seitenleiste: Einstellungen gibt es
  nicht, einen Weg aus der Anmeldung braucht es.
- **Keine Mehrfachauswahl** in der Liste. Ihre einzige Aktion im Entwurf ist
  „Add to settlement".
- **Nur Hell.** Der Entwurf definiert `color-scheme: light` und kein dunkles
  Gegenstück; einen selbst erfundenen Dunkelmodus hätte niemand entschieden.
- **Sprache.** Die Oberflächentexte sind englisch, 1:1 aus dem Entwurf – anders
  als der übrige Code, dessen Kommentare und Fehlermeldungen deutsch sind (so
  auch hier). Zahlen- und Datumsformate bleiben schweizerisch.

## Entwickeln

```bash
docker compose up postgres api -d      # Datenbank + Belegdienst
cd frontend && cp .env.example .env.local
npm run dev                            # http://localhost:3000
```

`npm install` läuft **im Repo-Root**, nie in `frontend/` – es ist ein
npm-Workspace (`"workspaces": ["frontend", "api"]`).

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # oxlint && oxfmt --check
npm run lint:fix
npm run build          # next build (output: standalone)
```

Ohne konfigurierte Entra-App kommt man über `/signin` nicht hinaus. Zum Prüfen
der Ansichten genügt eine App-Registrierung mit der lokalen Redirect-URI
`http://localhost:3000/api/auth/callback/microsoft-entra-id`; die eigene `oid`
muss in `app.users.aad_object_id` stehen, sonst zeigt die Oberfläche die
Erklärung „nothing linked yet" (was dann korrekt ist).

## Zeitzonen und Zahlen

Zwei Details, die nach Stil aussehen und keiner sind:

- **`receipt_date` ist ein Kalendertag**, `created_at` ein Zeitpunkt. Ein Tag
  durch eine Zeitzonenkonvertierung zu schicken verschiebt ihn – „2026-01-01"
  wird als UTC-Mitternacht gelesen und in Europe/Zurich zu 01:00 desselben Tags,
  im Sommer zu 02:00, westlich von UTC zum Vortag. `lib/receipts/format.ts` hat
  deshalb zwei getrennte Formatierer, und der Zeitraumfilter liegt bewusst auf
  dem Belegdatum.
- **Beträge sind Strings.** `numeric` wird absichtlich nicht als Zahl geparst –
  ein double hält den Wert nicht exakt. Der Export gibt den String weiter und
  tauscht nur das Dezimaltrennzeichen; nur die Anzeige geht durch `Number()`.

Leere Felder zeigen einen Gedankenstrich, nie „0.00": ein nicht erkannter Betrag
und ein Betrag von null sind zwei verschiedene Aussagen.

## Prüfhinweis und Konfidenz

Das Abzeichen „Review" und der Hinweiskasten im Detail hängen an zwei Signalen
aus dem Dienst: gemeldeten `issues` des Extraktions-Agenten und einer Konfidenz
unter 0.6 (`lib/receipts/review.ts` – die einzige Stelle, an der das entschieden
wird).

Die Konfidenz ist **deterministisch gerechnet** (Feldvollständigkeit und
Summenprüfung, `computeConfidence()` im Agent-Repo), kein Modellurteil. Der
Hinweis steht in der Oberfläche, weil eine Prozentzahl neben einem KI-Ergebnis
sonst als Selbsteinschätzung gelesen wird.

## Korrigieren

Schreibend ist genau eine Stelle: Kategorie und Belegart auf der Detailseite
(`PATCH /receipts/:id`). Das sind die beiden Felder, die der Extraktions-Agent
bewusst leer lässt – sie müssen von Hand gesetzt werden können.

Betrag, Datum und Währung bleiben dem Teams-Dialog vorbehalten: dort liegt das
Belegbild daneben, und zwei Wege zu derselben Zahl sind einer zu viel. Ein leeres
Auswahlfeld bedeutet „nicht gesetzt" und wird im Dienst zu `NULL`, nicht zu einem
Leerstring.

Das Formular ist ein echtes `<form>` mit einer Server Action und funktioniert
ohne JavaScript.

## CSV-Export

`/api/export` mit denselben Query-Parametern wie die Liste. Serverseitig
gestreamt: der Dienst wird seitenweise abgefragt (200 Zeilen), das erste Byte
geht raus, bevor die letzte Seite geholt ist.

Für Excel mit CH/DE-Locale:

- **UTF-8 mit BOM** – sonst rät Excel die Kodierung nach Codepage und zerlegt
  jedes „ö" und „é", und Händlernamen sind voll davon.
- **Semikolon** als Trennzeichen, **Komma** als Dezimaltrennzeichen. Bei
  Komma-getrennten Dateien landet die ganze Zeile in einer Spalte.
- **CRLF** als Zeilenende (RFC 4180).

Der erste Aufruf an den Dienst passiert **vor** der Antwort: ein Fehler muss
auffallen, bevor das erste Byte geschrieben ist – sonst liegt eine halbe Datei im
Download-Ordner.

## Umgebungsvariablen

Siehe `.env.example` – dort steht zu jedem Wert, warum er gebraucht wird.

| Variable | Pflicht | Zweck |
|---|---|---|
| `API_URL` | ja | Basis-URL des Belegdienstes |
| `API_SERVICE_TOKEN` | ja | gemeinsames Geheimnis mit dem Dienst |
| `AUTH_SECRET` | ja | verschlüsselt das Session-Cookie |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_ISSUER` | ja | App-Registrierung |
| `AUTH_URL` | hinter Proxy | öffentliche URL (Railway) |
| `MASTRA_URL` | für Bilder | Agent-Service, hält die Belegdateien |
| `API_TIMEOUT_MS` | nein | Default 15000 |
| `TEAMS_CHAT_URL` | nein | Deep Link für „Capture in Teams" |

Kein `NEXT_PUBLIC_*`: alle Aufrufe passieren serverseitig, weder Token noch
interne Adressen erreichen den Browser.
