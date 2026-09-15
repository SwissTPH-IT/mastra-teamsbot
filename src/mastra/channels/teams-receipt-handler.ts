// Der Weg vom Teams-Anhang in den `receipt-review-workflow` – und der Weg der
// Antwort des Nutzers zurück in `run.resume()`.
//
// Zwei Fälle:
//
//   Nachricht MIT Bild    -> Beleg ablegen, Review-Run starten, Karte posten.
//                            Der Run bleibt suspendiert im Store liegen.
//   Nachricht OHNE Bild   -> gibt es für diesen Thread einen offenen Review,
//                            ist die Nachricht die Antwort darauf. Sonst
//                            übernimmt der Standard-Handler (Agent + DB-Tools).
//
// Die Vorlage ist eine Adaptive Card mit Bestätigen / Anpassen / Abbrechen.
// Ein Klick darauf kommt NICHT hier an – Teams schickt ihn als Action.Submit,
// den der Adapter an `chat.onAction` gibt (siehe receipt-card-handlers.ts).
// Der Textweg hier bleibt daneben bestehen, für alle, die lieber tippen.
//
// Die Zuordnung Thread -> runId steht in app.pending_reviews, damit sie einen
// Prozess-Neustart und ein Railway-Deploy überlebt. Der Kandidatensatz steht
// dort NICHT – der liegt im Workflow-Snapshot, wo Mastra ihn verwaltet.

import type { ChannelHandler } from '@mastra/core/channels';
import { createHash } from 'node:crypto';
import { model } from '../model';
import { USER_ID_KEY } from '../tools/tool-context';
import { initialReviewState } from '../workflows/receipt-review-workflow';
import { reportOutcome, resumeReview, type ReviewResume } from './receipt-review-session';
import {
  closePendingReview,
  getPendingReview,
  openPendingReview,
} from '../../db/receipts';
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  resolveReceiptJsonPath,
  resolveUploadPath,
  storeUpload,
} from '../receipts/upload-store';

/**
 * Anhänge, die als Beleg in Frage kommen.
 *
 * Der mimeType allein reicht als Kriterium nicht: ein direkt in die Teams-
 * Nachricht eingefügtes Bild kommt als `contentType: "image/*"` herein – mit
 * Stern, ohne konkretes Format. Deshalb hier nur die grobe Klasse prüfen; das
 * echte Format bestimmt `detectImageMime()` später an den Bytes.
 */
function isReceiptImage(attachment: { type: string; mimeType?: string }): boolean {
  if (attachment.type === 'image') return true;
  // Hochgeladene Dateien ohne erkennbare Endung landen als "file" mit
  // application/octet-stream. Ob wirklich ein Bild drinsteckt, klärt
  // detectImageMime() – hier nur nicht vorschnell aussortieren.
  return attachment.type === 'file' && attachment.mimeType === 'application/octet-stream';
}

/**
 * Bildformat an den Magic Bytes erkennen.
 *
 * Verlässlicher als der von Teams gemeldete contentType und gleichzeitig die
 * Validierung: was hier nicht erkannt wird, ist keines der vier Formate, die
 * `storeUpload()` akzeptiert.
 */
function detectImageMime(bytes: Uint8Array): string | undefined {
  const startsWith = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  // WebP: "RIFF" an Position 0, "WEBP" an Position 8.
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return undefined;
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

/**
 * Der Provider meldet ein nicht bildfähiges Modell mit "No endpoints found that
 * support image input" – ohne zu sagen, welches Modell er meint. Genau die
 * Information fehlt beim Debuggen, also hier anhängen.
 */
function annotateModelError(reason: string): string {
  if (!/support image input|does not support image|vision/i.test(reason)) return reason;
  return `${reason} (konfiguriertes Modell: "${model}" – MASTRA_MODEL muss auf ein vision-fähiges Modell zeigen)`;
}

/**
 * Antwort des Nutzers auf eine Vorlage einordnen.
 *
 * Bewusst deterministisch und nicht per Modell: ob eine Buchung geschrieben wird,
 * soll nicht davon abhängen, wie ein LLM gerade gelaunt ist. Nur eine klare
 * Zustimmung zählt als Zustimmung – alles andere ist eine Korrektur und führt zu
 * einer erneuten Vorlage, also im schlimmsten Fall zu einer Rückfrage zu viel
 * statt zu einer falschen Buchung.
 */
const CONFIRM_WORDS = [
  'ja', 'passt', 'stimmt', 'korrekt', 'richtig', 'ok', 'okay', 'bestätigt', 'bestaetigt',
  'speichern', 'übernehmen', 'uebernehmen', 'yes', 'jup', 'jo', 'genau', 'perfekt', '👍', '✅',
];
const CANCEL_WORDS = [
  'abbrechen', 'abbruch', 'verwerfen', 'löschen', 'loeschen', 'nicht speichern', 'cancel', 'stop',
];

export function classifyReply(text: string): ReviewResume {
  const normalized = text.trim().toLowerCase();

  if (normalized === '') return { kind: 'correct', text };

  if (CANCEL_WORDS.some(word => normalized === word || normalized.startsWith(`${word} `))) {
    return { kind: 'cancel' };
  }

  // Nur kurze, eindeutige Zustimmung. "ja, aber das Datum stimmt nicht" ist
  // eine Korrektur, kein Ja – deshalb die Längenbegrenzung.
  const stripped = normalized.replace(/[.!,\s]+$/g, '');
  if (CONFIRM_WORDS.includes(stripped)) return { kind: 'confirm' };
  if (
    normalized.length <= 25 &&
    CONFIRM_WORDS.some(word => stripped.startsWith(word)) &&
    !/nicht|kein|falsch|aber|ausser|außer/.test(normalized)
  ) {
    return { kind: 'confirm' };
  }

  return { kind: 'correct', text };
}

/**
 * Handler für Mentions, DMs und Folgenachrichten im Thread.
 */
export const handleTeamsReceipt: ChannelHandler = async (thread, message, defaultHandler, ctx) => {
  const mastra = ctx.mastra;
  if (!mastra) {
    await thread.post(
      '❌ Interner Fehler: keine Mastra-Instanz im Channel-Handler – der Beleg-Workflow ist nicht erreichbar.',
    );
    return;
  }

  // Die Mandantenkennung, serverseitig aus dem signierten Bot-Framework-Payload.
  // Der ChannelHandlerContext trägt den RequestContext genau dafür: laut
  // @mastra/core/dist/channels/types.d.ts darf ein Handler hier "stamp the
  // tenant a channel sender maps to", bevor er defaultHandler aufruft.
  // Ab hier sehen Workflow-Steps und Agent-Tools dieselbe userId.
  const userId = message.author.userId;
  ctx.requestContext.set(USER_ID_KEY, userId);

  const logger = mastra.getLogger();
  const workflow = mastra.getWorkflowById('receipt-review-workflow');
  const images = message.attachments.filter(isReceiptImage);

  // Ohne das ist ein aussortierter Anhang von "gar kein Anhang" nicht zu
  // unterscheiden – und der Nutzer sieht nur, dass der Agent antwortet.
  if (message.attachments.length > 0) {
    logger?.debug(
      `[teams] ${images.length}/${message.attachments.length} Anhänge als Beleg erkannt: ${message.attachments
        .map(a => `${a.name ?? 'ohne Namen'} (type=${a.type}, mime=${a.mimeType ?? 'unbekannt'})`)
        .join(', ')}`,
    );
  }

  /* ---------- Fall 1: Antwort auf eine offene Vorlage ---------- */

  if (images.length === 0) {
    const pending = await getPendingReview(thread.id);
    if (!pending) {
      // Ganz normale Nachricht: der Agent antwortet, mit den DB-Tools.
      await defaultHandler(thread, message);
      return;
    }

    // Ein offener Review gehört dem Nutzer, der ihn gestartet hat. In einem
    // Kanal darf nicht jemand anderes die Buchung eines Kollegen bestätigen.
    if (pending.userId !== userId) {
      await defaultHandler(thread, message);
      return;
    }

    // Der Textweg neben der Karte: "passt", eine Korrektur oder "abbrechen".
    await resumeReview({
      mastra,
      thread,
      pending,
      resumeData: classifyReply(message.text),
      requestContext: ctx.requestContext,
    });
    return;
  }

  /* ---------- Fall 2: neuer Beleg ---------- */

  // Mehrere Bilder in einer Nachricht: nur das erste geht in den Review. Zwei
  // gleichzeitig offene Vorlagen im selben Thread wären für den Nutzer nicht
  // auseinanderzuhalten – er antwortet mit einem Satz, und beide Runs würden
  // ihn beanspruchen.
  if (images.length > 1) {
    await thread.post(
      `Ich habe ${images.length} Bilder bekommen und nehme das erste. Die übrigen bitte einzeln ` +
        'schicken – jeder Beleg wird einzeln bestätigt.',
    );
  }

  const attachment = images[0];
  const name = attachment.name || 'Beleg';

  await thread.startTyping('Beleg wird gelesen…');

  try {
    const bytes = await readAttachment(attachment);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(
        `Datei ist ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB groß, erlaubt sind maximal ${
          MAX_UPLOAD_BYTES / 1024 / 1024
        } MB.`,
      );
    }

    // Teams meldet für eingefügte Bilder nur "image/*", deshalb das Format an
    // den Bytes bestimmen statt dem gemeldeten mimeType zu vertrauen.
    const mimeType = detectImageMime(bytes);
    if (!mimeType) {
      throw new Error(
        `Dateiformat nicht erkannt (Teams meldete "${attachment.mimeType ?? 'unbekannt'}"). Erlaubt: ${Object.keys(
          ALLOWED_UPLOAD_TYPES,
        ).join(', ')}`,
      );
    }

    // Der Idempotenz-Key: derselbe Beleg zweimal geschickt gibt denselben Hash
    // und damit per Upsert dieselbe Zeile.
    const fileHash = createHash('sha256').update(bytes).digest('hex');

    // storeUpload() validiert Typ und Größe und vergibt die uploadId – exakt
    // derselbe Pfad wie beim Upload aus dem Web-Frontend.
    const stored = await storeUpload(new File([bytes as BlobPart], name, { type: mimeType }));

    const run = await workflow.createRun();

    // Zeiger VOR dem Start setzen: startet der Run und der Prozess stirbt, bevor
    // wir die runId notiert hätten, wäre der suspendierte Run nicht mehr
    // auffindbar.
    await openPendingReview({
      threadId: thread.id,
      runId: run.runId,
      userId,
      uploadId: stored.uploadId,
    });

    const result = await run.start({
      inputData: {
        receiptPath: resolveUploadPath(stored.uploadId),
        receiptJsonPath: resolveReceiptJsonPath(stored.uploadId),
        fileHash,
        fileReference: `local:uploads/${stored.uploadId}`,
      },
      initialState: initialReviewState,
      requestContext: ctx.requestContext,
    });

    if (result.status === 'failed') {
      await closePendingReview(thread.id);
      const reason = result.error?.message || String(result.error);
      await thread.post(`❌ **${name}** – nicht verarbeitet: ${annotateModelError(reason)}`);
      return;
    }

    await reportOutcome(thread, run.runId, result);
  } catch (error) {
    await closePendingReview(thread.id);
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger?.error(`[teams] Beleg "${name}" konnte nicht verarbeitet werden: ${errorMessage}`);
    // Auch im Fehlerfall bekommt der Nutzer eine Antwort – ein stiller Fehler in
    // Teams sieht für ihn aus wie ein hängender Bot.
    await thread.post(`❌ **${name}** – nicht verarbeitet: ${annotateModelError(errorMessage)}`);
  }
};
