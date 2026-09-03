// Der Satz DB-Tools für den Agenten. Klein, eng typisiert, kein generisches SQL.
//
// Zwei Dinge liegen bewusst NICHT in der Entscheidungshoheit des Modells:
//
// 1. Mandantentrennung. In keinem inputSchema steht eine userId. Sie kommt über
//    requireUserId() aus dem RequestContext und geht als erstes Argument in jede
//    Repository-Funktion, die sie an jedes WHERE hängt. Ein Nutzer kann keine
//    fremden Belege lesen oder ändern, auch nicht, wenn er den Agenten explizit
//    darum bittet.
// 2. Idempotenz. createReceipt läuft als Upsert gegen (user_id, file_hash),
//    nicht als blindes Insert.
//
// Fachdaten laufen über Drizzle (src/db/receipts.ts), nicht über store.db /
// store.pool – Direktzugriff auf den Store ist laut Referenz eine Umgehung der
// Storage-Logik für Low-Level-Sonderfälle.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  getReceipt,
  listReceipts,
  saveReceipt,
  searchReceipts,
  updateReceipt,
  type ReceiptPatch,
} from '../../db/receipts';
import type { ReceiptRow } from '../../db/schema';
import { candidateSchema } from '../receipts/candidate';
import { requireUserId } from './tool-context';

/** Was der Agent von einer Belegzeile zu sehen bekommt. Ohne rawExtraction – zu gross. */
const receiptViewSchema = z.object({
  id: z.string(),
  merchant: z.string().nullable(),
  receiptDate: z.string().nullable(),
  totalAmount: z.string().nullable(),
  currency: z.string().nullable(),
  vatAmount: z.string().nullable(),
  category: z.string().nullable(),
  receiptType: z.string().nullable(),
  paymentMethod: z.string().nullable(),
  confidence: z.string().nullable(),
  issues: z.array(z.string()),
  createdAt: z.string(),
});

function toView(row: ReceiptRow) {
  return {
    id: row.id,
    merchant: row.merchant,
    receiptDate: row.receiptDate,
    totalAmount: row.totalAmount,
    currency: row.currency?.trim() ?? null,
    vatAmount: row.vatAmount,
    category: row.category,
    receiptType: row.receiptType,
    paymentMethod: row.paymentMethod,
    confidence: row.confidence,
    issues: Array.isArray(row.issues) ? (row.issues as string[]) : [],
    createdAt: row.createdAt.toISOString(),
  };
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als YYYY-MM-DD.')
  .optional();

export const createReceiptTool = createTool({
  id: 'create-receipt',
  description:
    'Speichert einen bestätigten Beleg in der Datenbank. Nur benutzen, wenn der Nutzer die ' +
    'Werte ausdrücklich bestätigt hat. Belege aus einem Bildanhang laufen NICHT hierüber – ' +
    'die gehen automatisch durch den Review-Workflow.',
  inputSchema: z.object({
    candidate: candidateSchema.describe('Die bestätigten Belegdaten.'),
    fileHash: z
      .string()
      .min(8)
      .describe('sha256 der Originaldatei. Bestimmt, ob ein Beleg neu ist oder aktualisiert wird.'),
    fileReference: z.string().describe('Referenz auf die Originaldatei, z. B. "local:uploads/<id>".'),
  }),
  outputSchema: z.object({
    receipt: receiptViewSchema,
  }),
  execute: async ({ candidate, fileHash, fileReference }, context) => {
    const userId = requireUserId(context);

    const row = await saveReceipt(userId, {
      candidate,
      fileHash,
      fileReference,
      rawExtraction: candidate,
    });

    return { receipt: toView(row) };
  },
});

export const listReceiptsTool = createTool({
  id: 'list-receipts',
  description:
    'Listet die zuletzt erfassten Belege des Nutzers, neueste zuerst. Für Fragen wie ' +
    '"was habe ich diesen Monat erfasst?".',
  inputSchema: z.object({
    limit: z.number().int().min(1).max(50).optional().describe('Anzahl Belege, Default 10.'),
    from: isoDate.describe('Frühestes Belegdatum, einschliesslich.'),
    to: isoDate.describe('Spätestes Belegdatum, einschliesslich.'),
  }),
  outputSchema: z.object({
    receipts: z.array(receiptViewSchema),
    count: z.number(),
  }),
  execute: async ({ limit, from, to }, context) => {
    const userId = requireUserId(context);
    const rows = await listReceipts(userId, { limit, from, to });
    return { receipts: rows.map(toView), count: rows.length };
  },
});

export const searchReceiptsTool = createTool({
  id: 'search-receipts',
  description:
    'Sucht in den Belegen des Nutzers nach Händler, Kategorie, Belegart oder Referenznummer, ' +
    'optional eingegrenzt auf Zeitraum und Betragsspanne.',
  inputSchema: z.object({
    query: z.string().min(1).describe('Suchbegriff, z. B. "Migros".'),
    limit: z.number().int().min(1).max(50).optional(),
    from: isoDate,
    to: isoDate,
    minAmount: z.string().optional().describe('Mindestbetrag als Dezimalstring, z. B. "20.00".'),
    maxAmount: z.string().optional().describe('Höchstbetrag als Dezimalstring.'),
  }),
  outputSchema: z.object({
    receipts: z.array(receiptViewSchema),
    count: z.number(),
  }),
  execute: async (input, context) => {
    const userId = requireUserId(context);
    const rows = await searchReceipts(userId, input);
    return { receipts: rows.map(toView), count: rows.length };
  },
});

export const updateReceiptTool = createTool({
  id: 'update-receipt',
  description:
    'Korrigiert einzelne Felder eines bereits gespeicherten Belegs. Die receiptId stammt aus ' +
    'list-receipts oder search-receipts. Nur die genannten Felder werden geändert.',
  inputSchema: z.object({
    receiptId: z.string().min(1),
    merchant: z.string().optional(),
    receiptDate: isoDate,
    totalAmount: z.string().optional().describe('Dezimalstring ohne Währungszeichen, z. B. "42.10".'),
    currency: z.string().length(3).optional().describe('ISO-4217, z. B. "CHF".'),
    vatAmount: z.string().optional(),
    category: z.string().optional(),
    receiptType: z.string().optional(),
    paymentMethod: z.string().optional(),
  }),
  outputSchema: z.object({
    receipt: receiptViewSchema.nullable(),
    updated: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ receiptId, ...patch }, context) => {
    const userId = requireUserId(context);

    // Existiert der Beleg nicht ODER gehört er jemand anderem, kommt hier null
    // zurück – für den Nutzer ununterscheidbar, und das ist Absicht.
    const existing = await getReceipt(userId, receiptId);
    if (!existing) {
      return {
        receipt: null,
        updated: false,
        message: `Kein Beleg mit der ID ${receiptId} gefunden.`,
      };
    }

    const row = await updateReceipt(userId, receiptId, patch as ReceiptPatch);

    return {
      receipt: row ? toView(row) : null,
      updated: row !== null,
      message: row ? 'Beleg aktualisiert.' : `Kein Beleg mit der ID ${receiptId} gefunden.`,
    };
  },
});

export const receiptDbTools = {
  createReceipt: createReceiptTool,
  listReceipts: listReceiptsTool,
  searchReceipts: searchReceiptsTool,
  updateReceipt: updateReceiptTool,
};
