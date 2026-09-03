// Zellinhalte, die mehr als reinen Text brauchen.

import { formatAmount, formatTimestamp } from "@/lib/receipts/format";
import { cn } from "@/lib/utils";

/** Platzhalter fuer NULL. Eine leere Zelle sieht wie ein Renderfehler aus. */
export function Empty() {
  return <span className="text-fg-subtle">&ndash;</span>;
}

/**
 * Betrag: rechtsausgerichtet und tabellarisch, damit die Spalte optisch steht.
 * Die Waehrung ist sichtbar - bei gemischten Waehrungen ist eine nackte Zahl
 * irrefuehrend.
 */
export function AmountCell({
  value,
  currency,
  className,
}: {
  value: string | null;
  currency: string | null;
  className?: string;
}) {
  const formatted = formatAmount(value, currency);
  return (
    <span className={cn("tabular whitespace-nowrap", className)}>{formatted ?? <Empty />}</span>
  );
}

export function TimestampCell({ value }: { value: Date | null }) {
  const formatted = formatTimestamp(value);
  return <span className="tabular whitespace-nowrap">{formatted ?? <Empty />}</span>;
}

/**
 * Konfidenz als Zustand, nicht als Dekoration: eingefaerbt wird nur, was
 * Aufmerksamkeit braucht. Der Wert ist deterministisch berechnet
 * (computeConfidence in src/mastra/receipts/candidate.ts), kein Modellwert.
 */
export function ConfidenceCell({ value }: { value: string | null }) {
  if (value === null) return <Empty />;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return <span className="tabular">{value}</span>;

  const low = numeric < 0.6;
  return (
    <span
      className={cn("tabular whitespace-nowrap", low && "text-warn font-medium")}
      title={low ? "Niedrige Konfidenz - Werte pruefen" : undefined}
    >
      {Math.round(numeric * 100)} %
    </span>
  );
}

/** Teams-Nutzer-ID. Eine opake GUID, deshalb monospace und gekuerzt. */
export function UserCell({ value }: { value: string }) {
  return (
    <span className="font-mono text-fg-muted text-[11px]" title={value}>
      {value.length > 12 ? `${value.slice(0, 12)}…` : value}
    </span>
  );
}
