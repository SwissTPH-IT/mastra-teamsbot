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
import {
  deleteSettlementAction,
  removeFromSettlement,
  submitSettlementAction,
} from "@/app/(app)/settlements/actions";
import { classifyFailure } from "@/lib/api/guard";
import { isNotFound } from "@/lib/api/client";
import { fetchSettlement, type ApiSettlementDetail } from "@/lib/api/settlements";
import type { ApiReceipt } from "@/lib/api/receipts";
import { categoryLabel } from "@/lib/receipts/categories";
import { formatAmount, formatReceiptDate } from "@/lib/receipts/format";
import { needsReview, receiptTitle, sourceLabel } from "@/lib/receipts/review";
import {
  STATUS_STYLE,
  formatSubmittedDay,
  formatTotals,
  itemCount,
  settlementMeta,
} from "@/lib/settlements/format";

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
        </div>
        <div className="text-right">
          <div className="tabular text-[28px] font-semibold tracking-[-0.03em]">
            {formatTotals(settlement.totals)}
          </div>
          <div className="text-ink-3 mt-[2px] text-xs">{itemCount(settlement.receiptCount)}</div>
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
          <div className="border-line grid h-[38px] grid-cols-[88px_minmax(0,1fr)_120px_102px_96px] items-center gap-3 border-b px-4">
            {["Date", "Item", "Source", "Amount", ""].map((label, index) => (
              <span
                key={index}
                className={`text-ink-3 text-[10.5px] font-semibold tracking-[0.08em] uppercase ${
                  label === "Amount" ? "text-right" : ""
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
                disabled={settlement.receiptCount === 0 || withoutType > 0}
                title={
                  settlement.receiptCount === 0
                    ? "Add items first"
                    : withoutType > 0
                      ? "Every item needs a receipt type"
                      : undefined
                }
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

function Position({
  receipt,
  settlementId,
  locked,
}: {
  receipt: ApiReceipt;
  settlementId: string;
  locked: boolean;
}) {
  const title = receiptTitle(receipt);
  return (
    <div className="border-line grid h-12 grid-cols-[88px_minmax(0,1fr)_120px_102px_96px] items-center gap-3 border-b px-4 last:border-b-0">
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
      <span className="tabular text-right text-sm">
        {formatAmount(receipt.totalAmount) ?? "–"}
        {receipt.currency && receipt.currency !== "CHF" ? (
          <span className="text-ink-3 ml-1 text-xs">{receipt.currency}</span>
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
 * "Total per category" aus der Vorlage - je Waehrung getrennt. Eine Kategorie
 * mit CHF- und EUR-Belegen hat zwei Zeilen, nicht eine falsche.
 */
function CategoryTotals({ settlement }: { settlement: ApiSettlementDetail }) {
  const currencies = new Set(settlement.byCategory.map((entry) => entry.currency));
  const showCurrency = currencies.size > 1 || !currencies.has("CHF");

  return (
    <div className="flex flex-col gap-[9px]">
      <div className="text-ink-3 text-[10.5px] font-semibold tracking-[0.09em] uppercase">
        Total per category
      </div>
      {settlement.byCategory.length === 0 ? (
        <div className="text-ink-3 text-[13px]">–</div>
      ) : (
        settlement.byCategory.map((entry) => (
          <div
            key={`${entry.category ?? ""}-${entry.currency ?? ""}`}
            className="border-line flex items-center justify-between gap-[10px] border-b py-[6px] text-[13px]"
          >
            <span className={entry.category ? "text-ink-2" : "text-ink-3"}>
              {categoryLabel(entry.category)}
            </span>
            <span className="tabular">
              {formatAmount(entry.sum)}
              {showCurrency ? ` ${entry.currency ?? "(no currency)"}` : ""}
            </span>
          </div>
        ))
      )}
      <div className="flex items-center justify-between pt-1 text-sm font-semibold">
        <span>Total</span>
        <span className="tabular text-right">{formatTotals(settlement.totals)}</span>
      </div>
    </div>
  );
}
