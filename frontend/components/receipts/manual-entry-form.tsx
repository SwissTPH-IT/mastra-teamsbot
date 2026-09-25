"use client";

// Das Formular "Add expense without receipt".
//
// Wie die Korrektur ein echtes <form> mit Server Action - ohne JavaScript
// schickt der Browser es trotzdem ab, und der Dienst prueft ohnehin alles.
// Mit JavaScript kommt eines dazu: Betrag und Waehrung sind kontrolliert, damit
// der Hinweiskasten die 20-CHF-Grenze schon beim Tippen zeigt und "Save"
// sperrt, bevor ein aussichtsloser Aufruf rausgeht.

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createManualEntry } from "@/app/(app)/receipts/new/actions";
import { CATEGORIES } from "@/lib/receipts/categories";
import type { FormState } from "@/lib/receipts/form-state";
import {
  NO_RECEIPT_CURRENCIES,
  NO_RECEIPT_LIMIT,
  NO_RECEIPT_LIMIT_CURRENCY,
  noReceiptRule,
  type NoReceiptRule,
} from "@/lib/receipts/no-receipt";
import { borderFor, CHEVRON, Field, INPUT_CLASS, SELECT_CLASS } from "./correction-form";

const RULE_TONES: Record<NoReceiptRule["tone"], { box: string; dot: string; title: string }> = {
  neutral: { box: "border-line bg-surface", dot: "bg-line-2", title: "text-ink" },
  ok: { box: "border-line bg-surface", dot: "bg-ok", title: "text-ink" },
  warn: { box: "border-warn bg-warn-soft", dot: "bg-warn", title: "text-warn-deep-strong" },
  bad: { box: "border-bad bg-bad-soft", dot: "bg-bad", title: "text-bad-deep" },
};

export function ManualEntryForm({
  entryId,
  today,
  /** Deep Link in den Teams-Chat, falls konfiguriert (TEAMS_CHAT_URL). */
  teamsUrl,
}: {
  entryId: string;
  /** Vorgabe fuer das Datum, DD.MM.YYYY - auf dem Server in Europe/Zurich bestimmt. */
  today: string;
  teamsUrl: string | null;
}) {
  const [state, action] = useActionState<FormState, FormData>(createManualEntry, null);

  const initial = (name: string, fallback = "") =>
    state?.ok === false && name in state.values ? state.values[name] : fallback;
  const error = (name: string): string | undefined =>
    state?.ok === false ? state.fieldErrors[name] : undefined;

  const [amount, setAmount] = useState(() => initial("totalAmount"));
  const [currency, setCurrency] = useState(() => initial("currency", NO_RECEIPT_LIMIT_CURRENCY));

  const rule = noReceiptRule(amount, currency);
  const tone = RULE_TONES[rule.tone];
  const limitHint = `Without a receipt up to ${NO_RECEIPT_LIMIT.toFixed(2)} ${NO_RECEIPT_LIMIT_CURRENCY}`;

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={entryId} />

      <div className="grid grid-cols-2 gap-[18px]">
        <Field label="Date" hint="Receipt date, DD.MM.YYYY" error={error("receiptDate")}>
          <input
            name="receiptDate"
            defaultValue={initial("receiptDate", today)}
            placeholder="DD.MM.YYYY"
            required
            className={`${INPUT_CLASS} tabular ${borderFor(error("receiptDate"))}`}
          />
        </Field>

        <div className="grid grid-cols-[minmax(0,1fr)_104px] items-start gap-3">
          <Field
            label="Amount"
            hint={rule.blocked ? undefined : limitHint}
            error={
              error("totalAmount") ??
              (rule.blocked
                ? `Over the limit: ${NO_RECEIPT_LIMIT.toFixed(2)} ${NO_RECEIPT_LIMIT_CURRENCY} is the maximum without a receipt`
                : undefined)
            }
          >
            <input
              name="totalAmount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              required
              className={`${INPUT_CLASS} tabular ${
                rule.blocked ? "border-bad" : borderFor(error("totalAmount"))
              }`}
            />
          </Field>
          <Field label="Currency" error={error("currency")}>
            <select
              name="currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className={SELECT_CLASS}
              style={CHEVRON}
            >
              {NO_RECEIPT_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Category" error={error("category")}>
          <select
            name="category"
            defaultValue={initial("category", "other")}
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

        <Field
          label="Label"
          hint="Shown in the list instead of a merchant"
          error={error("merchant")}
        >
          <input
            name="merchant"
            defaultValue={initial("merchant")}
            placeholder="e.g. Parkgebühr Flughafen"
            maxLength={200}
            className={`${INPUT_CLASS} ${borderFor(error("merchant"))}`}
          />
        </Field>

        <div className="col-span-2">
          <Field
            label="Reason / purpose"
            hint="Required: why there is no receipt"
            error={error("reason")}
          >
            <textarea
              name="reason"
              defaultValue={initial("reason")}
              rows={3}
              required
              maxLength={1000}
              placeholder="e.g. ticket machine without printout, trip to the field visit"
              className={`bg-panel text-ink placeholder:text-ink-3 min-h-[80px] w-full resize-y rounded-[11px] border p-3 text-sm leading-[1.55] ${borderFor(error("reason"))}`}
            />
          </Field>
        </div>

        {/* Aus der Vorlage, ausgegraut: Abrechnungen gibt es noch nicht. */}
        <div className="col-span-2">
          <Field label="Settlement (optional)" hint="Settlements are not available yet">
            <select
              disabled
              className={`${SELECT_CLASS} bg-surface text-ink-3 cursor-not-allowed opacity-60`}
              style={CHEVRON}
            >
              <option>Assign later</option>
            </select>
          </Field>
        </div>
      </div>

      <div className={`flex flex-col gap-[7px] rounded-xl border px-4 py-[14px] ${tone.box}`}>
        <div className="flex items-center gap-2">
          <span className={`h-[6px] w-[6px] rounded-full ${tone.dot}`} />
          <span className={`text-[13.5px] font-semibold ${tone.title}`}>{rule.title}</span>
        </div>
        <div className="text-ink text-[13px] leading-[1.6]">{rule.text}</div>
        {rule.openQuestion ? (
          <div className="border-line-2 bg-panel text-ink-2 mt-[3px] rounded-[10px] border border-dashed px-[13px] py-[11px] text-[12.5px] leading-[1.6]">
            <span className="text-ink font-semibold">Open design question:</span> which value does
            the 20.00 CHF limit apply to for foreign currency, the nominal amount, the rate on the
            receipt date, or the rate at submission? And who covers the difference if the rate
            pushes the item over the limit later? Deliberately left visible instead of silently
            converted.
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-[9px]">
        <SaveButton blocked={rule.blocked} />
        {rule.blocked && teamsUrl ? (
          <a
            href={teamsUrl}
            target="_blank"
            rel="noreferrer"
            className="border-brand bg-panel text-brand-deep flex h-10 items-center rounded-[10px] border px-[14px] text-[13.5px] font-medium"
          >
            Submit receipt via Teams
          </a>
        ) : null}
        <Link
          href="/receipts"
          className="text-ink-2 hover:bg-surface flex h-10 items-center rounded-[10px] px-[14px] text-[13.5px]"
        >
          Cancel
        </Link>
        <span
          role="status"
          className={`ml-auto text-right text-xs ${state?.ok === false ? "text-bad-deep" : "text-ink-3"}`}
        >
          {state?.ok === false ? state.message : "Not in a settlement yet"}
        </span>
      </div>
    </form>
  );
}

/** Eigene Komponente, weil useFormStatus nur innerhalb des Formulars den Wartezustand kennt. */
function SaveButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || blocked}
      className="bg-brand hover:bg-brand-deep disabled:bg-surface disabled:text-ink-3 h-10 rounded-[10px] px-4 text-[13.5px] font-medium text-white disabled:cursor-not-allowed"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}
