'use client';

import { useState, type FC } from 'react';
import {
  AlertTriangleIcon,
  CheckIcon,
  CopyIcon,
  FileWarningIcon,
  Loader2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { receiptImageUrl } from '@/lib/receipt-uploads';
import {
  displayValue,
  isMissing,
  type ExtractReceiptResultItem,
  type ReceiptData,
} from './receipt-types';

const Thumbnail: FC<{ uploadId: string; className?: string }> = ({
  uploadId,
  className,
}) => (
  <a
    href={receiptImageUrl(uploadId)}
    target="_blank"
    rel="noopener noreferrer"
    className={cn(
      'bg-muted block size-20 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10',
      className,
    )}
    title="Originalbild in neuem Tab öffnen"
  >
    {/* Kein next/image: die Route liefert beliebige Nutzerbilder aus. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src={receiptImageUrl(uploadId)}
      alt="Belegbild"
      className="size-full object-cover"
    />
  </a>
);

const Field: FC<{ label: string; value: string | undefined }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
      {label}
    </span>
    <span
      className={cn(
        'text-sm wrap-break-word',
        isMissing(value) && 'text-muted-foreground/70 italic',
      )}
    >
      {displayValue(value)}
    </span>
  </div>
);

const LineItems: FC<{ receipt: ReceiptData }> = ({ receipt }) => {
  if (receipt.lineItems.length === 0) {
    return (
      <p className="text-muted-foreground text-sm italic">
        Keine Einzelpositionen auf dem Beleg.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[24rem] border-collapse text-sm">
        <thead>
          <tr className="text-muted-foreground border-border border-b text-[11px] tracking-wide uppercase">
            <th className="py-1.5 pe-2 text-start font-medium">Position</th>
            <th className="py-1.5 px-2 text-end font-medium">Menge</th>
            <th className="py-1.5 px-2 text-end font-medium">Einzel</th>
            <th className="py-1.5 ps-2 text-end font-medium">Summe</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lineItems.map((item, index) => (
            <tr
              key={`${item.description}-${index}`}
              className="border-border/60 border-b last:border-0"
            >
              <td className="py-1.5 pe-2">{displayValue(item.description)}</td>
              <td className="py-1.5 px-2 text-end tabular-nums">
                {displayValue(item.quantity)}
              </td>
              <td className="py-1.5 px-2 text-end tabular-nums">
                {displayValue(item.unitPrice)}
              </td>
              <td className="py-1.5 ps-2 text-end tabular-nums">
                {displayValue(item.lineTotal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const CopyJsonButton: FC<{ item: ExtractReceiptResultItem }> = ({ item }) => {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(JSON.stringify(item.receipt, null, 2));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      {copied ? 'Kopiert' : 'JSON kopieren'}
    </Button>
  );
};

const ReceiptCard: FC<{ item: ExtractReceiptResultItem }> = ({ item }) => {
  if (item.status === 'error' || !item.receipt) {
    return (
      <div className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-xl border p-4">
        <FileWarningIcon className="text-destructive mt-0.5 size-5 shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Beleg konnte nicht verarbeitet werden</p>
          <p className="text-muted-foreground text-sm">
            {item.error ?? 'Unbekannter Fehler.'}
          </p>
        </div>
      </div>
    );
  }

  const { receipt } = item;
  const total = displayValue(receipt.totals.total);
  const currency = isMissing(receipt.payment.currency)
    ? ''
    : ` ${receipt.payment.currency}`;

  return (
    <div className="bg-card flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex items-start gap-4">
        <Thumbnail uploadId={item.uploadId} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="truncate text-base font-medium">
            {displayValue(receipt.merchant.name)}
          </h3>
          <p className="text-muted-foreground truncate text-sm">
            {displayValue(receipt.transaction.dateNormalized)}
            {!isMissing(receipt.transaction.time) && ` · ${receipt.transaction.time}`}
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {total}
            <span className="text-muted-foreground text-sm font-normal">{currency}</span>
          </p>
        </div>
      </div>

      {receipt.issues.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <ul className="flex flex-col gap-1 text-sm">
            {receipt.issues.map(issue => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Adresse" value={receipt.merchant.address} />
        <Field label="Steuer-/UID-Nr." value={receipt.merchant.taxOrRegistrationId} />
        <Field label="Belegnummer" value={receipt.transaction.referenceNumber} />
        <Field label="Datum (Original)" value={receipt.transaction.dateRaw} />
        <Field label="Zahlungsart" value={receipt.payment.method} />
        <Field label="Währung" value={receipt.payment.currency} />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
          Positionen
        </span>
        <LineItems receipt={receipt} />
      </div>

      <div className="grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-5">
        <Field label="Zwischensumme" value={receipt.totals.subtotal} />
        <Field label="Rabatte" value={receipt.totals.discounts} />
        <Field label="Steuersatz" value={receipt.totals.taxRate} />
        <Field label="Steuerbetrag" value={receipt.totals.taxAmount} />
        <Field label="Gesamt" value={receipt.totals.total} />
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        {item.receiptJsonPath ? (
          <code className="truncate font-mono">{item.receiptJsonPath}</code>
        ) : (
          <span />
        )}
        <CopyJsonButton item={item} />
      </div>
    </div>
  );
};

const PendingCard: FC<{ uploadId?: string }> = ({ uploadId }) => (
  <div className="bg-card flex items-center gap-4 rounded-xl border p-4">
    {uploadId ? (
      <Thumbnail uploadId={uploadId} className="opacity-60" />
    ) : (
      <div className="bg-muted size-20 shrink-0 animate-pulse rounded-lg" />
    )}
    <div className="text-muted-foreground flex items-center gap-2 text-sm">
      <Loader2Icon className="size-4 animate-spin" />
      Beleg wird gelesen …
    </div>
  </div>
);

export { ReceiptCard, PendingCard, Thumbnail };
