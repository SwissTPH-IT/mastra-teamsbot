// Wie ein Belegbild vom Composer zum Workflow kommt.
//
// Der AttachmentAdapter lädt die Datei schon beim Anhängen hoch (nicht erst beim
// Senden) und legt in die Nachricht nur eine Markerzeile mit der uploadId. Das
// Bild selbst wandert also nie als base64 durch den Chat-Kontext – der Agent
// bekommt eine ID, das Vision-Modell im Workflow bekommt die Datei.

import type {
  Attachment,
  AttachmentAdapter,
  CompleteAttachment,
  PendingAttachment,
} from '@assistant-ui/react';

export const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Die Zeile, die der Agent laut seinen Instructions auswertet. */
export function buildReceiptMarker(filename: string, uploadId: string): string {
  // Anführungszeichen im Dateinamen würden den Marker zerlegen.
  const safeName = filename.replace(/"/g, "'");
  return `[Beleg] datei="${safeName}" uploadId="${uploadId}"`;
}

const MARKER_PATTERN = /\[Beleg\] datei="([^"]*)" uploadId="([^"]+)"/g;

export type ParsedReceiptMarker = { filename: string; uploadId: string };

/**
 * Trennt Markerzeilen vom eigentlichen Text. Beides in einem Durchlauf, weil
 * die Runtime Anhang- und Tippnachricht zu einem Textteil zusammenlegen kann.
 */
export function splitReceiptMarkers(text: string): {
  markers: ParsedReceiptMarker[];
  rest: string;
} {
  const markers: ParsedReceiptMarker[] = [];
  const rest = text
    .replace(MARKER_PATTERN, (_match, filename: string, uploadId: string) => {
      markers.push({ filename, uploadId });
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { markers, rest };
}

/** URL der Bildvorschau – geht über den Next-Proxy, nicht direkt an Mastra. */
export function receiptImageUrl(uploadId: string): string {
  return `/api/uploads/${encodeURIComponent(uploadId)}/file`;
}

type UploadResponse = {
  uploadId: string;
  filename: string;
  mimeType: string;
  size: number;
};

export class ReceiptUploadAdapter implements AttachmentAdapter {
  accept = ACCEPTED_IMAGE_TYPES;

  /** uploadId je Anhang, gesetzt in add(), gelesen in send(). */
  private uploadIds = new Map<string, string>();

  async *add({ file }: { file: File }) {
    const id = crypto.randomUUID();

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `"${file.name}" ist ${(file.size / 1024 / 1024).toFixed(1)} MB groß. Maximal ${
          MAX_UPLOAD_BYTES / 1024 / 1024
        } MB.`,
      );
    }

    const base = {
      id,
      type: 'image' as const,
      name: file.name,
      contentType: file.type,
      file,
    };

    yield {
      ...base,
      status: { type: 'running' as const, reason: 'uploading' as const, progress: 0 },
    };

    const body = new FormData();
    body.append('file', file, file.name);

    const response = await fetch('/api/uploads', { method: 'POST', body });
    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(detail?.error ?? `Upload fehlgeschlagen (HTTP ${response.status}).`);
    }

    const { uploadId } = (await response.json()) as UploadResponse;
    this.uploadIds.set(id, uploadId);

    yield {
      ...base,
      status: { type: 'requires-action' as const, reason: 'composer-send' as const },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const uploadId = this.uploadIds.get(attachment.id);
    if (!uploadId) {
      throw new Error(`Upload für "${attachment.name}" ist nicht abgeschlossen.`);
    }
    this.uploadIds.delete(attachment.id);

    return {
      ...attachment,
      status: { type: 'complete' },
      content: [{ type: 'text', text: buildReceiptMarker(attachment.name, uploadId) }],
    };
  }

  async remove(attachment: Attachment): Promise<void> {
    // Die Datei bleibt im Volume liegen – sie ist der Rohbeleg zur JSON-Datei.
    // Hier nur die lokale Zuordnung aufräumen.
    this.uploadIds.delete(attachment.id);
  }
}
