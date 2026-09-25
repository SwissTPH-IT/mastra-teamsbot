// Anzeige einer Abrechnung: Status, Zeitraum, Summe.
//
// Eine Stelle fuer alle drei, weil Liste, Detail, Startseite und
// Zuordnungsdialog dieselbe Abrechnung zeigen. Laeuft das auseinander, heisst
// sie auf einer Seite "Draft" und auf der naechsten "draft".

import type { ApiSettlement, SettlementStatus } from "../api/settlements";
import type { CurrencySummary } from "../api/receipts";
import { formatAmount, formatReceiptDate, formatTimestamp } from "../receipts/format";

/** Aufschrift und Punktfarbe je Status. Farben wie STATUS_STYLE in der Vorlage. */
export const STATUS_STYLE: Record<SettlementStatus, { label: string; dot: string }> = {
  draft: { label: "Draft", dot: "bg-line-2" },
  submitted: { label: "Submitted", dot: "bg-brand" },
};

/**
 * "02.09.–06.09.2026" wie in der Vorlage; ueber einen Jahreswechsel beide
 * Jahre. Nur aus Kalendertagen gebaut, ohne Date - siehe lib/receipts/format.ts.
 */
export function formatPeriod(start: string | null, end: string | null): string | null {
  const from = formatReceiptDate(start);
  const to = formatReceiptDate(end);
  if (!from || !to) return from ?? to;
  if (from === to) return from;
  return from.slice(6) === to.slice(6) ? `${from.slice(0, 6)}–${to}` : `${from}–${to}`;
}

/**
 * Summe je Waehrung als eine Zeile: "192.85 CHF" oder "192.85 CHF + 12.50 EUR".
 * Belege ohne Waehrung stehen als eigener Posten da, statt in CHF zu verschwinden.
 */
export function formatTotals(totals: CurrencySummary[]): string {
  if (totals.length === 0) return "0.00";
  return totals
    .map((entry) => `${formatAmount(entry.sum) ?? entry.sum} ${entry.currency ?? "(no currency)"}`)
    .join(" + ");
}

/**
 * Summen je Waehrung zusammenzaehlen - fuer die Auswahlleiste und die
 * Statuskacheln, wo mehrere Posten zu einer Zeile werden.
 *
 * In ganzen Rappen gerechnet: Number("0.10") + Number("0.20") ist nicht 0.30.
 * Rappen als ganze Zahl sind bis 2^53 exakt, weit ueber jedem Belegbetrag.
 */
export function addTotals(entries: CurrencySummary[]): CurrencySummary[] {
  const byCurrency = new Map<string | null, { count: number; cents: number }>();
  for (const entry of entries) {
    const current = byCurrency.get(entry.currency) ?? { count: 0, cents: 0 };
    current.count += entry.count;
    current.cents += toCents(entry.sum);
    byCurrency.set(entry.currency, current);
  }
  return [...byCurrency.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([currency, { count, cents }]) => ({ currency, count, sum: fromCents(cents) }));
}

/** "168.00" -> 16800. Der Dienst liefert numeric(14,2), also hoechstens zwei Stellen. */
function toCents(amount: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) return 0;
  const value = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -value : value;
}

function fromCents(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function itemCount(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

/**
 * Der Einreichungstag, "01.09.2026". submittedAt ist ein Zeitpunkt - hier ist
 * die Umrechnung nach Europe/Zurich richtig (formatTimestamp), und nur der
 * Tag davon wird gezeigt.
 */
export function formatSubmittedDay(submittedAt: string | null): string {
  return formatTimestamp(submittedAt)?.slice(0, 10) ?? "";
}

/** Die Unterzeile in Liste und Kopf: Zeitraum und Einreichungsstand. */
export function settlementMeta(settlement: ApiSettlement): string {
  const period = formatPeriod(settlement.periodStart, settlement.periodEnd);
  const state =
    settlement.status === "submitted" && settlement.submittedAt
      ? `submitted ${formatSubmittedDay(settlement.submittedAt)}`
      : "not submitted";
  return period ? `Period ${period} · ${state}` : state;
}
