// Der Kandidatensatz: die geparste, typisierte Form eines extrahierten Belegs.
//
// Der Extraktions-Agent (src/mastra/agents/receipt-agent.ts) liefert bewusst
// NUR Strings, inklusive der Marker "NOT_PRESENT" und "ILLEGIBLE" – er tippt ab
// und interpretiert nicht. Diese Datei ist die eine Stelle, an der interpretiert
// wird: Marker -> null, "CHF 42.10" -> "42.10" + "CHF", "14.03.2026" ->
// "2026-03-14".
//
// Der Kandidat ist gleichzeitig das, was dem Nutzer zur Kontrolle vorgelegt wird
// und was in `app.receipts` landet. Beträge bleiben Strings: die numeric-Spalten
// nehmen Strings entgegen, und alles andere wäre ein Umweg über float.

import { z } from 'zod';
import type { ReceiptData } from '../agents/receipt-agent';

/** Die Marker, mit denen der Extraktions-Agent "kein Wert" ausdrückt. */
const MARKERS = new Set(['NOT_PRESENT', 'ILLEGIBLE', '']);

export const lineItemSchema = z.object({
  description: z.string(),
  quantity: z.string(),
  unitPrice: z.string(),
  lineTotal: z.string(),
});

export const candidateSchema = z.object({
  merchant: z.string().nullable(),
  merchantAddress: z.string().nullable(),
  merchantTaxId: z.string().nullable(),
  receiptDate: z.string().nullable().describe('ISO-Datum YYYY-MM-DD.'),
  receiptTime: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  totalAmount: z.string().nullable().describe('Dezimalzahl als String, z. B. "42.10".'),
  subtotalAmount: z.string().nullable(),
  discountAmount: z.string().nullable(),
  vatAmount: z.string().nullable(),
  vatRate: z.string().nullable(),
  currency: z.string().nullable().describe('ISO-4217, z. B. "CHF".'),
  paymentMethod: z.string().nullable(),
  receiptType: z.string().nullable(),
  category: z.string().nullable(),
  lineItems: z.array(lineItemSchema),
  issues: z.array(z.string()),
});

export type ReceiptCandidate = z.infer<typeof candidateSchema>;

/** Marker und Leerstrings zu null. Sonst der getrimmte Wert. */
function value(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return MARKERS.has(trimmed.toUpperCase()) ? null : trimmed;
}

/**
 * Bekannte Schreibweisen -> ISO-4217.
 *
 * Bewusst klein und explizit: was hier nicht drinsteht, wird null statt geraten.
 * Eine falsch geratene Währung fällt niemandem auf, ein leeres Feld schon.
 */
const CURRENCY_ALIASES: Record<string, string> = {
  CHF: 'CHF',
  'FR.': 'CHF',
  FR: 'CHF',
  SFR: 'CHF',
  'SFR.': 'CHF',
  '€': 'EUR',
  EUR: 'EUR',
  EURO: 'EUR',
  $: 'USD',
  USD: 'USD',
  'US$': 'USD',
  '£': 'GBP',
  GBP: 'GBP',
};

export function parseCurrency(raw: string | undefined | null): string | null {
  const text = value(raw);
  if (!text) return null;
  const key = text.toUpperCase().replace(/\s+/g, '');
  if (CURRENCY_ALIASES[key]) return CURRENCY_ALIASES[key];
  // Auch der Fall "CHF 42.10" im Währungsfeld: das erste erkennbare Symbol zählt.
  for (const [alias, iso] of Object.entries(CURRENCY_ALIASES)) {
    if (key.includes(alias)) return iso;
  }
  return null;
}

/**
 * Betrag aus einem gedruckten Wert lösen.
 *
 * Deckt die Formate ab, die auf Schweizer und deutschen Belegen vorkommen:
 * "42.10", "42,10", "1'234.50", "1.234,50", "CHF 42.10", "-5.00".
 * Was sich nicht eindeutig lesen lässt, wird null – nicht 0.
 */
export function parseAmount(raw: string | undefined | null): string | null {
  const text = value(raw);
  if (!text) return null;

  // Alles ausser Ziffern, Trennzeichen und Vorzeichen weg (Währungssymbole etc.).
  let cleaned = text.replace(/[^0-9.,'\-−]/g, '').replace(/−/g, '-');
  if (!/\d/.test(cleaned)) return null;

  const negative = cleaned.startsWith('-');
  cleaned = cleaned.replace(/-/g, '');

  // Apostroph ist immer Tausendertrennung (1'234.50).
  cleaned = cleaned.replace(/'/g, '');

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma >= 0 && lastDot >= 0) {
    // Beide vorhanden: das hintere ist das Dezimaltrennzeichen.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    cleaned = cleaned.split(thousandSep).join('');
    cleaned = cleaned.replace(decimalSep, '.');
  } else if (lastComma >= 0) {
    // Nur Komma: Dezimaltrennzeichen, ausser es sieht nach Tausendern aus (1,234).
    cleaned = cleaned.length - lastComma === 4 ? cleaned.replace(',', '') : cleaned.replace(',', '.');
  } else if (lastDot >= 0) {
    // Mehrere Punkte = Tausendertrennung (1.234.567), einer = Dezimalpunkt.
    const dots = cleaned.split('.').length - 1;
    if (dots > 1) cleaned = cleaned.split('.').join('');
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;

  return (negative ? -parsed : parsed).toFixed(2);
}

/** Wie parseAmount, aber mit drei Nachkommastellen für den Steuersatz. */
export function parseRate(raw: string | undefined | null): string | null {
  const amount = parseAmount(raw);
  return amount === null ? null : Number(amount).toFixed(3);
}

/**
 * Datum auf YYYY-MM-DD bringen.
 *
 * Der Agent liefert `dateNormalized` bereits in diesem Format; das hier ist die
 * Absicherung dagegen, dass er es doch mal nicht tut, plus der Fallback auf
 * `dateRaw` in den gängigen europäischen Schreibweisen.
 */
export function parseDate(normalized: string | undefined, raw?: string): string | null {
  for (const input of [value(normalized), value(raw)]) {
    if (!input) continue;

    const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    // 14.03.2026 / 14-03-2026 / 14/03/2026, auch zweistellige Jahre.
    const european = input.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
    if (european) {
      const day = european[1].padStart(2, '0');
      const month = european[2].padStart(2, '0');
      const year = european[3].length === 2 ? `20${european[3]}` : european[3];
      if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
        return `${year}-${month}-${day}`;
      }
    }
  }
  return null;
}

/** Die skalaren Felder, über die die Confidence gerechnet wird. */
const SCORED_FIELDS = [
  'merchant',
  'receiptDate',
  'totalAmount',
  'currency',
  'merchantAddress',
  'merchantTaxId',
  'referenceNumber',
  'subtotalAmount',
  'vatAmount',
  'paymentMethod',
] as const;

/**
 * Deterministische Confidence, kein Modellwert.
 *
 * Der Extraktions-Agent liefert bewusst keine Selbsteinschätzung – er würde sie
 * erfinden. Stattdessen zählen wir, wie viel er überhaupt lesen konnte: Anteil
 * der befüllten Felder, abgestraft um 0.1 pro gemeldetem Lesbarkeitsproblem.
 * Die vier Kopffelder (Händler, Datum, Betrag, Währung) zählen doppelt – ein
 * Beleg ohne sie ist unbrauchbar, auch wenn zehn Nebenfelder gefüllt sind.
 */
export function computeConfidence(candidate: ReceiptCandidate): string {
  let score = 0;
  let weightSum = 0;

  for (const field of SCORED_FIELDS) {
    const weight = ['merchant', 'receiptDate', 'totalAmount', 'currency'].includes(field) ? 2 : 1;
    weightSum += weight;
    if (candidate[field] !== null) score += weight;
  }

  const base = weightSum === 0 ? 0 : score / weightSum;
  const penalty = Math.min(0.1 * candidate.issues.length, 0.5);
  return Math.max(0, Math.min(1, base - penalty)).toFixed(2);
}

/** Extraktions-Output -> Kandidatensatz. */
export function toCandidate(receipt: ReceiptData): ReceiptCandidate {
  return {
    merchant: value(receipt.merchant.name),
    merchantAddress: value(receipt.merchant.address),
    merchantTaxId: value(receipt.merchant.taxOrRegistrationId),
    receiptDate: parseDate(receipt.transaction.dateNormalized, receipt.transaction.dateRaw),
    receiptTime: value(receipt.transaction.time),
    referenceNumber: value(receipt.transaction.referenceNumber),
    totalAmount: parseAmount(receipt.totals.total),
    subtotalAmount: parseAmount(receipt.totals.subtotal),
    discountAmount: parseAmount(receipt.totals.discounts),
    vatAmount: parseAmount(receipt.totals.taxAmount),
    vatRate: parseRate(receipt.totals.taxRate),
    // Die Währung steht mal im Währungsfeld, mal nur am Betrag.
    currency: parseCurrency(receipt.payment.currency) ?? parseCurrency(receipt.totals.total),
    paymentMethod: value(receipt.payment.method),
    // Der Extraktions-Agent kategorisiert bewusst nicht. Bleibt leer, bis ein
    // Nutzer es in der Korrekturrunde setzt.
    receiptType: null,
    category: null,
    lineItems: receipt.lineItems.map(item => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
    issues: receipt.issues,
  };
}

/** Die Vorlage für den Nutzer im Teams-Thread. */
export function formatCandidate(candidate: ReceiptCandidate): string {
  const line = (label: string, val: string | null) => `- **${label}:** ${val ?? '_nicht gelesen_'}`;
  const amount =
    candidate.totalAmount === null
      ? null
      : [candidate.currency, candidate.totalAmount].filter(Boolean).join(' ');

  const rows = [
    line('Händler', candidate.merchant),
    line('Datum', candidate.receiptDate),
    line('Betrag', amount),
    line('MwSt.', candidate.vatAmount),
    line('Zahlungsart', candidate.paymentMethod),
  ];

  if (candidate.category) rows.push(line('Kategorie', candidate.category));
  if (candidate.lineItems.length > 0) rows.push(`- **Positionen:** ${candidate.lineItems.length}`);
  if (candidate.issues.length > 0) rows.push(`\n⚠️ ${candidate.issues.join('; ')}`);

  return rows.join('\n');
}
