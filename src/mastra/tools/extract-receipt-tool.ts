// Brücke zwischen Chat und Workflow.
//
// Der Chat-Agent bekommt vom Frontend nur uploadIds zu sehen. Dieses Tool löst
// sie zu Dateipfaden auf und startet damit den bestehenden `receipt-workflow` –
// derselbe Workflow, der auch aus dem Studio läuft. Die Extraktionslogik bleibt
// also an genau einer Stelle.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { receiptSchema } from '../agents/receipt-agent';
import { isValidUploadId, resolveReceiptJsonPath, resolveUploadPath } from '../receipts/upload-store';

const resultSchema = z.object({
  uploadId: z.string(),
  status: z.enum(['success', 'error']),
  receipt: receiptSchema.optional().describe('Die extrahierten Felder, nur bei status "success".'),
  receiptJsonPath: z.string().optional().describe('Wohin die JSON-Datei geschrieben wurde.'),
  error: z.string().optional().describe('Fehlermeldung, nur bei status "error".'),
});

export const extractReceiptTool = createTool({
  id: 'extract-receipt',
  description:
    'Extrahiert die Daten von einem oder mehreren hochgeladenen Belegbildern und speichert ' +
    'pro Beleg eine JSON-Datei. Erwartet die uploadIds, die das Frontend beim Hochladen ' +
    'gemeldet hat. Alle uploadIds einer Nachricht in EINEM Aufruf übergeben.',
  inputSchema: z.object({
    uploadIds: z
      .array(z.string())
      .min(1)
      .describe('Die uploadIds der hochgeladenen Belegbilder, in der Reihenfolge des Uploads.'),
  }),
  outputSchema: z.object({
    results: z.array(resultSchema),
  }),
  execute: async ({ uploadIds }, { mastra }) => {
    if (!mastra) {
      throw new Error('Tool ohne Mastra-Instanz aufgerufen – Workflow nicht erreichbar.');
    }

    const workflow = mastra.getWorkflowById('receipt-workflow');
    const logger = mastra.getLogger();

    // Sequenziell: die Extraktion ist ein Modellaufruf pro Bild, und bei einer
    // Handvoll Belegen ist Reihenfolge wertvoller als Parallelität.
    const results = [];
    for (const uploadId of uploadIds) {
      if (!isValidUploadId(uploadId)) {
        results.push({
          uploadId,
          status: 'error' as const,
          error: 'Unbekannte oder ungültige uploadId.',
        });
        continue;
      }

      try {
        const run = await workflow.createRun();
        const outcome = await run.start({
          inputData: {
            receiptPath: resolveUploadPath(uploadId),
            receiptJsonPath: resolveReceiptJsonPath(uploadId),
          },
        });

        if (outcome.status !== 'success') {
          const reason =
            outcome.status === 'failed'
              ? outcome.error?.message || String(outcome.error)
              : `Workflow endete mit Status "${outcome.status}".`;
          results.push({ uploadId, status: 'error' as const, error: reason });
          continue;
        }

        results.push({
          uploadId,
          status: 'success' as const,
          receipt: outcome.result.receipt,
          receiptJsonPath: outcome.result.receiptJsonPath,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.error(`[receipts] Extraktion für ${uploadId} fehlgeschlagen: ${message}`);
        results.push({ uploadId, status: 'error' as const, error: message });
      }
    }

    return { results };
  },
});
