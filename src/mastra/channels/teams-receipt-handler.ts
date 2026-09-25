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
// Alles, was hier in den Thread geht, ist Englisch – unabhängig von der Sprache
// des Nutzers. Die Fehlertexte aus upload-store/API sind deutsch (Log, REST)
// und werden deshalb nicht durchgereicht, sondern hier neu formuliert.
//
// Die Zuordnung Thread -> runId steht in app.pending_reviews, damit sie einen
// Prozess-Neustart und ein Railway-Deploy überlebt. Der Kandidatensatz steht
// dort NICHT – der liegt im Workflow-Snapshot, wo Mastra ihn verwaltet.

import type { ChannelHandler } from '@mastra/core/channels';
import { createHash } from 'node:crypto';
import { model } from '../model';
import { receiptApi, type ConversationRef } from '../api-client';
import { USER_ID_KEY } from '../tools/tool-context';
import { initialReviewState } from '../workflows/receipt-review-workflow';
import { reportOutcome, resumeReview, type ReviewResume } from './receipt-review-session';
import {
  closePendingReview,
  getPendingReview,
  openPendingReview,
} from '../../db/receipts';
import {
  ACCEPTED_FORMATS,
  MAX_UPLOAD_BYTES,
  UploadTooLargeError,
  resolveReceiptJsonPath,
  resolveUploadPath,
  storeUpload,
} from '../receipts/upload-store';
import { UnsupportedReceiptFileError } from '../receipts/file-format';

/**
 * Die Felder der Bot-Framework-Activity, die wir lesen.
 *
 * `message.raw` ist der vom Chat-SDK durchgereichte Rohpayload und als
 * `unknown` typisiert – beim Teams-Adapter ist das die Activity. Bewusst ein
 * enger Typ statt `any`: so fällt ein Tippfehler im Feldnamen beim Kompilieren
 * auf, und es ist dokumentiert, worauf wir uns überhaupt verlassen.
 *
 * Alles optional, weil nicht jede Activity alles mitbringt: bei Gast- und
 * Anonym-Konten fehlt die aadObjectId, und nicht jeder Kanaltyp füllt
 * channelData.
 */
type TeamsActivity = {
  from?: { id?: string; name?: string; aadObjectId?: string };
  conversation?: { id?: string; conversationType?: string; tenantId?: string };
  recipient?: { id?: string; name?: string };
  channelData?: { tenant?: { id?: string } };
  serviceUrl?: string;
  channelId?: string;
};

/**
 * Identität aus der Activity lösen.
 *
 * Die Tenant-ID steht je nach Activity-Typ unter `channelData.tenant.id` oder
 * `conversation.tenantId` – beide prüfen ist billiger als sich auf eine zu
 * verlassen.
 */
function readIdentity(
  raw: unknown,
  userId: string,
  fullName?: string,
): {
  aadObjectId: string | null;
  tenantId: string | null;
  displayName: string | null;
  conversationRef: ConversationRef | null;
} {
  const activity = raw as TeamsActivity | undefined;

  return {
    aadObjectId: activity?.from?.aadObjectId ?? null,
    tenantId: activity?.channelData?.tenant?.id ?? activity?.conversation?.tenantId ?? null,
    displayName: fullName ?? activity?.from?.name ?? null,
    conversationRef: activity
      ? {
          conversationId: activity.conversation?.id,
          serviceUrl: activity.serviceUrl,
          channelId: activity.channelId,
          recipient: activity.recipient,
        }
      : null,
  };
}

/**
 * Anhänge, die als Beleg in Frage kommen.
 *
 * Der mimeType allein reicht als Kriterium nicht: ein direkt in die Teams-
 * Nachricht eingefügtes Bild kommt als `contentType: "image/*"` herein – mit
 * Stern, ohne konkretes Format. Hochgeladene Dateien bekommen ihren Typ vom
 * Adapter aus der Endung, und alles, was er nicht kennt (.heic, .tif, .bmp),
 * wird `application/octet-stream`. Deshalb hier nur die grobe Klasse prüfen;
 * das echte Format bestimmt `normalizeReceiptFile()` an den Bytes.
 */
function isReceiptAttachment(attachment: { type: string; mimeType?: string }): boolean {
  if (attachment.type === 'image') return true;
  return (
    attachment.type === 'file' &&
    (attachment.mimeType === 'application/pdf' || attachment.mimeType === 'application/octet-stream')
  );
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
  if (!/support image input|does not support image|vision|pdf|file input/i.test(reason)) return reason;
  return `${reason} (configured model: "${model}" – MASTRA_MODEL must point to a model that reads images and PDFs)`;
}

/**
 * Die Meldung im Thread, wenn ein Beleg nicht angenommen oder nicht gelesen
 * werden konnte. Nur bekannte Fälle bekommen eine eigene Erklärung; Modellfehler
 * kommen vom Provider ohnehin auf Englisch. Alles andere (deutsche Texte aus
 * API und Workflow) bleibt im Log.
 */
function intakeErrorText(name: string, error: unknown): string {
  if (error instanceof UploadTooLargeError) {
    return (
      `❌ **${name}** is ${(error.bytes / 1024 / 1024).toFixed(1)} MB – ` +
      `the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`
    );
  }
  if (error instanceof UnsupportedReceiptFileError) {
    return (
      `❌ **${name}** could not be read as a receipt. ` +
      `Supported formats: ${ACCEPTED_FORMATS.join(', ')}.`
    );
  }
  const reason = error instanceof Error ? error.message : String(error);
  const annotated = annotateModelError(reason);
  return annotated === reason
    ? `❌ **${name}** could not be processed. Please try again or send a clearer photo.`
    : `❌ **${name}** could not be processed: ${annotated}`;
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
// Englisch zuerst, weil die Karte Englisch spricht; die deutschen Wörter
// bleiben, damit ein "passt" nicht plötzlich als Korrektur gilt.
const CONFIRM_WORDS = [
  'yes', 'ok', 'okay', 'confirm', 'confirmed', 'correct', 'right', 'fine', 'good', 'looks good',
  'all good', 'lgtm', 'save', 'approve', 'approved', 'yep', 'yup', 'sure', 'perfect', 'exactly',
  'ja', 'passt', 'stimmt', 'korrekt', 'richtig', 'bestätigt', 'bestaetigt', 'speichern',
  'übernehmen', 'uebernehmen', 'jup', 'jo', 'genau', 'perfekt', '👍', '✅',
];
const CANCEL_WORDS = [
  'cancel', 'stop', 'abort', 'discard', 'delete', "don't save", 'dont save', 'do not save',
  'abbrechen', 'abbruch', 'verwerfen', 'löschen', 'loeschen', 'nicht speichern',
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
    !/\b(not|no|wrong|but|except|isn't|incorrect)\b|n't|nicht|kein|falsch|aber|ausser|außer/.test(normalized)
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
      '❌ Internal error: the receipt workflow is not reachable. Please try again later.',
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
  const files = message.attachments.filter(isReceiptAttachment);

  // Ohne das ist ein aussortierter Anhang von "gar kein Anhang" nicht zu
  // unterscheiden – und der Nutzer sieht nur, dass der Agent antwortet.
  if (message.attachments.length > 0) {
    logger?.debug(
      `[teams] ${files.length}/${message.attachments.length} Anhänge als Beleg erkannt: ${message.attachments
        .map(a => `${a.name ?? 'ohne Namen'} (type=${a.type}, mime=${a.mimeType ?? 'unbekannt'})`)
        .join(', ')}`,
    );
  }

  // Identität festhalten, bei jeder Nachricht und nicht erst beim Beleg:
  // aadObjectId und Conversation Reference stehen nur in DIESER Activity.
  // Ohne die erste ist ein späterer Browser-Login diesem Nutzer nicht
  // zuzuordnen, ohne die zweite kann ihn keine proaktive Nachricht erreichen.
  //
  // Bewusst nicht blockierend: ein fehlgeschlagener Upsert darf einen Beleg
  // nicht verhindern. Die Identität wird bei der nächsten Nachricht ohnehin
  // wieder mitgeschickt.
  const identity = readIdentity(message.raw, userId, message.author.fullName);
  try {
    await receiptApi.upsertIdentity({ userId, ...identity });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger?.warn(`[teams] Identität für ${userId} nicht gespeichert: ${reason}`);
  }
  logger?.debug(
    `[teams] Identität: aad=${identity.aadObjectId ?? 'fehlt'} tenant=${identity.tenantId ?? 'fehlt'}`,
  );

  /* ---------- Fall 1: Antwort auf eine offene Vorlage ---------- */

  if (files.length === 0) {
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

  // Mehrere Dateien in einer Nachricht: nur die erste geht in den Review. Zwei
  // gleichzeitig offene Vorlagen im selben Thread wären für den Nutzer nicht
  // auseinanderzuhalten – er antwortet mit einem Satz, und beide Runs würden
  // ihn beanspruchen.
  if (files.length > 1) {
    await thread.post(
      `I received ${files.length} files and will take the first one. Please send the others ` +
        'one at a time – each receipt is confirmed separately.',
    );
  }

  const attachment = files[0];
  const name = attachment.name || 'Receipt';

  await thread.startTyping('Reading receipt…');

  try {
    const bytes = await readAttachment(attachment);

    // Der Idempotenz-Key: derselbe Beleg zweimal geschickt gibt denselben Hash
    // und damit per Upsert dieselbe Zeile. Über die Originalbytes, nicht über
    // die konvertierte Fassung – die hängt von der sharp-Version ab.
    const fileHash = createHash('sha256').update(bytes).digest('hex');

    // storeUpload() prüft Grösse und Format an den Bytes (Teams meldet für
    // eingefügte Bilder nur "image/*"), konvertiert HEIC/TIFF/BMP/AVIF nach
    // JPEG und vergibt die uploadId – derselbe Pfad wie POST /receipts/upload.
    const stored = await storeUpload(bytes, name);
    if (stored.convertedFrom) {
      logger?.debug(`[teams] "${name}" von ${stored.convertedFrom} nach ${stored.mimeType} konvertiert.`);
    }

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
      logger?.error(`[teams] Beleg "${name}" konnte nicht verarbeitet werden: ${reason}`);
      await thread.post(intakeErrorText(name, new Error(reason)));
      return;
    }

    await reportOutcome(thread, run.runId, result);
  } catch (error) {
    await closePendingReview(thread.id);
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger?.error(`[teams] Beleg "${name}" konnte nicht verarbeitet werden: ${errorMessage}`);
    // Auch im Fehlerfall bekommt der Nutzer eine Antwort – ein stiller Fehler in
    // Teams sieht für ihn aus wie ein hängender Bot.
    await thread.post(intakeErrorText(name, error));
  }
};
