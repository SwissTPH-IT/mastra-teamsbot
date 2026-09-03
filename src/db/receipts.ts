// Repository für app.receipts und app.pending_reviews.
//
// Die Mandantentrennung sitzt hier, nicht in den Tools und schon gar nicht im
// Modell: JEDE Funktion nimmt `userId` als erstes Pflichtargument und hängt es
// an jedes WHERE. Es gibt bewusst keine Variante ohne – der Typ erzwingt sie.
// Eine fremde receiptId trifft dadurch 0 Zeilen statt einer fremden Zeile.

import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from './index';
import { pendingReviews, receipts, type PendingReviewRow, type ReceiptRow } from './schema';
import { computeConfidence, type ReceiptCandidate } from '../mastra/receipts/candidate';

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
 */
export async function saveReceipt(userId: string, input: SaveReceiptInput): Promise<ReceiptRow> {
  const values = toRowValues(input);

  const [row] = await db
    .insert(receipts)
    .values({ userId, fileHash: input.fileHash, ...values })
    .onConflictDoUpdate({
      target: [receipts.userId, receipts.fileHash],
      set: { ...values, updatedAt: sql`now()` },
    })
    .returning();

  return row;
}

export type ListReceiptsFilter = {
  limit?: number;
  from?: string;
  to?: string;
};

/** Belege des Nutzers, neueste zuerst. Nutzt den (user_id, receipt_date DESC)-Index. */
export async function listReceipts(
  userId: string,
  filter: ListReceiptsFilter = {},
): Promise<ReceiptRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 10, 1), 50);

  const conditions = [eq(receipts.userId, userId)];
  if (filter.from) conditions.push(gte(receipts.receiptDate, filter.from));
  if (filter.to) conditions.push(lte(receipts.receiptDate, filter.to));

  return db
    .select()
    .from(receipts)
    .where(and(...conditions))
    .orderBy(desc(receipts.receiptDate), desc(receipts.createdAt))
    .limit(limit);
}

export type SearchReceiptsFilter = ListReceiptsFilter & {
  query: string;
  minAmount?: string;
  maxAmount?: string;
};

/** Volltext-nahe Suche über Händler, Kategorie, Belegart und Referenznummer. */
export async function searchReceipts(
  userId: string,
  filter: SearchReceiptsFilter,
): Promise<ReceiptRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 10, 1), 50);
  const pattern = `%${filter.query}%`;

  const conditions = [
    eq(receipts.userId, userId),
    or(
      ilike(receipts.merchant, pattern),
      ilike(receipts.category, pattern),
      ilike(receipts.receiptType, pattern),
      ilike(receipts.referenceNumber, pattern),
    )!,
  ];
  if (filter.from) conditions.push(gte(receipts.receiptDate, filter.from));
  if (filter.to) conditions.push(lte(receipts.receiptDate, filter.to));
  if (filter.minAmount) conditions.push(gte(receipts.totalAmount, filter.minAmount));
  if (filter.maxAmount) conditions.push(lte(receipts.totalAmount, filter.maxAmount));

  return db
    .select()
    .from(receipts)
    .where(and(...conditions))
    .orderBy(desc(receipts.receiptDate), desc(receipts.createdAt))
    .limit(limit);
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
 */
export async function updateReceipt(
  userId: string,
  receiptId: string,
  patch: ReceiptPatch,
): Promise<ReceiptRow | null> {
  const fields = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (Object.keys(fields).length === 0) return getReceipt(userId, receiptId);

  const [row] = await db
    .update(receipts)
    .set({ ...fields, updatedAt: sql`now()` })
    .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)))
    .returning();

  return row ?? null;
}

export async function getReceipt(userId: string, receiptId: string): Promise<ReceiptRow | null> {
  const [row] = await db
    .select()
    .from(receipts)
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
