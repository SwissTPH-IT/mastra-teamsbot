// Ablage der vom Frontend hochgeladenen Belege.
//
// Das Frontend lädt jede Datei zuerst hoch (POST /api/receipts/upload) und
// erhält eine `uploadId` zurück. Nur diese ID reist danach durch den Chat –
// nie das Bild selbst. Der Workflow bekommt also weiterhin einen Dateipfad,
// genau wie beim Aufruf aus dem Studio.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.RECEIPT_DATA_DIR || '/app/data';

export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
export const RECEIPT_JSON_DIR = join(DATA_DIR, 'receipts');

/** Nur Formate, die ein Vision-Modell tatsächlich als Bild lesen kann. */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Eine uploadId ist "<uuid><ext>" – die Endung steckt mit drin, damit der Pfad
 * ohne zusätzlichen Lookup auflösbar ist. Das Muster ist absichtlich streng:
 * es ist gleichzeitig der Schutz gegen Path Traversal, weil `/`, `.` und `..`
 * gar nicht matchen können.
 */
const UPLOAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif)$/;

export function isValidUploadId(uploadId: string): boolean {
  return UPLOAD_ID_PATTERN.test(uploadId);
}

/** Wirft, wenn die ID nicht dem Muster entspricht. Sonst: absoluter Pfad. */
export function resolveUploadPath(uploadId: string): string {
  if (!isValidUploadId(uploadId)) {
    throw new Error(`Ungültige uploadId: ${uploadId}`);
  }
  return join(UPLOAD_DIR, uploadId);
}

/** Pfad der JSON-Datei, die der Workflow für diesen Upload schreibt. */
export function resolveReceiptJsonPath(uploadId: string): string {
  if (!isValidUploadId(uploadId)) {
    throw new Error(`Ungültige uploadId: ${uploadId}`);
  }
  const base = uploadId.slice(0, uploadId.lastIndexOf('.'));
  return join(RECEIPT_JSON_DIR, `${base}.json`);
}

export type StoredUpload = {
  uploadId: string;
  filename: string;
  mimeType: string;
  size: number;
};

/** Schreibt die Datei nach UPLOAD_DIR und gibt ihre uploadId zurück. */
export async function storeUpload(file: File): Promise<StoredUpload> {
  const ext = ALLOWED_UPLOAD_TYPES[file.type];
  if (!ext) {
    throw new Error(
      `Nicht unterstützter Dateityp "${file.type || 'unbekannt'}". Erlaubt: ${Object.keys(
        ALLOWED_UPLOAD_TYPES,
      ).join(', ')}`,
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Datei ist ${(file.size / 1024 / 1024).toFixed(1)} MB groß, erlaubt sind maximal ${
        MAX_UPLOAD_BYTES / 1024 / 1024
      } MB.`,
    );
  }

  const uploadId = `${randomUUID()}${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, uploadId), Buffer.from(await file.arrayBuffer()));

  return {
    uploadId,
    filename: file.name || uploadId,
    mimeType: file.type,
    size: file.size,
  };
}
