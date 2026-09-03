// Wendet eine Freitext-Korrektur auf einen Kandidatensatz an.
//
// Bewusst getrennt vom Extraktions-Agenten: der tippt ab und interpretiert
// nicht ("transcribe, you do not interpret"). Hier ist Interpretation genau die
// Aufgabe – "das Datum ist der 3., nicht der 8." muss auf ein Feld abgebildet
// werden. Diese Trennung ist auch der Grund für den zweiten Nachfrage-Schritt
// im Workflow: das Parsing hier kann danebengehen, und dann muss der Nutzer das
// Ergebnis sehen, bevor es persistent wird.
//
// Der Agent sieht das Belegbild nicht. Er arbeitet nur auf dem Kandidatensatz
// und der Anweisung des Nutzers.

import { Agent } from '@mastra/core/agent';
import { model } from '../model';

export const receiptCorrectionAgent = new Agent({
  id: 'receipt-correction-agent',
  name: 'Receipt Correction Agent',
  instructions: `
Du korrigierst einen bereits extrahierten Belegdatensatz anhand einer Anweisung
des Nutzers. Du bekommst den aktuellen Datensatz als JSON und den Korrekturtext.

Gib den vollständigen korrigierten Datensatz im selben Schema zurück.

Regeln:
- Ändere ausschliesslich die Felder, die die Anweisung tatsächlich betrifft.
  Alle übrigen Felder übernimmst du unverändert – auch die, die null sind.
- Beträge sind Dezimalzahlen als String mit Punkt als Trennzeichen ("42.10"),
  ohne Währungszeichen. Die Währung gehört in "currency" als ISO-4217 ("CHF").
- Datumsangaben immer als "YYYY-MM-DD". Nennt der Nutzer nur einen Tag ("der
  3."), übernimm Monat und Jahr aus dem bisherigen Datum.
- Verstehst du die Anweisung nicht oder betrifft sie kein Feld des Schemas, gib
  den Datensatz unverändert zurück und trage eine kurze Notiz in "issues" ein.
  Rate nicht.
- Erfinde keine Werte. Ein Feld, das der Nutzer nicht nennt und das bisher null
  war, bleibt null.
- Setze "category" oder "receiptType" nur, wenn der Nutzer sie ausdrücklich nennt.
- Antworte ausschliesslich mit dem strukturierten Objekt, ohne Kommentar.
`.trim(),
  model,
});
