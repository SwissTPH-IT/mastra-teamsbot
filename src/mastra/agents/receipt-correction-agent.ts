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
  // Englisch, weil der Nutzer das Ergebnis (auch die issues) in Teams sieht und
  // die Teams-Interaktion durchgehend Englisch ist. Die Korrektur selbst darf in
  // jeder Sprache kommen.
  instructions: `
You correct an already extracted receipt record based on an instruction from the
user. You receive the current record as JSON and the correction text. The user may
write in any language (often English or German).

Return the complete corrected record in the same schema.

Rules:
- Change only the fields the instruction actually concerns. Copy every other field
  unchanged – including those that are null.
- Amounts are decimal numbers as strings with a dot as separator ("42.10"), without
  a currency sign. The currency goes into "currency" as ISO-4217 ("CHF").
- Dates are always "YYYY-MM-DD". If the user only names a day ("the 3rd"), take the
  month and year from the existing date.
- If you do not understand the instruction or it does not concern any field of the
  schema, return the record unchanged and add a short note in English to "issues".
  Do not guess.
- Never invent values. A field the user does not mention that was null stays null.
- Set "category" or "receiptType" only if the user names them explicitly.
- Write anything you add to "issues" in English.
- Reply with the structured object only, no commentary.
`.trim(),
  model,
});
