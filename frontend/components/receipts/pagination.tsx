// Seitenweiter Blaetterer.
//
// Steht nicht in der Vorlage - die zeigt sieben Beispielzeilen. Mit echten
// Daten ist er nicht verzichtbar: der Dienst liefert hoechstens 200 Zeilen pro
// Aufruf (limit in api/src/routes/receipts.ts), und ein Jahr Belege sind mehr.
// Optisch bewusst zurueckhaltend, in der Formensprache der Filterzeile.

import Link from "next/link";
import { serializeReceiptQuery, type ReceiptQuery } from "@/lib/receipts/query-params";

const BUTTON =
  "border-line-2 bg-panel text-ink-2 hover:bg-surface h-9 rounded-[10px] border px-3 text-[13px] flex items-center";
const BUTTON_OFF =
  "border-line bg-surface text-ink-3 h-9 rounded-[10px] border px-3 text-[13px] flex items-center cursor-not-allowed opacity-60";

export function Pagination({ query, total }: { query: ReceiptQuery; total: number }) {
  const pageCount = Math.max(1, Math.ceil(total / query.pageSize));
  if (pageCount === 1) return null;

  const first = (query.page - 1) * query.pageSize + 1;
  const last = Math.min(query.page * query.pageSize, total);

  const href = (page: number) => {
    const search = serializeReceiptQuery(query, { page });
    return search ? `/receipts?${search}` : "/receipts";
  };

  return (
    <div className="flex items-center gap-[9px]">
      <span className="text-ink-3 tabular text-[12.5px]">
        {first}–{last} of {total}
      </span>
      <div className="ml-auto flex items-center gap-[9px]">
        {query.page > 1 ? (
          <Link href={href(query.page - 1)} className={BUTTON}>
            Previous
          </Link>
        ) : (
          <span className={BUTTON_OFF}>Previous</span>
        )}
        {query.page < pageCount ? (
          <Link href={href(query.page + 1)} className={BUTTON}>
            Next
          </Link>
        ) : (
          <span className={BUTTON_OFF}>Next</span>
        )}
      </div>
    </div>
  );
}
