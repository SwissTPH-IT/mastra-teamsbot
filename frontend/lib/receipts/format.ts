// Anzeigeformatierung. Alles ueber Intl, nichts von Hand zusammengebaut.
//
// Der Unterschied, auf den es hier ankommt: receipt_date ist in Postgres ein
// `date` (ein Kalendertag ohne Zeitzone), created_at/updated_at sind
// `timestamptz` (ein Zeitpunkt). Ein Kalendertag durch eine
// Zeitzonenkonvertierung zu schicken verschiebt ihn - "2026-01-01" wird als
// UTC-Mitternacht gelesen und in Europe/Zurich zu 01:00 desselben Tags, im
// Sommer zu 02:00, und bei einer Zone westlich von UTC zum Vortag. Deshalb
// zwei getrennte Formatierer.

const AMOUNT_FORMATTERS = new Map<string, Intl.NumberFormat>();

/** de-CH: Tausender-Apostroph, Punkt als Dezimaltrenner. */
function amountFormatter(currency: string | null): Intl.NumberFormat {
  const key = currency ?? "";
  let formatter = AMOUNT_FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("de-CH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...(currency
        ? { style: "currency" as const, currency, currencyDisplay: "code" as const }
        : {}),
    });
    AMOUNT_FORMATTERS.set(key, formatter);
  }
  return formatter;
}

/**
 * Betrag mit Waehrung.
 *
 * `value` kommt als String aus der Datenbank: node-postgres parst `numeric`
 * absichtlich nicht, weil ein double den Wert nicht exakt halten kann. Der
 * Number() hier ist nur fuer die Anzeige - fuer den Export bleibt der String
 * unangetastet (siehe lib/export/csv.ts).
 */
export function formatAmount(value: string | null, currency: string | null): string | null {
  if (value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return amountFormatter(currency).format(numeric);
}

/** Prozentsatz, z. B. "8.100" -> "8.1 %". */
export function formatRate(value: string | null): string | null {
  if (value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return `${new Intl.NumberFormat("de-CH", { maximumFractionDigits: 2 }).format(numeric)} %`;
}

const DATE_PARTS = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Belegdatum (`date`) als dd.MM.yyyy - ohne Umweg ueber Date und damit ohne
 * Zeitzone. Siehe Kommentar am Dateikopf.
 */
export function formatReceiptDate(value: string | null): string | null {
  if (!value) return null;
  const match = DATE_PARTS.exec(value);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Erfassungszeitpunkt (`timestamptz`), angezeigt in Europe/Zurich. */
export function formatTimestamp(value: Date | null): string | null {
  if (!value) return null;
  return TIMESTAMP_FORMATTER.format(value);
}

/** ISO-Datum fuer <input type="date"> und Dateinamen. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
