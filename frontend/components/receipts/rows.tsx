// Die Belegzeile, in zwei Ausfuehrungen: kompakt fuer "Recent items" auf der
// Startseite, vollstaendig fuer die Liste.
//
// Beide benutzen dieselben Bausteine - Abzeichen, Kategorie-Text, Herkunft -,
// damit derselbe Beleg auf beiden Seiten gleich aussieht. Gedoppelte Zellen
// waren in der Vorgaengerfassung die Stelle, an der zwei Ansichten
// auseinanderliefen.

import Link from "next/link";
import type { ApiReceipt } from "@/lib/api/receipts";
import { categoryLabel } from "@/lib/receipts/categories";
import { formatAmount, formatReceiptDate } from "@/lib/receipts/format";
import { needsReview, receiptTitle, sourceLabel } from "@/lib/receipts/review";

/** "Review" - der Beleg hat gemeldete Probleme oder eine niedrige Konfidenz. */
export function ReviewBadge() {
  return (
    <span className="bg-warn-soft text-warn-deep-strong flex-none rounded-full px-[7px] py-px text-[11px]">
      Review
    </span>
  );
}

function Title({ receipt }: { receipt: ApiReceipt }) {
  const title = receiptTitle(receipt);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className={`truncate text-sm ${title.muted ? "text-ink-3" : "text-ink"}`}
        title={title.text}
      >
        {title.text}
      </span>
      {needsReview(receipt) ? <ReviewBadge /> : null}
    </span>
  );
}

function Source({ receipt }: { receipt: ApiReceipt }) {
  const label = sourceLabel(receipt);
  return (
    <span className="text-ink-3 flex items-center gap-[6px] text-[12.5px]">
      <span
        className={`h-[5px] w-[5px] flex-none rounded-full ${
          label === "receipt" ? "bg-brand" : "bg-line-2"
        }`}
      />
      {label}
    </span>
  );
}

function Category({ receipt }: { receipt: ApiReceipt }) {
  return (
    <span className={`text-[13px] ${receipt.category ? "text-ink-2" : "text-ink-3"}`}>
      {categoryLabel(receipt.category)}
    </span>
  );
}

/** Die fuenf letzten Belege auf der Startseite. Ohne Auswahl und Zuordnung. */
export function RecentRow({ receipt }: { receipt: ApiReceipt }) {
  return (
    <Link
      href={`/receipts/${receipt.id}`}
      className="border-line bg-panel hover:bg-surface grid h-12 w-full grid-cols-[92px_minmax(0,1fr)_150px_116px_110px] items-center gap-4 border-t px-[18px] text-left first:border-t-0"
    >
      <span className="text-ink-3 tabular text-[13px]">
        {formatReceiptDate(receipt.receiptDate) ?? "–"}
      </span>
      <Title receipt={receipt} />
      <Category receipt={receipt} />
      <Source receipt={receipt} />
      <span className="tabular text-right text-sm">{formatAmount(receipt.totalAmount) ?? "–"}</span>
    </Link>
  );
}

/**
 * Eine Zeile der Belegliste.
 *
 * Die Zuordnungsspalte steht in der Vorlage und bleibt hier stehen, zeigt aber
 * nur "not assigned": es gibt noch keine Abrechnungen, denen ein Beleg
 * zugeordnet sein koennte. Die Spalte zu entfernen und spaeter wieder
 * einzusetzen wuerde die Spaltenbreiten zweimal verschieben.
 */
export function ReceiptRow({ receipt }: { receipt: ApiReceipt }) {
  return (
    <Link
      href={`/receipts/${receipt.id}`}
      className="border-line bg-panel hover:bg-surface grid h-[50px] w-full grid-cols-[92px_minmax(0,1fr)_146px_110px_118px_186px] items-center gap-[14px] border-b px-[18px] text-left"
    >
      <span className="text-ink-3 tabular text-[13px]">
        {formatReceiptDate(receipt.receiptDate) ?? "–"}
      </span>
      <Title receipt={receipt} />
      <Category receipt={receipt} />
      <span className="tabular text-right text-sm">{formatAmount(receipt.totalAmount) ?? "–"}</span>
      <Source receipt={receipt} />
      <span className="text-ink-3 truncate text-[12.5px]">not assigned</span>
    </Link>
  );
}

/** Der Kopf der Belegliste. Spaltenbreiten identisch zu ReceiptRow. */
export function ReceiptTableHeader() {
  const columns = [
    { label: "Date", align: "" },
    { label: "Merchant / label", align: "" },
    { label: "Category", align: "" },
    { label: "Amount", align: "text-right" },
    { label: "Source", align: "" },
    { label: "Assignment", align: "" },
  ];

  return (
    <div className="border-line grid h-10 grid-cols-[92px_minmax(0,1fr)_146px_110px_118px_186px] items-center gap-[14px] border-b px-[18px]">
      {columns.map((column) => (
        <span
          key={column.label}
          className={`text-ink-3 text-[10.5px] font-semibold tracking-[0.08em] uppercase ${column.align}`}
        >
          {column.label}
        </span>
      ))}
    </div>
  );
}
