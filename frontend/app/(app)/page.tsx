// Die Startseite: was offen ist, und die fuenf letzten Belege.
//
// Aufbau wie in der Vorlage. Die Abrechnungs-Kacheln sind ausgegraut, weil es
// Abrechnungen noch nicht gibt - sichtbar und erkennbar deaktiviert statt
// entfernt: so sieht man, wohin das gehoert, ohne es anklicken zu koennen.

import Link from "next/link";
import { auth } from "@/auth";
import { NoReceipts, ServiceUnavailable, UnlinkedAccount } from "@/components/receipts/states";
import { RecentRow } from "@/components/receipts/rows";
import { classifyFailure, type LoadFailure } from "@/lib/api/guard";
import {
  fetchReceiptPage,
  fetchSummary,
  type ApiReceipt,
  type CurrencySummary,
} from "@/lib/api/receipts";
import { formatAmount, formatToday, greeting } from "@/lib/receipts/format";
import { parseReceiptQuery } from "@/lib/receipts/query-params";

/** Die vier Zustaende einer Abrechnung. Aus der Vorlage, noch ohne Daten. */
const SETTLEMENT_STATES = ["Draft", "Submitted", "Approved", "Query"] as const;

export default async function HomePage() {
  const session = await auth();
  const name = session?.user?.name ?? null;

  const data = await load();

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-[25px] font-semibold tracking-[-0.018em]">
            {greeting()}
            {name ? `, ${name.split(" ")[0]}` : ""}
          </h1>
          <div className="text-ink-3 mt-[6px] text-[13.5px]">{formatToday()}</div>
        </div>
        <div className="flex gap-[9px]">
          <Link
            href="/receipts/new"
            className="bg-brand hover:bg-brand-deep flex h-10 items-center rounded-[10px] px-4 text-[13.5px] font-medium text-white"
          >
            Add expense without receipt
          </Link>
          <TeamsButton />
        </div>
      </div>

      {data.failure ? (
        data.failure.kind === "unlinked" ? (
          <UnlinkedAccount name={name} />
        ) : (
          <ServiceUnavailable detail={data.failure.detail} />
        )
      ) : data.receipts.length === 0 ? (
        <NoReceipts />
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,340px)_minmax(0,1fr)] items-start gap-7">
            <Unassigned summary={data.summary} />
            <SettlementTiles />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <div className="text-ink-3 text-[10.5px] font-semibold tracking-[0.09em] uppercase">
                Recent items
              </div>
              <Link href="/receipts" className="text-brand text-[13px] font-medium">
                All receipts
              </Link>
            </div>
            <div className="border-line bg-panel overflow-hidden rounded-xl border">
              {data.receipts.map((receipt) => (
                <RecentRow key={receipt.id} receipt={receipt} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Die Kennzahl. "Unassigned" ist heute jeder Beleg - es gibt keine
 * Abrechnungen, denen einer zugeordnet sein koennte. Der Wert ist damit
 * richtig, und die Zeile darunter sagt, was er bedeutet.
 *
 * Getrennt je Waehrung: CHF und EUR zu addieren ergibt eine Zahl, die nichts
 * bedeutet (siehe summarizeReceipts). Im Normalfall ist es genau eine Zeile.
 */
function Unassigned({ summary }: { summary: CurrencySummary[] }) {
  const count = summary.reduce((sum, entry) => sum + entry.count, 0);
  const [first, ...rest] = summary;

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="text-ink-3 text-[10.5px] font-semibold tracking-[0.09em] uppercase">
        Unassigned
      </div>
      <div className="flex items-baseline gap-[10px]">
        <span className="tabular text-[46px] leading-none font-semibold tracking-[-0.035em]">
          {formatAmount(first?.sum ?? "0") ?? "0.00"}
        </span>
        <span className="text-ink-3 text-sm">{first?.currency ?? "CHF"}</span>
      </div>
      {rest.length > 0 ? (
        <div className="text-ink-2 text-[13px]">
          plus{" "}
          {rest
            .map((entry) => `${entry.currency ?? "no currency"} ${formatAmount(entry.sum)}`)
            .join(", ")}
        </div>
      ) : null}
      <div className="text-ink-2 text-[13.5px]">
        {count === 1 ? "1 item" : `${count} items`} not in a settlement yet
      </div>
    </div>
  );
}

/**
 * Die Abrechnungs-Kacheln, ausgegraut.
 *
 * Kein Zahlenwert und kein Link: es gibt weder app.expense_reports noch einen
 * Endpunkt dafuer. Eine "0.00" pro Kachel waere die schlechtere Wahl - sie
 * behauptet, es gebe keine Abrechnungen, statt zu sagen, dass es sie noch
 * nicht gibt.
 */
function SettlementTiles() {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-ink-3 flex items-baseline gap-2 text-[10.5px] font-semibold tracking-[0.09em] uppercase">
        Settlements
        <span className="bg-surface text-ink-3 rounded-full px-[7px] py-px text-[10px] font-medium tracking-normal normal-case">
          Soon
        </span>
      </div>
      <div
        aria-disabled="true"
        title="Settlements are not available yet"
        className="border-line bg-panel grid grid-cols-4 overflow-hidden rounded-xl border opacity-60"
      >
        {SETTLEMENT_STATES.map((state) => (
          <div
            key={state}
            className="border-line flex flex-col gap-[7px] border-l px-4 pt-4 pb-[14px] first:border-l-0"
          >
            <span className="text-ink-2 flex items-center gap-[6px] text-[12.5px]">
              <span className="bg-line-2 h-[6px] w-[6px] rounded-full" />
              {state}
            </span>
            <span className="tabular text-ink-3 text-[18px] font-semibold tracking-[-0.02em]">
              –
            </span>
            <span className="text-ink-3 text-[11.5px]">not yet available</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * "Capture in Teams".
 *
 * Ein echter Deep Link braucht die Bot-ID des Tenants. Ist TEAMS_CHAT_URL
 * gesetzt, fuehrt der Knopf in den Chat; sonst ist er deaktiviert statt auf
 * eine geratene URL zu zeigen.
 */
function TeamsButton() {
  const url = process.env.TEAMS_CHAT_URL;

  if (!url) {
    return (
      <span
        aria-disabled="true"
        title="Set TEAMS_CHAT_URL to link the expenses bot"
        className="border-line-2 bg-panel text-ink-3 flex h-10 cursor-not-allowed items-center rounded-[10px] border px-[14px] text-[13.5px] opacity-60"
      >
        Capture in Teams
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="border-line-2 bg-panel text-ink-2 hover:bg-surface flex h-10 items-center rounded-[10px] border px-[14px] text-[13.5px]"
    >
      Capture in Teams
    </a>
  );
}

type HomeData = {
  failure?: LoadFailure;
  summary: CurrencySummary[];
  receipts: ApiReceipt[];
};

/**
 * Kennzahl und letzte Belege in einem Gang.
 *
 * Parallel, nicht nacheinander: die beiden Abfragen haengen nicht voneinander
 * ab, und hintereinander waere die Startseite doppelt so langsam wie noetig.
 */
async function load(): Promise<HomeData> {
  const query = {
    ...parseReceiptQuery(new URLSearchParams()),
    period: "all" as const,
    pageSize: 25,
  };

  try {
    const [summary, page] = await Promise.all([
      fetchSummary(),
      fetchReceiptPage({ ...query, from: null }),
    ]);
    return { summary, receipts: page.receipts.slice(0, 5) };
  } catch (error) {
    return { failure: classifyFailure(error), summary: [], receipts: [] };
  }
}
