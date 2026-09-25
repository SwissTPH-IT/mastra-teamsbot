// Die Belegliste.
//
// Serverseitig gerendert und serverseitig gefiltert: Zeitraum, Kategorie,
// Sortierung und Seite gehen als Parameter an den Dienst. Keine Komponente
// filtert selbst - eine im Browser gefilterte Tabelle zeigt bei 200 Zeilen pro
// Seite etwas anderes als die Trefferzahl daneben.

import { Suspense } from "react";
import { FilterBar } from "@/components/receipts/filter-bar";
import { Pagination } from "@/components/receipts/pagination";
import { SelectionBar, SelectionProvider } from "@/components/settlements/selection";
import { ReceiptRow, ReceiptTableHeader } from "@/components/receipts/rows";
import {
  NoMatches,
  NoReceipts,
  ServiceUnavailable,
  UnlinkedAccount,
} from "@/components/receipts/states";
import { classifyFailure } from "@/lib/api/guard";
import { fetchCategories, fetchReceiptPage, fetchSummary } from "@/lib/api/receipts";
import { fetchSettlements, type ApiSettlement } from "@/lib/api/settlements";
import {
  hasActiveFilter,
  parseReceiptQuery,
  serializeReceiptQuery,
  toSearchParams,
  type ReceiptQuery,
} from "@/lib/receipts/query-params";

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseReceiptQuery(toSearchParams(await searchParams));

  return (
    <div className="flex flex-col gap-[22px]">
      {/* Der Kopf steht sofort, die Tabelle kommt nach. Die Suspense-Grenze
          sitzt hier und NICHT in einer loading.tsx: eine loading.tsx deckt auch
          Kindsegmente ab, dann wuerde /receipts/<id> zu streamen anfangen,
          bevor notFound() laeuft - und die 404-Seite ginge mit Status 200
          raus. */}
      <Suspense key={serializeReceiptQuery(query)} fallback={<Skeleton query={query} />}>
        <List query={query} />
      </Suspense>
    </div>
  );
}

async function List({ query }: { query: ReceiptQuery }) {
  let page;
  let categories: string[] = [];
  let drafts: ApiSettlement[] = [];
  let unassigned = 0;

  try {
    // Parallel: Kategorien, offene Entwuerfe (fuer "Add to settlement") und
    // die Zahl der freien Belege haengen nicht an der Seite. Die freien unter
    // denselben Filtern wie die Tabelle - sonst stuende "12 unassigned" neben
    // einer Liste, die nur 3 davon zeigt.
    const [pageResult, categoryList, draftList, free] = await Promise.all([
      fetchReceiptPage(query),
      fetchCategories(),
      fetchSettlements("draft"),
      fetchSummary({ ...query, unassigned: true }),
    ]);
    page = pageResult;
    categories = categoryList;
    drafts = draftList;
    unassigned = free.reduce((sum, entry) => sum + entry.count, 0);
  } catch (error) {
    const failure = classifyFailure(error);
    return (
      <>
        <Header summary="" />
        {failure.kind === "unlinked" ? (
          <UnlinkedAccount />
        ) : (
          <ServiceUnavailable detail={failure.detail} />
        )}
      </>
    );
  }

  const filtered = hasActiveFilter(query);
  const summary =
    page.total === 0
      ? filtered
        ? "No items match"
        : "No items yet"
      : `${page.count} of ${page.total} items · ${unassigned} unassigned`;

  return (
    <SelectionProvider>
      <Header summary={summary} query={query} />
      <FilterBar query={query} categories={categories} filtersActive={filtered} />

      {page.total === 0 && !filtered ? (
        <NoReceipts />
      ) : (
        <>
          <div className="border-line bg-panel overflow-hidden rounded-xl border">
            <ReceiptTableHeader receipts={page.receipts} />
            {page.receipts.map((receipt) => (
              <ReceiptRow key={receipt.id} receipt={receipt} />
            ))}
            {page.receipts.length === 0 ? <NoMatches /> : null}
          </div>
          <Pagination query={query} total={page.total} />
        </>
      )}

      <SelectionBar settlements={drafts} />
    </SelectionProvider>
  );
}

function Header({ summary, query }: { summary: string; query?: ReceiptQuery }) {
  const search = query ? serializeReceiptQuery(query) : "";

  return (
    <div className="flex items-end justify-between gap-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.018em]">Receipts</h1>
        <div className="text-ink-3 mt-[6px] text-[13px]">{summary || " "}</div>
      </div>
      <div className="flex gap-[9px]">
        {/* Der Export gehoert nicht zur Vorlage, aber zur bestehenden
            Oberflaeche - und er laeuft durch dieselben Filter wie die Liste
            (siehe app/api/export). Ihn wegzulassen waere ein Rueckschritt. */}
        {query ? (
          <a
            href={search ? `/api/export?${search}` : "/api/export"}
            className="border-line-2 bg-panel text-ink-2 hover:bg-surface flex h-10 items-center rounded-[10px] border px-[14px] text-[13.5px]"
          >
            Export CSV
          </a>
        ) : null}
        <button
          type="button"
          disabled
          title="Entering expenses without a receipt is not available yet"
          className="bg-surface text-ink-3 h-10 cursor-not-allowed rounded-[10px] px-4 text-[13.5px] font-medium"
        >
          Add expense without receipt
        </button>
      </div>
    </div>
  );
}

/** Die Tabelle in Umrissen, waehrend die Abfrage laeuft. Gleiche Zeilenhoehe. */
function Skeleton({ query }: { query: ReceiptQuery }) {
  return (
    <>
      <Header summary="Loading…" />
      <div className="border-line bg-panel overflow-hidden rounded-xl border">
        <ReceiptTableHeader />
        {Array.from({ length: Math.min(query.pageSize, 8) }).map((_, index) => (
          <div key={index} className="border-line flex h-[50px] items-center border-b px-[18px]">
            <div className="bg-surface h-[14px] w-full max-w-[680px] animate-pulse rounded-[7px]" />
          </div>
        ))}
      </div>
    </>
  );
}
