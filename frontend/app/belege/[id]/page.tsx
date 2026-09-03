// Detailansicht eines Belegs.
//
// Eigene Seite statt aufklappbarer Zeile: die URL ist damit teilbar und
// verlinkbar ("schau dir mal /belege/<id> an"), und die dichte Tabelle bleibt
// dicht. Read-only - Korrekturen laufen ueber den Teams-Flow, es gibt hier
// bewusst kein Formular und keinen schreibenden Endpunkt.

import Link from "next/link";
import { notFound } from "next/navigation";
import { AmountCell, ConfidenceCell, Empty, TimestampCell } from "@/components/receipts/cells";
import { formatRate, formatReceiptDate } from "@/lib/receipts/format";
import { getReceipt, type ReceiptRow } from "@/lib/receipts/queries";
import { resolveScope } from "@/lib/receipts/scope";

export const dynamic = "force-dynamic";

/** Die Marker aus receiptSchema. Im Rohwert eines Positionsfelds stehen sie noch. */
const MARKERS = new Set(["NOT_PRESENT", "ILLEGIBLE", ""]);

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return MARKERS.has(trimmed) ? null : trimmed;
}

export default async function BelegDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await resolveScope();
  const receipt = await getReceipt(scope, id);

  if (!receipt) notFound();

  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link href="/belege" className="text-fg-muted text-[13px] hover:underline">
            &larr; Alle Belege
          </Link>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">
            {receipt.merchant ?? "Beleg ohne Haendler"}
          </h1>
          <p className="text-fg-muted tabular text-[13px]">
            {formatReceiptDate(receipt.receiptDate) ?? "ohne Belegdatum"}
            {receipt.receiptTime ? `, ${receipt.receiptTime}` : ""}
          </p>
        </div>
        <p className="text-right text-xl font-semibold">
          <AmountCell value={receipt.totalAmount} currency={receipt.currency} />
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <Section title="Beleg">
            <Field label="Belegdatum" value={formatReceiptDate(receipt.receiptDate)} tabular />
            <Field label="Belegzeit" value={receipt.receiptTime} tabular />
            <Field label="Referenznummer" value={receipt.referenceNumber} />
            <Field label="Belegart" value={receipt.receiptType} />
            <Field label="Kategorie" value={receipt.category} />
            <Field label="Zahlungsart" value={receipt.paymentMethod} />
          </Section>

          <Section title="Haendler">
            <Field label="Name" value={receipt.merchant} />
            <Field label="Adresse" value={receipt.merchantAddress} />
            <Field label="Steuernummer" value={receipt.merchantTaxId} />
          </Section>

          <Section title="Betraege">
            <AmountField label="Zwischensumme" value={receipt.subtotalAmount} row={receipt} />
            <AmountField label="Rabatt" value={receipt.discountAmount} row={receipt} />
            <AmountField label="MwSt-Betrag" value={receipt.vatAmount} row={receipt} />
            <Field label="MwSt-Satz" value={formatRate(receipt.vatRate)} tabular />
            <AmountField label="Gesamtbetrag" value={receipt.totalAmount} row={receipt} />
            <Field label="Waehrung" value={receipt.currency} tabular />
          </Section>

          <LineItems value={receipt.lineItems} />
          <Issues value={receipt.issues} />

          <Section title="Erfassung">
            <dt className="text-fg-muted text-[13px]">Erfasst am</dt>
            <dd className="text-[13px]">
              <TimestampCell value={receipt.createdAt} />
            </dd>
            <dt className="text-fg-muted text-[13px]">Zuletzt geaendert</dt>
            <dd className="text-[13px]">
              <TimestampCell value={receipt.updatedAt} />
            </dd>
            <dt className="text-fg-muted text-[13px]">Konfidenz</dt>
            <dd className="text-[13px]">
              <ConfidenceCell value={receipt.confidence} />
            </dd>
            <dt className="text-fg-muted text-[13px]">Nutzer</dt>
            <dd className="font-mono text-[12px] break-all">{receipt.userId}</dd>
            <dt className="text-fg-muted text-[13px]">Beleg-ID</dt>
            <dd className="font-mono text-[12px] break-all">{receipt.id}</dd>
            <dt className="text-fg-muted text-[13px]">Dateireferenz</dt>
            <dd className="font-mono text-[12px] break-all">{receipt.fileReference}</dd>
          </Section>

          {/* Der unveraenderte Agent-Output, inklusive aller
              NOT_PRESENT/ILLEGIBLE-Marker. Nachvollziehbar, aber
              zusammengeklappt: er ist die Begruendung fuer die geparsten
              Felder, nicht die Ansicht. */}
          <details className="border-line rounded-lg border">
            <summary className="text-fg-muted cursor-pointer px-4 py-2.5 text-[13px] font-medium">
              Roh-Extraktion
            </summary>
            <pre className="border-line overflow-x-auto border-t px-4 py-3 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(receipt.rawExtraction, null, 2)}
            </pre>
          </details>
        </div>

        <ReceiptImage id={receipt.id} reference={receipt.fileReference} />
      </div>
    </article>
  );
}

/**
 * Das Belegbild.
 *
 * Laeuft ueber den eigenen Proxy (/api/belege/<id>/bild) und nicht direkt gegen
 * den Agenten: dessen Adresse ist eine serverseitige Variable und soll nicht im
 * Browser landen, und der Proxy prueft den Scope.
 */
function ReceiptImage({ id, reference }: { id: string; reference: string }) {
  return (
    <aside className="flex flex-col gap-2">
      <h2 className="text-fg-muted text-[11px] font-semibold tracking-wide uppercase">
        Originaldatei
      </h2>
      <a
        href={`/api/belege/${id}/bild`}
        target="_blank"
        rel="noreferrer"
        className="border-line bg-surface-2 block overflow-hidden rounded-lg border"
      >
        {/* Bewusst <img> und nicht next/image: die Datei kommt aus einem
            eigenen Route Handler mit unbekannten Abmessungen, eine
            Bildoptimierung darueber bringt nichts. */}
        <img
          src={`/api/belege/${id}/bild`}
          alt={`Belegbild zu ${reference}`}
          className="h-auto w-full object-contain"
        />
      </a>
      <p className="text-fg-subtle text-[11px]">In neuem Tab oeffnen fuer die Vollansicht</p>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-fg-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </h2>
      <dl className="border-line grid grid-cols-[minmax(120px,180px)_1fr] gap-x-4 gap-y-1.5 rounded-lg border px-4 py-3">
        {children}
      </dl>
    </section>
  );
}

function Field({
  label,
  value,
  tabular,
}: {
  label: string;
  value: string | null;
  tabular?: boolean;
}) {
  return (
    <>
      <dt className="text-fg-muted text-[13px]">{label}</dt>
      <dd className={`text-[13px] ${tabular ? "tabular" : ""}`}>{value ?? <Empty />}</dd>
    </>
  );
}

function AmountField({
  label,
  value,
  row,
}: {
  label: string;
  value: string | null;
  row: ReceiptRow;
}) {
  return (
    <>
      <dt className="text-fg-muted text-[13px]">{label}</dt>
      <dd className="text-[13px]">
        <AmountCell value={value} currency={row.currency} />
      </dd>
    </>
  );
}

/**
 * Positionen. `line_items` ist jsonb und damit fuer Drizzle `unknown` - die
 * Form wird hier zur Laufzeit geprueft statt behauptet.
 */
function LineItems({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;

  const items = value.filter(
    (item): item is Record<string, unknown> => typeof item === "object" && item !== null,
  );
  if (items.length === 0) return null;

  const HEAD = "text-fg-muted px-3 py-2 text-[11px] font-semibold uppercase";

  return (
    <section>
      <h2 className="text-fg-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
        Positionen
      </h2>
      <div className="border-line overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-[13px]">
          <thead className="bg-surface-2 border-line border-b">
            <tr>
              <th scope="col" className={`${HEAD} text-left`}>
                Beschreibung
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Menge
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Einzelpreis
              </th>
              <th scope="col" className={`${HEAD} text-right`}>
                Zeilensumme
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index} className="border-line border-b last:border-0">
                <td className="px-3 py-1.5">{clean(item.description) ?? <Empty />}</td>
                <td className="tabular px-3 py-1.5 text-right">
                  {clean(item.quantity) ?? <Empty />}
                </td>
                <td className="tabular px-3 py-1.5 text-right">
                  {clean(item.unitPrice) ?? <Empty />}
                </td>
                <td className="tabular px-3 py-1.5 text-right">
                  {clean(item.lineTotal) ?? <Empty />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Auffaelligkeiten aus der Extraktion. Zustandsfarbe, weil sie eine sind. */
function Issues({ value }: { value: unknown }) {
  if (!Array.isArray(value)) return null;
  const issues = value.filter((item): item is string => typeof item === "string" && item !== "");
  if (issues.length === 0) return null;

  return (
    <section>
      <h2 className="text-fg-muted mb-2 text-[11px] font-semibold tracking-wide uppercase">
        Auffaelligkeiten
      </h2>
      <ul className="border-warn/40 flex list-disc flex-col gap-1 rounded-lg border py-3 pr-4 pl-8 text-[13px]">
        {issues.map((issue, index) => (
          <li key={index}>{issue}</li>
        ))}
      </ul>
    </section>
  );
}
