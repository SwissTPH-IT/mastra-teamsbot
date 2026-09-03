// Die Belegtabelle.
//
// Server Component: Filter, Sortierung und Paginierung stehen in der URL, die
// Daten kommen serverseitig aus der Query-Schicht. Der Browser bekommt keine
// Datenbankverbindung und keinen Connection String zu sehen, und es gibt
// keinen Client-Zustand, der mit der URL synchron gehalten werden muesste.
//
// Die Suspense-Grenze steht hier und nicht in einer loading.tsx: eine
// loading.tsx wuerde auch fuer /belege/<id> gelten und dort den Response
// starten, bevor klar ist, ob der Beleg existiert - notFound() koennte den
// Status dann nicht mehr auf 404 setzen (siehe table-skeleton.tsx).

import { Suspense } from "react";
import { FilterBar } from "@/components/receipts/filter-bar";
import { ExportButton } from "@/components/receipts/export-button";
import { NoDataYet, NoMatches } from "@/components/receipts/empty-state";
import { Pagination } from "@/components/receipts/pagination";
import { ReceiptTable } from "@/components/receipts/receipt-table";
import { TableSkeleton } from "@/components/receipts/table-skeleton";
import {
  hasActiveFilter,
  parseReceiptQuery,
  serializeReceiptQuery,
  toSearchParams,
  type ReceiptQuery,
} from "@/lib/receipts/query-params";
import { listReceipts } from "@/lib/receipts/queries";
import { resolveScope } from "@/lib/receipts/scope";

// Die Ansicht zeigt den aktuellen Datenbankstand; ein Cache waere hier eine
// Fehlerquelle und kein Gewinn.
export const dynamic = "force-dynamic";

export default async function BelegePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseReceiptQuery(toSearchParams(await searchParams));

  return (
    <div className="flex flex-col gap-4">
      {/* Die Filterleiste braucht keine Datenbank und bleibt deshalb ausserhalb
          der Suspense-Grenze stehen - sie soll beim Filtern nicht verschwinden. */}
      <FilterBar query={query} />

      <Suspense key={serializeReceiptQuery(query)} fallback={<TableSkeleton />}>
        <Ergebnis query={query} />
      </Suspense>
    </div>
  );
}

async function Ergebnis({ query }: { query: ReceiptQuery }) {
  const scope = await resolveScope();
  const { rows, total, page, pageCount } = await listReceipts(scope, query);

  if (rows.length === 0) {
    return hasActiveFilter(query) ? <NoMatches /> : <NoDataYet />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <ExportButton query={query} total={total} />
      </div>
      <ReceiptTable rows={rows} query={query} />
      <Pagination query={query} page={page} pageCount={pageCount} total={total} />
    </div>
  );
}
