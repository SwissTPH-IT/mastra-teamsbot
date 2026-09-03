// Die Tabelle.
//
// Ein echtes <table> mit <thead>/<th scope="col">, kein Div-Gitter: nur so
// liest ein Screenreader Spaltenzuordnung und Sortierrichtung vor, und nur so
// funktioniert Kopieren nach Excel. Server Component - Sortierung, Filterung
// und Paginierung passieren in der URL und in SQL, es gibt keinen
// Client-Zustand, den eine Client-Komponente halten muesste.
//
// Der Wrapper scrollt horizontal, nicht der Body: auf schmalen Viewports soll
// die Seite stehen bleiben und die Tabelle wandern.

import Link from "next/link";
import type { ReceiptQuery } from "@/lib/receipts/query-params";
import type { ReceiptRow } from "@/lib/receipts/queries";
import { formatReceiptDate } from "@/lib/receipts/format";
import { AmountCell, ConfidenceCell, Empty, TimestampCell, UserCell } from "./cells";
import { ColumnHeader, PlainHeader } from "./column-header";

export function ReceiptTable({ rows, query }: { rows: ReceiptRow[]; query: ReceiptQuery }) {
  return (
    <div className="border-line overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">
          Erfasste Belege, sortiert nach{" "}
          {query.sort === "totalAmount"
            ? "Betrag"
            : query.sort === "createdAt"
              ? "Erfassungszeitpunkt"
              : query.sort === "merchant"
                ? "Haendler"
                : "Belegdatum"}{" "}
          {query.dir === "asc" ? "aufsteigend" : "absteigend"}
        </caption>
        <thead className="bg-surface-2 border-line border-b">
          <tr>
            <ColumnHeader field="receiptDate" label="Datum" query={query} />
            <ColumnHeader field="merchant" label="Haendler" query={query} />
            <PlainHeader label="Kategorie" />
            <ColumnHeader field="totalAmount" label="Betrag" query={query} align="right" />
            <PlainHeader label="MwSt." align="right" />
            <PlainHeader label="Nutzer" />
            <ColumnHeader field="createdAt" label="Erfasst" query={query} align="right" />
            <PlainHeader label="Konfidenz" align="right" />
            <PlainHeader label="" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-line hover:bg-surface-2 border-b last:border-0">
              <td className="tabular px-3 py-2 whitespace-nowrap">
                {formatReceiptDate(row.receiptDate) ?? <Empty />}
              </td>
              <th scope="row" className="max-w-[280px] truncate px-3 py-2 text-left font-normal">
                {row.merchant ?? <Empty />}
              </th>
              <td className="text-fg-muted max-w-[160px] truncate px-3 py-2">
                {row.category ?? <Empty />}
              </td>
              <td className="px-3 py-2 text-right font-medium">
                <AmountCell value={row.totalAmount} currency={row.currency} />
              </td>
              <td className="text-fg-muted px-3 py-2 text-right">
                <AmountCell value={row.vatAmount} currency={row.currency} />
              </td>
              <td className="px-3 py-2">
                <UserCell value={row.userId} />
              </td>
              <td className="text-fg-muted px-3 py-2 text-right">
                <TimestampCell value={row.createdAt} />
              </td>
              <td className="px-3 py-2 text-right">
                <ConfidenceCell value={row.confidence} />
              </td>
              <td className="px-3 py-2 text-right">
                <Link
                  href={`/belege/${row.id}`}
                  className="text-accent whitespace-nowrap hover:underline"
                >
                  Details
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
