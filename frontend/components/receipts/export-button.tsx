// Export-Knopf.
//
// Ein <a> auf den Route Handler, mit genau den Query-Parametern der aktuellen
// Ansicht - kein fetch, kein Blob im Browser. Die Datei entsteht serverseitig
// und laeuft durch dieselbe Query-Schicht wie die Tabelle.
//
// Die Trefferzahl steht bewusst auf dem Knopf: exportiert wird, was die Filter
// treffen, nicht nur die sichtbare Seite. Ohne die Zahl ist das nicht zu
// erkennen.

import type { ReceiptQuery } from "@/lib/receipts/query-params";

export function ExportButton({ query, total }: { query: ReceiptQuery; total: number }) {
  // Nur die Filter, nicht page/pageSize/sort: der Export umfasst alle Treffer,
  // nicht die sichtbare Seite, und die Reihenfolge in einer Datei, die in Excel
  // neu sortiert wird, ist unerheblich (siehe streamReceipts).
  const params = new URLSearchParams({ format: "csv" });
  if (query.q) params.set("q", query.q);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);

  return (
    <a
      href={`/api/export?${params.toString()}`}
      download
      className="border-line text-fg hover:bg-surface-2 inline-flex h-8 items-center rounded-md border px-3 text-[13px] font-medium"
      aria-disabled={total === 0}
    >
      <span className="tabular">{total}</span>
      <span className="ml-1">{total === 1 ? "Beleg exportieren" : "Belege exportieren"}</span>
    </a>
  );
}
