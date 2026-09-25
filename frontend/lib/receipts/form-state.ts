// Rueckmeldung eines Formulars nach dem Absenden - fuer Korrektur und
// Erfassung ohne Beleg gleich.
//
// Der Dienst lehnt Eingaben mit deutschem Text ab, dazu maschinenlesbar
// `fields` (welches Feld) und `code` (welche Fachregel). Die Oberflaeche ist
// Englisch; sie formuliert deshalb hier selbst, statt den Text durchzureichen.

import { NO_RECEIPT_LIMIT, NO_RECEIPT_LIMIT_CURRENCY } from "./no-receipt";

export type FormState =
  | { ok: true }
  | {
      ok: false;
      message: string;
      /** Feld -> Meldung, fuer die Markierung am Eingabefeld. */
      fieldErrors: Record<string, string>;
      /**
       * Was abgeschickt wurde. React setzt ein Formular nach der Action auf
       * seine defaultValues zurueck - ohne diese Werte waere nach einem
       * Tippfehler alles Getippte weg.
       */
      values: Record<string, string>;
    }
  | null;

const FIELD_MESSAGES: Record<string, string> = {
  merchant: "Too long.",
  receiptDate: "Date not readable, e.g. 14.03.2026.",
  totalAmount: "Amount not readable, e.g. 12.50.",
  vatAmount: "Amount not readable, e.g. 3.20.",
  currency: "Use an ISO code, e.g. CHF.",
  paymentMethod: "Too long.",
  category: "Unknown category.",
  receiptType: "Unknown receipt type.",
  reason: "Required: why there is no receipt.",
};

const LIMIT_MESSAGE = `Over the limit: ${NO_RECEIPT_LIMIT.toFixed(2)} ${NO_RECEIPT_LIMIT_CURRENCY} is the maximum without a receipt.`;

/** Abgelehnte Eingaben (400) in Meldungen fuer Formular und Felder uebersetzen. */
export function describeRejection(detail: { code?: string; fields?: string[] }): {
  message: string;
  fieldErrors: Record<string, string>;
} {
  if (detail.code === "no_receipt_limit") {
    return { message: LIMIT_MESSAGE, fieldErrors: { totalAmount: LIMIT_MESSAGE } };
  }

  const fieldErrors: Record<string, string> = {};
  for (const field of detail.fields ?? []) {
    fieldErrors[field] = FIELD_MESSAGES[field] ?? "Not accepted.";
  }
  return {
    message:
      Object.keys(fieldErrors).length > 0
        ? "Some values could not be read. Check the marked fields."
        : "The receipt service did not accept these values.",
    fieldErrors,
  };
}

/** Die abgeschickten Textfelder, fuer `values`. Dateien gibt es hier nicht. */
export function submittedValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !key.startsWith("$")) values[key] = value;
  }
  return values;
}
