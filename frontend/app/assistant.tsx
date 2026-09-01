'use client';

import { useMemo, type FC, type PropsWithChildren } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/react-ai-sdk';
import { ReceiptIcon } from 'lucide-react';
import { Thread } from '@/components/assistant-ui/thread';
import { ReceiptToolUI } from '@/components/receipt/receipt-tool-ui';
import { ReceiptUploadAdapter } from '@/lib/receipt-uploads';

const Welcome: FC = () => (
  <div className="mb-6 flex flex-col items-center gap-3 px-4 text-center">
    <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-2xl">
      <ReceiptIcon className="size-6" />
    </div>
    <h1 className="text-2xl font-medium tracking-tight">Belege erfassen</h1>
    <p className="text-muted-foreground max-w-md text-sm">
      Ziehe ein Foto deiner Quittung in das Feld unten oder wähle es über{' '}
      <span className="text-foreground font-medium">+</span> aus. Mehrere Belege
      gleichzeitig sind möglich. Die erkannten Daten erscheinen direkt hier und werden
      als JSON gespeichert.
    </p>
  </div>
);

/**
 * Der Beleg-Tool-Aufruf ist das Ergebnis, nicht ein Zwischenschritt – deshalb
 * ohne die einklappbare "Used tools"-Gruppe des Standard-Threads.
 */
const ToolGroup: FC<PropsWithChildren<unknown>> = ({ children }) => (
  <div className="flex flex-col gap-3 py-2">{children}</div>
);

export const Assistant = () => {
  // Der Adapter hält die Zuordnung Anhang -> uploadId, darf also nicht bei
  // jedem Render neu entstehen.
  const attachments = useMemo(() => new ReceiptUploadAdapter(), []);

  const runtime = useChatRuntime({
    transport: new AssistantChatTransport({ api: '/api/chat' }),
    adapters: { attachments },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="mx-auto flex h-dvh w-full flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <ReceiptIcon className="text-muted-foreground size-4" />
          <span className="text-sm font-medium">Belegerfassung</span>
          <span className="text-muted-foreground ms-auto text-xs">
            Mastra · receipt-workflow
          </span>
        </header>
        <div className="flex-1 overflow-hidden">
          <Thread components={{ Welcome, ToolFallback: ReceiptToolUI, ToolGroup }} />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
};
