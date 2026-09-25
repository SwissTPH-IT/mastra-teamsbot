"use client";

// Die Filterzeile aus der Vorlage.
//
// Jede Aenderung geht in die URL, nicht in einen lokalen Zustand: eine gefilterte
// Ansicht ist damit teilbar, der Zurueck-Button funktioniert, und der
// Export-Endpunkt liest exakt dieselben Parameter (siehe app/api/export).
// serializeReceiptQuery() setzt dabei die Seite zurueck - Seite 7 eines anderen
// Filters ist meistens leer.

import { useRouter } from "next/navigation";
import { PERIODS, serializeReceiptQuery, type ReceiptQuery } from "@/lib/receipts/query-params";

/**
 * Die drei Umschalter, die noch nichts filtern koennen.
 *
 * "Unassigned only" braucht Abrechnungen, "With/Without receipt" braucht
 * selbst eingetragene Belege - beides gibt es nicht. Sie stehen hier, weil die
 * Vorlage sie vorsieht und ihr Platz in der Zeile sonst zweimal wandert.
 */
const PENDING_TOGGLES = ["Unassigned only", "With receipt", "Without receipt"] as const;

const SELECT_CLASS =
  "border-line-2 bg-panel text-ink h-9 cursor-pointer appearance-none rounded-[10px] border pr-[34px] pl-[10px] text-[13px]";

// Der Pfeil als Data-URI wie in der Vorlage: ein Hintergrundbild statt eines
// zusaetzlichen Elements, damit das <select> ein echtes <select> bleibt
// (Tastatur, Screenreader, Mobil-Auswahlrad).
const CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none' stroke='%23767683' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M1 1.3 5 4.7 9 1.3'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  backgroundSize: "10px 6px",
} as const;

export function FilterBar({
  query,
  categories,
  filtersActive,
}: {
  query: ReceiptQuery;
  categories: string[];
  filtersActive: boolean;
}) {
  const router = useRouter();

  const go = (overrides: Partial<ReceiptQuery>) => {
    const search = serializeReceiptQuery(query, overrides);
    router.push(search ? `/receipts?${search}` : "/receipts");
  };

  return (
    <div className="flex flex-wrap items-center gap-[10px] pb-[2px]">
      <select
        value={query.period}
        onChange={(event) => go({ period: event.target.value as ReceiptQuery["period"] })}
        aria-label="Period"
        className={SELECT_CLASS}
        style={CHEVRON}
      >
        {PERIODS.map((period) => (
          <option key={period.value} value={period.value}>
            {period.label}
          </option>
        ))}
      </select>

      <select
        value={query.category}
        onChange={(event) => go({ category: event.target.value })}
        aria-label="Category"
        className={SELECT_CLASS}
        style={CHEVRON}
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>

      {PENDING_TOGGLES.map((label) => (
        <button
          key={label}
          type="button"
          disabled
          title="Not available yet - needs settlements and self-entered expenses"
          className="border-line bg-surface text-ink-3 h-9 cursor-not-allowed rounded-[10px] border px-[13px] text-[13px] opacity-60"
        >
          {label}
        </button>
      ))}

      <span className="text-ink-3 ml-1 text-xs">Period applies to the receipt date</span>

      {filtersActive ? (
        <button
          type="button"
          onClick={() => router.push("/receipts")}
          className="text-ink-2 ml-auto px-[2px] text-[13px]"
        >
          Reset filters
        </button>
      ) : null}
    </div>
  );
}
