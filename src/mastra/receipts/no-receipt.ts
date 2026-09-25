// Die Regel für Ausgaben ohne Beleg.
//
// Eine Stelle für Grenze und Prüfung, weil sie an zwei Wegen gilt: beim
// Erfassen (POST /receipts/manual) und bei jeder späteren Korrektur
// (PATCH /receipts/:id). Wäre sie nur beim Erfassen geprüft, liesse sich aus
// 12.00 per Korrektur 120.00 machen – ohne Beleg.
//
// Die Weboberfläche zeigt die Grenze schon beim Tippen an. Das ist Komfort;
// entschieden wird ausschliesslich hier.

/** Höchstbetrag pro Posten ohne Beleg. Als String – Beträge sind Strings, siehe candidate.ts. */
export const NO_RECEIPT_LIMIT = '20.00';

/** Die Hauswährung, auf die sich die Grenze bezieht. */
export const NO_RECEIPT_LIMIT_CURRENCY = 'CHF';

/**
 * Prüft Betrag und Währung eines Postens ohne Beleg. Liefert die Meldung oder null.
 *
 * Bei Fremdwährung gilt die Grenze auf den NOMINALBETRAG, ohne Umrechnung.
 * Welcher Kurs gelten soll (Belegdatum? Einreichung?) ist fachlich offen, und
 * im System steht kein Kurs. Eine stillschweigende Umrechnung würde eine
 * Entscheidung vortäuschen, die niemand getroffen hat – die Oberfläche zeigt
 * die offene Frage deshalb sichtbar an. Der Nominalbetrag ist die einzige
 * Grenze, die sich ohne Kurs überhaupt prüfen lässt.
 */
export function checkNoReceiptAmount(
  totalAmount: string | null,
  currency: string | null,
): string | null {
  if (totalAmount === null) return 'Ohne Beleg ist ein Betrag Pflicht.';
  if (currency === null) return 'Ohne Beleg ist eine Währung Pflicht.';

  // Vergleich in Rappen als Ganzzahl: die Strings haben genau zwei
  // Nachkommastellen (parseAmount), und so kommt kein float dazwischen.
  const cents = Math.round(Number(totalAmount) * 100);
  const limitCents = Math.round(Number(NO_RECEIPT_LIMIT) * 100);

  if (!(cents > 0)) return 'Der Betrag muss grösser als 0 sein.';
  if (cents > limitCents) {
    return (
      `Ohne Beleg sind höchstens ${NO_RECEIPT_LIMIT} ${NO_RECEIPT_LIMIT_CURRENCY} pro Posten ` +
      'erlaubt. Darüber bitte den Beleg über den Teams-Bot einreichen.'
    );
  }
  return null;
}

/** Eine Begründung zählt nur, wenn nach dem Trimmen etwas übrig bleibt. */
export function hasReason(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && reason.trim() !== '';
}
