// Die Regel fuer Ausgaben ohne Beleg, so wie das Formular sie ANZEIGT.
//
// Entschieden wird im Dienst (src/mastra/receipts/no-receipt.ts, geprueft bei
// POST /receipts/manual und bei jeder Korrektur). Hier steht nur, was der
// Nutzer beim Tippen sieht - damit er nicht erst nach dem Absenden erfaehrt,
// dass 34.50 ohne Beleg nicht geht. Weicht diese Datei vom Dienst ab, lehnt
// der Dienst trotzdem ab; die Grenze hier ist Komfort, keine Pruefung.

export const NO_RECEIPT_LIMIT = 20;
export const NO_RECEIPT_LIMIT_CURRENCY = "CHF";

/** Waehrungen im Formular. Wie in der Vorlage: CHF und EUR. */
export const NO_RECEIPT_CURRENCIES = ["CHF", "EUR"] as const;

/**
 * Betrag grob lesen, nur fuer die Anzeige. "12,50" und "1'234.50" gehen durch.
 *
 * Bewusst einfacher als parseAmount() im Dienst: hier geht es um "ueber oder
 * unter der Grenze", nicht um den gespeicherten Wert. Der kommt aus dem Dienst.
 */
export function readAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/['\s]/g, "").replace(",", ".");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export type NoReceiptRule = {
  tone: "neutral" | "ok" | "warn" | "bad";
  title: string;
  text: string;
  /** Die offene Fachfrage zur Fremdwaehrung sichtbar zeigen statt still umzurechnen. */
  openQuestion: boolean;
  /** Speichern sperren - der Dienst wuerde ohnehin ablehnen. */
  blocked: boolean;
};

const chf = (value: number) =>
  value.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Der Hinweiskasten unter dem Formular, in den drei Zustaenden der Vorlage. */
export function noReceiptRule(amountRaw: string, currency: string): NoReceiptRule {
  const amount = readAmount(amountRaw);
  const limit = `${chf(NO_RECEIPT_LIMIT)} ${NO_RECEIPT_LIMIT_CURRENCY}`;

  if (amount === null || amount <= 0) {
    return {
      tone: "neutral",
      title: "Company rule",
      text: `Without a receipt up to ${limit} per item. A reason is required, a receipt is not.`,
      openQuestion: false,
      blocked: false,
    };
  }

  if (amount > NO_RECEIPT_LIMIT) {
    return {
      tone: "bad",
      title: "Cannot be saved without a receipt",
      text: `${currency} ${chf(amount)} exceeds the ${limit} limit, so saving is disabled. Way out: photograph the receipt and submit it through the Teams bot, and the item appears here automatically.`,
      openQuestion: false,
      blocked: true,
    };
  }

  if (currency !== NO_RECEIPT_LIMIT_CURRENCY) {
    return {
      tone: "warn",
      title: "Foreign currency: limit not decided yet",
      text: `${currency} ${chf(amount)} is checked against the nominal limit of ${chf(NO_RECEIPT_LIMIT)}, without conversion. Which rate applies is deliberately left open.`,
      openQuestion: true,
      blocked: false,
    };
  }

  return {
    tone: "ok",
    title: "Within the company rule",
    text: `${chf(amount)} ${currency} is below ${limit}. A reason is required, a receipt is not.`,
    openQuestion: false,
    blocked: false,
  };
}
