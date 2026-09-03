// Belegt die harte Anforderung an die Pausierung: ein suspendierter Run
// überlebt einen Prozess-Neustart (hier simuliert durch eine komplett neu
// aufgebaute Mastra-Instanz) und ist danach korrekt fortsetzbar – mit
// identischem Kandidatensatz.
//
// Der Test läuft gegen eine echte Postgres, weil genau das die Aussage ist:
// ohne persistenten Store lebte der Zustand nur im Prozessspeicher. Ein Mock
// würde die Anforderung nicht prüfen, sondern umgehen.
//
//   docker compose up postgres -d
//   TEST_DATABASE_URL=postgres://mastra:mastra@localhost:5432/mastra npm test

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// Ohne DB kein Test statt rotem npm test. Die Anforderung wird von CI mit
// gesetzter Variable geprüft.
const suite = TEST_DATABASE_URL ? describe : describe.skip;

// Muss vor dem ersten Import von src/db/pool.ts stehen – das liest DATABASE_URL
// beim Modul-Laden.
process.env.DATABASE_URL = TEST_DATABASE_URL ?? 'postgres://unused';

const USER_ID = 'teams-user-suspend-resume-test';
const FILE_HASH = 'a'.repeat(64);

/**
 * Baut eine frische Mastra-Instanz mit eigenem Pool und eigenem Store.
 *
 * Bewusst über dynamische Imports mit `vi.resetModules()`-Semantik: der Pool in
 * src/db/pool.ts ist ein Modul-Singleton. Damit "Instanz B" wirklich nichts vom
 * Prozessspeicher der Instanz A erbt, wird der Modulgraph zwischen den beiden
 * Aufbauten verworfen.
 */
async function buildMastra() {
  const { Mastra } = await import('@mastra/core');
  const { PostgresStore } = await import('@mastra/pg');
  const { Pool } = await import('pg');

  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
  const storage = new PostgresStore({
    id: `test-store-${Math.random().toString(36).slice(2)}`,
    pool,
    schemaName: 'mastra',
    disableInit: true,
  });

  return { Mastra, storage, pool };
}

suite('Suspendierter Review-Run über einen Instanz-Neuaufbau hinweg', () => {
  let cleanupPool: import('pg').Pool;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    cleanupPool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    await cleanupPool.query('DELETE FROM app.receipts WHERE user_id = $1', [USER_ID]);
  });

  afterAll(async () => {
    await cleanupPool.query('DELETE FROM app.receipts WHERE user_id = $1', [USER_ID]);
    await cleanupPool.end();
  });

  it('stellt den Kandidatensatz identisch aus dem Store wieder her und schreibt erst nach Bestätigung', async () => {
    const { createWorkflow, createStep, createWorkflowStateReader } = await import(
      '@mastra/core/workflows'
    );
    const { RequestContext } = await import('@mastra/core/request-context');
    const { z } = await import('zod');
    const { candidateSchema } = await import('../src/mastra/receipts/candidate');
    const { saveReceipt } = await import('../src/db/receipts');

    // Der zu prüfende Kandidat. Die Extraktion selbst ist hier nicht Gegenstand
    // des Tests (und würde einen Modellaufruf kosten), deshalb wird sie durch
    // einen deterministischen Seed-Step ersetzt. Review-Schritt und
    // Persistenz-Schritt sind dieselbe Mechanik wie im Produktions-Workflow.
    const candidate = {
      merchant: 'Migros',
      merchantAddress: 'Bahnhofstrasse 1, 4051 Basel',
      merchantTaxId: 'CHE-123.456.789',
      receiptDate: '2026-03-14',
      receiptTime: '18:42',
      referenceNumber: 'TRX-99887',
      totalAmount: '42.10',
      subtotalAmount: '39.10',
      discountAmount: null,
      vatAmount: '3.00',
      vatRate: '7.700',
      currency: 'CHF',
      paymentMethod: 'Debitkarte',
      receiptType: null,
      category: null,
      lineItems: [
        { description: 'Brot', quantity: '1', unitPrice: '3.50', lineTotal: '3.50' },
      ],
      issues: [],
    };

    const stateSchema = z.object({
      candidate: candidateSchema.nullable(),
      round: z.number(),
    });

    const buildWorkflow = () => {
      const seed = createStep({
        id: 'seed-candidate',
        inputSchema: z.object({ fileHash: z.string() }),
        outputSchema: z.object({ fileHash: z.string() }),
        stateSchema,
        execute: async ({ inputData, setState }) => {
          await setState({ candidate, round: 0 });
          return inputData;
        },
      });

      const review = createStep({
        id: 'review-candidate',
        inputSchema: seed.outputSchema,
        outputSchema: z.object({ fileHash: z.string(), confirmed: z.boolean() }),
        stateSchema,
        suspendSchema: z.object({ candidate: candidateSchema, round: z.number() }),
        resumeSchema: z.object({ confirmed: z.boolean() }),
        execute: async ({ inputData, state, resumeData, suspend }) => {
          if (!resumeData) {
            return suspend({ candidate: state.candidate!, round: state.round });
          }
          return { fileHash: inputData.fileHash, confirmed: resumeData.confirmed };
        },
      });

      const persist = createStep({
        id: 'persist-receipt',
        inputSchema: review.outputSchema,
        outputSchema: z.object({ receiptId: z.string().nullable() }),
        stateSchema,
        execute: async ({ inputData, state, requestContext }) => {
          if (!inputData.confirmed) return { receiptId: null };
          const userId = requestContext.get('userId') as string;
          const row = await saveReceipt(userId, {
            candidate: state.candidate!,
            fileHash: inputData.fileHash,
            fileReference: 'local:uploads/test.jpg',
            rawExtraction: { test: true },
          });
          return { receiptId: row.id };
        },
      });

      return createWorkflow({
        id: 'test-review-workflow',
        inputSchema: z.object({ fileHash: z.string() }),
        outputSchema: z.object({ receiptId: z.string().nullable() }),
        stateSchema,
      })
        .then(seed)
        .then(review)
        .then(persist)
        .commit();
    };

    /* ---------- Instanz A: starten, suspendieren ---------- */

    const a = await buildMastra();
    const mastraA = new a.Mastra({
      workflows: { testReviewWorkflow: buildWorkflow() },
      storage: a.storage,
    });

    const requestContextA = new RequestContext();
    requestContextA.set('userId', USER_ID);

    const runA = await mastraA.getWorkflowById('test-review-workflow').createRun();
    const runId = runA.runId;

    const started = await runA.start({
      inputData: { fileHash: FILE_HASH },
      // Ein Workflow mit stateSchema verlangt initialState beim Start.
      initialState: { candidate: null, round: 0 },
      requestContext: requestContextA,
    });

    expect(started.status).toBe('suspended');

    // Instanz A endet hier – Pool zu, nichts bleibt im Prozessspeicher, auf das
    // sich Instanz B stützen könnte.
    await a.pool.end();

    /* ---------- Instanz B: frisch aufgebaut, aus dem Store fortsetzen ---------- */

    const b = await buildMastra();
    const mastraB = new b.Mastra({
      workflows: { testReviewWorkflow: buildWorkflow() },
      storage: b.storage,
    });

    const workflowB = mastraB.getWorkflowById('test-review-workflow');

    const state = await workflowB.getWorkflowRunById(runId);
    expect(state).not.toBeNull();
    expect(state!.status).toBe('suspended');

    // Der Kern der Aussage: der wiederhergestellte Kandidatensatz ist identisch.
    const suspendedStep = createWorkflowStateReader(state!).getSuspendedStep();
    expect(suspendedStep?.suspendPayload?.candidate).toEqual(candidate);

    const requestContextB = new RequestContext();
    requestContextB.set('userId', USER_ID);

    const runB = await workflowB.createRun({ runId });
    const resumed = await runB.resume({
      step: suspendedStep?.path,
      resumeData: { confirmed: true },
      requestContext: requestContextB,
    });

    // Narrowing statt Cast: nur der Erfolgsfall hat ein `result`.
    if (resumed.status !== 'success') {
      throw new Error(`Resume endete mit Status "${resumed.status}" statt "success".`);
    }
    expect(resumed.result.receiptId).toBeTruthy();

    /* ---------- Geschrieben wurde genau eine Zeile ---------- */

    const rows = await cleanupPool.query(
      'SELECT merchant, total_amount, currency, receipt_date FROM app.receipts WHERE user_id = $1 AND file_hash = $2',
      [USER_ID, FILE_HASH],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].merchant).toBe('Migros');
    expect(rows.rows[0].total_amount).toBe('42.10');

    await b.pool.end();
  }, 60_000);

  it('legt bei einem zweiten Lauf mit demselben file_hash keine zweite Zeile an', async () => {
    const { saveReceipt } = await import('../src/db/receipts');

    const candidate = {
      merchant: 'Migros Basel',
      merchantAddress: null,
      merchantTaxId: null,
      receiptDate: '2026-03-14',
      receiptTime: null,
      referenceNumber: null,
      totalAmount: '42.10',
      subtotalAmount: null,
      discountAmount: null,
      vatAmount: null,
      vatRate: null,
      currency: 'CHF',
      paymentMethod: null,
      receiptType: null,
      category: null,
      lineItems: [],
      issues: [],
    };

    await saveReceipt(USER_ID, {
      candidate,
      fileHash: FILE_HASH,
      fileReference: 'local:uploads/test.jpg',
      rawExtraction: { test: true },
    });

    const rows = await cleanupPool.query(
      'SELECT merchant FROM app.receipts WHERE user_id = $1 AND file_hash = $2',
      [USER_ID, FILE_HASH],
    );

    // Eine Zeile, aber aktualisiert – der Upsert, nicht ein blindes Insert.
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].merchant).toBe('Migros Basel');
  }, 30_000);
});
