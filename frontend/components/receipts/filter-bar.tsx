// Filterleiste.
//
// Ein normales GET-Formular auf /belege - deshalb keine Client-Komponente und
// kein State: Absenden schreibt die Felder in die URL, und die Seite liest sie
// beim Rendern wieder (siehe lib/receipts/query-params.ts). Damit sind
// Ansichten teilbar, der Zurueck-Button funktioniert, und die Leiste
// funktioniert auch ohne JavaScript.
//
// Sortierung und Seitengroesse reisen als Hidden-Fields mit, damit ein neuer
// Filter sie nicht zuruecksetzt. `page` reist bewusst NICHT mit: ein geaenderter
// Filter fuehrt zurueck auf Seite 1, sonst landet man auf einer leeren Seite 7.

import Link from "next/link";
import type { ReceiptQuery } from "@/lib/receipts/query-params";
import { hasActiveFilter, PAGE_SIZES } from "@/lib/receipts/query-params";

const FIELD =
  "border-line bg-surface text-fg placeholder:text-fg-subtle h-8 rounded-md border px-2.5 text-[13px] " +
  "focus-visible:border-accent";
const LABEL = "text-fg-muted text-[11px] font-medium uppercase tracking-wide";

export function FilterBar({ query }: { query: ReceiptQuery }) {
  return (
    <form action="/belege" method="get" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="sort" value={query.sort} />
      <input type="hidden" name="dir" value={query.dir} />

      <div className="flex min-w-[220px] flex-col gap-1">
        <label className={LABEL} htmlFor="filter-q">
          Suche
        </label>
        <input
          id="filter-q"
          name="q"
          type="search"
          defaultValue={query.q}
          placeholder="Haendler oder Kategorie"
          className={`${FIELD} w-full`}
        />
      </div>

      <fieldset className="border-0 p-0">
        <legend className={LABEL}>Belegdatum</legend>
        <div className="mt-1 flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-fg-subtle text-[11px]" htmlFor="filter-from">
              von
            </label>
            <input
              id="filter-from"
              name="from"
              type="date"
              defaultValue={query.from ?? ""}
              className={`${FIELD} tabular`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-fg-subtle text-[11px]" htmlFor="filter-to">
              bis
            </label>
            <input
              id="filter-to"
              name="to"
              type="date"
              defaultValue={query.to ?? ""}
              className={`${FIELD} tabular`}
            />
          </div>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label className={LABEL} htmlFor="filter-page-size">
          Zeilen
        </label>
        <select
          id="filter-page-size"
          name="pageSize"
          defaultValue={String(query.pageSize)}
          className={`${FIELD} tabular`}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        className="bg-fg text-bg h-8 rounded-md px-3 text-[13px] font-medium hover:opacity-90"
      >
        Filtern
      </button>

      {hasActiveFilter(query) && (
        <Link href="/belege" className="text-fg-muted h-8 px-1 text-[13px] leading-8 underline">
          zuruecksetzen
        </Link>
      )}
    </form>
  );
}
