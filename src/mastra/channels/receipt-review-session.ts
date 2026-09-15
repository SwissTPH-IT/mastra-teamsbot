// Ein offener Review, gemeinsam benutzt von beiden Wegen, auf denen eine
// Antwort hereinkommt: Klick auf die Adaptive Card (chat.onAction /
// chat.onModalSubmit) und Text im Thread (der Channel-Handler).
//
// Beide tun am Ende dasselbe – den suspendierten Run mit `resumeData`
// fortsetzen und das Ergebnis im Thread berichten. Diese Datei ist diese Mitte,
// damit die beiden Wege nicht auseinanderlaufen; es darf nicht davon abhängen,
// ob jemand klickt oder tippt, ob eine Buchung geschrieben wird.
//
// Doku: https://mastra.ai/docs/workflows/suspend-and-resume

import type { Mastra } from '@mastra/core';
import type { RequestContext } from '@mastra/core/request-context';
import { createWorkflowStateReader } from '@mastra/core/workflows';
import type { Thread } from 'chat';
import { closePendingReview } from '../../db/receipts';
import type { PendingReviewRow } from '../../db/schema';
import type { ReceiptCandidate } from '../receipts/candidate';
import { buildReviewCard, reviewFallbackText } from './receipt-review-card';

/**
 * Der Thread, in dem berichtet wird.
 *
 * Bewusst unspezifisch generisch: `ActionEvent.thread` ist als
 * `Thread<TRawMessage>` typisiert (das erste Generic ist eigentlich der
 * Thread-State), `ModalSubmitEvent.relatedThread` dagegen als
 * `Thread<Record<string, unknown>, TRawMessage>`. Beide sollen hier hineinpassen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReviewThread = Thread<any, any>;

/** Der Step im receipt-review-workflow, der suspendiert. */
export const REVIEW_STEP_ID = 'review-candidate';

export type ReviewResume =
  | { kind: 'confirm' }
  | { kind: 'correct'; text: string }
  | { kind: 'cancel' }
  | { kind: 'edit'; candidate: ReceiptCandidate };

/** Die suspendSchema-Payload des Review-Schritts. */
export type SuspendPayload = {
  candidate: ReceiptCandidate;
  summary: string;
  round: number;
  maxRounds: number;
  isRecheck: boolean;
};

type RunOutcome = {
  status: string;
  suspendPayload?: unknown;
  steps?: Record<string, unknown>;
  result?: { message?: string; status?: string };
};

/**
 * Die Suspend-Payload des Review-Schritts aus einem Run-Ergebnis lösen.
 *
 * `result.suspendPayload` ist NICHT die Payload selbst, sondern eine Map
 * stepId -> Payload (Execution Engine: `base.suspendPayload[stepId] = rest`).
 * Der direkte Zugriff auf `.candidate` ergab deshalb undefined – und genau das
 * stand dann anstelle der Vorlage im Thread.
 */
export function readSuspendPayload(result: RunOutcome): SuspendPayload | undefined {
  const candidates = [
    (result.suspendPayload as Record<string, unknown> | undefined)?.[REVIEW_STEP_ID],
    // Dieselbe Payload hängt auch am Step-Ergebnis – als Absicherung, falls die
    // Engine die Map-Form einmal anders aufbaut.
    (result.steps?.[REVIEW_STEP_ID] as { suspendPayload?: unknown } | undefined)?.suspendPayload,
  ];

  for (const entry of candidates) {
    const payload = entry as SuspendPayload | undefined;
    if (payload?.candidate) return payload;
  }
  return undefined;
}

function reviewWorkflow(mastra: Mastra) {
  return mastra.getWorkflowById('receipt-review-workflow');
}

/**
 * Die Vorlage eines liegenden Runs lesen, ohne ihn fortzusetzen.
 *
 * Das braucht der Dialog: der Nutzer klickt "Anpassen", und die Eingabefelder
 * sollen mit dem Stand vorbelegt sein, den die Karte zeigt. Der steht im
 * Snapshot (mastra_workflow_snapshot) und damit auch nach einem Deploy noch da.
 */
export async function readOpenPresentation(
  mastra: Mastra,
  runId: string,
): Promise<SuspendPayload | undefined> {
  const state = await reviewWorkflow(mastra).getWorkflowRunById(runId);
  if (!state || state.status !== 'suspended') return undefined;

  const suspended = createWorkflowStateReader(state).getSuspendedStep();
  if (suspended?.stepId !== REVIEW_STEP_ID) return undefined;

  const payload = suspended.suspendPayload as SuspendPayload | undefined;
  return payload?.candidate ? payload : undefined;
}

/**
 * Ergebnis eines start()/resume() in den Thread schreiben und den
 * pending_review entsprechend offen halten oder schliessen.
 */
export async function reportOutcome(
  thread: ReviewThread,
  runId: string,
  result: RunOutcome,
): Promise<void> {
  if (result.status === 'suspended') {
    const payload = readSuspendPayload(result);
    // Ohne Vorlage darf der Review nicht offen bleiben: ein Klick auf
    // "Bestätigen" würde sonst einen Datensatz bestätigen, den der Nutzer nie
    // gesehen hat.
    if (!payload) {
      await closePendingReview(thread.id);
      await thread.post(
        '❌ Der Beleg wurde gelesen, aber die Vorlage zum Prüfen konnte nicht aufgebaut werden. ' +
          'Bitte den Beleg noch einmal schicken.',
      );
      return;
    }

    await postPresentation(thread, runId, payload);
    return;
  }

  await closePendingReview(thread.id);

  if (result.status === 'success') {
    const outcome = result.result;
    await thread.post(outcome?.status === 'saved' ? `✅ ${outcome.message}` : `ℹ️ ${outcome?.message}`);
    return;
  }

  await thread.post(`❌ Der Beleg konnte nicht verarbeitet werden (Status "${result.status}").`);
}

/**
 * Die Karte posten.
 *
 * Kann der Client keine Adaptive Card darstellen, bleibt der Thread sonst leer –
 * deshalb im Fehlerfall dieselbe Vorlage als Text. Der Textweg ("passt",
 * Korrektur, "abbrechen") funktioniert weiterhin, die Karte ist nur der
 * bequemere Weg.
 */
async function postPresentation(
  thread: ReviewThread,
  runId: string,
  payload: SuspendPayload,
): Promise<void> {
  try {
    await thread.post(
      buildReviewCard({
        candidate: payload.candidate,
        runId,
        round: payload.round,
        maxRounds: payload.maxRounds,
        isRecheck: payload.isRecheck,
      }),
    );
  } catch (error) {
    await thread.post(reviewFallbackText(payload.candidate));
    throw error;
  }
}

/**
 * Den suspendierten Run fortsetzen.
 *
 * Der in der Doku beschriebene Weg: Zustand lesen, suspendierten Schritt
 * bestimmen, Run über dieselbe runId neu aufbauen, resumen. Funktioniert genau
 * deshalb auch nach einem Prozess-Neustart – der Zustand liegt im Snapshot,
 * nicht im Speicher.
 *
 * Die Prüfung der runId ist der Schutz gegen eine veraltete Karte: schickt
 * jemand einen zweiten Beleg in denselben Thread, zeigt `pending_reviews` auf
 * den neuen Run, und die Buttons der alten Karte dürfen ihn nicht bestätigen.
 */
export async function resumeReview(args: {
  mastra: Mastra;
  thread: ReviewThread;
  pending: PendingReviewRow;
  /** runId aus der angeklickten Karte. Fehlt beim Textweg – dort gibt es keine. */
  expectedRunId?: string;
  resumeData: ReviewResume;
  requestContext: RequestContext;
}): Promise<void> {
  const { mastra, thread, pending, expectedRunId, resumeData, requestContext } = args;
  const logger = mastra.getLogger();

  if (expectedRunId && expectedRunId !== pending.runId) {
    await thread.post(
      'Diese Vorlage gehört zu einem älteren Beleg und ist nicht mehr aktuell. ' +
        'Bitte die neueste Karte in diesem Verlauf benutzen.',
    );
    return;
  }

  const workflow = reviewWorkflow(mastra);

  try {
    const state = await workflow.getWorkflowRunById(pending.runId);
    if (!state || state.status !== 'suspended') {
      await closePendingReview(thread.id);
      await thread.post(
        'Zu diesem Thread ist kein offener Beleg mehr vorhanden. Schick den Beleg bitte noch einmal.',
      );
      return;
    }

    const suspendedStep = createWorkflowStateReader(state).getSuspendedStep();
    const run = await workflow.createRun({ runId: pending.runId });

    await thread.startTyping('Einen Moment…');
    const result = await run.resume({
      step: suspendedStep?.path,
      resumeData,
      requestContext,
    });

    await reportOutcome(thread, pending.runId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.error(`[teams] Resume für Run ${pending.runId} fehlgeschlagen: ${message}`);
    await thread.post(`❌ Die Antwort konnte nicht verarbeitet werden: ${message}`);
  }
}
