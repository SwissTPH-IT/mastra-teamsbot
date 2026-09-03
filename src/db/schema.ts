// Fachdaten-Schema. Liegt vollständig im Postgres-Schema "app".
//
// Getrennt von "mastra" (dort legt PostgresStore seine mastra_*-Tabellen an),
// damit ein Drizzle-Diff die Mastra-Tabellen nie sieht und nie ein DROP dafür
// vorschlägt. Der Scope wird zusätzlich in drizzle.config.ts über
// `schemaFilter: ['app']` festgenagelt.

import {
  char,
  date,
  index,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const appSchema = pgSchema('app');

/**
 * Ein bestätigter Beleg.
 *
 * Die typisierten Spalten sind eine geparste Projektion des Extraktions-Outputs
 * (`receiptSchema` in src/mastra/agents/receipt-agent.ts). Dort ist JEDER Wert
 * ein String, inklusive der Marker "NOT_PRESENT" und "ILLEGIBLE". Was sich nicht
 * als Zahl/Datum lesen lässt, wird hier NULL – der Originalwert bleibt im
 * unveränderten `rawExtraction` erhalten und ist damit nachvollziehbar.
 */
export const receipts = appSchema.table(
  'receipts',
  {
    id: text('id')
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),

    /**
     * Der Teams-Nutzer, dem der Beleg gehört. Kommt aus `message.author.userId`
     * im signierten Bot-Framework-Payload und wird serverseitig gesetzt – nie
     * vom Modell. Siehe requireUserId() in src/mastra/tools/tool-context.ts.
     */
    userId: text('user_id').notNull(),

    /** sha256 der Originaldatei. Zusammen mit userId der Idempotenz-Key. */
    fileHash: text('file_hash').notNull(),

    /**
     * Referenz auf die Originaldatei, NICHT die Datei selbst.
     * Format "<schema>:<pfad>", aktuell nur "local:uploads/<uploadId>".
     * Ein Objektspeicher existiert noch nicht – siehe README, Abschnitt
     * "Offene Lücke: Objektspeicher".
     */
    fileReference: text('file_reference').notNull(),

    merchant: text('merchant'),
    merchantAddress: text('merchant_address'),
    merchantTaxId: text('merchant_tax_id'),

    /** Belegdatum aus transaction.dateNormalized. Bewusst getrennt von createdAt. */
    receiptDate: date('receipt_date'),
    receiptTime: text('receipt_time'),
    referenceNumber: text('reference_number'),

    // Beträge als numeric mit fester Skalierung. Kein float/double: Rundungs-
    // fehler in Geldbeträgen sind später nicht mehr rekonstruierbar.
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }),
    subtotalAmount: numeric('subtotal_amount', { precision: 14, scale: 2 }),
    discountAmount: numeric('discount_amount', { precision: 14, scale: 2 }),
    vatAmount: numeric('vat_amount', { precision: 14, scale: 2 }),
    vatRate: numeric('vat_rate', { precision: 6, scale: 3 }),

    /** ISO-4217, eigene Spalte statt im Betrag mitgeschleppt. NULL wenn unklar. */
    currency: char('currency', { length: 3 }),
    paymentMethod: text('payment_method'),

    /**
     * Beide bleiben leer, bis ein Nutzer sie setzt. Der Extraktions-Agent
     * kategorisiert bewusst nicht ("Categorizing expenses ... is not your job"),
     * und wir erfinden hier nichts.
     */
    receiptType: text('receipt_type'),
    category: text('category'),

    lineItems: jsonb('line_items').notNull().default(sql`'[]'::jsonb`),
    issues: jsonb('issues').notNull().default(sql`'[]'::jsonb`),

    /** Der Agent-Output 1:1, inklusive aller NOT_PRESENT/ILLEGIBLE-Marker. */
    rawExtraction: jsonb('raw_extraction').notNull(),

    /** Deterministisch berechnet, kein Modellwert. Siehe computeConfidence(). */
    confidence: numeric('confidence', { precision: 3, scale: 2 }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // Idempotenz: derselbe Beleg desselben Nutzers gibt es genau einmal.
    // Ein doppelter Upload oder ein wiederholter Tool-Call trifft per
    // ON CONFLICT dieselbe Zeile statt eine zweite anzulegen.
    uniqueIndex('receipts_user_file_hash_key').on(table.userId, table.fileHash),
    index('receipts_user_date_idx').on(table.userId, table.receiptDate.desc()),
    index('receipts_user_created_idx').on(table.userId, table.createdAt.desc()),
  ],
);

/**
 * Zeiger von einem Teams-Thread auf den suspendierten Workflow-Run.
 *
 * Bewusst NUR ein Zeiger: der Kandidatensatz liegt im Workflow-State und damit
 * im von Mastra verwalteten `mastra_workflow_snapshot`. Hier steht nichts, was
 * für die Korrektheit der Buchung gebraucht wird – nur, welcher Run zu welchem
 * Thread gehört, damit die Antwort des Nutzers das richtige `run.resume()`
 * trifft. Diese Zuordnung muss einen Deploy überleben, deshalb eine Tabelle
 * und keine Map im Prozessspeicher.
 */
export const pendingReviews = appSchema.table('pending_reviews', {
  threadId: text('thread_id').primaryKey(),
  runId: text('run_id').notNull(),
  userId: text('user_id').notNull(),
  uploadId: text('upload_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ReceiptRow = typeof receipts.$inferSelect;
export type NewReceiptRow = typeof receipts.$inferInsert;
export type PendingReviewRow = typeof pendingReviews.$inferSelect;
