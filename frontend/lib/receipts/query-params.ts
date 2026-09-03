// URL <-> Abfrage. Der gesamte Filter- und Sortierzustand steht in den
// Query-Parametern und nirgends sonst: damit ist eine Ansicht teilbar, der
// Zurueck-Button funktioniert, und der Export-Endpunkt kann exakt dieselben
// Parameter parsen wie die Seite (er tut es auch - siehe app/api/export).

/** Nach welchen Spalten sortiert werden darf. Keine freie Spaltenwahl aus der URL. */
export const SORT_FIELDS = ["receiptDate", "totalAmount", "createdAt", "merchant"] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export type SortDirection = "asc" | "desc";

export const PAGE_SIZES = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;

export type ReceiptQuery = {
  /** Freitext ueber Haendler und Kategorie. Leerstring heisst "kein Filter". */
  q: string;
  /** Zeitraum auf dem BELEGDATUM (receipt_date), nicht auf createdAt. YYYY-MM-DD. */
  from: string | null;
  to: string | null;
  sort: SortField;
  dir: SortDirection;
  page: number;
  pageSize: number;
};

/** Query-Parameter, die zur Abfrage gehoeren - fuer Links, die andere behalten sollen. */
export const QUERY_PARAM_KEYS = ["q", "from", "to", "sort", "dir", "page", "pageSize"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readOne(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value === null || value.trim() === "" ? null : value.trim();
}

/**
 * Toleranter Parser: unbekannte oder unsinnige Werte fallen auf den Default
 * zurueck, statt einen Fehler zu werfen. Eine von Hand zusammengebaute URL soll
 * eine Tabelle zeigen und keine Fehlerseite.
 */
export function parseReceiptQuery(input: URLSearchParams): ReceiptQuery {
  const sortRaw = readOne(input, "sort");
  const sort = SORT_FIELDS.find((field) => field === sortRaw) ?? "receiptDate";

  const dirRaw = readOne(input, "dir");
  const dir: SortDirection = dirRaw === "asc" ? "asc" : "desc";

  const from = readOne(input, "from");
  const to = readOne(input, "to");

  const pageSizeRaw = Number(readOne(input, "pageSize"));
  const pageSize = PAGE_SIZES.find((size) => size === pageSizeRaw) ?? DEFAULT_PAGE_SIZE;

  const pageRaw = Number(readOne(input, "page"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return {
    q: readOne(input, "q") ?? "",
    from: from && ISO_DATE.test(from) ? from : null,
    to: to && ISO_DATE.test(to) ? to : null,
    sort,
    dir,
    page,
    pageSize,
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
 */
export function serializeReceiptQuery(
  query: ReceiptQuery,
  overrides: Partial<ReceiptQuery> = {},
): string {
  const merged = { ...query, ...overrides };
  const params = new URLSearchParams();

  if (merged.q) params.set("q", merged.q);
  if (merged.from) params.set("from", merged.from);
  if (merged.to) params.set("to", merged.to);
  if (merged.sort !== "receiptDate") params.set("sort", merged.sort);
  if (merged.dir !== "desc") params.set("dir", merged.dir);
  if (merged.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(merged.pageSize));
  if (merged.page > 1) params.set("page", String(merged.page));

  return params.toString();
}

/** True, wenn ueberhaupt ein Filter gesetzt ist - unterscheidet die Empty States. */
export function hasActiveFilter(query: ReceiptQuery): boolean {
  return query.q !== "" || query.from !== null || query.to !== null;
}
