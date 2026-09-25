// Der Satz DB-Tools für den Agenten. Klein, eng typisiert, kein generisches SQL.
//
// Seit dem API-Dienst greifen die Tools NICHT mehr selbst auf die Datenbank zu,
// sondern rufen api/ über HTTP. Der Unterschied ist nicht Geschmack: vorher war
// der volle Drizzle-Client eine Funktion entfernt, jetzt kann der Agent
// ausschliesslich, was der Dienst als Endpunkt anbietet – und jeder Zugriff
// steht dort im Log, mit Actor und Subject getrennt.
//
// Zwei Dinge liegen weiterhin nicht in der Entscheidungshoheit des Modells:
//
// 1. Mandantentrennung. In keinem inputSchema steht eine userId. Sie kommt über
//    requireUserId() aus dem RequestContext und geht als X-Subject-User an die
//    API, die sie an jedes WHERE hängt. Ein Nutzer kann keine fremden Belege
//    lesen oder ändern, auch nicht, wenn er den Agenten explizit darum bittet.
// 2. Idempotenz. create-receipt läuft als Upsert gegen (user_id, file_hash),
//    nicht als blindes Insert – das entscheidet die API, nicht der Aufrufer.

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { receiptApi, type ApiReceipt } from '../api-client';
import { candidateSchema } from '../receipts/candidate';
import { requireUserId } from './tool-context';

/**
 * Was der Agent von einer Belegzeile zu sehen bekommt.
 *
 * Bewusst enger als die Antwort der API: rawExtraction gibt es dort ohnehin
 * nicht mehr, und die Detailfelder (Zwischensumme, Steuersatz, Dateireferenz)
 * braucht das Modell für seine Antworten nicht. Was das Modell sieht,
 * entscheidet dieses Tool – was der Dienst herausgibt, entscheidet der Dienst.
 */
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

function toView(receipt: ApiReceipt) {
  return {
    id: receipt.id,
    merchant: receipt.merchant,
    receiptDate: receipt.receiptDate,
    totalAmount: receipt.totalAmount,
    currency: receipt.currency,
    vatAmount: receipt.vatAmount,
    category: receipt.category,
    receiptType: receipt.receiptType,
    paymentMethod: receipt.paymentMethod,
    confidence: receipt.confidence,
    issues: receipt.issues,
    createdAt: receipt.createdAt,
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

    const receipt = await receiptApi.create({
      userId,
      candidate,
      fileHash,
      fileReference,
      // Ein diktierter Beleg hat keinen Modell-Output aus der Extraktion; dann
      // ist der Kandidat selbst das Rohmaterial, wie vorher.
      rawExtraction: candidate,
    });

    return { receipt: toView(receipt) };
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
    const result = await receiptApi.list({ userId, limit, from, to });
    return { receipts: result.receipts.map(toView), count: result.count };
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
  execute: async ({ query, ...filter }, context) => {
    const userId = requireUserId(context);
    // Dieselbe Route wie list-receipts: mit `q` sucht die API, ohne listet sie.
    const result = await receiptApi.list({ userId, q: query, ...filter });
    return { receipts: result.receipts.map(toView), count: result.count };
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

    // Ein Beleg, der nicht existiert, und einer, der jemand anderem gehört,
    // sind hier ununterscheidbar: die API antwortet in beiden Fällen mit 404.
    // Das ist Absicht – eine geratene id darf nicht verraten, dass sie
    // existiert.
    const receipt = await receiptApi.update(userId, receiptId, patch);

    return {
      receipt: receipt ? toView(receipt) : null,
      updated: receipt !== null,
      message: receipt ? 'Beleg aktualisiert.' : `Kein Beleg mit der ID ${receiptId} gefunden.`,
    };
  },
});

export const receiptDbTools = {
  createReceipt: createReceiptTool,
  listReceipts: listReceiptsTool,
  searchReceipts: searchReceiptsTool,
  updateReceipt: updateReceiptTool,
};
