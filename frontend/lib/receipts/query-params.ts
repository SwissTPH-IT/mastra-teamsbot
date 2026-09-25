// URL <-> Abfrage. Der gesamte Filterzustand steht in den Query-Parametern und
// nirgends sonst: damit ist eine Ansicht teilbar, der Zurueck-Button
// funktioniert, und der Export-Endpunkt parst exakt dieselben Parameter wie die
// Seite (er tut es auch - siehe app/api/export).

/** Die Zeitraeume aus dem Mockup. Kein freies Datumsfeld, drei Vorgaben. */
export const PERIODS = [
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "90", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: null },
] as const;

export type Period = (typeof PERIODS)[number]["value"];
const DEFAULT_PERIOD: Period = "30";

/** Nach welchen Spalten sortiert werden darf. Keine freie Spaltenwahl aus der URL. */
export const SORT_FIELDS = ["receiptDate", "totalAmount", "createdAt", "merchant"] as const;
export type SortField = (typeof SORT_FIELDS)[number];
export type SortDirection = "asc" | "desc";

export const PAGE_SIZES = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

export type ReceiptQuery = {
  /**
   * Freitext ueber Haendler, Kategorie, Belegart und Referenznummer.
   *
   * Die Vorlage zeigt kein Suchfeld, der Dienst kann es aber - der Parameter
   * bleibt deshalb lesbar, damit ein geteilter Link mit ?q= funktioniert.
   */
  q: string;
  period: Period;
  /** Exakte Kategorie. Leer heisst "alle", nicht "ohne Kategorie". */
  category: string;
  /** Nur Belege, die in keiner Abrechnung liegen. In der URL als `unassigned=1`. */
  unassigned: boolean;
  sort: SortField;
  dir: SortDirection;
  page: number;
  pageSize: number;
  /**
   * Zeitraum auf dem BELEGDATUM (receipt_date), abgeleitet aus `period`.
   * YYYY-MM-DD oder null. Steht nicht in der URL: `period` ist die Wahrheit,
   * `from` die Rechnung daraus.
   */
  from: string | null;
  to: string | null;
};

/** Query-Parameter, die zur Abfrage gehoeren - fuer Links, die andere behalten sollen. */
export const QUERY_PARAM_KEYS = [
  "q",
  "period",
  "category",
  "unassigned",
  "sort",
  "dir",
  "page",
  "pageSize",
] as const;

function readOne(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value === null || value.trim() === "" ? null : value.trim();
}

/**
 * Der Zeitraum als Datumsgrenze.
 *
 * Bewusst auf dem Kalendertag gerechnet und nicht auf einem Zeitstempel: das
 * Belegdatum ist ein `date`. Ein Tag durch eine Zeitzonenkonvertierung zu
 * schicken verschiebt ihn (siehe format.ts), deshalb Europe/Zurich explizit
 * beim Bestimmen von "heute".
 */
export function periodStart(period: Period, today = new Date()): string | null {
  const days = PERIODS.find((entry) => entry.value === period)?.days ?? null;
  if (days === null) return null;

  const swissToday = new Date(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(today),
  );
  swissToday.setUTCDate(swissToday.getUTCDate() - days);
  return swissToday.toISOString().slice(0, 10);
}

/**
 * Toleranter Parser: unbekannte oder unsinnige Werte fallen auf den Default
 * zurueck, statt einen Fehler zu werfen. Eine von Hand zusammengebaute URL soll
 * eine Tabelle zeigen und keine Fehlerseite.
 */
export function parseReceiptQuery(input: URLSearchParams): ReceiptQuery {
  const periodRaw = readOne(input, "period");
  const period = PERIODS.find((entry) => entry.value === periodRaw)?.value ?? DEFAULT_PERIOD;

  const sortRaw = readOne(input, "sort");
  const sort = SORT_FIELDS.find((field) => field === sortRaw) ?? "receiptDate";

  const pageSizeRaw = Number(readOne(input, "pageSize"));
  const pageSize = PAGE_SIZES.find((size) => size === pageSizeRaw) ?? DEFAULT_PAGE_SIZE;

  const pageRaw = Number(readOne(input, "page"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return {
    q: readOne(input, "q") ?? "",
    period,
    category: readOne(input, "category") ?? "",
    unassigned: readOne(input, "unassigned") === "1",
    sort,
    dir: readOne(input, "dir") === "asc" ? "asc" : "desc",
    page,
    pageSize,
    from: periodStart(period),
    to: null,
  };
}

/** Next uebergibt searchParams als Record; hier in URLSearchParams uebersetzt. */
export function toSearchParams(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    params.set(key, Array.isArray(value) ? (value[0] ?? "") : value);
  }
  return params;
}

/**
 * Serialisiert zurueck in eine URL - nur was vom Default abweicht, damit die
 * Adresszeile lesbar bleibt. `page` faellt raus, wenn es 1 ist.
 *
 * Jede Filteraenderung setzt die Seite zurueck: Seite 7 eines anderen Filters
 * ist meistens leer, und eine leere Tabelle nach einem Klick auf einen Filter
 * sieht wie ein Fehler aus.
 */
export function serializeReceiptQuery(
  query: ReceiptQuery,
  overrides: Partial<ReceiptQuery> = {},
): string {
  const resetsPage = Object.keys(overrides).some((key) =>
    ["q", "period", "category", "unassigned", "pageSize", "sort", "dir"].includes(key),
  );
  const merged = { ...query, ...overrides, ...(resetsPage ? { page: 1 } : {}) };
  const params = new URLSearchParams();

  if (merged.q) params.set("q", merged.q);
  if (merged.period !== DEFAULT_PERIOD) params.set("period", merged.period);
  if (merged.category) params.set("category", merged.category);
  if (merged.unassigned) params.set("unassigned", "1");
  if (merged.sort !== "receiptDate") params.set("sort", merged.sort);
  if (merged.dir !== "desc") params.set("dir", merged.dir);
  if (merged.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(merged.pageSize));
  if (merged.page > 1) params.set("page", String(merged.page));

  return params.toString();
}

/** True, wenn ueberhaupt ein Filter gesetzt ist - unterscheidet die Empty States. */
export function hasActiveFilter(query: ReceiptQuery): boolean {
  return (
    query.q !== "" || query.category !== "" || query.unassigned || query.period !== DEFAULT_PERIOD
  );
}
