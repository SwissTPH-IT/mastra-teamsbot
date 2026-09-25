"use client";

// Einen erfassten Beleg nachtraeglich korrigieren.
//
// Ein echtes <form> mit einer Server Action: es funktioniert damit auch ohne
// JavaScript, und der Zustand nach dem Absenden kommt vom Server, nicht aus
// einer optimistischen Annahme im Browser. useActionState liefert nur die
// Rueckmeldung ("Saved" / Fehlertext) und den Wartezustand des Knopfes.
//
// Alle Felder sind unkontrolliert (defaultValue). React setzt das Formular
// nach der Action auf die defaultValues zurueck: nach einem Erfolg sind das
// die neuen Werte aus dem Dienst, nach einem Fehler das Getippte (state.values)
// - so geht bei einem Tippfehler nichts verloren.

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveCorrections } from "@/app/(app)/receipts/[id]/actions";
import type { ApiReceipt } from "@/lib/api/receipts";
import { CATEGORIES, RECEIPT_TYPES } from "@/lib/receipts/categories";
import { formatReceiptDate } from "@/lib/receipts/format";
import type { FormState } from "@/lib/receipts/form-state";
import { NO_RECEIPT_LIMIT, NO_RECEIPT_LIMIT_CURRENCY } from "@/lib/receipts/no-receipt";

export const SELECT_CLASS =
  "border-line-2 bg-panel text-ink disabled:bg-surface disabled:text-ink-3 h-11 w-full cursor-pointer appearance-none rounded-[11px] border pr-[34px] pl-3 text-sm disabled:cursor-not-allowed";

export const INPUT_CLASS =
  "bg-panel text-ink placeholder:text-ink-3 disabled:bg-surface disabled:text-ink-3 h-11 w-full rounded-[11px] border px-3 text-sm disabled:cursor-not-allowed";

export const CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none' stroke='%23767683' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M1 1.3 5 4.7 9 1.3'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  backgroundSize: "10px 6px",
} as const;

/** Rahmenfarbe eines Eingabefelds: rot, wenn der Dienst es abgelehnt hat. */
export function borderFor(error: string | undefined): string {
  return error ? "border-bad" : "border-line-2";
}

/**
 * Waehrungen im Korrekturformular. Die vier, die parseCurrency() im Dienst
 * kennt - eine andere, schon gespeicherte bleibt waehlbar (siehe unten).
 */
const CURRENCIES = ["CHF", "EUR", "USD", "GBP"] as const;

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  /** Ersetzt den Hinweis, solange das Feld abgelehnt ist. */
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className="text-ink-2 text-[12.5px] font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-bad-deep text-[11.5px] leading-[1.45]">{error}</span>
      ) : hint ? (
        <span className="text-ink-3 text-[11.5px] leading-[1.45]">{hint}</span>
      ) : null}
    </label>
  );
}

/** Eine Zeile der Werteliste - gleiches Raster wie die nur lesbaren Felder darunter. */
function EditRow({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="border-line grid grid-cols-[210px_minmax(0,1fr)] items-baseline gap-4 border-b py-[8px]">
      <span className="text-ink-3 text-[13px]">{label}</span>
      <span className="flex flex-col gap-[5px]">
        {children}
        {error ? <span className="text-bad-deep text-[11.5px]">{error}</span> : null}
      </span>
    </label>
  );
}

export function CorrectionForm({
  receipt,
  lockedReason,
}: {
  receipt: ApiReceipt;
  /**
   * Gesetzt, wenn der Beleg in einer eingereichten Abrechnung liegt. Dann ist
   * das Formular nur noch Anzeige - der Dienst wuerde die Korrektur ohnehin
   * mit 409 ablehnen, aber ein Knopf, der garantiert scheitert, ist keiner.
   */
  lockedReason?: string;
}) {
  const [state, action] = useActionState<FormState, FormData>(saveCorrections, null);
  const manual = receipt.fileReference === null;

  // Nach einem Fehler das Getippte, sonst der gespeicherte Wert.
  const value = (name: string, stored: string | null): string =>
    state?.ok === false && name in state.values ? state.values[name] : (stored ?? "");
  const error = (name: string): string | undefined =>
    state?.ok === false ? state.fieldErrors[name] : undefined;

  const currencies: string[] = [...CURRENCIES];
  if (receipt.currency && !currencies.includes(receipt.currency)) {
    currencies.push(receipt.currency);
  }

  return (
    <form action={action}>
      {/* Ein fieldset statt disabled an jedem Feld: gesperrt heisst hier
          ALLES gesperrt, auch ein Feld, das spaeter dazukommt. */}
      <fieldset disabled={!!lockedReason} className="flex min-w-0 flex-col gap-6">
        <input type="hidden" name="id" value={receipt.id} />

        <div className="grid grid-cols-2 gap-[18px]">
          <Field label="Category" hint={manual ? undefined : "Left empty by the agent on purpose"}>
            <select
              name="category"
              defaultValue={value("category", receipt.category)}
              className={SELECT_CLASS}
              style={CHEVRON}
            >
              {CATEGORIES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Receipt type" hint="Required before submitting">
            <select
              name="receiptType"
              defaultValue={value("receiptType", receipt.receiptType)}
              className={SELECT_CLASS}
              style={CHEVRON}
            >
              {RECEIPT_TYPES.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex flex-col gap-[2px]">
          <div className="text-ink-3 mb-[6px] text-[10.5px] font-semibold tracking-[0.09em] uppercase">
            {manual ? "Entered fields · editable" : "Extracted fields · editable"}
          </div>

          <EditRow label={manual ? "label" : "merchant"} error={error("merchant")}>
            <input
              name="merchant"
              defaultValue={value("merchant", receipt.merchant)}
              placeholder={manual ? "e.g. Parkgebühr Flughafen" : "not recognised"}
              maxLength={200}
              className={`${INPUT_CLASS} ${borderFor(error("merchant"))}`}
            />
          </EditRow>

          <EditRow label="receiptDate" error={error("receiptDate")}>
            <input
              name="receiptDate"
              defaultValue={value("receiptDate", formatReceiptDate(receipt.receiptDate))}
              placeholder="DD.MM.YYYY"
              required={manual}
              className={`${INPUT_CLASS} tabular ${borderFor(error("receiptDate"))}`}
            />
          </EditRow>

          <EditRow label="totalAmount" error={error("totalAmount")}>
            <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-3">
              <input
                name="totalAmount"
                defaultValue={value("totalAmount", receipt.totalAmount)}
                placeholder="0.00"
                inputMode="decimal"
                required={manual}
                className={`${INPUT_CLASS} tabular ${borderFor(error("totalAmount"))}`}
              />
              <select
                name="currency"
                aria-label="Currency"
                defaultValue={value("currency", receipt.currency)}
                className={`${SELECT_CLASS} ${borderFor(error("currency"))}`}
                style={CHEVRON}
              >
                {/* Ohne Beleg ist die Waehrung Pflicht - "nicht gesetzt" gibt es dort nicht. */}
                {manual ? null : <option value="">–</option>}
                {currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </EditRow>

          {manual ? (
            <EditRow label="reason" error={error("reason")}>
              <textarea
                name="reason"
                defaultValue={value("reason", receipt.reason)}
                rows={3}
                required
                maxLength={1000}
                className={`bg-panel text-ink disabled:bg-surface disabled:text-ink-3 min-h-[80px] w-full resize-y rounded-[11px] border p-3 text-sm leading-[1.55] ${borderFor(error("reason"))}`}
              />
            </EditRow>
          ) : (
            <>
              <EditRow label="vatAmount" error={error("vatAmount")}>
                <input
                  name="vatAmount"
                  defaultValue={value("vatAmount", receipt.vatAmount)}
                  placeholder="not recognised"
                  inputMode="decimal"
                  className={`${INPUT_CLASS} tabular ${borderFor(error("vatAmount"))}`}
                />
              </EditRow>
              <EditRow label="paymentMethod" error={error("paymentMethod")}>
                <input
                  name="paymentMethod"
                  defaultValue={value("paymentMethod", receipt.paymentMethod)}
                  placeholder="not recognised"
                  maxLength={100}
                  className={`${INPUT_CLASS} ${borderFor(error("paymentMethod"))}`}
                />
              </EditRow>
            </>
          )}

          <div className="text-ink-3 mt-[10px] text-xs leading-[1.5]">
            {manual
              ? `Without a receipt up to ${NO_RECEIPT_LIMIT.toFixed(2)} ${NO_RECEIPT_LIMIT_CURRENCY} per item, also after a correction.`
              : "An empty field counts as not recognised, never as 0.00."}{" "}
            Amounts accept 12.50, 12,50 or 1&apos;234.50.
          </div>
        </div>

        <div className="border-line flex items-center gap-[9px] border-t pt-5">
          <SubmitButton />
          <span
            role="status"
            className={`ml-auto text-right text-xs ${state?.ok === false ? "text-bad-deep" : "text-ink-3"}`}
          >
            {state?.ok === true
              ? "Saved"
              : state?.ok === false
                ? state.message
                : (lockedReason ?? "")}
          </span>
        </div>
      </fieldset>
    </form>
  );
}

/**
 * Der Absende-Knopf.
 *
 * Eigene Komponente, weil useFormStatus nur INNERHALB des Formulars den
 * Wartezustand kennt - im Elternteil ist er immer false.
 */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-brand hover:bg-brand-deep h-10 rounded-[10px] px-4 text-[13.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? "Saving…" : "Save corrections"}
    </button>
  );
}
