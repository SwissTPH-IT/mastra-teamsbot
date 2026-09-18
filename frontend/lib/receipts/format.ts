// Anzeigeformatierung. Alles ueber Intl, nichts von Hand zusammengebaut.
//
// Der Unterschied, auf den es hier ankommt: receipt_date ist in Postgres ein
// `date` (ein Kalendertag ohne Zeitzone), created_at/updated_at sind
// `timestamptz` (ein Zeitpunkt). Ein Kalendertag durch eine
// Zeitzonenkonvertierung zu schicken verschiebt ihn - "2026-01-01" wird als
// UTC-Mitternacht gelesen und in Europe/Zurich zu 01:00 desselben Tags, im
// Sommer zu 02:00, und bei einer Zone westlich von UTC zum Vortag. Deshalb
// zwei getrennte Formatierer.
//
// Zahlenformat ist de-CH wie in der Vorlage (Tausender-Apostroph, Punkt als
// Dezimaltrenner) - unabhaengig davon, dass die Oberflaechentexte englisch
// sind. Ein Schweizer Beleg mit US-Formatierung liest sich falsch.

const AMOUNT_FORMATTER = new Intl.NumberFormat("de-CH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Betrag ohne Waehrung - fuer die Betragsspalte, die ihre Waehrung im
 * Spaltenkopf bzw. in der Kennzahl daneben traegt.
 *
 * `value` kommt als String aus dem Dienst: `numeric` wird absichtlich nicht als
 * Zahl geparst, weil ein double den Wert nicht exakt halten kann. Das Number()
 * hier ist nur fuer die Anzeige - fuer den Export bleibt der String
 * unangetastet (siehe lib/export/csv.ts).
 */
export function formatAmount(value: string | null): string | null {
  if (value === null) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value;
  return AMOUNT_FORMATTER.format(numeric);
}

/** Betrag mit Waehrungscode davor, z. B. "CHF 31.50". */
export function formatAmountWithCurrency(
  value: string | null,
  currency: string | null,
): string | null {
  const amount = formatAmount(value);
  if (amount === null) return null;
  return currency ? `${currency} ${amount}` : amount;
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

/**
 * Erfassungszeitpunkt, angezeigt in Europe/Zurich.
 *
 * Der Dienst liefert ISO-8601 mit Zone (toISOString), also einen echten
 * Zeitpunkt - hier ist die Konvertierung richtig und beim Belegdatum falsch.
 */
export function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return TIMESTAMP_FORMATTER.format(parsed);
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Zurich",
  weekday: "long",
});

/** "Thursday, 17.09.2026" - die Zeile unter der Begruessung auf der Startseite. */
export function formatToday(now = new Date()): string {
  const day = new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);
  return `${WEEKDAY_FORMATTER.format(now)}, ${day}`;
}

/**
 * Die Tageszeit-Begruessung aus der Vorlage.
 *
 * Nach Schweizer Zeit, nicht nach der Zone des Servers: "Good morning" um
 * 23 Uhr waere eine kleine, aber sichere Irritation.
 */
export function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Zurich",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Initialen fuer das Avatar-Rund in der Seitenleiste. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/** ISO-Datum fuer Dateinamen. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
