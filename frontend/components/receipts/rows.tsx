// Die Belegzeile, in zwei Ausfuehrungen: kompakt fuer "Recent items" auf der
// Startseite, vollstaendig fuer die Liste.
//
// Beide benutzen dieselben Bausteine - Abzeichen, Kategorie-Text, Herkunft -,
// damit derselbe Beleg auf beiden Seiten gleich aussieht. Gedoppelte Zellen
// waren in der Vorgaengerfassung die Stelle, an der zwei Ansichten
// auseinanderliefen.

import Link from "next/link";
import { SelectAll, SelectBox } from "@/components/settlements/selection";
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

/** Gesperrt heisst: in einer eingereichten Abrechnung. Dann weder auswaehlen noch verschieben. */
export function lockedReason(receipt: ApiReceipt): string | undefined {
  return receipt.settlement?.status === "submitted"
    ? "Locked: in a submitted settlement"
    : undefined;
}

/** "in Field visit Bern" oder "free" - wie die Spalte in der Vorlage. */
function Assignment({ receipt }: { receipt: ApiReceipt }) {
  if (!receipt.settlement) {
    return <span className="text-brand-deep truncate text-[12.5px]">free</span>;
  }
  return (
    <span className="text-ink-2 truncate text-[12.5px]" title={receipt.settlement.title ?? ""}>
      in {receipt.settlement.title}
    </span>
  );
}

const ROW_GRID = "grid-cols-[92px_minmax(0,1fr)_146px_110px_118px_186px]";

/**
 * Eine Zeile der Belegliste.
 *
 * Die Checkbox steht AUSSERHALB des Links: ein Klick auf sie soll auswaehlen
 * und nicht in die Detailansicht springen, und ein <input> in einem <a> ist
 * ohnehin kein gueltiges HTML.
 */
export function ReceiptRow({ receipt }: { receipt: ApiReceipt }) {
  return (
    <div className="border-line bg-panel hover:bg-surface grid grid-cols-[18px_minmax(0,1fr)] items-center gap-[14px] border-b pl-[18px]">
      <SelectBox
        id={receipt.id}
        amount={receipt.totalAmount}
        currency={receipt.currency}
        label={receiptTitle(receipt).text}
        disabledReason={lockedReason(receipt)}
      />
      <Link
        href={`/receipts/${receipt.id}`}
        className={`grid h-[50px] w-full ${ROW_GRID} items-center gap-[14px] pr-[18px] text-left`}
      >
        <span className="text-ink-3 tabular text-[13px]">
          {formatReceiptDate(receipt.receiptDate) ?? "–"}
        </span>
        <Title receipt={receipt} />
        <Category receipt={receipt} />
        <span className="tabular text-right text-sm">
          {formatAmount(receipt.totalAmount) ?? "–"}
        </span>
        <Source receipt={receipt} />
        <Assignment receipt={receipt} />
      </Link>
    </div>
  );
}

/**
 * Der Kopf der Belegliste. Spaltenbreiten identisch zu ReceiptRow.
 *
 * `receipts` fuer "alle auswaehlen": nur die Zeilen dieser Seite und nur die
 * nicht gesperrten. Ohne (im Ladezustand) steht eine deaktivierte Box da,
 * damit die Spalten nicht springen.
 */
export function ReceiptTableHeader({ receipts }: { receipts?: ApiReceipt[] }) {
  const columns = [
    { label: "Date", align: "" },
    { label: "Merchant / label", align: "" },
    { label: "Category", align: "" },
    { label: "Amount", align: "text-right" },
    { label: "Source", align: "" },
    { label: "Assignment", align: "" },
  ];

  const selectable = (receipts ?? [])
    .filter((receipt) => !lockedReason(receipt))
    .map((receipt) => ({
      id: receipt.id,
      amount: receipt.totalAmount,
      currency: receipt.currency,
    }));

  return (
    <div className="border-line grid h-10 grid-cols-[18px_minmax(0,1fr)] items-center gap-[14px] border-b px-[18px]">
      {receipts ? (
        <SelectAll rows={selectable} />
      ) : (
        <input type="checkbox" disabled aria-hidden className="h-4 w-4" />
      )}
      <div className={`grid ${ROW_GRID} items-center gap-[14px]`}>
        {columns.map((column) => (
          <span
            key={column.label}
            className={`text-ink-3 text-[10.5px] font-semibold tracking-[0.08em] uppercase ${column.align}`}
          >
            {column.label}
          </span>
        ))}
      </div>
    </div>
  );
}
