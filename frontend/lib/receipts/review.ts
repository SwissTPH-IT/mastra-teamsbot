// Wann ein Beleg nachgesehen werden muss.
//
// Die Vorlage zeigt dafuer ein "Review"-Abzeichen und markiert den Titel
// gedaempft. Woran das haengt, steht hier und nur hier - sonst entscheidet die
// Liste anders als die Detailansicht, und der Nutzer sieht ein Abzeichen, das
// auf der Detailseite nicht erklaert wird.
//
// Zwei Signale, beide aus dem Dienst und beide deterministisch:
//
//   issues      Was der Extraktions-Agent selbst als Problem gemeldet hat
//               (freier Text, z. B. "receipt cropped at the edge").
//   confidence  Deterministisch aus Feldvollstaendigkeit und Summenpruefung
//               gerechnet, KEIN Modellwert - siehe computeConfidence() in
//               src/mastra/receipts/candidate.ts.

import type { ApiReceipt } from "../api/receipts";

/**
 * Unterhalb dieser Konfidenz wird nachgesehen.
 *
 * 0.6 ist so gewaehlt, dass die vier Kopffelder (Haendler, Datum, Betrag,
 * Waehrung) zusammen die Schwelle gerade nicht ueberschreiten, wenn eines von
 * ihnen fehlt: die Gewichtung in computeConfidence() zaehlt sie doppelt, und
 * ein Beleg ohne Haendler ist genau der Fall, den ein Mensch ansehen soll.
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.6;

export function needsReview(receipt: ApiReceipt): boolean {
  if (receipt.issues.length > 0) return true;
  const confidence = receipt.confidence === null ? null : Number(receipt.confidence);
  return (
    confidence !== null && Number.isFinite(confidence) && confidence < REVIEW_CONFIDENCE_THRESHOLD
  );
}

/**
 * Die Herkunft, wie sie in der Spalte "Source" steht.
 *
 * Heute hat jeder Beleg eine Datei - erfasst wird ausschliesslich in Teams,
 * und ohne Bild gibt es keine Extraktion. Die Spalte bleibt trotzdem, weil die
 * Vorlage den Fall "no receipt" vorsieht (selbst eingetragene Kleinbetraege)
 * und sie dann ohne Umbau richtig ist.
 */
export function sourceLabel(receipt: ApiReceipt): "receipt" | "no receipt" {
  return receipt.fileReference ? "receipt" : "no receipt";
}

/** Was in der Liste als Bezeichnung steht. Ohne Haendler der Hinweis der Vorlage. */
export function receiptTitle(receipt: ApiReceipt): { text: string; muted: boolean } {
  if (receipt.merchant && receipt.merchant.trim() !== "") {
    return { text: receipt.merchant, muted: false };
  }
  return { text: "merchant not recognised", muted: true };
}
