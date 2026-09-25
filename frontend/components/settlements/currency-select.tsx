"use client";

// Die Waehrung einer Abrechnung: Auswahl beim Anlegen und Umschalter im Entwurf.
//
// Ein natives <select> - die Liste ist kurz, und Tastatur und Screenreader
// kommen so vom Browser.

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changeCurrencyAction, type ActionState } from "@/app/(app)/settlements/actions";
import { DEFAULT_SETTLEMENT_CURRENCY, SETTLEMENT_CURRENCIES } from "@/lib/settlements/currencies";

/** Das Feld `currency` fuer ein Formular, das eine Abrechnung anlegt. */
export function CurrencySelect({
  className,
  defaultValue = DEFAULT_SETTLEMENT_CURRENCY,
}: {
  className: string;
  defaultValue?: string;
}) {
  return (
    <select
      name="currency"
      required
      defaultValue={defaultValue}
      aria-label="Settlement currency"
      className={className}
    >
      {SETTLEMENT_CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}

/**
 * Waehrung eines Entwurfs wechseln. Abgeschickt wird beim Aendern - ein
 * eigener "Save"-Knopf fuer ein Feld mit vier Werten waere eine Handlung zu
 * viel. Ohne JavaScript bleibt der Knopf daneben als Weg.
 */
export function CurrencySwitcher({
  settlementId,
  currency,
}: {
  settlementId: string;
  currency: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(changeCurrencyAction, null);

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="settlementId" value={settlementId} />
      <label className="text-ink-3 flex items-center gap-2 text-[12.5px]">
        Currency
        <Select currency={currency} />
      </label>
      <noscript>
        <button type="submit" className="text-brand text-[12.5px]">
          Apply
        </button>
      </noscript>
      {state?.ok === false ? <span className="text-bad-deep text-xs">{state.message}</span> : null}
    </form>
  );
}

function Select({ currency }: { currency: string }) {
  const { pending } = useFormStatus();
  return (
    <select
      name="currency"
      // key: nach dem Wechsel kommt die Seite mit der neuen Waehrung zurueck,
      // und ein unkontrolliertes <select> behielte sonst seinen alten Wert.
      key={currency}
      defaultValue={currency}
      disabled={pending}
      onChange={(event) => event.currentTarget.form?.requestSubmit()}
      className="border-line-2 bg-panel text-ink h-8 rounded-[8px] border px-2 text-[13px] disabled:opacity-60"
    >
      {SETTLEMENT_CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {code}
        </option>
      ))}
    </select>
  );
}
