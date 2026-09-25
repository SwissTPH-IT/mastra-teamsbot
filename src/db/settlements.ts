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

import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from './index';
import { exchangeRates, receipts, settlements, type SettlementRow } from './schema';
import { receiptIsEditable, type ReceiptWithSettlement } from './receipts';
import { conversionIsProvisional, convertedAmount, rateJoin } from './exchange-rates';

/**
 * Eine Summe je Originalwährung. CHF und EUR zu addieren ergäbe keine Zahl –
 * dafür gibt es `total`, umgerechnet.
 */
export type CurrencyTotal = {
  /** null bei Belegen, auf denen keine Währung zu lesen war. */
  currency: string | null;
  count: number;
  /** In Postgres gerechnet, als String – wie alle Beträge. */
  sum: string;
};

export type CategoryTotal = CurrencyTotal & { category: string | null };

/**
 * Die Summe der Abrechnung in IHRER Währung: jede Position zum Kurs ihres
 * Belegdatums umgerechnet, dann addiert.
 *
 * `missingCount` Positionen fehlen darin (kein Betrag, keine Währung, kein
 * Datum oder noch kein Kurs). Solange das nicht 0 ist, ist `sum` zu klein,
 * und die Oberfläche muss das sagen, statt eine falsche Zahl zu zeigen.
 */
export type SettlementTotal = {
  currency: string;
  sum: string;
  missingCount: number;
  /** Positionen, deren Kurs sich noch ändern kann – siehe isProvisionalRate(). */
  provisionalCount: number;
};

export type SettlementSummary = SettlementRow & {
  receiptCount: number;
  /** Frühestes und spätestes Belegdatum. Der Zeitraum wird nicht gespeichert. */
  periodStart: string | null;
  periodEnd: string | null;
  /** Je Originalwährung, unumgerechnet. */
  totals: CurrencyTotal[];
  total: SettlementTotal;
};

/** Die Umrechnung einer Position in die Abrechnungswährung. */
export type Conversion = {
  /** Betrag in der Abrechnungswährung. null: nicht rechenbar, siehe `missing`. */
  amount: string | null;
  /** 1 Abrechnungswährung = `rate` Belegwährung. null bei gleicher Währung oder ohne Kurs. */
  rate: string | null;
  /** Von welchem Tag der Kurs stammt. Kann vor dem Belegdatum liegen. */
  rateDate: string | null;
  provisional: boolean;
  missing: 'amount' | 'currency' | 'date' | 'rate' | null;
};

export type SettlementItem = ReceiptWithSettlement & { conversion: Conversion };

export type SettlementDetail = SettlementSummary & {
  /** Je Kategorie, in der Abrechnungswährung. */
  byCategory: CategoryTotal[];
  receipts: SettlementItem[];
};

/** Warum eine Änderung an einer Abrechnung nicht ging. Die API macht daraus 404/409/422. */
export class SettlementError extends Error {
  constructor(
    readonly reason:
      | 'not-found'
      | 'locked'
      | 'empty'
      | 'incomplete'
      | 'unconverted'
      | 'rates-pending'
      | 'receipts-unavailable',
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
 * Die Belege der Abrechnung(en) mit ihrem Kurs. Die Abrechnung hängt über
 * (id, user_id) daran, wie beim Fremdschlüssel – sie liefert die Zielwährung.
 */
function settlementJoin(): SQL | undefined {
  return and(eq(settlements.id, receipts.settlementId), eq(settlements.userId, receipts.userId));
}

type Aggregate = Omit<SettlementSummary, keyof SettlementRow>;

function emptyAggregate(currency: string): Aggregate {
  return {
    receiptCount: 0,
    periodStart: null,
    periodEnd: null,
    totals: [],
    total: { currency, sum: '0.00', missingCount: 0, provisionalCount: 0 },
  };
}

/**
 * Anzahl, Zeitraum und Summen je Abrechnung, für mehrere auf einmal.
 *
 * Zwei Abfragen für alle statt je eine pro Abrechnung: eine gruppiert nach
 * (Abrechnung, Originalwährung), eine nach Abrechnung für die umgerechnete
 * Summe. Die Zusammenfassung passiert danach in JavaScript, aber nur als
 * Einsammeln – gerechnet wird in Postgres.
 */
async function aggregate(
  userId: string,
  settlementRows: SettlementRow[],
): Promise<Map<string, Aggregate>> {
  const result = new Map<string, Aggregate>();
  if (settlementRows.length === 0) return result;
  const settlementIds = settlementRows.map(row => row.id);

  const [rows, converted] = await Promise.all([
    db
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
      .orderBy(sql`count(*) desc`),
    db
      .select({
        settlementId: receipts.settlementId,
        sum: sql<string>`coalesce(sum(${convertedAmount()}), 0)::text`,
        missingCount: sql<number>`count(*) filter (where ${convertedAmount()} is null)::int`,
        provisionalCount: sql<number>`count(*) filter (where ${conversionIsProvisional()})::int`,
      })
      .from(receipts)
      .innerJoin(settlements, settlementJoin())
      .leftJoin(exchangeRates, rateJoin())
      .where(and(eq(receipts.userId, userId), inArray(receipts.settlementId, settlementIds)))
      .groupBy(receipts.settlementId),
  ]);

  for (const settlement of settlementRows) {
    result.set(settlement.id, emptyAggregate(settlement.currency.trim()));
  }

  for (const row of converted) {
    const entry = row.settlementId ? result.get(row.settlementId) : undefined;
    if (!entry) continue;
    entry.total = {
      ...entry.total,
      sum: row.sum,
      missingCount: row.missingCount,
      provisionalCount: row.provisionalCount,
    };
  }

  for (const row of rows) {
    const entry = row.settlementId ? result.get(row.settlementId) : undefined;
    if (!entry) continue;
    entry.receiptCount += row.count;
    // YYYY-MM-DD vergleicht sich als String korrekt.
    if (row.periodStart && (!entry.periodStart || row.periodStart < entry.periodStart)) {
      entry.periodStart = row.periodStart;
    }
    if (row.periodEnd && (!entry.periodEnd || row.periodEnd > entry.periodEnd)) {
      entry.periodEnd = row.periodEnd;
    }
    entry.totals.push({ currency: row.currency?.trim() ?? null, count: row.count, sum: row.sum });
  }

  return result;
}

function withAggregate(row: SettlementRow, aggregates: Map<string, Aggregate>): SettlementSummary {
  const currency = row.currency.trim();
  return { ...row, currency, ...(aggregates.get(row.id) ?? emptyAggregate(currency)) };
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

  const aggregates = await aggregate(userId, rows);
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

/** Warum eine Position keinen Betrag in der Abrechnungswährung hat. */
function missingReason(
  item: { totalAmount: string | null; currency: string | null; receiptDate: string | null },
  settlementCurrency: string,
  amount: string | null,
): Conversion['missing'] {
  if (amount !== null) return null;
  if (item.totalAmount === null) return 'amount';
  if (item.currency === null) return 'currency';
  if (item.currency.trim() === settlementCurrency) return null;
  if (item.receiptDate === null) return 'date';
  return 'rate';
}

/** Eine Abrechnung mit Belegen und Summen je Kategorie. null, wenn sie dem Nutzer nicht gehört. */
export async function getSettlement(
  userId: string,
  settlementId: string,
): Promise<SettlementDetail | null> {
  const row = await getSettlementRow(userId, settlementId);
  if (!row) return null;
  const currency = row.currency.trim();
  const inThisSettlement = and(eq(receipts.userId, userId), eq(receipts.settlementId, row.id));

  const [aggregates, byCategory, items] = await Promise.all([
    aggregate(userId, [row]),
    // Je Kategorie in der Abrechnungswährung, nicht mehr je Originalwährung:
    // eine Abrechnung hat genau eine Summe pro Kategorie.
    db
      .select({
        category: receipts.category,
        count: sql<number>`count(*)::int`,
        sum: sql<string>`coalesce(sum(${convertedAmount()}), 0)::text`,
      })
      .from(receipts)
      .innerJoin(settlements, settlementJoin())
      .leftJoin(exchangeRates, rateJoin())
      .where(inThisSettlement)
      .groupBy(receipts.category)
      .orderBy(sql`coalesce(sum(${convertedAmount()}), 0) desc`),
    db
      .select({
        receipt: receipts,
        amount: convertedAmount(),
        rate: exchangeRates.rate,
        rateDate: sql<string | null>`${exchangeRates.rateDate}::text`,
        provisional: conversionIsProvisional(),
      })
      .from(receipts)
      .innerJoin(settlements, settlementJoin())
      .leftJoin(exchangeRates, rateJoin())
      .where(inThisSettlement)
      .orderBy(
        sql`${receipts.receiptDate} asc nulls last`,
        asc(receipts.createdAt),
        asc(receipts.id),
      ),
  ]);

  return {
    ...withAggregate(row, aggregates),
    byCategory: byCategory.map(entry => ({ ...entry, currency })),
    receipts: items.map(item => ({
      ...item.receipt,
      settlementTitle: row.title,
      settlementStatus: row.status,
      conversion: {
        // Postgres liefert das numeric als String; round() ist schon passiert.
        amount: item.amount,
        rate: item.rate,
        rateDate: item.rateDate,
        provisional: item.provisional,
        missing: missingReason(item.receipt, currency, item.amount),
      },
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
 *
 * Wie alle schreibenden Funktionen hier liefert sie nur die id und keine
 * Detailansicht: die rechnet mit Kursen, die der Dienst erst NACH dem
 * Schreiben holen kann – neue Belege brauchen neue Kurse.
 */
export async function createSettlement(
  userId: string,
  input: { title: string; currency: string },
  receiptIds: string[] = [],
): Promise<string> {
  return db.transaction(async tx => {
    const [row] = await tx
      .insert(settlements)
      .values({ userId, title: input.title, currency: input.currency })
      .returning({ id: settlements.id });
    await moveReceipts(tx, userId, row!.id, receiptIds);
    return row!.id;
  });
}

/**
 * Titel oder Währung ändern. Nur im Entwurf – eine eingereichte Abrechnung
 * heisst, wie sie eingereicht wurde, und lautet auf die Währung von damals.
 */
export async function updateSettlement(
  userId: string,
  settlementId: string,
  changes: { title?: string; currency?: string },
): Promise<SettlementRow> {
  const [row] = await db
    .update(settlements)
    .set({ ...changes, updatedAt: sql`now()` })
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
): Promise<void> {
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
): Promise<void> {
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
}

/**
 * Einreichen. Danach ist die Abrechnung gesperrt.
 *
 * Vier Bedingungen vorher, alle in der Transaktion unter FOR UPDATE:
 * nicht leer, jeder Beleg hat eine Belegart ("Required before submitting"
 * steht in der Oberfläche am Feld), jede Position hat einen Betrag in der
 * Abrechnungswährung, und keiner der Kurse ist noch vorläufig. Das Letzte ist
 * die Garantie, dass eine eingereichte Summe sich nie mehr bewegt: feste Kurse
 * überschreibt saveRates() nicht.
 *
 * Die Kurse holt der Dienst vorher; hier wird nur gelesen. Zurück in den
 * Entwurf gibt es bewusst keinen Endpunkt – das ist die Aufgabe von Finance,
 * und diese Rolle gibt es noch nicht.
 */
export async function submitSettlement(userId: string, settlementId: string): Promise<void> {
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
        unconverted: sql<number>`count(*) filter (where ${convertedAmount()} is null)::int`,
        provisional: sql<number>`count(*) filter (where ${conversionIsProvisional()})::int`,
      })
      .from(receipts)
      .innerJoin(settlements, settlementJoin())
      .leftJoin(exchangeRates, rateJoin())
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
    if (counts.unconverted > 0) {
      throw new SettlementError(
        'unconverted',
        `${counts.unconverted} Position(en) ohne Betrag in der Abrechnungswährung: es fehlt ` +
          'Betrag, Währung, Belegdatum oder ein Wechselkurs.',
      );
    }
    if (counts.provisional > 0) {
      throw new SettlementError(
        'rates-pending',
        `${counts.provisional} Position(en) mit vorläufigem Wechselkurs. Der Tageskurs steht ` +
          'erst ein bis zwei Tage nach dem Belegdatum fest.',
      );
    }

    await tx
      .update(settlements)
      .set({ status: 'submitted', submittedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(settlements.id, settlementId), eq(settlements.userId, userId)));
  });
}
