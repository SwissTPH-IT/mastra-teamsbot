"use client";

// Mehrfachauswahl in der Belegliste: Checkbox je Zeile, Leiste unten.
//
// Der Zustand liegt in einem Context und nicht in der URL: eine Auswahl ist
// ein Zwischenschritt vor "Add to settlement", keine Ansicht, die man teilt.
// Die Zeilen selbst bleiben Server-Komponenten; nur die Checkbox darin ist
// eine Client-Komponente, die an diesem Context haengt.
//
// Beim Seitenwechsel oder Filtern bleibt die Auswahl nicht stehen - der
// Provider sitzt innerhalb der Suspense-Grenze der Liste, die bei jeder neuen
// Abfrage neu aufgebaut wird. Eine Auswahl ueber Seiten hinweg, die man nicht
// mehr sieht, waere eine Fehlerquelle ("was habe ich da eigentlich
// zugeordnet?").

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AssignDialog, type AssignTarget } from "./assign-dialog";
import { addTotals, formatTotals, itemCount } from "@/lib/settlements/format";

type Picked = { amount: string | null; currency: string | null };

type Selection = {
  selected: Map<string, Picked>;
  toggle: (id: string, picked: Picked) => void;
  setMany: (entries: [string, Picked][], on: boolean) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

function useSelection(): Selection {
  const context = useContext(SelectionContext);
  if (!context) throw new Error("SelectionProvider fehlt.");
  return context;
}

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Map<string, Picked>>(new Map());

  const toggle = useCallback((id: string, picked: Picked) => {
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(id)) next.delete(id);
      else next.set(id, picked);
      return next;
    });
  }, []);

  const setMany = useCallback((entries: [string, Picked][], on: boolean) => {
    setSelected((previous) => {
      const next = new Map(previous);
      for (const [id, picked] of entries) {
        if (on) next.set(id, picked);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Map()), []);

  const value = useMemo(
    () => ({ selected, toggle, setMany, clear }),
    [selected, toggle, setMany, clear],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

const BOX_CLASS = "accent-brand h-4 w-4 cursor-pointer disabled:cursor-not-allowed";

/**
 * Die Checkbox einer Zeile.
 *
 * `disabledReason` bei Belegen in einer eingereichten Abrechnung: sie koennen
 * nicht wandern, also koennen sie auch nicht ausgewaehlt werden.
 */
export function SelectBox({
  id,
  amount,
  currency,
  label,
  disabledReason,
}: {
  id: string;
  amount: string | null;
  currency: string | null;
  label: string;
  disabledReason?: string;
}) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      title={disabledReason}
      disabled={!!disabledReason}
      checked={selected.has(id)}
      onChange={() => toggle(id, { amount, currency })}
      className={BOX_CLASS}
    />
  );
}

/** "Alle auf dieser Seite". Nur die auswaehlbaren - gesperrte bleiben aussen vor. */
export function SelectAll({
  rows,
}: {
  rows: { id: string; amount: string | null; currency: string | null }[];
}) {
  const { selected, setMany } = useSelection();
  const allOn = rows.length > 0 && rows.every((row) => selected.has(row.id));

  return (
    <input
      type="checkbox"
      aria-label="Select all items on this page"
      disabled={rows.length === 0}
      checked={allOn}
      onChange={() =>
        setMany(
          rows.map((row) => [row.id, { amount: row.amount, currency: row.currency }]),
          !allOn,
        )
      }
      className={BOX_CLASS}
    />
  );
}

/**
 * Die Leiste unten, sobald etwas ausgewaehlt ist.
 *
 * Die Summe je Waehrung, wie ueberall: die Vorlage zeigt "… CHF", aber eine
 * Auswahl mit einem EUR-Beleg ergaebe sonst eine falsche Zahl.
 */
export function SelectionBar({ settlements }: { settlements: AssignTarget[] }) {
  const { selected, clear } = useSelection();
  if (selected.size === 0) return null;

  const totals = addTotals(
    [...selected.values()].map((entry) => ({
      currency: entry.currency,
      count: 1,
      sum: entry.amount ?? "0",
    })),
  );

  return (
    <div className="bg-panel border-line-2 fixed right-0 bottom-0 left-[244px] z-40 flex items-center gap-[18px] border-t px-12 py-[14px]">
      <div className="flex items-center gap-3">
        <span className="tabular bg-brand flex h-[26px] min-w-[26px] items-center justify-center rounded-lg px-2 text-[13px] font-semibold text-white">
          {selected.size}
        </span>
        <span className="text-ink-2 text-[13.5px]">items selected</span>
        <span className="bg-line h-5 w-px" />
        <span className="tabular text-[17px] font-semibold">{formatTotals(totals)}</span>
      </div>
      <div className="ml-auto flex items-center gap-[9px]">
        <button
          type="button"
          onClick={clear}
          className="border-line bg-panel text-ink-2 hover:bg-surface h-[38px] rounded-[10px] border px-[14px] text-[13px]"
        >
          Clear selection
        </button>
        <AssignDialog
          receiptIds={[...selected.keys()]}
          settlements={settlements}
          subtitle={`${itemCount(selected.size)} · ${formatTotals(totals)}`}
          trigger="Add to settlement"
          triggerClassName="bg-brand hover:bg-brand-deep h-10 rounded-[10px] px-4 text-[13.5px] font-medium text-white"
          onAssigned={clear}
        />
      </div>
    </div>
  );
}
