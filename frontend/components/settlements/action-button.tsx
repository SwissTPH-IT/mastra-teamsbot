"use client";

// Ein Knopf, der eine Server Action ausloest und ihre Antwort zeigt.
//
// Fuer die kleinen Aktionen der Abrechnung (Remove, Submit, Delete draft):
// jedes ein eigenes <form> mit versteckten Feldern, damit es auch ohne
// JavaScript funktioniert. `confirm` fuer das, was nicht rueckgaengig zu machen
// ist - Einreichen sperrt die Abrechnung, und zurueck kann heute nur Finance.

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/(app)/settlements/actions";

export function ActionButton({
  action,
  fields,
  label,
  pendingLabel,
  className,
  confirm,
  disabled,
  title,
  messageClassName = "text-xs",
}: {
  action: (previous: ActionState, form: FormData) => Promise<ActionState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  className: string;
  confirm?: string;
  disabled?: boolean;
  title?: string;
  messageClassName?: string;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      className="contents"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Submit
        label={label}
        pendingLabel={pendingLabel}
        className={className}
        disabled={disabled}
        title={title}
      />
      {state?.ok === false ? (
        <span className={`text-bad-deep ${messageClassName}`}>{state.message}</span>
      ) : null}
    </form>
  );
}

function Submit({
  label,
  pendingLabel,
  className,
  disabled,
  title,
}: {
  label: string;
  pendingLabel: string;
  className: string;
  disabled?: boolean;
  title?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={disabled || pending} title={title} className={className}>
      {pending ? pendingLabel : label}
    </button>
  );
}
