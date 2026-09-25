// Die Abrechnungs-Endpunkte.
//
// Dieselbe duenne Schicht wie bei den Belegen: validieren, Subject aus dem
// Auth-Kontext, Repository rufen, projizieren. Was erlaubt ist (nur Entwuerfe
// aendern, nur eigene Belege zuordnen, nicht leer einreichen), entscheidet
// src/db/settlements.ts – im selben Statement wie das Schreiben. Die Fehler
// von dort werden in index.ts zu 404/409/422.
//
// Keine Route nimmt eine userId. Das Subject kommt ausschliesslich aus
// authenticate(), wie ueberall in diesem Dienst.

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  assignReceipts,
  createSettlement,
  deleteSettlement,
  getSettlement,
  listSettlements,
  MAX_ASSIGN,
  renameSettlement,
  submitSettlement,
  unassignReceipt,
  type SettlementDetail,
  type SettlementSummary,
} from 'mastra-teamsbot/db/settlements';
import { SETTLEMENT_STATUSES, type SettlementRow } from 'mastra-teamsbot/db/schema';
import { subjectOf, type AuthState } from '../auth';
import { validate } from '../validate';
import { toView as toReceiptView } from './receipts';

type Env = { Variables: { auth: AuthState } };

function toRowView(row: SettlementRow) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSummaryView(summary: SettlementSummary) {
  return {
    ...toRowView(summary),
    receiptCount: summary.receiptCount,
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
    totals: summary.totals,
  };
}

function toDetailView(detail: SettlementDetail) {
  return {
    ...toSummaryView(detail),
    byCategory: detail.byCategory,
    receipts: detail.receipts.map(toReceiptView),
  };
}

/** Ein Titel ist Pflicht und nicht nur Leerzeichen. 200 Zeichen reichen fuer "Field visit Bern KW36". */
const title = z.string().trim().min(1, 'Titel fehlt.').max(200);

const receiptIds = z.array(z.string().min(1)).min(1).max(MAX_ASSIGN);

const listQuerySchema = z.object({ status: z.enum(SETTLEMENT_STATUSES).optional() });

const createSchema = z.object({
  title,
  /** Optional gleich zuordnen – "Create new settlement" im Zuordnungsdialog. */
  receiptIds: receiptIds.optional(),
});

const patchSchema = z.object({ title });

const assignSchema = z.object({ receiptIds });

export const settlementRoutes = new Hono<Env>()

  .get('/', validate('query', listQuerySchema), async c => {
    const rows = await listSettlements(subjectOf(c), c.req.valid('query'));
    return c.json({ settlements: rows.map(toSummaryView) });
  })

  .post('/', validate('json', createSchema), async c => {
    const body = c.req.valid('json');
    const detail = await createSettlement(subjectOf(c), body.title, body.receiptIds);
    return c.json({ settlement: toDetailView(detail) }, 201);
  })

  .get('/:id', async c => {
    const detail = await getSettlement(subjectOf(c), c.req.param('id'));
    // Wie bei den Belegen: nicht vorhanden und fremd sind ununterscheidbar.
    if (!detail) throw new HTTPException(404, { message: 'Abrechnung nicht gefunden.' });
    return c.json({ settlement: toDetailView(detail) });
  })

  .patch('/:id', validate('json', patchSchema), async c => {
    const userId = subjectOf(c);
    const id = c.req.param('id');
    await renameSettlement(userId, id, c.req.valid('json').title);
    return c.json({ settlement: toDetailView((await getSettlement(userId, id))!) });
  })

  .delete('/:id', async c => {
    await deleteSettlement(subjectOf(c), c.req.param('id'));
    return c.body(null, 204);
  })

  .post('/:id/receipts', validate('json', assignSchema), async c => {
    const detail = await assignReceipts(
      subjectOf(c),
      c.req.param('id'),
      c.req.valid('json').receiptIds,
    );
    return c.json({ settlement: toDetailView(detail) });
  })

  .delete('/:id/receipts/:receiptId', async c => {
    const detail = await unassignReceipt(
      subjectOf(c),
      c.req.param('id'),
      c.req.param('receiptId'),
    );
    return c.json({ settlement: toDetailView(detail) });
  })

  .post('/:id/submit', async c => {
    const detail = await submitSettlement(subjectOf(c), c.req.param('id'));
    return c.json({ settlement: toDetailView(detail) });
  });
