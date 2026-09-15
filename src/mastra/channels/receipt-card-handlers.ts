// Die Gegenstelle zur Adaptive Card: was passiert, wenn jemand einen Button
// drückt oder den Korrektur-Dialog abschickt.
//
// Warum das nicht im Channel-Handler steht: ein Klick auf eine Adaptive Card
// ist in Teams keine Nachricht. Der Adapter erkennt an `value.actionId`, dass
// es ein Action.Submit ist, und leitet ihn an `chat.processAction` – nicht an
// die Message-Handler. Er kommt also nie bei `handleTeamsReceipt` an.
//
// Mastra selbst registriert nur einen `onAction`-Handler für seine
// Tool-Freigaben und ignoriert fremde actionIds; Handler sind additiv. Der Weg,
// eigene dazuzuhängen, ist `AgentChannels.sdk` – laut Doku ("Use this to
// register additional event handlers") genau dafür da.
//
// Registriert wird einmal beim Start (src/mastra/index.ts) und nicht beim
// ersten Beleg: eine Karte, die vor einem Deploy gepostet wurde, muss auch nach
// dem Deploy noch auf Klicks reagieren.

import type { Mastra } from '@mastra/core';
import { RequestContext } from '@mastra/core/request-context';
import type { ActionEvent, ModalResponse, ModalSubmitEvent } from 'chat';
import { getPendingReview } from '../../db/receipts';
import type { PendingReviewRow } from '../../db/schema';
import { applyReviewEdits, type ReviewEdits, type ReviewField } from '../receipts/candidate';
import {
  MODAL_INPUT_IDS,
  buildEditModal,
  parseActionId,
  parseEditModalCallbackId,
  retiredCardText,
} from './receipt-review-card';
import { readOpenPresentation, resumeReview, type ReviewThread } from './receipt-review-session';
import { USER_ID_KEY } from '../tools/tool-context';

/** Die Agent-`id`, an der die Teams-Kanäle hängen (nicht der Registrierungs-Key). */
const TEAMS_AGENT_ID = 'teams-agent';

const NO_OPEN_REVIEW =
  'Zu diesem Thread ist kein offener Beleg mehr vorhanden. Schick den Beleg bitte noch einmal.';
const NOT_YOUR_REVIEW =
  'Diesen Beleg kann nur bestätigen, wer ihn geschickt hat.';

/**
 * Die Action- und Dialog-Handler an die Chat-Instanz des Teams-Agenten hängen.
 *
 * Läuft absichtlich im Hintergrund: `initialize()` ist dieselbe Promise, die
 * `Mastra.addAgent` schon gestartet hat (die Methode ist idempotent), und sie
 * ist erledigt, lange bevor der erste Webhook ankommt. Ein `await` hier würde
 * nur den Modulimport blockieren.
 */
export function registerReceiptCardHandlers(mastra: Mastra): void {
  const logger = mastra.getLogger();

  void (async () => {
    const channels = mastra.getAgentById(TEAMS_AGENT_ID)?.getChannels();
    if (!channels) {
      logger?.error('[teams] Kein Channels-Objekt am Teams-Agenten – Karten-Buttons bleiben tot.');
      return;
    }

    await channels.initialize(mastra);
    const sdk = channels.sdk;
    if (!sdk) {
      logger?.error('[teams] Chat-SDK nicht initialisiert – Karten-Buttons bleiben tot.');
      return;
    }

    sdk.onAction(event => handleCardAction(mastra, event));
    sdk.onModalSubmit(event => handleEditSubmit(mastra, event));
    logger?.info('[teams] Adaptive-Card-Handler registriert (Bestätigen / Anpassen / Abbrechen).');
  })().catch(error => {
    logger?.error(
      `[teams] Adaptive-Card-Handler konnten nicht registriert werden: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
}

/**
 * Den offenen Review zu diesem Thread holen und prüfen, ob dieser Klick ihn
 * beantworten darf. Alles, was hier scheitert, ist eine Antwort im Thread und
 * kein stiller Abbruch – ein Button, der nichts tut, ist das Schlimmste.
 */
async function claimPendingReview(
  thread: ReviewThread,
  userId: string,
  runId: string,
): Promise<PendingReviewRow | null> {
  const pending = await getPendingReview(thread.id);

  if (!pending) {
    await thread.post(NO_OPEN_REVIEW);
    return null;
  }
  // In einem Kanal sieht jeder die Karte. Bestätigen darf nur, wer den Beleg
  // geschickt hat – gespeichert wird er auf dessen user_id.
  if (pending.userId !== userId) {
    await thread.post(NOT_YOUR_REVIEW);
    return null;
  }
  if (pending.runId !== runId) {
    await thread.post(
      'Diese Vorlage gehört zu einem älteren Beleg und ist nicht mehr aktuell. ' +
        'Bitte die neueste Karte in diesem Verlauf benutzen.',
    );
    return null;
  }

  return pending;
}

/**
 * Die userId kommt aus dem signierten Bot-Framework-Payload (`activity.from.id`,
 * vom Adapter in `event.user.userId` übernommen) – dieselbe Quelle wie
 * `message.author.userId` im Channel-Handler. Der Klick-Weg hat keinen
 * RequestContext vom Server, also wird hier einer aufgebaut; die Werkzeuge und
 * der persist-Schritt lesen die userId ausschliesslich von dort.
 */
function requestContextFor(userId: string): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(USER_ID_KEY, userId);
  return requestContext;
}

async function handleCardAction(mastra: Mastra, event: ActionEvent): Promise<void> {
  const parsed = parseActionId(event.actionId);
  // Fremde actionIds gehören jemand anderem (z. B. Mastras Tool-Freigaben).
  if (!parsed) return;

  const logger = mastra.getLogger();
  const thread = event.thread;
  if (!thread) {
    logger?.warn(`[teams] Karten-Klick ohne Thread (actionId=${event.actionId}) – ignoriert.`);
    return;
  }

  const userId = event.user.userId;
  const pending = await claimPendingReview(thread, userId, parsed.runId);
  if (!pending) return;

  // Der Stand, den die Karte zeigt. Für "Anpassen" sind es die Startwerte des
  // Dialogs, für die beiden anderen der Text, der von der Karte übrig bleibt.
  const presentation = await readOpenPresentation(mastra, parsed.runId);
  if (!presentation) {
    await thread.post(NO_OPEN_REVIEW);
    return;
  }

  if (parsed.action === 'edit') {
    // Teams hat diesen Klick als task/fetch-Invoke geschickt (der Button trägt
    // actionType 'modal'); openModal beantwortet den Invoke mit dem Dialog.
    await event.openModal(
      buildEditModal({
        candidate: presentation.candidate,
        runId: parsed.runId,
        cardMessageId: event.messageId,
      }),
    );
    return;
  }

  await resumeReview({
    mastra,
    thread,
    pending,
    expectedRunId: parsed.runId,
    resumeData: parsed.action === 'confirm' ? { kind: 'confirm' } : { kind: 'cancel' },
    requestContext: requestContextFor(userId),
  });

  await retireCard(
    event,
    retiredCardText(presentation.candidate, parsed.action === 'confirm' ? 'confirmed' : 'cancelled'),
  );
}

async function handleEditSubmit(
  mastra: Mastra,
  event: ModalSubmitEvent,
): Promise<ModalResponse | undefined> {
  const parsed = parseEditModalCallbackId(event.callbackId);
  if (!parsed) return undefined;
  const { runId, cardMessageId } = parsed;

  const logger = mastra.getLogger();
  const thread = event.relatedThread;
  if (!thread) {
    // Der Dialog-Kontext liegt im State-Adapter und läuft nach einiger Zeit ab.
    // Ohne Thread gibt es niemanden, dem wir das Ergebnis berichten könnten.
    logger?.warn('[teams] Dialog-Submit ohne zugehörigen Thread – der Kontext ist abgelaufen.');
    return { action: 'close' };
  }

  const userId = event.user.userId;
  const pending = await claimPendingReview(thread, userId, runId);
  if (!pending) return { action: 'close' };

  const presentation = await readOpenPresentation(mastra, runId);
  if (!presentation) {
    await thread.post(NO_OPEN_REVIEW);
    return { action: 'close' };
  }

  const edits = readEdits(event.values);
  const { candidate, errors } = applyReviewEdits(presentation.candidate, edits);

  // Nicht lesbare Eingabe: denselben Dialog noch einmal zeigen, mit den Werten
  // des Nutzers und der Meldung darüber. Ein stilles null wäre der Datenverlust,
  // den die ganze Schleife verhindern soll.
  if (Object.keys(errors).length > 0) {
    return {
      action: 'update',
      modal: buildEditModal({
        candidate: presentation.candidate,
        runId,
        errors,
        values: edits,
        cardMessageId,
      }),
    };
  }

  await resumeReview({
    mastra,
    thread,
    pending,
    expectedRunId: runId,
    resumeData: { kind: 'edit', candidate },
    requestContext: requestContextFor(userId),
  });

  await retireCardMessage(event, thread.id, cardMessageId, retiredCardText(candidate, 'edited'));
  return { action: 'close' };
}

/** Nur die vier bekannten Eingaben übernehmen – alles andere gehört nicht in den Datensatz. */
function readEdits(values: Record<string, string>): ReviewEdits {
  const edits: ReviewEdits = {};
  for (const id of MODAL_INPUT_IDS) {
    const value = values[id as ReviewField];
    if (typeof value === 'string') edits[id as ReviewField] = value;
  }
  return edits;
}

/**
 * Die beantwortete Karte durch Text ersetzen.
 *
 * Best effort: scheitert das Update (fehlende Rechte, zu alte Nachricht),
 * bleibt die Karte stehen. Ein zweiter Klick läuft dann in "kein offener
 * Beleg" – unschön, aber nicht gefährlich, denn `pending_reviews` ist zu.
 */
async function retireCard(event: ActionEvent, text: string): Promise<void> {
  try {
    await event.adapter.editMessage?.(event.threadId, event.messageId, text);
  } catch {
    // bewusst ignoriert
  }
}

async function retireCardMessage(
  event: ModalSubmitEvent,
  threadId: string,
  cardMessageId: string | undefined,
  text: string,
): Promise<void> {
  if (!cardMessageId) return;
  try {
    await event.adapter.editMessage?.(threadId, cardMessageId, text);
  } catch {
    // bewusst ignoriert
  }
}
