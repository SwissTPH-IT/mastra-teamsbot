// Worauf eine Abrechnung lauten kann.
//
// Spiegel von SETTLEMENT_CURRENCIES in src/db/schema.ts - das Frontend
// importiert nichts aus src/. Entscheiden tut der Dienst (400 bei allem
// anderen); diese Liste fuellt nur die Auswahl. Beide aendern.

export const SETTLEMENT_CURRENCIES = ["CHF", "EUR", "USD", "GBP"] as const;
export type SettlementCurrency = (typeof SETTLEMENT_CURRENCIES)[number];

/** Vorauswahl beim Anlegen. Eine Vorauswahl, kein stiller Default: sie steht sichtbar im Formular. */
export const DEFAULT_SETTLEMENT_CURRENCY: SettlementCurrency = "CHF";

export function isSettlementCurrency(value: string): value is SettlementCurrency {
  return (SETTLEMENT_CURRENCIES as readonly string[]).includes(value);
}
