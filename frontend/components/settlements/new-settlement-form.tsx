"use client";

// "New settlement" auf der Uebersicht. Aufgeklappt statt Dialog: ein Feld und
// ein Knopf brauchen keinen Modal, und die Seite bleibt dabei sichtbar.

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { createEmptySettlement, type ActionState } from "@/app/(app)/settlements/actions";
import { CurrencySelect } from "./currency-select";

export function NewSettlementForm() {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionState, FormData>(createEmptySettlement, null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line-2 bg-panel text-ink-2 hover:bg-surface h-10 rounded-[10px] border px-[14px] text-[13.5px]"
      >
        New settlement
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-[9px]">
      {state?.ok === false ? <span className="text-bad-deep text-xs">{state.message}</span> : null}
      <input
        name="title"
        required
        autoFocus
        maxLength={200}
        placeholder="e.g. Field visit Bern, week 38"
        aria-label="Settlement title"
        className="border-line-2 bg-panel text-ink h-10 w-[280px] rounded-[10px] border px-3 text-sm"
      />
      <CurrencySelect className="border-line-2 bg-panel text-ink h-10 rounded-[10px] border px-2 text-sm" />
      <Create />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-ink-2 hover:bg-surface h-10 rounded-[10px] px-3 text-[13.5px]"
      >
        Cancel
      </button>
    </form>
  );
}

function Create() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-brand hover:bg-brand-deep h-10 rounded-[10px] px-4 text-[13.5px] font-medium text-white disabled:opacity-70"
    >
      {pending ? "Creating…" : "Create"}
    </button>
  );
}
