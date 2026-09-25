// Ablage der Belegdateien.
//
// Jeder Eingang (Teams-Anhang, POST /receipts/upload) legt die Datei hier ab
// und erhält eine `uploadId` zurück. Nur diese ID reist danach weiter – nie die
// Datei selbst. Der Workflow bekommt also einen Dateipfad, genau wie beim
// Aufruf aus dem Studio.
//
// Abgelegt wird die normalisierte Fassung (siehe file-format.ts): ein HEIC
// liegt hier als JPEG, damit Extraktion, Bildvorschau und jeder spätere Leser
// nur die fünf Formate aus STORED_TYPES kennen müssen.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ACCEPTED_FORMATS, STORED_TYPES, normalizeReceiptFile } from './file-format';

const DATA_DIR = process.env.RECEIPT_DATA_DIR || '/app/data';

export const UPLOAD_DIR = join(DATA_DIR, 'uploads');
export const RECEIPT_JSON_DIR = join(DATA_DIR, 'receipts');

/** Die abgelegten Formate: MIME-Typ -> Endung der uploadId. */
export const ALLOWED_UPLOAD_TYPES: Record<string, string> = STORED_TYPES;

/** Für Fehlermeldungen: was angenommen (und ggf. konvertiert) wird. */
export { ACCEPTED_FORMATS };

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Eine uploadId ist "<uuid><ext>" – die Endung steckt mit drin, damit der Pfad
 * ohne zusätzlichen Lookup auflösbar ist. Das Muster ist absichtlich streng:
 * es ist gleichzeitig der Schutz gegen Path Traversal, weil `/`, `.` und `..`
 * gar nicht matchen können.
 */
const UPLOAD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif|pdf)$/;

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
  /** MIME-Typ der abgelegten (ggf. konvertierten) Datei. */
  mimeType: string;
  size: number;
  /** Ursprungsformat, wenn konvertiert wurde. */
  convertedFrom?: string;
};

/** Zu gross – eigene Klasse, damit der Teams-Pfad die Meldung selbst formulieren kann. */
export class UploadTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(
      `Datei ist ${(bytes / 1024 / 1024).toFixed(1)} MB groß, erlaubt sind maximal ${
        MAX_UPLOAD_BYTES / 1024 / 1024
      } MB.`,
    );
    this.name = 'UploadTooLargeError';
  }
}

/**
 * Datei prüfen, normalisieren, nach UPLOAD_DIR schreiben, uploadId zurückgeben.
 *
 * Der Typ wird an den Bytes bestimmt, nicht übergeben: weder Teams noch ein
 * Browser-Upload melden ihn verlässlich.
 */
export async function storeUpload(bytes: Uint8Array, filename: string): Promise<StoredUpload> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new UploadTooLargeError(bytes.byteLength);

  const normalized = await normalizeReceiptFile(bytes);
  // Eine Konvertierung (TIFF -> JPEG) kann die Datei vergrössern.
  if (normalized.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new UploadTooLargeError(normalized.bytes.byteLength);
  }

  const uploadId = `${randomUUID()}${STORED_TYPES[normalized.mimeType]}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(join(UPLOAD_DIR, uploadId), normalized.bytes);

  return {
    uploadId,
    filename: filename || uploadId,
    mimeType: normalized.mimeType,
    size: normalized.bytes.byteLength,
    ...(normalized.convertedFrom ? { convertedFrom: normalized.convertedFrom } : {}),
  };
}
