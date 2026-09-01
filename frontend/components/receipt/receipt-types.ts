// Spiegelt receiptSchema aus src/mastra/agents/receipt-agent.ts.
// Alle Felder sind Strings: entweder der abgetippte Wert, "NOT_PRESENT" oder
// "ILLEGIBLE". Nichts wird hier umgerechnet.

export type ReceiptLineItem = {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
};

export type ReceiptData = {
  merchant: {
    name: string;
    address: string;
    taxOrRegistrationId: string;
  };
  transaction: {
    dateRaw: string;
    dateNormalized: string;
    time: string;
    referenceNumber: string;
  };
  lineItems: ReceiptLineItem[];
  totals: {
    subtotal: string;
    discounts: string;
    taxRate: string;
    taxAmount: string;
    total: string;
  };
  payment: {
    currency: string;
    method: string;
  };
  issues: string[];
};

export type ExtractReceiptResultItem = {
  uploadId: string;
  status: 'success' | 'error';
  receipt?: ReceiptData;
  receiptJsonPath?: string;
  error?: string;
};

export type ExtractReceiptArgs = {
  uploadIds?: string[];
};

export type ExtractReceiptResult = {
  results?: ExtractReceiptResultItem[];
};

export const NOT_PRESENT = 'NOT_PRESENT';
export const ILLEGIBLE = 'ILLEGIBLE';

/** True, wenn das Modell den Wert nicht gefunden oder nicht gelesen hat. */
export function isMissing(value: string | undefined): boolean {
  return !value || value === NOT_PRESENT || value === ILLEGIBLE;
}

/** Anzeigetext für ein Feld – Marker werden zu lesbaren Hinweisen. */
export function displayValue(value: string | undefined): string {
  if (!value || value === NOT_PRESENT) return '—';
  if (value === ILLEGIBLE) return 'unlesbar';
  return value;
}
