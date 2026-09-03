# Vom Beleg-Upload zur strukturierten Datenbank: Ausbaustufe 2 des Teams-Agenten

## Ausgangslage

Der erste Teil der Kette steht und funktioniert. Ein Nutzer lädt in Microsoft Teams einen Beleg hoch und übergibt ihn dem Agenten. Von dort läuft die Datei nach Mastra, wo ein Workflow sie entgegennimmt und die enthaltenen Informationen ausliest. Der Weg vom Foto oder PDF bis zum maschinenlesbaren Ergebnis ist damit abgedeckt.

Was bisher fehlt, ist alles, was nach dem Auslesen passiert. Die extrahierten Daten haben keinen Ort, an dem sie bleiben, und der Nutzer hat keine Möglichkeit, ein falsch erkanntes Datum oder einen vertauschten Betrag zu korrigieren, bevor der Wert weiterverarbeitet wird. Genau das ist Inhalt der zweiten Ausbaustufe.

## Zielbild: Extraktion mit Bestätigungsschleife

Der neue Ablauf sieht so aus:

1. Der Agent liest aus dem Beleg die spezifischen, definierten Felder aus — je nach Anwendungsfall etwa Händler, Datum, Gesamtbetrag, Mehrwertsteuer, Währung und Belegtyp.
2. Diese Werte werden dem Nutzer im Chat zur Kontrolle vorgelegt.
3. Bestätigt der Nutzer, werden die Daten in die Datenbank geschrieben.
4. Korrigiert der Nutzer einzelne Werte, legt der Agent den korrigierten Satz noch einmal zur Bestätigung vor. Erst danach folgt der Schreibvorgang.

Der zweite Nachfrage-Schritt ist wichtiger, als er auf den ersten Blick wirkt. Er verhindert, dass eine Korrektur des Nutzers durch das Modell falsch interpretiert wird und unbemerkt in die Datenbank wandert. Eine Freitext-Antwort wie „das Datum ist der 3., nicht der 8." muss geparst werden, und dieses Parsing kann schiefgehen. Die erneute Vorlage macht das Ergebnis sichtbar, bevor es persistent wird.

Technisch bedeutet das ein Human-in-the-Loop-Muster: Der Workflow muss an der Bestätigungsstelle anhalten, den Zustand halten und später mit der Antwort des Nutzers weiterlaufen. Mastra unterstützt das über pausierbare Workflow-Schritte, sodass der Zwischenzustand nicht selbst im Agentenkontext mitgeschleppt werden muss. Wichtig ist, dass der Kandidatensatz zwischen Vorlage und Bestätigung serverseitig gehalten wird und nicht ausschliesslich im Gesprächsverlauf existiert — sonst entscheidet die Kontextlänge darüber, ob eine Buchung korrekt landet.

## Erweiterung des Agenten um Datenbank-Tools

Der Agent braucht Werkzeuge, mit denen er auf die Datenbank zugreifen kann. Sinnvoll ist ein kleiner, klar abgegrenzter Satz:

- **Beleg anlegen** — schreibt einen bestätigten Datensatz, inklusive Nutzer-ID, Zeitstempel und Referenz auf die Originaldatei.
- **Belege lesen / suchen** — für Rückfragen des Nutzers im Chat („habe ich die Rechnung vom Hotel schon eingereicht?").
- **Beleg aktualisieren** — für nachträgliche Korrekturen an einem bereits gespeicherten Eintrag.

Bei der Ausgestaltung dieser Tools lohnt sich Zurückhaltung. Ein generisches Tool, das beliebiges SQL ausführt, ist bequem zu bauen und schwer zu kontrollieren. Besser sind eng typisierte Tools mit validierten Eingaben, bei denen die Datenzugriffslogik in der Anwendung liegt und nicht im Prompt. Zwei Punkte gehören dabei fest verdrahtet und nicht in die Entscheidungshoheit des Modells:

- **Mandantentrennung.** Die Nutzer-ID kommt aus dem Teams-Kontext und wird serverseitig in jede Abfrage eingesetzt. Ein Nutzer darf keine Belege eines anderen Nutzers lesen oder ändern können, auch dann nicht, wenn er den Agenten darum bittet.
- **Idempotenz.** Ein erneut abgeschickter Beleg oder ein wiederholter Tool-Aufruf darf keinen Duplikat-Eintrag erzeugen. Ein Schlüssel aus Datei-Hash und Nutzer-ID reicht in der Regel aus.

Zusätzlich empfiehlt sich, den Rohtext der Extraktion und ein Konfidenzsignal mitzuspeichern. Das kostet wenig und macht spätere Fehleranalysen möglich — man kann dann beantworten, ob ein falscher Wert am Modell, am Beleg oder an der Korrekturschleife lag.

## Datenbank: Postgres auf Railway

Der Stack wird um eine Postgres-Instanz erweitert, die auch im Railway-Deployment läuft. Railway bietet Postgres als eigenen Service an, der über Umgebungsvariablen mit den übrigen Services verbunden wird. Damit bleibt lokale Entwicklung und Deployment auf derselben Engine, was Überraschungen bei Datentypen und Zeitzonen erspart.

Ein paar Festlegungen, die früh getroffen werden sollten:

- **Beträge** als `numeric` mit fester Skalierung, nicht als Fliesskommazahl, und Währung als separates Feld.
- **Zeitstempel** durchgängig als `timestamptz`. Belegdatum und Erfassungsdatum sind zwei verschiedene Dinge und brauchen zwei Spalten.
- **Migrationen** von Anfang an über ein Werkzeug wie Drizzle oder Prisma. Das Schema wird sich in den nächsten Wochen mehrfach ändern, und Änderungen per Hand auf der Produktivinstanz sind der Anfang von Rekonstruktionsarbeit.
- **Originaldatei** nicht in die Datenbank. Der Beleg gehört in einen Objektspeicher, in der Tabelle steht nur der Verweis.

## Frontend: assistant-ui ausbauen oder ersetzen

Das bisherige Interface für das Hochladen von Quittungen wird nicht mehr gebraucht — dieser Weg läuft über Teams. Die Oberfläche soll stattdessen zur Ansicht auf die Datenbank werden: Der Nutzer sieht seine erfassten Belege und kann sie als Excel exportieren.

Damit steht eine Grundsatzentscheidung an, und die vom Team formulierte Frage ist die richtige: Bringt assistant-ui hier noch etwas, oder ist eine andere Oberfläche sinnvoller?

Das Kriterium ist, ob auf dieser Seite des Flows künftig noch KI-Interaktion stattfindet.

**Wenn ja**, etwa weil Nutzer später natürlichsprachlich abfragen sollen („zeig mir alle Bewirtungsbelege aus Q3 über 100 Franken") oder weil Korrekturen und Nachbearbeitung auch im Web möglich sein sollen, dann bleibt assistant-ui gerechtfertigt. Es bringt Streaming, Nachrichtenverlauf und Tool-Call-Darstellung mit, und diese Dinge selbst zu bauen kostet mehr, als es aussieht.

**Wenn nein**, wenn die Seite also reine Datenbank-Oberfläche ist, dann ist assistant-ui das falsche Werkzeug. Was dann gebraucht wird, ist eine Tabelle: Sortierung, Filter, Paginierung, Spaltenauswahl, Massenselektion und ein Export-Knopf. Dafür ist eine Kombination aus einem Table-Framework wie TanStack Table und einer Komponentenbibliothek wie shadcn/ui der direktere Weg. Eine Chat-Oberfläche zwischen Nutzer und Tabelle zu setzen macht das Filtern langsamer, nicht schneller.

Ein pragmatischer Mittelweg: die Tabellenansicht als Kern bauen und die Chat-Komponente als optionales Panel daneben vorsehen. Dann ist die Entscheidung nicht endgültig, und der Aufwand für den Fall, dass KI-Funktionen später doch dazukommen, bleibt begrenzt. Diese Bewertung sollte aber bewusst getroffen und dokumentiert werden, statt sich aus dem bestehenden Code zu ergeben.

**Zum Excel-Export:** Serverseitige Generierung ist der robustere Weg, weil der Export dann denselben Berechtigungsfilter durchläuft wie die Ansicht und auch bei grösseren Datenmengen nicht am Browser scheitert. Bibliotheken wie ExcelJS oder SheetJS erledigen das. Ein CSV-Export als Fallback ist billig und wird häufiger benutzt, als man erwartet.

## Deployment auf Railway

Am Ende müssen drei Bestandteile deployed sein:

- die **Postgres-Instanz** als Railway-Datenbank-Service,
- der **Agent** mit dem Mastra-Workflow und den neuen Datenbank-Tools,
- das **Frontend** als Datenbank-Oberfläche.

Damit das trägt, gehören einige Dinge dazu, die im Prototyp noch fehlen dürfen und im Deployment nicht mehr:

- Getrennte Umgebungen für Staging und Produktion, mit je eigener Datenbank. Migrationen wollen einmal getestet werden, bevor sie auf echte Belege treffen.
- Datenbank-Zugangsdaten über Railways Service-Variablen statt über kopierte Connection-Strings.
- Migrationen als Teil des Deploy-Schritts, nicht als manueller Vorgang.
- Ein Health-Check-Endpunkt am Agenten und aktivierte Backups auf der Datenbank.
- Ein Blick auf Connection Pooling: Serverless-nahe Deployments öffnen schnell mehr Verbindungen, als eine kleine Postgres-Instanz verträgt.

## Offene Punkte

Drei Fragen sind noch nicht entschieden und sollten es werden, bevor gebaut wird:

1. **Der Feldkatalog.** Welche Felder werden ausgelesen, welche sind Pflicht, und was passiert, wenn ein Pflichtfeld nicht erkannt wird? Blockiert das die Erfassung oder wird der Beleg als unvollständig gespeichert?
2. **Die Frontend-Entscheidung.** assistant-ui behalten oder durch eine Tabellenoberfläche ersetzen — abhängig davon, ob KI auf dieser Seite eine Rolle spielen soll.
3. **Der Bearbeitungspfad im Web.** Sollen Belege auch im Frontend korrigierbar sein, oder ist die Weboberfläche bewusst nur lesend? Das beeinflusst Tool-Zuschnitt, Berechtigungen und Audit-Anforderungen.

Der Rest der Ausbaustufe ist in seinen Konturen klar: Bestätigungsschleife im Workflow, Datenbank-Tools am Agenten, Postgres im Stack, Tabellenansicht mit Export im Frontend, und alles drei auf Railway.
