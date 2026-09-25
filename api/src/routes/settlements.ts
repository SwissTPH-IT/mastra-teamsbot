// Die Abrechnungs-Endpunkte.
//
// Dieselbe duenne Schicht wie bei den Belegen: validieren, Subject aus dem
// Auth-Kontext, Repository rufen, projizieren. Was erlaubt ist (nur Entwuerfe
// aendern, nur eigene Belege zuordnen, nicht leer einreichen), entscheidet
// src/db/settlements.ts – im selben Statement wie das Schreiben. Die Fehler
// von dort werden in index.ts zu 404/409/422.
//
// Dazu kommen die Wechselkurse: vor jeder Antwort, die Betraege zeigt, und vor
// dem Einreichen holt ensureRates() nach, was fehlt (api/src/fx.ts). Deshalb
// liefern die schreibenden Repository-Funktionen keine Detailansicht mehr –
// die waere vor dem Holen der Kurse gerechnet.
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
  submitSettlement,
  unassignReceipt,
  updateSettlement,
  type SettlementDetail,
  type SettlementSummary,
} from 'mastra-teamsbot/db/settlements';
import {
  SETTLEMENT_CURRENCIES,
  SETTLEMENT_STATUSES,
  type SettlementRow,
} from 'mastra-teamsbot/db/schema';
import { subjectOf, type AuthState } from '../auth';
import { ensureRates } from '../fx';
import { validate } from '../validate';
import { toView as toReceiptView } from './receipts';

type Env = { Variables: { auth: AuthState } };

function toRowView(row: SettlementRow) {
  return {
    id: row.id,
    title: row.title,
    // char(3) kommt rechtsgepolstert aus Postgres.
    currency: row.currency.trim(),
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
    /** In der Abrechnungswaehrung. */
    total: summary.total,
    /** Je Originalwaehrung, unumgerechnet. */
    totals: summary.totals,
  };
}

function toDetailView(detail: SettlementDetail) {
  return {
    ...toSummaryView(detail),
    byCategory: detail.byCategory,
    receipts: detail.receipts.map(item => ({
      ...toReceiptView(item),
      conversion: item.conversion,
    })),
  };
}

/** Kurse nachholen, dann lesen. 404, wenn die Abrechnung dem Nutzer nicht gehoert. */
async function loadDetail(userId: string, id: string) {
  await ensureRates(userId, [id]);
  const detail = await getSettlement(userId, id);
  // Wie bei den Belegen: nicht vorhanden und fremd sind ununterscheidbar.
  if (!detail) throw new HTTPException(404, { message: 'Abrechnung nicht gefunden.' });
  return { settlement: toDetailView(detail) };
}

/** Ein Titel ist Pflicht und nicht nur Leerzeichen. 200 Zeichen reichen fuer "Field visit Bern KW36". */
const title = z.string().trim().min(1, 'Titel fehlt.').max(200);

const currency = z.enum(SETTLEMENT_CURRENCIES, {
  errorMap: () => ({ message: `Waehrung muss eine von ${SETTLEMENT_CURRENCIES.join(', ')} sein.` }),
});

const receiptIds = z.array(z.string().min(1)).min(1).max(MAX_ASSIGN);

const listQuerySchema = z.object({ status: z.enum(SETTLEMENT_STATUSES).optional() });

const createSchema = z.object({
  title,
  /** Pflicht: worauf die Abrechnung lautet, entscheidet der Mensch, nicht ein Default. */
  currency,
  /** Optional gleich zuordnen – "Create new settlement" im Zuordnungsdialog. */
  receiptIds: receiptIds.optional(),
});

const patchSchema = z
  .object({ title: title.optional(), currency: currency.optional() })
  .refine(body => body.title !== undefined || body.currency !== undefined, {
    message: 'Nichts zu aendern.',
  });

const assignSchema = z.object({ receiptIds });

export const settlementRoutes = new Hono<Env>()

  .get('/', validate('query', listQuerySchema), async c => {
    const userId = subjectOf(c);
    const filter = c.req.valid('query');
    // Zweimal lesen: welche Abrechnungen es gibt, bestimmt erst die Liste, und
    // ihre Summen brauchen die Kurse. Meist fehlt nichts – dann ist das zweite
    // Lesen der einzige Mehraufwand.
    const first = await listSettlements(userId, filter);
    const missing = first.filter(row => row.total.missingCount > 0 || row.total.provisionalCount > 0);
    if (missing.length === 0) return c.json({ settlements: first.map(toSummaryView) });

    await ensureRates(
      userId,
      missing.map(row => row.id),
    );
    const rows = await listSettlements(userId, filter);
    return c.json({ settlements: rows.map(toSummaryView) });
  })

  .post('/', validate('json', createSchema), async c => {
    const userId = subjectOf(c);
    const body = c.req.valid('json');
    const id = await createSettlement(
      userId,
      { title: body.title, currency: body.currency },
      body.receiptIds,
    );
    return c.json(await loadDetail(userId, id), 201);
  })

  .get('/:id', async c => c.json(await loadDetail(subjectOf(c), c.req.param('id'))))

  .patch('/:id', validate('json', patchSchema), async c => {
    const userId = subjectOf(c);
    const id = c.req.param('id');
    await updateSettlement(userId, id, c.req.valid('json'));
    return c.json(await loadDetail(userId, id));
  })

  .delete('/:id', async c => {
    await deleteSettlement(subjectOf(c), c.req.param('id'));
    return c.body(null, 204);
  })

  .post('/:id/receipts', validate('json', assignSchema), async c => {
    const userId = subjectOf(c);
    const id = c.req.param('id');
    await assignReceipts(userId, id, c.req.valid('json').receiptIds);
    return c.json(await loadDetail(userId, id));
  })

  .delete('/:id/receipts/:receiptId', async c => {
    const userId = subjectOf(c);
    const id = c.req.param('id');
    await unassignReceipt(userId, id, c.req.param('receiptId'));
    return c.json(await loadDetail(userId, id));
  })

  .post('/:id/submit', async c => {
    const userId = subjectOf(c);
    const id = c.req.param('id');
    // Vorher: ein Kurs, der hier noch fehlt, liesse das Einreichen an
    // 'unconverted' scheitern, obwohl Frankfurter ihn haette.
    await ensureRates(userId, [id]);
    await submitSettlement(userId, id);
    return c.json(await loadDetail(userId, id));
  });
