// Sortierbarer Spaltenkopf.
//
// Ein Link, keine Client-Komponente: Sortierung ist Teil der URL, nicht des
// Komponentenzustands. Ein Klick tauscht die Richtung, wenn die Spalte schon
// aktiv ist, und startet sonst absteigend - bei Datum und Betrag ist "das
// Neueste bzw. Groesste zuerst" die Erwartung.
//
// `aria-sort` auf dem <th> ist der Teil, den ein Screenreader braucht; ohne das
// ist der Link nur ein Link und die Sortierung unsichtbar.

import Link from "next/link";
import {
  serializeReceiptQuery,
  type ReceiptQuery,
  type SortField,
} from "@/lib/receipts/query-params";
import { cn } from "@/lib/utils";

export function ColumnHeader({
  field,
  label,
  query,
  align = "left",
}: {
  field: SortField;
  label: string;
  query: ReceiptQuery;
  align?: "left" | "right";
}) {
  const active = query.sort === field;
  const nextDir = active && query.dir === "desc" ? "asc" : "desc";
  const href = `/belege?${serializeReceiptQuery(query, { sort: field, dir: nextDir, page: 1 })}`;

  return (
    <th
      scope="col"
      aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "text-fg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wide",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      <Link
        href={href}
        className={cn(
          "hover:text-fg inline-flex items-center gap-1 whitespace-nowrap",
          active && "text-fg",
        )}
      >
        {label}
        <span aria-hidden className={cn("text-[9px]", !active && "opacity-0")}>
          {query.dir === "asc" ? "▲" : "▼"}
        </span>
      </Link>
    </th>
  );
}

/** Nicht sortierbare Spalte - gleiche Optik, kein Link. */
export function PlainHeader({
  label,
  align = "left",
}: {
  label: string;
  align?: "left" | "right";
}) {
  return (
    <th
      scope="col"
      className={cn(
        "text-fg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {label}
    </th>
  );
}
