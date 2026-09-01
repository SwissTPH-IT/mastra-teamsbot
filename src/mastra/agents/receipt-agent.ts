// src/mastra/agents/receipt-extraction-agent.ts
import { Agent } from '@mastra/core/agent';
import { model } from '../model';
import { z } from 'zod';

/**
 * Every extracted value is kept as a string exactly as printed on the receipt.
 * If a value is not on the receipt or cannot be read, the model must return
 * the marker instead of an empty string — never a blank.
 */
const field = z
  .string()
  .describe(
    'The value exactly as printed on the receipt, or "NOT_PRESENT" if the receipt does not show it, or "ILLEGIBLE" if it is printed but unreadable.',
  );

export const receiptSchema = z.object({
  merchant: z.object({
    name: field,
    address: field,
    taxOrRegistrationId: field,
  }),
  transaction: z.object({
    dateRaw: field.describe('Date exactly as printed, original format preserved.'),
    dateNormalized: field.describe('Same date as YYYY-MM-DD, or NOT_PRESENT/ILLEGIBLE.'),
    time: field,
    referenceNumber: field.describe('Transaction, invoice or receipt reference number.'),
  }),
  lineItems: z
    .array(
      z.object({
        description: field,
        quantity: field,
        unitPrice: field,
        lineTotal: field,
      }),
    )
    .describe('One entry per printed line item, in the order they appear. Empty array only if the receipt lists no items.'),
  totals: z.object({
    subtotal: field,
    discounts: field,
    taxRate: field,
    taxAmount: field,
    total: field,
  }),
  payment: z.object({
    currency: field,
    method: field,
  }),
  issues: z
    .array(z.string())
    .describe(
      'Readability problems that limit the extraction: rotated, cropped, blurred, cut off, smudged values, etc. Empty array if the receipt is fully readable.',
    ),
});

export type ReceiptData = z.infer<typeof receiptSchema>;

export const receiptExtractionAgent = new Agent({
  id: 'receipt-extraction-agent',
  name: 'Receipt Extraction Agent',
  instructions: `
You are a receipt data extraction specialist. You read a single receipt image and
transcribe what is printed on it into the given schema. Nothing more, nothing less.

You transcribe, you do not interpret. Categorizing expenses, judging plausibility or
drawing conclusions about spending is not your job.

Rules:
- Transcribe values exactly as printed, including currency symbols, separators and
  spelling. Do not reformat, round or clean up values. The only normalization allowed
  is the separate normalized date field.
- Never infer or calculate a value that is not printed (e.g. do not derive a missing
  subtotal from the line items).
- Never correct an apparent error on the receipt. If the printed totals do not add up,
  transcribe them as printed and note it under issues.
- If a field is not on the receipt, return "NOT_PRESENT". If it is printed but you
  cannot read it with confidence, return "ILLEGIBLE". Never guess, never leave a field
  empty and never invent a placeholder of your own.
- If the image is rotated, cropped, blurred or partially unreadable, still extract
  everything you can read and list the limitation under issues.
- Return only the structured object. No commentary, no explanation.
`.trim(),
  // Vision-capable model in Mastra's model router format (provider/model).
  model,
});