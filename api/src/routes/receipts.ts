// Die Beleg-Endpunkte.
//
// Duenne Schicht: validieren, Subject aus dem Auth-Kontext nehmen, Repository
// rufen, projizieren. Die Fachlogik bleibt in src/db/receipts.ts und
// src/mastra/receipts/candidate.ts – hier wird nichts entschieden.
//
// Was der Aufrufer zu sehen bekommt, ist bewusst NICHT die Zeile: rawExtraction
// (der komplette Modell-Output) und file_hash verlassen den Dienst nie. Das war
// vorher eine Konvention im Tool, jetzt ist es die Grenze des Dienstes.

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  getReceipt,
  listReceipts,
  saveReceipt,
  searchReceipts,
  updateReceipt,
  type ReceiptPatch,
} from 'mastra-teamsbot/db/receipts';
import type { ReceiptRow } from 'mastra-teamsbot/db/schema';
import { candidateSchema } from 'mastra-teamsbot/receipts/candidate';
import { subjectOf, type AuthState } from '../auth';
import { validate } from '../validate';

type Env = { Variables: { auth: AuthState } };

/** Die Projektion. Identisch zu dem, was die Tools heute zurueckgeben. */
function toView(row: ReceiptRow) {
  return {
    id: row.id,
    merchant: row.merchant,
    receiptDate: row.receiptDate,
    receiptTime: row.receiptTime,
    referenceNumber: row.referenceNumber,
    totalAmount: row.totalAmount,
    subtotalAmount: row.subtotalAmount,
    vatAmount: row.vatAmount,
    vatRate: row.vatRate,
    // char(3) kommt rechtsgepolstert aus Postgres.
    currency: row.currency?.trim() ?? null,
    paymentMethod: row.paymentMethod,
    category: row.category,
    receiptType: row.receiptType,
    confidence: row.confidence,
    issues: Array.isArray(row.issues) ? (row.issues as string[]) : [],
    fileReference: row.fileReference,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als YYYY-MM-DD.');

const listQuerySchema = z.object({
  q: z.string().min(1).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  minAmount: z.string().optional(),
  maxAmount: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const createSchema = z.object({
  candidate: candidateSchema,
  fileHash: z.string().min(8),
  fileReference: z.string().min(1),
  /**
   * Der unveraenderte Modell-Output. Optional, weil der Tool-Weg
   * ("create-receipt" fuer diktierte Belege) keinen hat – dann wird der
   * Kandidat selbst abgelegt, wie bisher.
   */
  rawExtraction: z.unknown().optional(),
});

const patchSchema = z
  .object({
    merchant: z.string(),
    receiptDate: isoDate,
    totalAmount: z.string(),
    currency: z.string().length(3),
    vatAmount: z.string(),
    category: z.string(),
    receiptType: z.string(),
    paymentMethod: z.string(),
  })
  .partial();

export const receiptRoutes = new Hono<Env>()

  /**
   * Beleg schreiben. Upsert gegen (user_id, file_hash) – ein wiederholter
   * Aufruf trifft dieselbe Zeile statt eine zweite anzulegen. Damit ist ein
   * Retry des Agenten unschaedlich.
   */
  .post('/', validate('json', createSchema), async c => {
    const userId = subjectOf(c);
    const body = c.req.valid('json');

    const row = await saveReceipt(userId, {
      candidate: body.candidate,
      fileHash: body.fileHash,
      fileReference: body.fileReference,
      rawExtraction: body.rawExtraction ?? body.candidate,
    });

    return c.json({ receipt: toView(row) }, 201);
  })

  /**
   * Liste oder Suche, je nachdem ob `q` gesetzt ist. Ein Endpunkt statt zwei:
   * fuer den Aufrufer ist es dieselbe Frage mit einem Filter mehr.
   */
  .get('/', validate('query', listQuerySchema), async c => {
    const userId = subjectOf(c);
    const { q, ...filter } = c.req.valid('query');

    const rows = q
      ? await searchReceipts(userId, { query: q, ...filter })
      : await listReceipts(userId, filter);

    return c.json({ receipts: rows.map(toView), count: rows.length });
  })

  .get('/:id', async c => {
    const row = await getReceipt(subjectOf(c), c.req.param('id'));
    // Nicht vorhanden und "gehoert jemand anderem" sind von aussen
    // ununterscheidbar. Das ist Absicht: eine geratene id darf nicht
    // verraten, dass sie existiert.
    if (!row) throw new HTTPException(404, { message: 'Beleg nicht gefunden.' });
    return c.json({ receipt: toView(row) });
  })

  .patch('/:id', validate('json', patchSchema), async c => {
    const userId = subjectOf(c);
    const id = c.req.param('id');

    const existing = await getReceipt(userId, id);
    if (!existing) throw new HTTPException(404, { message: 'Beleg nicht gefunden.' });

    const row = await updateReceipt(userId, id, c.req.valid('json') as ReceiptPatch);
    if (!row) throw new HTTPException(404, { message: 'Beleg nicht gefunden.' });

    return c.json({ receipt: toView(row) });
  });
