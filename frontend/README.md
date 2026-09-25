# Spesen – Weboberfläche

Die Selbstverwaltung der eigenen Belege: ansehen, prüfen, nachträglich
korrigieren, Kleinbeträge ohne Beleg erfassen, zu Abrechnungen bündeln und
einreichen, als CSV exportieren. Nach dem Login sieht **jeder nur seine eigenen**
Belege und Abrechnungen.

Belege *mit Bild* kommen ausschliesslich über Microsoft Teams herein: der
Human-in-the-Loop-Flow des Agenten legt sie dem Nutzer vor, und erst nach seiner
Bestätigung entsteht eine Zeile in `app.receipts`. Hier entsteht nur eine Art
Zeile: die Ausgabe **ohne** Beleg (siehe „Erfassen ohne Beleg").

Grundlage ist das Mockup „Swiss TPH Expenses" (`dev/Swiss TPH Expenses.html`).
Umgesetzt sind der Belegteil und die Abrechnungen mit den Zuständen Draft und
Submitted. Approved und Query brauchen eine Prüfung durch Finance, die es nicht
gibt; sie sind **sichtbar ausgegraut** (siehe „Was ausgegraut ist und warum").

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
Sie ist nicht angelegt, und solange die Oberfläche nur die eigenen Belege und
Abrechnungen liest und schreibt, braucht es sie nicht. Der Weg dorthin
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
  (app)/receipts/page.tsx     Liste: Filterleiste, Tabelle, Auswahl, Blätterer
  (app)/receipts/[id]/        Detail: Bild, Prüfhinweis, Felder, Korrektur, Zuordnung
  (app)/settlements/page.tsx  Abrechnungen: Liste, „New settlement"
  (app)/settlements/[id]/     Abrechnung: Positionen, Summen je Kategorie, Submit
  (app)/settlements/actions.ts  Server Actions: zuordnen, entfernen, einreichen, löschen
  api/auth/[...nextauth]/     Anmeldevorgang
  api/export/route.ts         CSV, serverseitig gestreamt
  api/healthz/route.ts        Health-Check (ohne Login), siehe unten
  api/receipts/[id]/image/    Proxy auf das Belegbild beim Agenten
lib/
  api/client.ts               Der EINE Weg zu den Daten (server-only)
  api/receipts.ts             Typisierte Aufrufe + der Vertrag mit dem Dienst
  api/settlements.ts          Dasselbe für die Abrechnungen
  settlements/format.ts       Status, Zeitraum, Summen je Währung (in Rappen addiert)
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
  settlements/                Auswahl + Leiste, Zuordnungsdialog, Action-Knöpfe
```

Der Zustand der Ansicht steht vollständig in den **Query-Parametern** und
nirgends sonst: eine gefilterte Liste ist teilbar, der Zurück-Button
funktioniert, und `/api/export` parst exakt dieselben Parameter wie die Seite.
Was in der Tabelle steht, ist damit auch das, was in der Datei landet.

## Was ausgegraut ist und warum

Sichtbar und erkennbar deaktiviert, nicht entfernt: so ist zu sehen, wohin das
gehört, ohne es anklicken zu können.

| Element | Grund |
| --- | --- |
| Statuskacheln **Approved** und **Query** auf der Startseite | Beide setzen eine Prüfung durch Finance voraus, und diese Rolle gibt es im System nicht (siehe „Abrechnungen: zwei Zustände statt vier"). |
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
- **Abrechnungen: zwei Zustände statt vier.** Kein „Query"-Banner, kein
  „Resubmit", kein „Open flagged item" – das alles hängt an einer Rückfrage von
  Finance. Zurück in den Entwurf geht eine eingereichte Abrechnung heute nur per
  SQL.
- **Summen je Währung.** Der Entwurf zeigt überall „… CHF". Liegt ein EUR-Beleg
  in der Abrechnung oder der Auswahl, steht er als eigener Posten daneben
  („192.85 CHF + 12.50 EUR") – addiert wird nicht, einen Kurs gibt es nicht.
- **Kein Zeitraum als Eingabe.** Der Zeitraum einer Abrechnung ist das früheste
  bis späteste Belegdatum ihrer Positionen, gerechnet und nicht gespeichert.
- **Submit verlangt die Belegart** an jedem Beleg („Required before
  submitting" steht im Entwurf am Feld). Der Dienst prüft es, die Seite markiert
  die Positionen mit „Type missing". Eine Ausgabe ohne Beleg hat die Belegart
  `none` und ist damit einreichbar.
- **Kein „Download Excel" / PDF** an der eingereichten Abrechnung. Der CSV-Export
  der Belegliste hat dafür eine Spalte „Settlement".
- **Die Auswahl gilt pro Seite.** Blättern oder Filtern leert sie – eine
  Auswahl, die man nicht mehr sieht, wäre eine Fehlerquelle.
- **Ohne Beleg als Seite statt Dialog.** Der Entwurf öffnet „Add expense without
  receipt" als Overlay. Hier ist es `/receipts/new`: funktioniert ohne
  JavaScript, hat eine Adresse und braucht keine abgefangene Route. Felder,
  Texte und der Regel-Kasten sind die des Dialogs; der „Preview state"-Umschalter
  des Entwurfs entfällt, die drei Zustände ergeben sich aus der Eingabe.
- **Fremdwährung ohne Beleg:** Der Entwurf lässt offen, welcher Kurs für die
  20-CHF-Grenze gilt. Geprüft wird der **Nominalbetrag** ohne Umrechnung (ein
  Kurs steht nirgends im System), und die offene Frage bleibt im Formular
  sichtbar, wie im Entwurf.
- **Korrigierbare Felder im Detail** sind Händler/Label, Datum, Betrag, Währung,
  MwSt. und Zahlungsart (ohne Beleg: Label, Datum, Betrag, Währung, Begründung).
  Die übrigen ausgelesenen Werte stehen darunter nur lesbar („Other extracted
  fields").
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

## Wenn der Healthcheck rot ist

`/api/healthz` beantwortet nicht "ist alles in Ordnung", sondern "hilft ein
Neustart dieses Containers". Railway killt bei Rot den Container und blockiert
den Deploy, deshalb drei verschiedene Antworten:

| Antwort | Bedeutung | Was zu tun ist |
|---|---|---|
| `503 {"status":"misconfigured","api":"unconfigured"}` | `API_URL` ist auf diesem Service nicht gesetzt. Jeder Aufruf liefe gegen `localhost`. | Variable setzen: `http://receipt-api.railway.internal:4000` |
| `200 {"status":"ok","api":"down","apiError":…}` | `API_URL` steht, der Dienst antwortet gerade nicht. | Den **API**-Service ansehen. Absichtlich kein Rot: ein Neustart des Frontends repariert einen fremden Dienst nicht, er wäre eine Neustartschleife für das Problem eines anderen Services. `/signin` lädt, und jede Datenseite erklärt den Zustand. |
| `200 {"status":"ok","api":"up"}` | Die Kette steht. | – |

`API_URL` ist eine Variable **dieses** Services, nicht des API-Services –
Railway-Variablen sind pro Service und werden nicht vererbt. Denselben Zielwert
trägt auch der Agent; `API_SERVICE_TOKEN` steht mit identischem Wert an allen
drei Stellen.

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

Die Detailseite korrigiert über `PATCH /receipts/:id`:

- **Kategorie und Belegart** – die lässt der Extraktions-Agent bewusst leer.
- **Die Fachwerte** – Händler, Datum, Betrag, Währung, MwSt., Zahlungsart; bei
  einer Ausgabe ohne Beleg Label, Datum, Betrag, Währung und Begründung. Im
  Teams-Dialog sind nur vier Felder bestätigbar, und die Extraktion liest
  manchmal falsch – ohne diesen Weg bliebe ein falscher Händler für immer stehen.

Die Werte gehen **roh** an den Dienst („12,50", „1'234.50", „14.03.2026") und
werden dort mit denselben Parsern wie bei der Extraktion gelesen. Was sich nicht
lesen lässt, wird abgelehnt statt still zu `NULL` – das Feld wird markiert, das
Getippte bleibt stehen. Leer heisst „nicht gesetzt" und wird `NULL`.

Ändert sich ein Fachwert tatsächlich, setzt der Dienst `corrected_at` und rechnet
die Konfidenz neu. Ab dann gilt der Beleg als nachgesehen: das „Review"-Abzeichen
und der Prüfhinweis verschwinden, im Kopf steht „corrected <Zeitpunkt>". Nur
Kategorie oder Belegart zu setzen zählt nicht als Korrektur.

Bei Ausgaben ohne Beleg gilt die 20-CHF-Grenze auch nach dem Erfassen – aus
12.00 lässt sich per Korrektur nicht 120.00 machen.

Das Formular ist ein echtes `<form>` mit einer Server Action und funktioniert
ohne JavaScript.

Liegt der Beleg in einer eingereichten Abrechnung, ist das Formular gesperrt –
alle Felder, auch die Fachwerte. Die Sperre selbst sitzt im Dienst (409 mit
`code: "locked"`, im WHERE derselben Query wie die Korrektur); die Seite zeigt
sie nur an.

## Erfassen ohne Beleg

`/receipts/new` („Add expense without receipt" auf Start- und Listenseite),
`POST /receipts/manual`. Felder wie im Entwurf: Datum, Betrag + Währung (CHF,
EUR), Kategorie, Label (steht in der Liste statt eines Händlers), die
**Begründung, die Pflicht ist**, und optional ein Abrechnungsentwurf, in den die
Ausgabe gleich gelegt wird.

- **Grenze 20.00 CHF pro Posten.** Das Formular zeigt sie beim Tippen und sperrt
  „Save" darüber; entschieden wird im Dienst (`src/mastra/receipts/no-receipt.ts`).
- **Idempotent:** die Seite vergibt die id der künftigen Zeile beim Rendern. Ein
  doppelt abgeschicktes Formular trifft dieselbe Zeile statt eine zweite
  Ausgabe anzulegen – einen Datei-Hash, der das sonst übernimmt, gibt es ohne
  Datei nicht.
- In der Datenbank ist „ohne Beleg" schlicht `file_reference IS NULL`; ein
  `CHECK` verlangt dann eine Begründung. Belegart ist `none`, Konfidenz leer.
- Das Konto muss verknüpft sein (eine Nachricht an den Teams-Bot genügt), sonst
  weiss der Dienst nicht, wem die Ausgabe gehört.

## Abrechnungen

Eine Abrechnung bündelt Belege und wird als Ganzes eingereicht. Ein Beleg liegt
in höchstens einer. Zugeordnet wird aus der Liste (Checkboxen, Leiste unten,
„Add to settlement") oder von der Detailseite des Belegs; im Dialog lässt sich
auch gleich eine neue Abrechnung anlegen – Anlegen und Zuordnen passieren im
Dienst in einer Transaktion.

Alle Regeln entscheidet der Dienst (`src/db/settlements.ts`), im selben
Statement, in dem er schreibt:

- Zuordnen ist **alles oder nichts**: ist ein Beleg nicht zuzuordnen (fremd,
  gesperrt), wird keiner zugeordnet.
- Zwischen Entwürfen dürfen Belege wandern, aus einer eingereichten Abrechnung
  heraus nicht.
- **Submit** geht nur mit mindestens einem Beleg, mit Belegart an jedem und
  mit festem Kurs für jede Position (siehe „Währung" unten).
  Danach ist die Abrechnung gesperrt: keine Positionen hinzu oder weg, keine
  Korrekturen, kein neuer Titel, kein Löschen.
- Einen Entwurf zu löschen lässt die Belege stehen; sie sind danach wieder frei.

**Währung.** Eine Abrechnung lautet auf eine Währung, gewählt beim Anlegen
(„New settlement" und im Zuordnungsdialog, vorausgewählt CHF) und im Entwurf
oben auf der Detailseite änderbar. Jede Position steht in dieser Währung,
umgerechnet zum Kurs ihres Belegdatums; darunter klein der Originalbetrag und
der Kurs („EUR 100.00 · 1 CHF = 1.0569 EUR"). Summe, Kategorie-Summen, Liste
und Kacheln zeigen nur noch den umgerechneten Betrag. Gerechnet wird im
Dienst, die Kurse kommen von Frankfurter (siehe Root-README, „Frankfurter-Service").
Die Auswahl in `lib/settlements/currencies.ts` spiegelt `SETTLEMENT_CURRENCIES`
aus `src/db/schema.ts` – beide ändern.

Eine Position ohne umgerechneten Betrag (kein Betrag, keine Währung, kein Datum
oder kein Kurs) steht mit Hinweis da und fehlt in der Summe; die Summe sagt,
wie viele fehlen. Ein vorläufiger Kurs (Belegdatum heute oder gestern) ist mit
„prov." markiert. Beides sperrt **Submit**.

Fehler kommen mit einem `code` (`locked`, `receipts-unavailable`, `empty`,
`incomplete`, `unconverted`, `rates-pending`) zurück, aus dem
`app/(app)/settlements/actions.ts` den englischen Satz macht – der deutsche
Text des Dienstes geht ins Server-Log.

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

| Variable                                             | Pflicht      | Zweck                                |
| ---------------------------------------------------- | ------------ | ------------------------------------ |
| `API_URL`                                            | ja           | Basis-URL des Belegdienstes          |
| `API_SERVICE_TOKEN`                                  | ja           | gemeinsames Geheimnis mit dem Dienst |
| `AUTH_SECRET`                                        | ja           | verschlüsselt das Session-Cookie     |
| `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_ISSUER` | ja           | App-Registrierung                    |
| `AUTH_URL`                                           | hinter Proxy | öffentliche URL (Railway)            |
| `MASTRA_URL`                                         | für Bilder   | Agent-Service, hält die Belegdateien |
| `API_TIMEOUT_MS`                                     | nein         | Default 15000                        |
| `TEAMS_CHAT_URL`                                     | nein         | Deep Link für „Capture in Teams"     |

Kein `NEXT_PUBLIC_*`: alle Aufrufe passieren serverseitig, weder Token noch
interne Adressen erreichen den Browser.
