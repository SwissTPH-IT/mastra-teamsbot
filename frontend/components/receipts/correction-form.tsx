"use client";

// Kategorie und Belegart korrigieren.
//
// Ein echtes <form> mit einer Server Action: es funktioniert damit auch ohne
// JavaScript, und der Zustand nach dem Absenden kommt vom Server, nicht aus
// einer optimistischen Annahme im Browser. useActionState liefert nur die
// Rueckmeldung ("Saved" / Fehlertext) und den Wartezustand des Knopfes.

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveCorrections, type SaveState } from "@/app/(app)/receipts/[id]/actions";
import { CATEGORIES, RECEIPT_TYPES } from "@/lib/receipts/categories";

const SELECT_CLASS =
  "border-line-2 bg-panel text-ink h-11 w-full cursor-pointer appearance-none rounded-[11px] border pr-[34px] pl-3 text-sm";

const CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none' stroke='%23767683' stroke-width='1.5' stroke-linecap='round'%3E%3Cpath d='M1 1.3 5 4.7 9 1.3'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  backgroundSize: "10px 6px",
} as const;

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[7px]">
      <span className="text-ink-2 text-[12.5px] font-medium">{label}</span>
      {children}
      {hint ? <span className="text-ink-3 text-[11.5px] leading-[1.45]">{hint}</span> : null}
    </label>
  );
}

export function CorrectionForm({
  receiptId,
  category,
  receiptType,
  /** Ausgegraut, solange es keine Abrechnungen gibt. */
  assignmentNote,
}: {
  receiptId: string;
  category: string | null;
  receiptType: string | null;
  assignmentNote: string;
}) {
  const [state, action] = useActionState<SaveState, FormData>(saveCorrections, null);

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="id" value={receiptId} />

      <div className="grid grid-cols-2 gap-[18px]">
        <Field label="Category" hint="Left empty by the agent on purpose">
          <select
            name="category"
            defaultValue={category ?? ""}
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
            defaultValue={receiptType ?? ""}
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

      <div className="border-line flex items-center gap-[9px] border-t pt-5">
        <SubmitButton />
        <button
          type="button"
          disabled
          title="Settlements are not available yet"
          className="bg-surface text-ink-3 h-10 cursor-not-allowed rounded-[10px] px-[14px] text-[13.5px]"
        >
          Assign to settlement
        </button>
        <span className="text-ink-3 ml-auto text-xs">
          {state?.ok === true ? "Saved" : state?.ok === false ? state.message : assignmentNote}
        </span>
      </div>
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
      className="bg-brand hover:bg-brand-deep h-10 rounded-[10px] px-4 text-[13.5px] font-medium text-white disabled:opacity-70"
    >
      {pending ? "Saving…" : "Save corrections"}
    </button>
  );
}
