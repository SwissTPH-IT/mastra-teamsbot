// Repository für app.receipts und app.pending_reviews.
//
// Die Mandantentrennung sitzt hier, nicht in den Tools und schon gar nicht im
// Modell: JEDE Funktion nimmt `userId` als erstes Pflichtargument und hängt es
// an jedes WHERE. Es gibt bewusst keine Variante ohne – der Typ erzwingt sie.
// Eine fremde receiptId trifft dadurch 0 Zeilen statt einer fremden Zeile.

import {
  and,
  eq,
  getTableColumns,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from './index';
import {
  pendingReviews,
  receipts,
  settlements,
  type PendingReviewRow,
  type ReceiptRow,
  type SettlementStatus,
} from './schema';
import { computeConfidence, type ReceiptCandidate } from '../mastra/receipts/candidate';

/**
 * Ein Beleg samt der Abrechnung, in der er liegt.
 *
 * Titel und Status kommen per Join mit, weil jede Ansicht eines Belegs sie
 * braucht ("in Field visit Bern", gesperrt oder nicht) – ein zweiter Aufruf
 * pro Zeile waere bei 200 Zeilen 200 Aufrufe.
 */
export type ReceiptWithSettlement = ReceiptRow & {
  settlementTitle: string | null;
  settlementStatus: SettlementStatus | null;
};

/**
 * Wahr, solange der Beleg veraenderbar ist: ohne Abrechnung oder in einem
 * Entwurf.
 *
 * Eine eingereichte Abrechnung ist gesperrt – ihre Belege aendern sich nicht
 * mehr, weder ueber die Oberflaeche noch ueber den Agenten noch ueber einen
 * erneuten Upload derselben Datei. Die Bedingung steht deshalb im WHERE der
 * schreibenden Queries und nicht als Vorabpruefung: zwischen Pruefen und
 * Schreiben koennte sonst jemand einreichen.
 */
export function receiptIsEditable(): SQL {
  return sql`(${receipts.settlementId} is null or exists (
    select 1 from ${settlements}
    where ${settlements.id} = ${receipts.settlementId}
      and ${settlements.userId} = ${receipts.userId}
      and ${settlements.status} = 'draft'
  ))`;
}

/** Ein Beleg, der wegen einer eingereichten Abrechnung nicht geschrieben wurde. */
export class ReceiptLockedError extends Error {
  constructor() {
    super('Der Beleg liegt in einer eingereichten Abrechnung und kann nicht mehr geändert werden.');
    this.name = 'ReceiptLockedError';
  }
}

export type SaveReceiptInput = {
  candidate: ReceiptCandidate;
  /** sha256 der Originaldatei – zusammen mit userId der Idempotenz-Key. */
  fileHash: string;
  fileReference: string;
  /** Der unveränderte Agent-Output, so wie er aus dem Workflow kam. */
  rawExtraction: unknown;
};

function toRowValues(input: SaveReceiptInput) {
  const { candidate } = input;
  return {
    merchant: candidate.merchant,
    merchantAddress: candidate.merchantAddress,
    merchantTaxId: candidate.merchantTaxId,
    receiptDate: candidate.receiptDate,
    receiptTime: candidate.receiptTime,
    referenceNumber: candidate.referenceNumber,
    totalAmount: candidate.totalAmount,
    subtotalAmount: candidate.subtotalAmount,
    discountAmount: candidate.discountAmount,
    vatAmount: candidate.vatAmount,
    vatRate: candidate.vatRate,
    currency: candidate.currency,
    paymentMethod: candidate.paymentMethod,
    receiptType: candidate.receiptType,
    category: candidate.category,
    lineItems: candidate.lineItems,
    issues: candidate.issues,
    rawExtraction: input.rawExtraction,
    confidence: computeConfidence(candidate),
    fileReference: input.fileReference,
  };
}

/**
 * Beleg schreiben – als Upsert, nicht als blindes Insert.
 *
 * Läuft gegen den Idempotenz-Key (user_id, file_hash): ein doppelt hochgeladener
 * Beleg oder ein wiederholter Tool-Call aktualisiert dieselbe Zeile, statt eine
 * zweite anzulegen.
 *
 * Liegt die bestehende Zeile in einer eingereichten Abrechnung, greift das
 * `setWhere` nicht, es kommt keine Zeile zurück, und die Funktion wirft
 * ReceiptLockedError. Ein erneut geschicktes Foto darf einen eingereichten
 * Beleg nicht stillschweigend überschreiben.
 */
export async function saveReceipt(userId: string, input: SaveReceiptInput): Promise<ReceiptRow> {
  const values = toRowValues(input);

  const [row] = await db
    .insert(receipts)
    .values({ userId, fileHash: input.fileHash, ...values })
    .onConflictDoUpdate({
      target: [receipts.userId, receipts.fileHash],
      set: { ...values, updatedAt: sql`now()` },
      setWhere: receiptIsEditable(),
    })
    .returning();

  if (!row) throw new ReceiptLockedError();
  return row;
}

/** Nach welchen Spalten sortiert werden darf. Keine freie Spaltenwahl von aussen. */
export const RECEIPT_SORT_FIELDS = [
  'receiptDate',
  'totalAmount',
  'createdAt',
  'merchant',
] as const;
export type ReceiptSortField = (typeof RECEIPT_SORT_FIELDS)[number];

const SORT_COLUMNS = {
  receiptDate: receipts.receiptDate,
  totalAmount: receipts.totalAmount,
  createdAt: receipts.createdAt,
  merchant: receipts.merchant,
} as const satisfies Record<ReceiptSortField, unknown>;

export type ListReceiptsFilter = {
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
  /** Exakte Kategorie. Leerstring heisst "kein Filter", nicht "Kategorie leer". */
  category?: string;
  /** Nur Belege ohne Abrechnung. */
  unassigned?: boolean;
  sort?: ReceiptSortField;
  dir?: 'asc' | 'desc';
};

export type SearchReceiptsFilter = ListReceiptsFilter & {
  query: string;
  minAmount?: string;
  maxAmount?: string;
};

/** Obergrenze einer Seite. 200 ist die groesste Seitengroesse der Weboberflaeche. */
const MAX_LIMIT = 200;

/**
 * Die EINE Stelle, an der aus Nutzer und Filter eine WHERE-Bedingung wird.
 *
 * Liste, Suche und Zaehlung laufen alle hier durch – sonst zeigt die Tabelle
 * eine andere Menge als ihre Trefferzahl, und ein Export eine dritte. Das
 * `eq(userId)` steht bewusst unbedingt am Anfang und nicht in einem if.
 */
function buildConditions(userId: string, filter: Partial<SearchReceiptsFilter>): SQL[] {
  const conditions: SQL[] = [eq(receipts.userId, userId)];

  if (filter.query) {
    // LIKE-Metazeichen entschaerfen: ein eingegebenes "%" ist in einem
    // Haendlernamen legitimer Text und kein Platzhalter, der alles trifft.
    const pattern = `%${filter.query.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    conditions.push(
      or(
        ilike(receipts.merchant, pattern),
        ilike(receipts.category, pattern),
        ilike(receipts.receiptType, pattern),
        ilike(receipts.referenceNumber, pattern),
      )!,
    );
  }

  // Zeitraum auf dem BELEGDATUM, nicht auf created_at. Ein Beleg vom 31.12.
  // kann am 3.1. erfasst worden sein, und fuer die Buchhaltung zaehlt das
  // Belegdatum.
  if (filter.from) conditions.push(gte(receipts.receiptDate, filter.from));
  if (filter.to) conditions.push(lte(receipts.receiptDate, filter.to));
  if (filter.category) conditions.push(eq(receipts.category, filter.category));
  if (filter.minAmount) conditions.push(gte(receipts.totalAmount, filter.minAmount));
  if (filter.maxAmount) conditions.push(lte(receipts.totalAmount, filter.maxAmount));
  if (filter.unassigned) conditions.push(isNull(receipts.settlementId));

  return conditions;
}

/**
 * ORDER BY inklusive NULLS LAST.
 *
 * Ohne das stehen bei DESC die NULL-Werte oben (Postgres-Default ist DESC NULLS
 * FIRST) – eine Tabelle, die mit lauter leeren Datumszellen anfaengt, waehrend
 * die Daten darunter liegen. `id` als letztes Kriterium macht die Reihenfolge
 * eindeutig; sonst kann dieselbe Zeile bei zwei Seitenaufrufen auf zwei Seiten
 * landen.
 */
function buildOrderBy(filter: ListReceiptsFilter): SQL[] {
  const column = SORT_COLUMNS[filter.sort ?? 'receiptDate'];
  const direction = filter.dir === 'asc' ? 'asc' : 'desc';
  return [
    sql`${column} ${sql.raw(direction)} nulls last`,
    sql`${receipts.createdAt} ${sql.raw(direction)}`,
    sql`${receipts.id} ${sql.raw(direction)}`,
  ];
}

/**
 * SELECT mit Abrechnungstitel und -status.
 *
 * Der Join laeuft ueber (id, user_id), wie der Fremdschluessel. Ueber id allein
 * waere er heute genauso richtig – die Datenbank laesst nichts anderes zu –,
 * aber eine Query soll nicht davon abhaengen, dass ein Constraint existiert.
 */
function selectWithSettlement() {
  return db
    .select({
      ...getTableColumns(receipts),
      settlementTitle: settlements.title,
      settlementStatus: settlements.status,
    })
    .from(receipts)
    .leftJoin(
      settlements,
      and(eq(settlements.id, receipts.settlementId), eq(settlements.userId, receipts.userId)),
    );
}

async function selectPage(
  userId: string,
  filter: Partial<SearchReceiptsFilter>,
): Promise<ReceiptWithSettlement[]> {
  const limit = Math.min(Math.max(filter.limit ?? 10, 1), MAX_LIMIT);
  const offset = Math.max(filter.offset ?? 0, 0);

  return selectWithSettlement()
    .where(and(...buildConditions(userId, filter)))
    .orderBy(...buildOrderBy(filter))
    .limit(limit)
    .offset(offset);
}

/** Belege des Nutzers, neueste zuerst. Nutzt den (user_id, receipt_date DESC)-Index. */
export async function listReceipts(
  userId: string,
  filter: ListReceiptsFilter = {},
): Promise<ReceiptWithSettlement[]> {
  return selectPage(userId, filter);
}

/** Volltext-nahe Suche über Händler, Kategorie, Belegart und Referenznummer. */
export async function searchReceipts(
  userId: string,
  filter: SearchReceiptsFilter,
): Promise<ReceiptWithSettlement[]> {
  return selectPage(userId, filter);
}

/**
 * Trefferzahl unter denselben Filtern – ohne limit/offset.
 *
 * Getrennt von der Seite, weil die Oberflaeche beides braucht: die Zeilen
 * dieser Seite und die Gesamtzahl fuer Paginierung und Export-Aufschrift.
 */
export async function countReceipts(
  userId: string,
  filter: Partial<SearchReceiptsFilter> = {},
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(receipts)
    .where(and(...buildConditions(userId, filter)));

  return row?.count ?? 0;
}

/**
 * Anzahl und Summe je Waehrung, unter denselben Filtern.
 *
 * Getrennt nach Waehrung und nicht als eine Zahl: Betraege in CHF und EUR zu
 * addieren ergibt keinen Wert, sondern eine falsche Zahl. Ein Kurs steht
 * nirgends im System, und ihn hier zu erfinden waere die schlechteste Stelle
 * dafuer. Belege ohne Waehrung kommen als `currency: null` zurueck.
 *
 * Die Summe wird in Postgres gerechnet (`sum(numeric)`), nicht in JavaScript:
 * ein Aufaddieren von Strings ueber Number() verliert Rappen, sobald es viele
 * Zeilen sind.
 */
export async function summarizeReceipts(
  userId: string,
  filter: Partial<SearchReceiptsFilter> = {},
): Promise<{ currency: string | null; count: number; sum: string }[]> {
  const rows = await db
    .select({
      currency: receipts.currency,
      count: sql<number>`count(*)::int`,
      sum: sql<string>`coalesce(sum(${receipts.totalAmount}), 0)::text`,
    })
    .from(receipts)
    .where(and(...buildConditions(userId, filter)))
    .groupBy(receipts.currency)
    .orderBy(sql`count(*) desc`);

  return rows.map(row => ({ ...row, currency: row.currency?.trim() ?? null }));
}

/**
 * Die Kategorien, die dieser Nutzer tatsaechlich vergeben hat.
 *
 * Fuer das Filter-Dropdown: eine feste Liste im Frontend waere eine zweite
 * Wahrheit neben den Daten, und der Extraktions-Agent kategorisiert bewusst
 * nicht – die Werte kommen also ausschliesslich von Menschen.
 */
export async function listCategories(userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ category: receipts.category })
    .from(receipts)
    .where(and(eq(receipts.userId, userId), isNotNull(receipts.category)))
    .orderBy(receipts.category);

  return rows.map(row => row.category).filter((value): value is string => !!value);
}

/** Die Felder, die nachträglich korrigierbar sind. Datei-Referenz und Hash nicht. */
export type ReceiptPatch = Partial<
  Pick<
    ReceiptRow,
    | 'merchant'
    | 'receiptDate'
    | 'totalAmount'
    | 'currency'
    | 'vatAmount'
    | 'category'
    | 'receiptType'
    | 'paymentMethod'
  >
>;

/**
 * Korrektur an einem bereits gespeicherten Beleg.
 *
 * Das `eq(receipts.userId, userId)` im WHERE ist nicht optional: ohne es könnte
 * ein Nutzer über eine erratene id einen fremden Beleg ändern. Mit ihm trifft
 * die Query 0 Zeilen und die Funktion gibt null zurück.
 *
 * Ein Beleg in einer eingereichten Abrechnung trifft ebenfalls 0 Zeilen; die
 * Funktion unterscheidet das danach und wirft ReceiptLockedError, damit der
 * Aufrufer "gesperrt" und "gibt es nicht" auseinanderhalten kann.
 */
export async function updateReceipt(
  userId: string,
  receiptId: string,
  patch: ReceiptPatch,
): Promise<ReceiptWithSettlement | null> {
  const fields = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(fields).length === 0) return getReceipt(userId, receiptId);

  const [row] = await db
    .update(receipts)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId), receiptIsEditable()))
    .returning({ id: receipts.id });

  if (!row) {
    const existing = await getReceipt(userId, receiptId);
    if (existing) throw new ReceiptLockedError();
    return null;
  }
  return getReceipt(userId, receiptId);
}

export async function getReceipt(
  userId: string,
  receiptId: string,
): Promise<ReceiptWithSettlement | null> {
  const [row] = await selectWithSettlement()
    .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)))
    .limit(1);

  return row ?? null;
}

/* ---------- pending_reviews: nur der Zeiger Thread -> Run ---------- */

/**
 * Merkt sich, welcher suspendierte Run zu diesem Thread gehört.
 *
 * Ein Thread hat höchstens einen offenen Review. Kommt ein neuer Beleg herein,
 * während noch einer offen ist, ersetzt er ihn (ON CONFLICT) – der alte Run
 * bleibt suspendiert liegen und wird von der Retention aufgeräumt.
 */
export async function openPendingReview(review: {
  threadId: string;
  runId: string;
  userId: string;
  uploadId: string;
}): Promise<void> {
  await db
    .insert(pendingReviews)
    .values(review)
    .onConflictDoUpdate({
      target: pendingReviews.threadId,
      set: { runId: review.runId, userId: review.userId, uploadId: review.uploadId },
    });
}

export async function getPendingReview(threadId: string): Promise<PendingReviewRow | null> {
  const [row] = await db
    .select()
    .from(pendingReviews)
    .where(eq(pendingReviews.threadId, threadId))
    .limit(1);

  return row ?? null;
}

export async function closePendingReview(threadId: string): Promise<void> {
  await db.delete(pendingReviews).where(eq(pendingReviews.threadId, threadId));
}
