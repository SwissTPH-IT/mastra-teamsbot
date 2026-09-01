// Zwei HTTP-Endpunkte, die das Frontend braucht und die der Chat-Stream nicht
// abdeckt: Datei hinein, Datei wieder heraus.
//
//   POST /receipts/upload          multipart "file" -> { uploadId, ... }
//   GET  /receipts/:uploadId/file  liefert das Bild für die Vorschau
//
// Ohne /api-Prefix: den reserviert Mastra für seine eingebauten Routen.

import { registerApiRoute } from '@mastra/core/server';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  ALLOWED_UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
  resolveUploadPath,
  storeUpload,
} from '../receipts/upload-store';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export const uploadReceiptRoute = registerApiRoute('/receipts/upload', {
  method: 'POST',
  openapi: {
    summary: 'Belegbild hochladen',
    description:
      'Nimmt ein einzelnes Bild als multipart/form-data (Feld "file") an, legt es im ' +
      'Datenverzeichnis ab und gibt die uploadId zurück, mit der das Extraktions-Tool ' +
      'den Workflow starten kann.',
    tags: ['receipts'],
    responses: {
      '200': { description: 'Upload gespeichert' },
      '400': { description: 'Kein oder ungültiges File-Feld' },
    },
  },
  handler: async c => {
    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      return c.json({ error: 'Request ist kein gültiges multipart/form-data.' }, 400);
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: 'Feld "file" fehlt oder ist keine Datei.' }, 400);
    }

    try {
      const stored = await storeUpload(file);
      c.get('mastra')
        ?.getLogger()
        ?.info(`[receipts] Upload gespeichert: ${stored.uploadId} (${stored.filename})`);
      return c.json(stored);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : 'Upload fehlgeschlagen.',
          allowedTypes: Object.keys(ALLOWED_UPLOAD_TYPES),
          maxBytes: MAX_UPLOAD_BYTES,
        },
        400,
      );
    }
  },
});

export const receiptFileRoute = registerApiRoute('/receipts/:uploadId/file', {
  method: 'GET',
  openapi: {
    summary: 'Hochgeladenes Belegbild ausliefern',
    tags: ['receipts'],
    responses: {
      '200': { description: 'Bilddaten' },
      '404': { description: 'Unbekannte uploadId' },
    },
  },
  handler: async c => {
    const uploadId = c.req.param('uploadId');

    let path: string;
    try {
      path = resolveUploadPath(uploadId);
    } catch {
      return c.json({ error: 'Ungültige uploadId.' }, 400);
    }

    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return c.json({ error: 'Upload nicht gefunden.' }, 404);
    }

    const ext = uploadId.slice(uploadId.lastIndexOf('.') + 1);
    // Readable.toWeb, weil Hono für den Body einen Web-Stream erwartet.
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream;

    return c.body(body, 200, {
      'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
      'Content-Length': String(size),
      'Cache-Control': 'private, max-age=3600',
    });
  },
});

export const receiptRoutes = [uploadReceiptRoute, receiptFileRoute];
