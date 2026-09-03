// Serverseitige Paginierung: die Links tragen die Seitennummer in der URL, die
// Seite laedt die naechsten Zeilen aus der Datenbank. Es werden nie alle Zeilen
// geladen und im Browser durchgeblaettert.

import Link from "next/link";
import { serializeReceiptQuery, type ReceiptQuery } from "@/lib/receipts/query-params";
import { cn } from "@/lib/utils";

export function Pagination({
  query,
  page,
  pageCount,
  total,
}: {
  query: ReceiptQuery;
  page: number;
  pageCount: number;
  total: number;
}) {
  const first = (page - 1) * query.pageSize + 1;
  const last = Math.min(page * query.pageSize, total);

  return (
    <nav
      aria-label="Seitennavigation"
      className="text-fg-muted flex items-center justify-between gap-4 text-[13px]"
    >
      <p className="tabular">
        {first}&ndash;{last} von {total}
      </p>

      <div className="flex items-center gap-1">
        <PageLink query={query} page={page - 1} disabled={page <= 1} label="Zurueck" />
        <span className="tabular px-2">
          Seite {page} / {pageCount}
        </span>
        <PageLink query={query} page={page + 1} disabled={page >= pageCount} label="Weiter" />
      </div>
    </nav>
  );
}

function PageLink({
  query,
  page,
  disabled,
  label,
}: {
  query: ReceiptQuery;
  page: number;
  disabled: boolean;
  label: string;
}) {
  const className = cn(
    "border-line h-7 rounded-md border px-2.5 leading-[26px]",
    disabled ? "text-fg-subtle cursor-default opacity-50" : "hover:bg-surface-2 text-fg",
  );

  // Am Rand ein <span> statt eines toten Links: ein Link ohne Ziel ist mit
  // Tastatur erreichbar und tut nichts.
  if (disabled) {
    return (
      <span aria-disabled className={className}>
        {label}
      </span>
    );
  }

  return (
    <Link href={`/belege?${serializeReceiptQuery(query, { page })}`} className={className}>
      {label}
    </Link>
  );
}
