// Der Weg vom Teams-Anhang in den `receipt-workflow`.
//
// Teams liefert Bilder als `message.attachments`. Der Workflow will einen
// Dateipfad – genau wie beim Aufruf aus dem Studio oder aus dem Web-Frontend.
// Dieser Handler schließt die Lücke: Anhang holen, über den bestehenden
// `upload-store` ablegen, Workflow starten, Ergebnis als Text zurückposten.
//
// Damit existiert die Extraktionslogik weiterhin an genau einer Stelle
// (`receipt-workflow`), egal ob der Beleg aus dem Browser oder aus Teams kommt.

import type { ChannelHandler } from '@mastra/core/channels';
import type { ReceiptData } from '../agents/receipt-agent';
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  resolveReceiptJsonPath,
  resolveUploadPath,
  storeUpload,
} from '../receipts/upload-store';

type ReceiptOutcome = {
  name: string;
  receipt?: ReceiptData;
  receiptJsonPath?: string;
  error?: string;
};

/** Anhänge, die ein Vision-Modell tatsächlich als Beleg lesen kann. */
function isReceiptImage(attachment: { type: string; mimeType?: string }): boolean {
  if (attachment.type !== 'image') return false;
  return Boolean(attachment.mimeType && attachment.mimeType in ALLOWED_UPLOAD_TYPES);
}

/**
 * Bytes des Anhangs besorgen. `fetchData()` ist der bevorzugte Weg – der Adapter
 * hängt dort die Bot-Framework-Authentifizierung an. `data` ist der Fall, in dem
 * der Adapter die Datei schon geladen hat.
 */
async function readAttachment(attachment: {
  data?: Buffer | Blob;
  fetchData?: () => Promise<Buffer | ArrayBuffer>;
  url?: string;
}): Promise<Uint8Array> {
  if (attachment.fetchData) {
    const data = await attachment.fetchData();
    return data instanceof Uint8Array ? data : new Uint8Array(data);
  }
  if (attachment.data) {
    if (attachment.data instanceof Uint8Array) return attachment.data;
    return new Uint8Array(await attachment.data.arrayBuffer());
  }
  if (attachment.url) {
    // Letzter Ausweg: ein öffentlich erreichbarer Link. Bei Teams sind
    // Anhang-URLs in der Regel authentifiziert, deshalb nur als Fallback.
    const response = await fetch(attachment.url);
    if (!response.ok) {
      throw new Error(`Anhang konnte nicht geladen werden (HTTP ${response.status}).`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error('Anhang enthält keine Daten und keine URL.');
}

/** Ein Betrag pro Beleg, kurz gehalten – Teams ist ein Chat, kein Report. */
function summarize(outcomes: ReceiptOutcome[]): string {
  const lines = outcomes.map(outcome => {
    if (outcome.error || !outcome.receipt) {
      return `❌ **${outcome.name}** – nicht verarbeitet: ${outcome.error ?? 'unbekannter Fehler'}`;
    }

    const { merchant, transaction, totals, payment, issues } = outcome.receipt;
    const date = transaction.dateNormalized !== 'NOT_PRESENT' ? transaction.dateNormalized : transaction.dateRaw;
    const amount = [payment.currency, totals.total].filter(v => v && v !== 'NOT_PRESENT').join(' ');

    let line = `✅ **${merchant.name}** · ${date} · ${amount || 'Betrag nicht lesbar'}`;
    if (issues.length > 0) {
      line += `\n   ⚠️ ${issues.join('; ')} – bitte ein neues Foto (gerade, vollständig im Bild, mehr Licht).`;
    }
    return line;
  });

  const ok = outcomes.filter(o => o.receipt).length;
  const header =
    outcomes.length === 1
      ? ''
      : `**${ok} von ${outcomes.length} Belegen verarbeitet.**\n\n`;

  return header + lines.join('\n');
}

/**
 * Handler für Mentions, DMs und Folgenachrichten im Thread.
 *
 * Ohne Bildanhang übernimmt der Standard-Handler – der Agent antwortet dann
 * ganz normal per Modell. Mit Bildanhang läuft der deterministische Pfad:
 * jedes Bild einmal durch den `receipt-workflow`.
 */
export const handleTeamsReceipt: ChannelHandler = async (thread, message, defaultHandler, ctx) => {
  const images = message.attachments.filter(isReceiptImage);

  if (images.length === 0) {
    await defaultHandler(thread, message);
    return;
  }

  const mastra = ctx.mastra;
  if (!mastra) {
    await thread.post(
      '❌ Interner Fehler: keine Mastra-Instanz im Channel-Handler – der Beleg-Workflow ist nicht erreichbar.',
    );
    return;
  }

  const logger = mastra.getLogger();
  const workflow = mastra.getWorkflowById('receipt-workflow');

  await thread.startTyping('Beleg wird gelesen…');

  const outcomes: ReceiptOutcome[] = [];

  // Sequenziell: ein Modellaufruf pro Bild, und bei einer Handvoll Belegen ist
  // die Reihenfolge wertvoller als Parallelität (gleiche Begründung wie im Tool).
  for (const attachment of images) {
    const name = attachment.name || 'Beleg';
    try {
      const bytes = await readAttachment(attachment);
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw new Error(
          `Datei ist ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB groß, erlaubt sind maximal ${
            MAX_UPLOAD_BYTES / 1024 / 1024
          } MB.`,
        );
      }

      // storeUpload() validiert Typ und Größe und vergibt die uploadId – exakt
      // derselbe Pfad wie beim Upload aus dem Web-Frontend.
      const stored = await storeUpload(
        new File([bytes as BlobPart], name, { type: attachment.mimeType }),
      );

      const run = await workflow.createRun();
      const result = await run.start({
        inputData: {
          receiptPath: resolveUploadPath(stored.uploadId),
          receiptJsonPath: resolveReceiptJsonPath(stored.uploadId),
        },
      });

      if (result.status !== 'success') {
        const reason =
          result.status === 'failed'
            ? result.error?.message || String(result.error)
            : `Workflow endete mit Status "${result.status}".`;
        outcomes.push({ name, error: reason });
        continue;
      }

      outcomes.push({
        name,
        receipt: result.result.receipt,
        receiptJsonPath: result.result.receiptJsonPath,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger?.error(`[teams] Beleg "${name}" konnte nicht verarbeitet werden: ${errorMessage}`);
      outcomes.push({ name, error: errorMessage });
    }
  }

  // Auch im Fehlerfall bekommt der Nutzer eine Antwort – ein stiller Fehler in
  // Teams sieht für ihn aus wie ein hängender Bot.
  await thread.post(summarize(outcomes));
};
