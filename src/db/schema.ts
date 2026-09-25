// Fachdaten-Schema. Liegt vollständig im Postgres-Schema "app".
//
// Getrennt von "mastra" (dort legt PostgresStore seine mastra_*-Tabellen an),
// damit ein Drizzle-Diff die Mastra-Tabellen nie sieht und nie ein DROP dafür
// vorschlägt. Der Scope wird zusätzlich in drizzle.config.ts über
// `schemaFilter: ['app']` festgenagelt.

import {
  char,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const appSchema = pgSchema('app');

/**
 * Die Zustände einer Abrechnung, die es heute gibt.
 *
 * Die Vorlage kennt vier (Draft, Submitted, Approved, Query). Approved und
 * Query setzen eine Prüfung durch Finance voraus, und diese Rolle gibt es im
 * System nicht. Ein Status, den niemand setzen kann, wäre nur eine weitere
 * Zeile im CHECK – er kommt dazu, wenn es jemanden gibt, der ihn setzt.
 */
export const SETTLEMENT_STATUSES = ['draft', 'submitted'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/**
 * Eine Abrechnung: ein Bündel Belege, das als Ganzes eingereicht wird.
 *
 * Bewusst schmal. Zeitraum, Anzahl und Summen stehen NICHT hier, sie werden
 * aus den zugeordneten Belegen gerechnet – eine gespeicherte Summe wäre eine
 * zweite Wahrheit, die bei jeder Zuordnung und jeder Korrektur mitgezogen
 * werden müsste und irgendwann nicht mehr stimmt.
 */
export const settlements = appSchema.table(
  'settlements',
  {
    id: text('id')
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),

    /** Dieselbe Teams-userId wie in receipts.user_id. */
    userId: text('user_id').notNull(),

    title: text('title').notNull(),
    status: text('status').$type<SettlementStatus>().notNull().default('draft'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // Ziel des zusammengesetzten Fremdschlüssels in receipts. `id` allein ist
    // schon eindeutig, das Paar muss es für Postgres trotzdem ausdrücklich
    // sein, sonst darf kein FK darauf zeigen.
    unique('settlements_id_user_key').on(table.id, table.userId),
    index('settlements_user_created_idx').on(table.userId, table.createdAt.desc()),
    check(
      'settlements_status_check',
      sql`${table.status} in ('draft', 'submitted')`,
    ),
    // Eingereicht heisst: mit Zeitpunkt. Ohne diese Kopplung gibt es
    // "submitted" ohne Datum, und die Oberfläche müsste raten.
    check(
      'settlements_submitted_at_check',
      sql`(${table.status} = 'submitted') = (${table.submittedAt} is not null)`,
    ),
  ],
);

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

    /**
     * Die Abrechnung, in der der Beleg liegt. NULL heisst "unassigned".
     *
     * Ein Beleg liegt in höchstens einer Abrechnung, deshalb eine Spalte und
     * keine Zwischentabelle. Der Fremdschlüssel unten läuft ueber
     * (settlement_id, user_id) und nicht ueber settlement_id allein: nur so
     * kann ein Beleg von A nicht in einer Abrechnung von B landen. Das ist
     * damit eine Eigenschaft der Datenbank und keine Regel, die jede Query
     * einhalten muss.
     */
    settlementId: text('settlement_id'),

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
    index('receipts_user_settlement_idx').on(table.userId, table.settlementId),
    // Kein ON DELETE: eine Abrechnung mit Belegen lässt sich nicht löschen.
    // SET NULL ginge hier nicht – es würde auch user_id auf NULL setzen
    // wollen. deleteSettlement() hebt die Zuordnung deshalb vorher in
    // derselben Transaktion auf.
    foreignKey({
      name: 'receipts_settlement_fk',
      columns: [table.settlementId, table.userId],
      foreignColumns: [settlements.id, settlements.userId],
    }),
  ],
);

/**
 * Die Identität hinter einer Teams-userId.
 *
 * `teams_user_id` ist dieselbe ID wie `receipts.user_id` – sie kommt aus dem
 * signierten Bot-Framework-Payload. `aad_object_id` ist die Entra-Identität
 * desselben Menschen und damit die Brücke zu einem späteren Browser-Login:
 * ein Token liefert `oid`, die Belege hängen an der Teams-ID, und ohne diese
 * Tabelle gibt es zwischen beiden keine Verbindung.
 *
 * Beides steht ausschliesslich in der eingehenden Teams-Activity. Wird es dort
 * nicht mitgenommen, ist es nachträglich nicht rekonstruierbar – deshalb
 * schreibt der Teams-Handler bei JEDER Nachricht hierher, nicht erst bei einem
 * Beleg.
 */
export const users = appSchema.table(
  'users',
  {
    teamsUserId: text('teams_user_id').primaryKey(),

    /** Entra Object ID (`oid`). NULL, solange Teams sie nicht mitliefert. */
    aadObjectId: text('aad_object_id'),
    tenantId: text('tenant_id'),
    displayName: text('display_name'),

    /**
     * Was eine proaktive Nachricht braucht: conversationId, serviceUrl,
     * channelId und der Bot selbst. Eine Erinnerung ist keine Antwort auf eine
     * eingehende Activity – ohne diese Referenz gibt es keinen Adressaten.
     */
    conversationRef: jsonb('conversation_ref'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    // Eine Entra-Identität gehört zu genau einer Teams-ID. Mehrere NULL sind
    // in Postgres erlaubt, unbekannte Identitäten kollidieren also nicht.
    uniqueIndex('users_aad_object_id_key').on(table.aadObjectId),
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

export type UserRow = typeof users.$inferSelect;
export type SettlementRow = typeof settlements.$inferSelect;
export type ReceiptRow = typeof receipts.$inferSelect;
export type NewReceiptRow = typeof receipts.$inferInsert;
export type PendingReviewRow = typeof pendingReviews.$inferSelect;
