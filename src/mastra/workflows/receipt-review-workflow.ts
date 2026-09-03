// Human-in-the-Loop: extrahieren -> vorlegen -> (korrigieren -> erneut vorlegen)* -> schreiben.
//
// In die Datenbank wird ausschliesslich nach bestätigtem Zustand geschrieben.
// Kein Schreiben auf Verdacht, kein späteres Aufräumen.
//
// Der Kandidatensatz liegt zwischen Vorlage und Bestätigung im Workflow-State
// und damit im Snapshot in mastra.mastra_workflow_snapshot – nicht im
// Gesprächsverlauf. Sonst entschiede die Kontextlänge darüber, ob eine Buchung
// korrekt landet, und ein Deploy zwischen Vorlage und Antwort wäre Datenverlust.
//
// Doku:
//   Suspend/Resume   https://mastra.ai/docs/workflows/suspend-and-resume
//   Human-in-the-Loop https://mastra.ai/docs/workflows/human-in-the-loop
//   Workflow-State    https://mastra.ai/docs/workflows/workflow-state
//   RequestContext    https://mastra.ai/docs/server/request-context

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { receiptSchema } from '../agents/receipt-agent';
import { candidateSchema, formatCandidate, toCandidate, type ReceiptCandidate } from '../receipts/candidate';
import { receiptExtractionWorkflow } from './receipt-extraction-workflow';
import { saveReceipt } from '../../db/receipts';

/**
 * Deckel für die Korrekturschleife. Nach so vielen Runden ohne Bestätigung ist
 * nicht das Parsing das Problem, sondern das Foto – dann ist Abbrechen und neu
 * fotografieren ehrlicher als eine vierte Runde.
 */
export const MAX_CORRECTION_ROUNDS = Number(process.env.RECEIPT_MAX_CORRECTION_ROUNDS) || 3;

/**
 * `userId` kommt aus dem RequestContext, nicht aus dem inputSchema.
 * Der Workflow validiert ihn, bevor `run.start()` überhaupt losläuft – laut
 * Doku wirft die RequestContext-Validierung bei Workflows vor dem Start.
 */
const requestContextSchema = z.object({
  userId: z.string().min(1),
});

/** Alles, was zwischen den Suspend-Punkten überleben muss. */
const stateSchema = z.object({
  candidate: candidateSchema.nullable(),
  rawExtraction: receiptSchema.nullable(),
  round: z.number(),
});

/**
 * Startwert für den Workflow-State.
 *
 * Ein Workflow mit stateSchema verlangt `initialState` bei `run.start()` – ohne
 * das wirft die Validierung "Invalid initial data". Deshalb hier exportiert,
 * damit Handler und Tests denselben Startwert benutzen.
 */
export const initialReviewState = {
  candidate: null,
  rawExtraction: null,
  round: 0,
};

const workflowInputSchema = z.object({
  receiptPath: z.string(),
  receiptJsonPath: z.string(),
  fileHash: z.string().describe('sha256 der Originaldatei – der Idempotenz-Key.'),
  fileReference: z.string().describe('Referenz auf die Originaldatei, z. B. "local:uploads/<id>".'),
});

const workflowOutputSchema = z.object({
  status: z.enum(['saved', 'cancelled', 'abandoned']),
  receiptId: z.string().nullable(),
  candidate: candidateSchema.nullable(),
  message: z.string(),
});

/**
 * Schritt 1 — Extraktion.
 *
 * Ruft den bestehenden Extraktions-Workflow auf. Bewusst über `execute()` statt
 * als verschachtelter `.then(receiptExtractionWorkflow)`-Schritt: so bleibt der
 * Datei-Kontext (fileHash, fileReference) im Fluss, ohne ihn durch das
 * Input-Schema des Extraktions-Workflows schleusen zu müssen – der soll für den
 * Web-Pfad unverändert bleiben.
 */
const extractCandidate = createStep({
  id: 'extract-candidate',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    fileHash: z.string(),
    fileReference: z.string(),
  }),
  stateSchema,
  requestContextSchema,
  execute: async ({ inputData, mastra, setState, requestContext }) => {
    const workflow = mastra.getWorkflowById('receipt-extraction-workflow');
    const run = await workflow.createRun();
    const outcome = await run.start({
      inputData: {
        receiptPath: inputData.receiptPath,
        receiptJsonPath: inputData.receiptJsonPath,
      },
      requestContext,
    });

    if (outcome.status !== 'success') {
      const reason =
        outcome.status === 'failed'
          ? outcome.error?.message || String(outcome.error)
          : `Extraktion endete mit Status "${outcome.status}".`;
      throw new Error(reason);
    }

    await setState({
      candidate: toCandidate(outcome.result.receipt),
      rawExtraction: outcome.result.receipt,
      round: 0,
    });

    return { fileHash: inputData.fileHash, fileReference: inputData.fileReference };
  },
});

/**
 * Schritt 2 — Kontrolle durch den Nutzer.
 *
 * Ein Step, der mehrfach suspendieren kann. Das ist das Muster aus der
 * Suspend/Resume-Doku (`if (!approved) return await suspend(...)`): bei jedem
 * Resume läuft `execute` erneut von oben, mit `resumeData` gefüllt. Der Zustand
 * dazwischen (Kandidat, Rundenzähler) liegt im Workflow-State und wird laut
 * workflow-state.md über Suspend/Resume hinweg persistiert.
 *
 * Bewusst kein `.dountil()`: das gibt es in dieser Version zwar, aber ein Resume
 * in eine Loop-Iteration hinein zwingt dem Aufrufer executionPath-Handling auf.
 * Hier ist der Aufrufer der Teams-Handler, der nur eine runId hat.
 */
const reviewCandidate = createStep({
  id: 'review-candidate',
  inputSchema: extractCandidate.outputSchema,
  outputSchema: z.object({
    decision: z.enum(['confirmed', 'cancelled', 'abandoned']),
    fileHash: z.string(),
    fileReference: z.string(),
  }),
  stateSchema,
  suspendSchema: z.object({
    candidate: candidateSchema,
    /** Was der Nutzer sieht – vorformatiert, damit der Handler nichts erfinden muss. */
    summary: z.string(),
    round: z.number(),
    maxRounds: z.number(),
    /** true nach einer Korrektur: die zweite Vorlage, nicht die erste. */
    isRecheck: z.boolean(),
  }),
  resumeSchema: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('confirm') }),
    z.object({ kind: z.literal('correct'), text: z.string().min(1) }),
    z.object({ kind: z.literal('cancel') }),
  ]),
  execute: async ({ inputData, state, setState, resumeData, suspend, mastra }) => {
    const candidate = state.candidate;
    if (!candidate) {
      throw new Error('Kein Kandidatensatz im Workflow-State – Extraktion ist nicht gelaufen.');
    }

    const present = (value: ReceiptCandidate, round: number, isRecheck: boolean) =>
      suspend({
        candidate: value,
        summary: formatCandidate(value),
        round,
        maxRounds: MAX_CORRECTION_ROUNDS,
        isRecheck,
      });

    // Erster Durchlauf: vorlegen und warten.
    if (!resumeData) {
      return present(candidate, state.round, false);
    }

    if (resumeData.kind === 'cancel') {
      return { decision: 'cancelled' as const, ...inputData };
    }

    if (resumeData.kind === 'confirm') {
      return { decision: 'confirmed' as const, ...inputData };
    }

    // Korrektur: Freitext auf den Kandidaten anwenden.
    const agent = mastra.getAgentById('receipt-correction-agent');
    const response = await agent.generate(
      [
        {
          role: 'user',
          content:
            `Aktueller Datensatz:\n${JSON.stringify(candidate, null, 2)}\n\n` +
            `Korrektur des Nutzers:\n${resumeData.text}`,
        },
      ],
      { structuredOutput: { schema: candidateSchema } },
    );

    if (!response.object) {
      throw new Error('Die Korrektur konnte nicht angewandt werden (keine strukturierte Antwort).');
    }

    const round = state.round + 1;
    await setState({ ...state, candidate: response.object, round });

    // Deckel erreicht: nicht stillschweigend speichern, sondern abbrechen.
    if (round >= MAX_CORRECTION_ROUNDS) {
      return { decision: 'abandoned' as const, ...inputData };
    }

    // Der gewollte zweite Nachfrage-Schritt: das Ergebnis des Parsings wird
    // sichtbar gemacht, bevor es persistent wird.
    return present(response.object, round, true);
  },
});

/**
 * Schritt 3 — Schreiben.
 *
 * Läuft nur, wenn Schritt 2 mit `confirmed` zurückgekommen ist. Der Upsert
 * gegen (user_id, file_hash) macht ein wiederholtes Resume idempotent.
 */
const persistReceipt = createStep({
  id: 'persist-receipt',
  inputSchema: reviewCandidate.outputSchema,
  outputSchema: workflowOutputSchema,
  stateSchema,
  requestContextSchema,
  execute: async ({ inputData, state, requestContext }) => {
    // Die userId kommt ausschliesslich hierher – nie aus inputData, nie vom
    // Modell. Gesetzt hat sie der Teams-Handler aus message.author.userId.
    const userId = requestContext.get('userId');
    if (!userId) {
      throw new Error('Kein userId im RequestContext – der Beleg wird nicht gespeichert.');
    }

    if (inputData.decision === 'cancelled') {
      return {
        status: 'cancelled' as const,
        receiptId: null,
        candidate: state.candidate,
        message: 'Abgebrochen. Der Beleg wurde nicht gespeichert.',
      };
    }

    if (inputData.decision === 'abandoned') {
      return {
        status: 'abandoned' as const,
        receiptId: null,
        candidate: state.candidate,
        message:
          `Nach ${MAX_CORRECTION_ROUNDS} Korrekturrunden immer noch nicht bestätigt – ` +
          'nichts gespeichert. Bitte ein neues Foto schicken (gerade, vollständig im Bild, mehr Licht).',
      };
    }

    if (!state.candidate || !state.rawExtraction) {
      throw new Error('Bestätigt, aber kein Kandidatensatz im State – das darf nicht passieren.');
    }

    const row = await saveReceipt(userId, {
      candidate: state.candidate,
      fileHash: inputData.fileHash,
      fileReference: inputData.fileReference,
      rawExtraction: state.rawExtraction,
    });

    return {
      status: 'saved' as const,
      receiptId: row.id,
      candidate: state.candidate,
      message: 'Gespeichert.',
    };
  },
});

export const receiptReviewWorkflow = createWorkflow({
  id: 'receipt-review-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
  stateSchema,
  requestContextSchema,
})
  .then(extractCandidate)
  .then(reviewCandidate)
  .then(persistReceipt)
  .commit();
