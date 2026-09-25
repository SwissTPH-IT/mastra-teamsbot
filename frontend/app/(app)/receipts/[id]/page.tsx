// Die Detailansicht: Bild links, Werte rechts.
//
// Zwei Dinge sind hier Absicht und sehen nach Kleinigkeit aus:
//
//   1. Leere Felder zeigen einen Gedankenstrich und sind gedaempft. Nie "0.00":
//      ein nicht erkannter Betrag und ein Betrag von null sind zwei
//      verschiedene Aussagen, und die zweite waere gelogen.
//   2. Die Confidence ist deterministisch gerechnet (Feldvollstaendigkeit und
//      Summenpruefung), kein Modellurteil. Der Hinweis steht in der Oberflaeche,
//      weil eine Prozentzahl neben einem KI-Ergebnis sonst als
//      Selbsteinschaetzung gelesen wird.

import Link from "next/link";
import { notFound } from "next/navigation";
import { CorrectionForm } from "@/components/receipts/correction-form";
import { ReceiptImage } from "@/components/receipts/receipt-image";
import { lockedReason } from "@/components/receipts/rows";
import { ActionButton } from "@/components/settlements/action-button";
import { AssignDialog } from "@/components/settlements/assign-dialog";
import { removeFromSettlement } from "@/app/(app)/settlements/actions";
import { ServiceUnavailable, UnlinkedAccount } from "@/components/receipts/states";
import { classifyFailure } from "@/lib/api/guard";
import { isNotFound } from "@/lib/api/client";
import { fetchReceipt, type ApiReceipt } from "@/lib/api/receipts";
import { fetchSettlements, type ApiSettlement } from "@/lib/api/settlements";
import { receiptTypeLabel } from "@/lib/receipts/categories";
import {
  formatAmount,
  formatAmountWithCurrency,
  formatRate,
  formatReceiptDate,
  formatTimestamp,
} from "@/lib/receipts/format";
import { NO_RECEIPT_LIMIT, NO_RECEIPT_LIMIT_CURRENCY } from "@/lib/receipts/no-receipt";
import { needsReview, receiptTitle, sourceLabel } from "@/lib/receipts/review";

export default async function ReceiptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let receipt: ApiReceipt;
  let drafts: ApiSettlement[];
  try {
    [receipt, drafts] = await Promise.all([fetchReceipt(id), fetchSettlements("draft")]);
  } catch (error) {
    // 404 ist hier eine Seite und kein Zustand: eine geratene oder fremde id
    // sieht genauso aus wie eine geloeschte. Das ist gewollt - sie soll nicht
    // verraten, dass sie existiert.
    if (isNotFound(error)) notFound();
    const failure = classifyFailure(error);
    return failure.kind === "unlinked" ? (
      <UnlinkedAccount />
    ) : (
      <ServiceUnavailable detail={failure.detail} />
    );
  }

  const title = receiptTitle(receipt);
  const source = sourceLabel(receipt);

  return (
    <div className="flex flex-col gap-[22px]">
      <nav className="text-ink-3 flex items-center gap-[10px] text-[13px]">
        <Link href="/receipts" className="text-brand font-medium">
          Receipts
        </Link>
        <span>/</span>
        <span className="text-ink-2 truncate">{title.text}</span>
      </nav>

      <div className="grid grid-cols-[minmax(0,420px)_minmax(0,1fr)] items-start gap-8">
        <div className="sticky top-[26px] flex flex-col gap-3">
          {source === "receipt" ? (
            <ReceiptImage
              src={`/api/receipts/${receipt.id}/image`}
              isPdf={receipt.fileReference?.endsWith(".pdf") ?? false}
              capturedAt={`Captured in Teams · ${formatTimestamp(receipt.createdAt)}`}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="border-line-2 bg-surface flex h-[210px] w-full flex-col items-center justify-center gap-[6px] rounded-xl border border-dashed">
                <div className="text-ink-2 text-sm">No receipt image</div>
                <div className="text-ink-3 text-[12.5px]">
                  Entered without a receipt, up to {NO_RECEIPT_LIMIT.toFixed(2)}{" "}
                  {NO_RECEIPT_LIMIT_CURRENCY}
                </div>
              </div>
              {/* Die Begruendung ist bei einer Ausgabe ohne Beleg das, was der
                  Beleg sonst waere - deshalb an seinem Platz und nicht in der
                  Werteliste. */}
              <div className="border-line bg-panel rounded-xl border p-4">
                <div className="text-ink-3 mb-2 text-[10.5px] font-semibold tracking-[0.09em] uppercase">
                  Reason given
                </div>
                <div className="text-ink text-sm leading-[1.6] whitespace-pre-line">
                  {receipt.reason ?? "–"}
                </div>
              </div>
              <div className="text-ink-3 text-[11.5px]">
                Self entered · {formatTimestamp(receipt.createdAt)}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1
                className={`text-[21px] font-semibold tracking-[-0.018em] ${
                  title.muted ? "text-ink-3" : "text-ink"
                }`}
              >
                {title.text}
              </h1>
              <div className="text-ink-3 mt-[5px] text-[13px]">
                receiptDate {formatReceiptDate(receipt.receiptDate) ?? "–"} ·{" "}
                {source === "receipt" ? "receipt from Teams" : "no receipt"}
                {receipt.correctedAt ? ` · corrected ${formatTimestamp(receipt.correctedAt)}` : ""}
              </div>
            </div>
            <div className="tabular text-2xl font-semibold tracking-[-0.025em]">
              {formatAmountWithCurrency(receipt.totalAmount, receipt.currency) ?? "–"}
            </div>
          </div>

          {needsReview(receipt) ? <ReviewPanel receipt={receipt} /> : null}

          <CorrectionForm receipt={receipt} lockedReason={lockedReason(receipt)} />

          {/* Ausserhalb des Korrekturformulars: der Dialog hat ein eigenes
              <form>, und Formulare lassen sich nicht verschachteln. */}
          <Assignment
            receipt={receipt}
            drafts={drafts.filter((draft) => draft.id !== receipt.settlement?.id)}
          />

          {source === "receipt" ? <ExtractedFields receipt={receipt} /> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Wo der Beleg liegt, und der Weg hinein, hinaus oder hinueber.
 *
 * Verschieben in einen anderen Entwurf geht ueber denselben Dialog: der
 * Dienst erlaubt das Wandern zwischen Entwuerfen, nur aus einer eingereichten
 * Abrechnung heraus nicht.
 */
function Assignment({ receipt, drafts }: { receipt: ApiReceipt; drafts: ApiSettlement[] }) {
  const settlement = receipt.settlement;
  const locked = settlement?.status === "submitted";
  const title = receiptTitle(receipt).text;

  return (
    <div className="border-line flex items-center gap-[9px] rounded-xl border px-4 py-3">
      <div className="min-w-0 flex-1 text-[13px]">
        {settlement ? (
          <>
            <span className="text-ink-3">In settlement </span>
            <Link href={`/settlements/${settlement.id}`} className="text-brand font-medium">
              {settlement.title}
            </Link>
            <span className="text-ink-3">{locked ? " · submitted, locked" : " · draft"}</span>
          </>
        ) : (
          <span className="text-ink-3">Not in a settlement yet</span>
        )}
      </div>

      {settlement && !locked ? (
        <ActionButton
          action={removeFromSettlement}
          fields={{ settlementId: settlement.id, receiptId: receipt.id }}
          label="Remove"
          pendingLabel="Removing…"
          className="text-ink-2 hover:bg-surface h-9 rounded-[10px] px-3 text-[13px]"
        />
      ) : null}

      {/* Aus einer eingereichten Abrechnung fuehrt kein Weg heraus - also
          auch kein Knopf, der so aussieht. */}
      {locked ? null : (
        <AssignDialog
          receiptIds={[receipt.id]}
          settlements={drafts}
          subtitle={title}
          trigger={settlement ? "Move to settlement" : "Assign to settlement"}
          triggerClassName="border-line-2 bg-panel text-ink-2 hover:bg-surface h-9 rounded-[10px] border px-[14px] text-[13px]"
        />
      )}
    </div>
  );
}

/**
 * Der Hinweiskasten bei niedriger Konfidenz oder gemeldeten Problemen.
 *
 * Die Punkte sind der unveraenderte Text des Extraktions-Agenten ("receipt
 * cropped at the edge"). Sie zu uebersetzen oder zu vereinheitlichen wuerde
 * Information verlieren - was er sagt, ist der Hinweis, wo man nachsehen muss.
 */
function ReviewPanel({ receipt }: { receipt: ApiReceipt }) {
  const confidence = receipt.confidence === null ? null : Number(receipt.confidence);
  const percent = confidence === null ? 0 : Math.round(confidence * 100);

  return (
    <div className="border-warn bg-warn-soft flex flex-col gap-[9px] rounded-xl border px-[17px] py-[15px]">
      <div className="flex items-center justify-between gap-3">
        <div className="text-warn-deep-strong text-[13.5px] font-semibold">
          Please review: extraction incomplete
        </div>
        <div className="flex items-center gap-2">
          <div className="h-[5px] w-[76px] overflow-hidden rounded-full bg-white">
            <div className="bg-warn-deep h-full" style={{ width: `${percent}%` }} />
          </div>
          <span className="tabular text-warn-deep-strong text-xs">
            confidence {receipt.confidence ?? "–"}
          </span>
        </div>
      </div>

      {receipt.issues.length > 0 ? (
        <ul className="text-ink flex list-disc flex-col gap-1 pl-[17px] text-[13px] leading-[1.55]">
          {receipt.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : (
        <div className="text-ink text-[13px] leading-[1.55]">
          Several fields could not be read. Check the values against the image.
        </div>
      )}

      <div className="text-ink-2 text-xs">
        Confidence is computed deterministically from field completeness and the sum check. It is
        not a model rating.
      </div>
    </div>
  );
}

/**
 * Die uebrigen ausgelesenen Werte, nur lesbar.
 *
 * Korrigierbar sind die Felder im Formular darueber - die, die fuer die
 * Abrechnung zaehlen. Adresse, Positionen und Steuernummer bleiben hier
 * sichtbar, aber unveraendert: sie sind Beiwerk, und jedes weitere Eingabefeld
 * waere eines mehr, das beim Nachsehen im Weg steht.
 */
function ExtractedFields({ receipt }: { receipt: ApiReceipt }) {
  const fields: { label: string; value: string | null }[] = [
    { label: "merchantAddress", value: receipt.merchantAddress },
    { label: "receiptTime", value: receipt.receiptTime },
    {
      label: "subtotalAmount",
      value: formatAmountWithCurrency(receipt.subtotalAmount, receipt.currency),
    },
    { label: "vatRate", value: formatRate(receipt.vatRate) },
    { label: "referenceNumber", value: receipt.referenceNumber },
    {
      label: "receiptType",
      value: receipt.receiptType ? receiptTypeLabel(receipt.receiptType) : null,
    },
    {
      label: "lineItems",
      value: receipt.lineItemCount > 0 ? `${receipt.lineItemCount} items` : null,
    },
    { label: "discountAmount", value: formatAmount(receipt.discountAmount) },
    { label: "merchantTaxId", value: receipt.merchantTaxId },
  ];

  return (
    <div className="flex flex-col gap-[2px]">
      <div className="text-ink-3 mb-[10px] text-[10.5px] font-semibold tracking-[0.09em] uppercase">
        Other extracted fields
      </div>
      {fields.map((field) => (
        <div
          key={field.label}
          className="border-line grid grid-cols-[210px_minmax(0,1fr)] items-baseline gap-4 border-b py-[10px]"
        >
          <span className="text-ink-3 text-[13px]">{field.label}</span>
          <span className={`tabular text-sm ${field.value ? "text-ink" : "text-ink-3"}`}>
            {field.value ?? "–"}
          </span>
        </div>
      ))}
      <div className="text-ink-3 mt-[10px] text-xs">
        Empty fields show a dash and count as not recognised, never as 0.00.
      </div>
      {/* Die Vorlage zeigt hier zusaetzlich die Rohwerte der Extraktion. Die
          gibt der Dienst bewusst nicht heraus: rawExtraction und der
          Datei-Hash verlassen ihn nie (siehe api/src/routes/receipts.ts). Der
          Hinweis steht trotzdem, damit nicht gesucht wird, was es nicht gibt. */}
      <div className="text-ink-3 mt-1 text-xs">
        The raw extraction output stays inside the receipt service.
      </div>
    </div>
  );
}
