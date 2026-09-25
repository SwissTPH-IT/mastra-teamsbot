// Eine Abrechnung: Positionen links, Summen und Einreichen rechts.
//
// Aufbau wie "SETTLEMENT DETAIL" in der Vorlage, mit zwei Zustaenden statt
// drei: Draft und Submitted. "Query" (Rueckfrage von Finance) setzt eine
// Pruefrolle voraus, die es nicht gibt.
//
// Was im Entwurf erlaubt ist und was nicht, zeigt die Seite nur an - die
// Sperre selbst sitzt im Dienst. Ein ausgeblendeter "Remove"-Knopf ist
// Komfort, keine Sicherung.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ServiceUnavailable, UnlinkedAccount } from "@/components/receipts/states";
import { ReviewBadge } from "@/components/receipts/rows";
import { ActionButton } from "@/components/settlements/action-button";
import { CurrencySwitcher } from "@/components/settlements/currency-select";
import {
  deleteSettlementAction,
  removeFromSettlement,
  submitSettlementAction,
} from "@/app/(app)/settlements/actions";
import { classifyFailure } from "@/lib/api/guard";
import { isNotFound } from "@/lib/api/client";
import {
  fetchSettlement,
  type ApiSettlementDetail,
  type SettlementReceipt,
} from "@/lib/api/settlements";
import { categoryLabel } from "@/lib/receipts/categories";
import { formatAmount, formatReceiptDate } from "@/lib/receipts/format";
import { needsReview, receiptTitle, sourceLabel } from "@/lib/receipts/review";
import {
  MISSING_CONVERSION,
  STATUS_STYLE,
  conversionNote,
  formatSettlementTotal,
  formatSubmittedDay,
  itemCount,
  settlementMeta,
} from "@/lib/settlements/format";

/** Spalten der Positionsliste, fuer Kopf und Zeilen gleich. */
const COLUMNS = "grid-cols-[88px_minmax(0,1fr)_110px_minmax(150px,auto)_96px]";

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let settlement: ApiSettlementDetail;
  try {
    settlement = await fetchSettlement(id);
  } catch (error) {
    if (isNotFound(error)) notFound();
    const failure = classifyFailure(error);
    return failure.kind === "unlinked" ? (
      <UnlinkedAccount />
    ) : (
      <ServiceUnavailable detail={failure.detail} />
    );
  }

  const locked = settlement.status === "submitted";
  const style = STATUS_STYLE[settlement.status];
  const withoutType = settlement.receipts.filter((receipt) => !receipt.receiptType).length;
  const { missingCount, provisionalCount } = settlement.total;
  const blockedBy =
    settlement.receiptCount === 0
      ? "Add items first"
      : withoutType > 0
        ? "Every item needs a receipt type"
        : missingCount > 0
          ? "Every item needs an amount in the settlement currency"
          : provisionalCount > 0
            ? "Some exchange rates are not final yet"
            : undefined;

  return (
    <div className="flex flex-col gap-[22px]">
      <nav className="text-ink-3 flex items-center gap-[10px] text-[13px]">
        <Link href="/settlements" className="text-brand font-medium">
          Settlements
        </Link>
        <span>/</span>
        <span className="text-ink-2 truncate">{settlement.title}</span>
      </nav>

      <div className="flex items-start justify-between gap-5">
        <div className="flex flex-col gap-[7px]">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.018em]">{settlement.title}</h1>
            <span className="text-ink-2 flex items-center gap-[6px] text-[12.5px]">
              <span className={`h-[6px] w-[6px] rounded-full ${style.dot}`} />
              {style.label}
            </span>
          </div>
          <div className="text-ink-3 text-[13px]">{settlementMeta(settlement)}</div>
          {locked ? null : (
            <CurrencySwitcher settlementId={settlement.id} currency={settlement.currency} />
          )}
        </div>
        <div className="text-right">
          <div className="tabular text-[28px] font-semibold tracking-[-0.03em]">
            {formatAmount(settlement.total.sum)} {settlement.currency}
          </div>
          <div className="text-ink-3 mt-[2px] text-xs">
            {itemCount(settlement.receiptCount)}
            {missingCount > 0 ? ` · ${missingCount} not converted` : ""}
            {provisionalCount > 0 ? ` · ${provisionalCount} provisional rate` : ""}
          </div>
        </div>
      </div>

      {locked ? (
        <div className="border-line bg-surface flex flex-col gap-2 rounded-xl border px-[17px] py-[15px]">
          <div className="text-ink text-[13.5px] font-semibold">Submitted and locked</div>
          <div className="text-ink text-[13px] leading-[1.6]">
            Items can no longer be changed, removed or added. Still possible: view the settlement
            and its receipts and check the category totals. Corrections require Finance to return
            the settlement.
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)_280px] items-start gap-8">
        <div className="border-line bg-panel overflow-hidden rounded-xl border">
          <div className={`border-line grid h-[38px] ${COLUMNS} items-center gap-3 border-b px-4`}>
            {["Date", "Item", "Source", `Amount ${settlement.currency}`, ""].map((label, index) => (
              <span
                key={index}
                className={`text-ink-3 text-[10.5px] font-semibold tracking-[0.08em] uppercase ${
                  index === 3 ? "text-right" : ""
                }`}
              >
                {label}
              </span>
            ))}
          </div>

          {settlement.receipts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <div className="text-[15px] font-semibold">No items yet</div>
              <div className="text-ink-3 max-w-[380px] text-[13px] leading-[1.55]">
                Select receipts in the list and choose “Add to settlement”.
              </div>
            </div>
          ) : (
            settlement.receipts.map((receipt) => (
              <Position
                key={receipt.id}
                receipt={receipt}
                settlementId={settlement.id}
                settlementCurrency={settlement.currency}
                locked={locked}
              />
            ))
          )}
        </div>

        <div className="flex flex-col gap-[22px]">
          <CategoryTotals settlement={settlement} />

          <div className="flex flex-col gap-[9px]">
            {locked ? (
              <button
                type="button"
                disabled
                className="bg-surface text-ink-3 h-10 cursor-not-allowed rounded-[10px] px-4 text-[13.5px] font-medium"
              >
                Submitted {formatSubmittedDay(settlement.submittedAt)}
              </button>
            ) : (
              <ActionButton
                action={submitSettlementAction}
                fields={{ settlementId: settlement.id }}
                label="Submit"
                pendingLabel="Submitting…"
                disabled={blockedBy !== undefined}
                title={blockedBy}
                confirm={`Submit "${settlement.title}"? The settlement is locked afterwards: no new items, no corrections.`}
                className="bg-brand hover:bg-brand-deep disabled:bg-surface disabled:text-ink-3 h-10 rounded-[10px] px-4 text-[13.5px] font-medium text-white disabled:cursor-not-allowed"
              />
            )}

            {locked ? (
              <span className="border-line-2 bg-panel text-ink-3 flex h-[38px] cursor-not-allowed items-center justify-center rounded-[10px] border px-[14px] text-[13px]">
                Add more items
              </span>
            ) : (
              <Link
                href="/receipts?unassigned=1&period=all"
                className="border-line-2 bg-panel text-ink-2 hover:bg-surface flex h-[38px] items-center justify-center rounded-[10px] border px-[14px] text-[13px]"
              >
                Add more items
              </Link>
            )}

            {!locked && withoutType > 0 ? (
              <div className="text-warn-deep-strong text-xs leading-[1.55]">
                {withoutType === 1 ? "1 item has" : `${withoutType} items have`} no receipt type.
                Set it on the item before submitting.
              </div>
            ) : null}

            {!locked && missingCount > 0 ? (
              <div className="text-warn-deep-strong text-xs leading-[1.55]">
                {missingCount === 1 ? "1 item has" : `${missingCount} items have`} no amount in{" "}
                {settlement.currency}: amount, currency or date is missing, or no exchange rate is
                available for that day. They are not part of the total.
              </div>
            ) : null}

            {!locked && provisionalCount > 0 ? (
              <div className="text-ink-3 text-xs leading-[1.55]">
                {provisionalCount === 1
                  ? "1 exchange rate is"
                  : `${provisionalCount} exchange rates are`}{" "}
                provisional. The daily rate is fixed one to two days after the receipt date; submit
                then.
              </div>
            ) : null}

            <div className="text-ink-3 text-xs leading-[1.55]">
              {locked
                ? "Locked. Changes require Finance to return the settlement."
                : "Once submitted the settlement is locked: no new items, no corrections."}
            </div>

            {!locked ? (
              <div className="border-line mt-2 flex flex-col gap-1 border-t pt-3">
                <ActionButton
                  action={deleteSettlementAction}
                  fields={{ settlementId: settlement.id }}
                  label="Delete draft"
                  pendingLabel="Deleting…"
                  confirm={`Delete "${settlement.title}"? Its items stay and become unassigned again.`}
                  className="text-bad-deep self-start text-[12.5px] hover:underline"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Eine Position. Der Betrag steht in der Abrechnungswaehrung; darunter der
 * Originalbetrag und der Kurs des Belegdatums, damit nachvollziehbar ist, wie
 * die Zahl zustande kam.
 */
function Position({
  receipt,
  settlementId,
  settlementCurrency,
  locked,
}: {
  receipt: SettlementReceipt;
  settlementId: string;
  settlementCurrency: string;
  locked: boolean;
}) {
  const title = receiptTitle(receipt);
  const { conversion } = receipt;
  const note = conversionNote(receipt, conversion, settlementCurrency);
  const rateDay =
    conversion.rateDate && conversion.rateDate !== receipt.receiptDate
      ? `Rate of ${formatReceiptDate(conversion.rateDate)}`
      : undefined;
  return (
    <div
      className={`border-line grid min-h-12 ${COLUMNS} items-center gap-3 border-b px-4 py-[7px] last:border-b-0`}
    >
      <span className="tabular text-ink-3 text-[12.5px]">
        {formatReceiptDate(receipt.receiptDate) ?? "–"}
      </span>
      <Link href={`/receipts/${receipt.id}`} className="flex min-w-0 items-center gap-2">
        <span
          className={`truncate text-sm hover:underline ${title.muted ? "text-ink-3" : "text-ink"}`}
        >
          {title.text}
        </span>
        {needsReview(receipt) ? <ReviewBadge /> : null}
        {!receipt.receiptType && !locked ? (
          <span className="bg-warn-soft text-warn-deep-strong flex-none rounded-full px-[7px] py-px text-[11px]">
            Type missing
          </span>
        ) : null}
      </Link>
      <span className="text-ink-3 text-[12.5px]">{sourceLabel(receipt)}</span>
      <span className="flex flex-col items-end gap-px text-right">
        {conversion.amount !== null ? (
          <span className="tabular text-sm">
            {formatAmount(conversion.amount)}
            {conversion.provisional ? (
              <span
                className="text-ink-3 ml-1 text-[11px]"
                title="Provisional rate - fixed one to two days after the receipt date"
              >
                prov.
              </span>
            ) : null}
          </span>
        ) : (
          <span className="bg-warn-soft text-warn-deep-strong rounded-full px-[7px] py-px text-[11px]">
            {conversion.missing ? MISSING_CONVERSION[conversion.missing] : "–"}
          </span>
        )}
        {note ? (
          <span className="tabular text-ink-3 text-[11px] whitespace-nowrap" title={rateDay}>
            {note}
          </span>
        ) : null}
      </span>
      <span className="flex justify-end">
        {locked ? null : (
          <ActionButton
            action={removeFromSettlement}
            fields={{ settlementId, receiptId: receipt.id }}
            label="Remove"
            pendingLabel="Removing…"
            className="text-brand text-[12.5px] hover:underline"
            messageClassName="ml-2 text-[11.5px]"
          />
        )}
      </span>
    </div>
  );
}

/**
 * "Total per category" aus der Vorlage - in der Abrechnungswaehrung, eine
 * Zeile je Kategorie. Positionen ohne umgerechneten Betrag fehlen darin; die
 * Gesamtzeile sagt dann, wie viele.
 */
function CategoryTotals({ settlement }: { settlement: ApiSettlementDetail }) {
  return (
    <div className="flex flex-col gap-[9px]">
      <div className="text-ink-3 text-[10.5px] font-semibold tracking-[0.09em] uppercase">
        Total per category · {settlement.currency}
      </div>
      {settlement.byCategory.length === 0 ? (
        <div className="text-ink-3 text-[13px]">–</div>
      ) : (
        settlement.byCategory.map((entry) => (
          <div
            key={entry.category ?? ""}
            className="border-line flex items-center justify-between gap-[10px] border-b py-[6px] text-[13px]"
          >
            <span className={entry.category ? "text-ink-2" : "text-ink-3"}>
              {categoryLabel(entry.category)}
            </span>
            <span className="tabular">{formatAmount(entry.sum)}</span>
          </div>
        ))
      )}
      <div className="flex items-center justify-between pt-1 text-sm font-semibold">
        <span>Total</span>
        <span className="tabular text-right">{formatSettlementTotal(settlement.total)}</span>
      </div>
    </div>
  );
}
