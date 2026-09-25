"use client";

// "Add to settlement" - der Zuordnungsdialog aus der Vorlage.
//
// Ein natives <dialog> mit showModal(): Fokusfalle, Escape und der
// abgedunkelte Hintergrund kommen vom Browser, nicht aus eigenem Code. Das
// Formular darin ist ein echtes Formular mit einer Server Action; die
// Beleg-ids stehen als versteckte Felder darin, damit die Action genau die
// Auswahl bekommt, die der Dialog anzeigt.
//
// Zur Auswahl stehen nur Entwuerfe: in eine eingereichte Abrechnung kann
// nichts mehr hinein (der Dienst lehnt es ohnehin ab - hier wird es nur gar
// nicht erst angeboten).

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { assignToSettlement, type ActionState } from "@/app/(app)/settlements/actions";
import type { ApiSettlement } from "@/lib/api/settlements";
import { formatPeriod, formatSettlementTotal, itemCount } from "@/lib/settlements/format";
import { CurrencySelect } from "./currency-select";

export type AssignTarget = Pick<
  ApiSettlement,
  "id" | "title" | "periodStart" | "periodEnd" | "receiptCount" | "total"
>;

export function AssignDialog({
  receiptIds,
  settlements,
  subtitle,
  trigger,
  triggerClassName,
  onAssigned,
}: {
  receiptIds: string[];
  /** Die offenen Entwuerfe. Eingereichte gehoeren nicht hierher. */
  settlements: AssignTarget[];
  subtitle: string;
  trigger: string;
  triggerClassName: string;
  onAssigned?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState<ActionState, FormData>(assignToSettlement, null);
  const [target, setTarget] = useState<string>(settlements[0]?.id ?? "new");

  // Nach Erfolg zu, und die Auswahl draussen leeren. Ueber den Zustand der
  // Action und nicht optimistisch beim Klick: geschlossen wird erst, wenn der
  // Dienst die Zuordnung angenommen hat.
  useEffect(() => {
    if (state?.ok) {
      dialog.current?.close();
      onAssigned?.();
    }
  }, [state, onAssigned]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setTarget(settlements[0]?.id ?? "new");
          dialog.current?.showModal();
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>

      <dialog
        ref={dialog}
        className="bg-panel m-auto w-[500px] max-w-[calc(100%-32px)] rounded-2xl p-6 shadow-[0_18px_48px_rgba(0,0,0,0.18)] backdrop:bg-[rgba(22,22,32,0.38)]"
      >
        <form action={action} className="flex flex-col gap-[18px]">
          {receiptIds.map((id) => (
            <input key={id} type="hidden" name="receiptId" value={id} />
          ))}

          <div>
            <div className="text-[18px] font-semibold tracking-[-0.012em]">Add to settlement</div>
            <div className="text-ink-3 mt-[5px] text-[13px]">{subtitle}</div>
          </div>

          <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {settlements.map((settlement) => {
              const on = target === settlement.id;
              const period = formatPeriod(settlement.periodStart, settlement.periodEnd);
              return (
                <label
                  key={settlement.id}
                  className={`flex cursor-pointer items-center justify-between gap-[14px] rounded-[11px] border px-[15px] py-[13px] ${
                    on ? "border-brand bg-brand-soft" : "border-line bg-panel"
                  }`}
                >
                  <input
                    type="radio"
                    name="target"
                    value={settlement.id}
                    checked={on}
                    onChange={() => setTarget(settlement.id)}
                    className="sr-only"
                  />
                  <span className="flex flex-col gap-[3px]">
                    <span className="text-sm font-medium">{settlement.title}</span>
                    <span className="text-ink-3 text-xs">
                      {period ? `${period} · ` : ""}
                      {itemCount(settlement.receiptCount)}
                    </span>
                  </span>
                  <span className="tabular text-sm font-medium">
                    {formatSettlementTotal(settlement.total)}
                  </span>
                </label>
              );
            })}

            <label
              className={`text-ink-2 flex cursor-pointer items-center rounded-[11px] border border-dashed px-[15px] py-[13px] text-sm ${
                target === "new" ? "border-brand bg-brand-soft" : "border-line-2 bg-panel"
              }`}
            >
              <input
                type="radio"
                name="target"
                value="new"
                checked={target === "new"}
                onChange={() => setTarget("new")}
                className="sr-only"
              />
              Create new settlement
            </label>

            {target === "new" ? (
              <label className="flex flex-col gap-[7px]">
                <span className="text-ink-2 text-[12.5px] font-medium">Settlement title</span>
                <input
                  name="title"
                  required
                  maxLength={200}
                  placeholder="Enter a title"
                  className="border-line-2 bg-panel text-ink h-11 w-full rounded-[11px] border px-3 text-sm"
                />
                <span className="text-ink-3 text-[11.5px]">e.g. Field visit Bern, week 38</span>
              </label>
            ) : null}

            {target === "new" ? (
              <label className="flex flex-col gap-[7px]">
                <span className="text-ink-2 text-[12.5px] font-medium">Settlement currency</span>
                <CurrencySelect className="border-line-2 bg-panel text-ink h-11 w-full rounded-[11px] border px-3 text-sm" />
                <span className="text-ink-3 text-[11.5px]">
                  Every item is converted at the rate of its receipt date.
                </span>
              </label>
            ) : null}
          </div>

          {state?.ok === false ? (
            <div className="text-bad-deep text-[13px]">{state.message}</div>
          ) : null}

          <div className="flex items-center gap-[9px]">
            <AddButton />
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="text-ink-2 hover:bg-surface h-10 rounded-[10px] px-[14px] text-[13.5px]"
            >
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-brand hover:bg-brand-deep h-10 rounded-[10px] px-4 text-[13.5px] font-medium text-white disabled:opacity-70"
    >
      {pending ? "Adding…" : "Add"}
    </button>
  );
}
