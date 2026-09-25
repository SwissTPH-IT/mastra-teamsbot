// Die Abrechnungen: Liste und "New settlement".
//
// Aufbau wie in der Vorlage. Zeitraum, Anzahl und Summe kommen gerechnet vom
// Dienst - gespeichert ist davon nichts, damit eine Korrektur am Beleg nicht
// an zwei Stellen nachgezogen werden muss.

import Link from "next/link";
import { connection } from "next/server";
import { NewSettlementForm } from "@/components/settlements/new-settlement-form";
import { Panel, ServiceUnavailable, UnlinkedAccount } from "@/components/receipts/states";
import { classifyFailure } from "@/lib/api/guard";
import { fetchSettlements, type ApiSettlement } from "@/lib/api/settlements";
import {
  STATUS_STYLE,
  formatPeriod,
  formatTotals,
  itemCount,
  settlementMeta,
} from "@/lib/settlements/format";

export default async function SettlementsPage() {
  // Ohne Parameter wuerde Next die Seite beim Build statisch vorrendern
  // wollen. Der Session-Zugriff in apiRequest() scheitert dann im try unten
  // und landete als "Abruf fehlgeschlagen" im Build-Log. Die Seite ist pro
  // Nutzer, also ausdruecklich dynamisch.
  await connection();

  let settlements: ApiSettlement[];
  try {
    settlements = await fetchSettlements();
  } catch (error) {
    const failure = classifyFailure(error);
    return (
      <div className="flex flex-col gap-[22px]">
        <Header />
        {failure.kind === "unlinked" ? (
          <UnlinkedAccount />
        ) : (
          <ServiceUnavailable detail={failure.detail} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <Header action={<NewSettlementForm />} />

      {settlements.length === 0 ? (
        <Panel>
          <div className="text-[18px] font-semibold">No settlement yet</div>
          <div className="text-ink-2 max-w-[460px] text-[13.5px] leading-[1.6]">
            A settlement groups the receipts of one trip or one month and is submitted as a whole.
            Create one here, or select receipts in the list and choose “Add to settlement”.
          </div>
          <Link href="/receipts?unassigned=1" className="text-brand mt-2 text-[13px] font-medium">
            Show unassigned receipts
          </Link>
        </Panel>
      ) : (
        <div className="border-line bg-panel overflow-hidden rounded-xl border">
          {settlements.map((settlement) => (
            <SettlementRow key={settlement.id} settlement={settlement} />
          ))}
        </div>
      )}
    </div>
  );
}

function Header({ action }: { action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-5">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.018em]">Settlements</h1>
        <div className="text-ink-3 mt-[6px] text-[13px]">
          A bundle of items submitted for approval as a whole.
        </div>
      </div>
      {action}
    </div>
  );
}

function SettlementRow({ settlement }: { settlement: ApiSettlement }) {
  const style = STATUS_STYLE[settlement.status];
  return (
    <Link
      href={`/settlements/${settlement.id}`}
      className="border-line bg-panel hover:bg-surface grid w-full grid-cols-[minmax(0,1fr)_168px_124px_104px_minmax(130px,auto)] items-center gap-5 border-t px-5 py-4 text-left first:border-t-0"
    >
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-[15px] font-medium">{settlement.title}</span>
        <span className="text-ink-3 text-xs">{settlementMeta(settlement)}</span>
      </span>
      <span className="tabular text-ink-3 text-[12.5px]">
        {formatPeriod(settlement.periodStart, settlement.periodEnd) ?? "–"}
      </span>
      <span className="text-ink-2 flex items-center gap-[6px] text-[12.5px]">
        <span className={`h-[6px] w-[6px] rounded-full ${style.dot}`} />
        {style.label}
      </span>
      <span className="text-ink-3 text-[12.5px]">{itemCount(settlement.receiptCount)}</span>
      <span className="tabular text-right text-base font-medium">
        {formatTotals(settlement.totals)}
      </span>
    </Link>
  );
}
