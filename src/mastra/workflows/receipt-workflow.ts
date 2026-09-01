// src/mastra/workflows/receipt-workflow.ts
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { receiptSchema } from '../agents/receipt-agent';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

/**
 * Step 1 — Load: read the receipt file from disk and turn it into a data URL.
 * Deterministic I/O, no LLM involved.
 */
const loadReceipt = createStep({
  id: 'load-receipt',
  inputSchema: z.object({
    receiptPath: z.string(),
    receiptJsonPath: z.string(),
  }),
  outputSchema: z.object({
    dataUrl: z.string(),
    mimeType: z.string(),
    receiptPath: z.string(),
    receiptJsonPath: z.string(),
  }),
  execute: async ({ inputData }) => {
    const { receiptPath, receiptJsonPath } = inputData;
    const ext = extname(receiptPath).toLowerCase();
    const mimeType = MIME_BY_EXT[ext];

    if (!mimeType) {
      throw new Error(`Unsupported receipt file type: ${ext || '(no extension)'}`);
    }

    const base64 = (await readFile(receiptPath)).toString('base64');

    return {
      dataUrl: `data:${mimeType};base64,${base64}`,
      mimeType,
      receiptPath,
      receiptJsonPath,
    };
  },
});

/**
 * Step 2 — Extract: hand the image to the agent and get back a validated object.
 * The agent is called from execute() (not composed via .agent()) because the input
 * is an image message, not a plain prompt string.
 */
const extractReceipt = createStep({
  id: 'extract-receipt',
  inputSchema: loadReceipt.outputSchema,
  outputSchema: z.object({
    receipt: receiptSchema,
    receiptJsonPath: z.string(),
    receiptPath: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const { dataUrl, mimeType, receiptPath, receiptJsonPath } = inputData;
    const agent = mastra.getAgentById('receipt-extraction-agent');

    const response = await agent.generate(
      [
        {
          role: 'user',
          content: [
            { type: 'image', image: dataUrl, mimeType },
            { type: 'text', text: 'Extract this receipt into the given schema.' },
          ],
        },
      ],
      { structuredOutput: { schema: receiptSchema } },
    );

    if (!response.object) {
      throw new Error('Receipt extraction returned no structured output.');
    }

    return { receipt: response.object, receiptJsonPath, receiptPath };
  },
});

/**
 * Step 3 — Persist: write the JSON file. This is the deliverable.
 */
const writeReceiptJson = createStep({
  id: 'write-receipt-json',
  inputSchema: extractReceipt.outputSchema,
  outputSchema: z.object({
    receiptJsonPath: z.string(),
    receipt: receiptSchema,
    issues: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    const { receipt, receiptJsonPath, receiptPath } = inputData;

    const payload = {
      source: receiptPath,
      extractedAt: new Date().toISOString(),
      ...receipt,
    };

    await mkdir(dirname(receiptJsonPath), { recursive: true });
    await writeFile(receiptJsonPath, JSON.stringify(payload, null, 2), 'utf-8');

    return { receiptJsonPath, receipt, issues: receipt.issues };
  },
});

export const receiptWorkflow = createWorkflow({
  id: 'receipt-workflow',
  inputSchema: z.object({
    receiptPath: z.string().describe('Absolute path to the receipt image.'),
    receiptJsonPath: z.string().describe('Absolute path where the JSON result is written.'),
  }),
  outputSchema: z.object({
    receiptJsonPath: z.string(),
    receipt: receiptSchema,
    issues: z.array(z.string()),
  }),
})
  .then(loadReceipt)
  .then(extractReceipt)
  .then(writeReceiptJson)
  .commit();