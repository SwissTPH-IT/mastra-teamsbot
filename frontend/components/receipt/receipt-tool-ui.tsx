'use client';

import type { FC } from 'react';
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { ToolFallback } from '@/components/assistant-ui/tool-fallback';
import { PendingCard, ReceiptCard } from './receipt-card';
import type { ExtractReceiptArgs, ExtractReceiptResult } from './receipt-types';

/** Muss dem Key in `tools: { extractReceipt: … }` des Agents entsprechen. */
export const EXTRACT_RECEIPT_TOOL = 'extractReceipt';

const ExtractReceiptUI: FC<{
  args: ExtractReceiptArgs;
  result: ExtractReceiptResult | undefined;
  status: { type: string };
}> = ({ args, result, status }) => {
  const results = result?.results;

  if (!results) {
    // Während der Extraktion sind die uploadIds schon aus dem gestreamten
    // Argument bekannt – also gleich mit Bildvorschau anzeigen.
    const pending = args?.uploadIds ?? [];
    if (status.type === 'incomplete') {
      return (
        <div className="border-destructive/40 bg-destructive/5 rounded-xl border p-4 text-sm">
          Die Extraktion wurde abgebrochen.
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-2">
        {pending.length > 0 ? (
          pending.map(uploadId => <PendingCard key={uploadId} uploadId={uploadId} />)
        ) : (
          <PendingCard />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {results.map(item => (
        <ReceiptCard key={item.uploadId} item={item} />
      ))}
    </div>
  );
};

/**
 * Wird als `ToolFallback` in den Thread gegeben: der Beleg-Tool-Aufruf bekommt
 * die Ergebniskarte, jeder andere Tool-Aufruf die Standardanzeige.
 */
export const ReceiptToolUI: ToolCallMessagePartComponent = props => {
  if (props.toolName !== EXTRACT_RECEIPT_TOOL) {
    return <ToolFallback {...props} />;
  }

  return (
    <ExtractReceiptUI
      args={props.args as ExtractReceiptArgs}
      result={props.result as ExtractReceiptResult | undefined}
      status={props.status}
    />
  );
};
