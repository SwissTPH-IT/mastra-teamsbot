// Repository für app.settlements und die Zuordnung Beleg -> Abrechnung.
//
// Dieselbe Regel wie in receipts.ts: JEDE Funktion nimmt `userId` als erstes
// Pflichtargument und hängt es an jedes WHERE. Dazu kommt hier eine zweite
// Schicht, die nicht vom Code abhängt: der Fremdschlüssel
// receipts(settlement_id, user_id) -> settlements(id, user_id). Selbst eine
// fehlerhafte Query kann einen Beleg nicht in die Abrechnung eines anderen
// Nutzers legen – Postgres lehnt das ab.
//
// Gesperrt ist eine Abrechnung ab `submitted`. Jede schreibende Query prüft
// den Status im selben Statement (nicht vorher in einem eigenen SELECT),
// damit ein gleichzeitiges Einreichen nicht zwischen Prüfen und Schreiben
// fallen kann.

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from './index';
import { receipts, settlements, type SettlementRow } from './schema';
import { receiptIsEditable, type ReceiptWithSettlement } from './receipts';

/** Eine Summe je Währung. CHF und EUR zu addieren ergäbe keine Zahl. */
export type CurrencyTotal = {
  /** null bei Belegen, auf denen keine Währung zu lesen war. */
  currency: string | null;
  count: number;
  /** In Postgres gerechnet, als String – wie alle Beträge. */
  sum: string;
};

export type CategoryTotal = CurrencyTotal & { category: string | null };

export type SettlementSummary = SettlementRow & {
  receiptCount: number;
  /** Frühestes und spätestes Belegdatum. Der Zeitraum wird nicht gespeichert. */
  periodStart: string | null;
  periodEnd: string | null;
  totals: CurrencyTotal[];
};

export type SettlementDetail = SettlementSummary & {
  byCategory: CategoryTotal[];
  receipts: ReceiptWithSettlement[];
};

/** Warum eine Änderung an einer Abrechnung nicht ging. Die API macht daraus 404/409. */
export class SettlementError extends Error {
  constructor(
    readonly reason: 'not-found' | 'locked' | 'empty' | 'incomplete' | 'receipts-unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'SettlementError';
  }
}

const notFound = () => new SettlementError('not-found', 'Abrechnung nicht gefunden.');
const locked = () =>
  new SettlementError(
    'locked',
    'Die Abrechnung ist eingereicht und damit gesperrt: keine neuen Belege, keine Korrekturen.',
  );

/** Obergrenze für eine Zuordnung in einem Aufruf – die grösste Seite der Liste. */
export const MAX_ASSIGN = 200;

/**
 * Anzahl, Zeitraum und Summen je Abrechnung, für mehrere auf einmal.
 *
 * Eine Abfrage für alle statt einer pro Abrechnung. Gruppiert nach
 * (Abrechnung, Währung); die Zusammenfassung pro Abrechnung passiert danach in
 * JavaScript, aber nur als Einsammeln – gerechnet wird in Postgres.
 */
async function aggregate(
  userId: string,
  settlementIds: string[],
): Promise<Map<string, Omit<SettlementSummary, keyof SettlementRow>>> {
  const result = new Map<string, Omit<SettlementSummary, keyof SettlementRow>>();
  if (settlementIds.length === 0) return result;

  const rows = await db
    .select({
      settlementId: receipts.settlementId,
      currency: receipts.currency,
      count: sql<number>`count(*)::int`,
      sum: sql<string>`coalesce(sum(${receipts.totalAmount}), 0)::text`,
      periodStart: sql<string | null>`min(${receipts.receiptDate})::text`,
      periodEnd: sql<string | null>`max(${receipts.receiptDate})::text`,
    })
    .from(receipts)
    .where(and(eq(receipts.userId, userId), inArray(receipts.settlementId, settlementIds)))
    .groupBy(receipts.settlementId, receipts.currency)
    .orderBy(sql`count(*) desc`);

  for (const row of rows) {
    if (!row.settlementId) continue;
    const entry = result.get(row.settlementId) ?? {
      receiptCount: 0,
      periodStart: null,
      periodEnd: null,
      totals: [],
    };
    entry.receiptCount += row.count;
    // YYYY-MM-DD vergleicht sich als String korrekt.
    if (row.periodStart && (!entry.periodStart || row.periodStart < entry.periodStart)) {
      entry.periodStart = row.periodStart;
    }
    if (row.periodEnd && (!entry.periodEnd || row.periodEnd > entry.periodEnd)) {
      entry.periodEnd = row.periodEnd;
    }
    entry.totals.push({ currency: row.currency?.trim() ?? null, count: row.count, sum: row.sum });
    result.set(row.settlementId, entry);
  }

  return result;
}

function withAggregate(
  row: SettlementRow,
  aggregates: Map<string, Omit<SettlementSummary, keyof SettlementRow>>,
): SettlementSummary {
  return {
    ...row,
    ...(aggregates.get(row.id) ?? {
      receiptCount: 0,
      periodStart: null,
      periodEnd: null,
      totals: [],
    }),
  };
}

/** Die Abrechnungen des Nutzers: Entwürfe zuerst, dann die neuesten. */
export async function listSettlements(
  userId: string,
  filter: { status?: SettlementRow['status'] } = {},
): Promise<SettlementSummary[]> {
  const rows = await db
    .select()
    .from(settlements)
    .where(
      and(
        eq(settlements.userId, userId),
        filter.status ? eq(settlements.status, filter.status) : undefined,
      ),
    )
    .orderBy(
      sql`case when ${settlements.status} = 'draft' then 0 else 1 end`,
      desc(settlements.createdAt),
      desc(settlements.id),
    );

  const aggregates = await aggregate(
    userId,
    rows.map(row => row.id),
  );
  return rows.map(row => withAggregate(row, aggregates));
}

async function getSettlementRow(userId: string, settlementId: string): Promise<SettlementRow | null> {
  const [row] = await db
    .select()
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Eine Abrechnung mit Belegen und Summen je Kategorie. null, wenn sie dem Nutzer nicht gehört. */
export async function getSettlement(
  userId: string,
  settlementId: string,
): Promise<SettlementDetail | null> {
  const row = await getSettlementRow(userId, settlementId);
  if (!row) return null;

  const [aggregates, byCategory, items] = await Promise.all([
    aggregate(userId, [row.id]),
    db
      .select({
        category: receipts.category,
        currency: receipts.currency,
        count: sql<number>`count(*)::int`,
        sum: sql<string>`coalesce(sum(${receipts.totalAmount}), 0)::text`,
      })
      .from(receipts)
      .where(and(eq(receipts.userId, userId), eq(receipts.settlementId, row.id)))
      .groupBy(receipts.category, receipts.currency)
      .orderBy(sql`coalesce(sum(${receipts.totalAmount}), 0) desc`),
    db
      .select()
      .from(receipts)
      .where(and(eq(receipts.userId, userId), eq(receipts.settlementId, row.id)))
      .orderBy(
        sql`${receipts.receiptDate} asc nulls last`,
        asc(receipts.createdAt),
        asc(receipts.id),
      ),
  ]);

  return {
    ...withAggregate(row, aggregates),
    byCategory: byCategory.map(entry => ({ ...entry, currency: entry.currency?.trim() ?? null })),
    receipts: items.map(item => ({
      ...item,
      settlementTitle: row.title,
      settlementStatus: row.status,
    })),
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Das eigentliche Zuordnen, innerhalb einer Transaktion des Aufrufers.
 *
 * Trifft das UPDATE weniger Zeilen als verlangt – fremde id, gesperrter Beleg,
 * geratener Wert –, wirft es, und die ganze Transaktion rollt zurück. Eine
 * halbe Zuordnung wäre schwerer zu erklären als gar keine.
 */
async function moveReceipts(
  tx: Tx,
  userId: string,
  settlementId: string,
  receiptIds: string[],
): Promise<void> {
  const ids = [...new Set(receiptIds)];
  if (ids.length === 0) return;

  const updated = await tx
    .update(receipts)
    .set({ settlementId, updatedAt: sql`now()` })
    .where(and(eq(receipts.userId, userId), inArray(receipts.id, ids), receiptIsEditable()))
    .returning({ id: receipts.id });

  if (updated.length !== ids.length) {
    throw new SettlementError(
      'receipts-unavailable',
      `${ids.length - updated.length} von ${ids.length} Belegen wurden nicht gefunden oder ` +
        'liegen in einer eingereichten Abrechnung. Es wurde nichts zugeordnet.',
    );
  }
}

/**
 * Neue Abrechnung, optional gleich mit Belegen.
 *
 * Beides in einer Transaktion: "Create new settlement" im Zuordnungsdialog
 * soll nicht eine leere Abrechnung zurücklassen, wenn die Zuordnung scheitert.
 */
export async function createSettlement(
  userId: string,
  title: string,
  receiptIds: string[] = [],
): Promise<SettlementDetail> {
  const id = await db.transaction(async tx => {
    const [row] = await tx
      .insert(settlements)
      .values({ userId, title })
      .returning({ id: settlements.id });
    await moveReceipts(tx, userId, row!.id, receiptIds);
    return row!.id;
  });

  return (await getSettlement(userId, id))!;
}

/** Titel ändern. Nur im Entwurf – eine eingereichte Abrechnung heisst, wie sie eingereicht wurde. */
export async function renameSettlement(
  userId: string,
  settlementId: string,
  title: string,
): Promise<SettlementRow> {
  const [row] = await db
    .update(settlements)
    .set({ title, updatedAt: sql`now()` })
    .where(
      and(
        eq(settlements.id, settlementId),
        eq(settlements.userId, userId),
        eq(settlements.status, 'draft'),
      ),
    )
    .returning();

  if (row) return row;
  throw (await getSettlementRow(userId, settlementId)) ? locked() : notFound();
}

/**
 * Entwurf löschen. Die Belege bleiben, sie sind danach wieder unassigned.
 *
 * Eine Transaktion, weil der Fremdschlüssel kein ON DELETE hat (siehe
 * schema.ts): erst die Zuordnung lösen, dann die Zeile löschen. Scheitert das
 * Löschen, bleibt auch die Zuordnung.
 */
export async function deleteSettlement(userId: string, settlementId: string): Promise<void> {
  await db.transaction(async tx => {
    const [row] = await tx
      .select({ status: settlements.status })
      .from(settlements)
      .where(and(eq(settlements.id, settlementId), eq(settlements.userId, userId)))
      .for('update');

    if (!row) throw notFound();
    if (row.status !== 'draft') throw locked();

    await tx
      .update(receipts)
      .set({ settlementId: null, updatedAt: sql`now()` })
      .where(and(eq(receipts.userId, userId), eq(receipts.settlementId, settlementId)));
    await tx
      .delete(settlements)
      .where(and(eq(settlements.id, settlementId), eq(settlements.userId, userId)));
  });
}

/**
 * Belege einer Abrechnung zuordnen – alle oder keinen (siehe moveReceipts).
 *
 * Ein Beleg darf aus einer anderen Abrechnung herüberwandern, solange jene ein
 * Entwurf ist; aus einer eingereichten nicht (receiptIsEditable()).
 *
 * Die Abrechnung wird per FOR UPDATE gesperrt: ein gleichzeitiges Einreichen
 * wartet, bis die Zuordnung durch ist, und sieht dann die neuen Belege.
 */
export async function assignReceipts(
  userId: string,
  settlementId: string,
  receiptIds: string[],
): Promise<SettlementDetail> {
  await db.transaction(async tx => {
    const [row] = await tx
      .select({ status: settlements.status })
      .from(settlements)
      .where(and(eq(settlements.id, settlementId), eq(settlements.userId, userId)))
      .for('update');

    if (!row) throw notFound();
    if (row.status !== 'draft') throw locked();

    await moveReceipts(tx, userId, settlementId, receiptIds);
  });

  return (await getSettlement(userId, settlementId))!;
}

/**
 * Einen Beleg aus einem Entwurf herausnehmen. Er ist danach unassigned.
 *
 * Das `settlement_id = $settlementId` im WHERE ist Absicht: wer den Beleg aus
 * Abrechnung A entfernen will, soll ihn nicht aus B entfernen, nur weil er
 * inzwischen dorthin gewandert ist.
 */
export async function unassignReceipt(
  userId: string,
  settlementId: string,
  receiptId: string,
): Promise<SettlementDetail> {
  const settlement = await getSettlementRow(userId, settlementId);
  if (!settlement) throw notFound();

  const [row] = await db
    .update(receipts)
    .set({ settlementId: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(receipts.id, receiptId),
        eq(receipts.userId, userId),
        eq(receipts.settlementId, settlementId),
        receiptIsEditable(),
      ),
    )
    .returning({ id: receipts.id });

  if (!row) {
    if (settlement.status !== 'draft') throw locked();
    throw new SettlementError('receipts-unavailable', 'Der Beleg liegt nicht in dieser Abrechnung.');
  }

  return (await getSettlement(userId, settlementId))!;
}

/**
 * Einreichen. Danach ist die Abrechnung gesperrt.
 *
 * Zwei Bedingungen vorher, beide in der Transaktion unter FOR UPDATE:
 * nicht leer, und jeder Beleg hat eine Belegart ("Required before
 * submitting" steht in der Oberfläche am Feld). Zurück in den Entwurf gibt es
 * bewusst keinen Endpunkt – das ist die Aufgabe von Finance, und diese Rolle
 * gibt es noch nicht.
 */
export async function submitSettlement(
  userId: string,
  settlementId: string,
): Promise<SettlementDetail> {
  await db.transaction(async tx => {
    const [row] = await tx
      .select({ status: settlements.status })
      .from(settlements)
      .where(and(eq(settlements.id, settlementId), eq(settlements.userId, userId)))
      .for('update');

    if (!row) throw notFound();
    if (row.status !== 'draft') throw locked();

    const [counts] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        withoutType: sql<number>`count(*) filter (where ${receipts.receiptType} is null)::int`,
      })
      .from(receipts)
      .where(and(eq(receipts.userId, userId), eq(receipts.settlementId, settlementId)));

    if (!counts || counts.total === 0) {
      throw new SettlementError('empty', 'Eine leere Abrechnung kann nicht eingereicht werden.');
    }
    if (counts.withoutType > 0) {
      throw new SettlementError(
        'incomplete',
        `${counts.withoutType} Beleg(e) ohne Belegart. Die Belegart ist vor dem Einreichen Pflicht.`,
      );
    }

    await tx
      .update(settlements)
      .set({ status: 'submitted', submittedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(settlements.id, settlementId), eq(settlements.userId, userId)));
  });

  return (await getSettlement(userId, settlementId))!;
}
