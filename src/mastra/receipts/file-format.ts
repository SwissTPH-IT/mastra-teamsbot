// Welche Belegdateien angenommen werden, und in welcher Form sie beim Modell
// ankommen.
//
// Die Vision-Modelle der Provider (OpenAI, Anthropic, OpenRouter) lesen als
// Bild nur JPEG, PNG, WebP und nicht animiertes GIF – dazu PDF als eigenen
// Dateityp (File-Part, kein Image-Part). Alles andere, was Handys und Scanner
// produzieren, wird deshalb beim Ablegen EINMAL nach JPEG konvertiert:
//
//   HEIC/HEIF   iPhone-Standard; HEVC kann die Prebuilt-libvips von sharp aus
//               Patentgründen nicht dekodieren, deshalb libheif als Wasm
//               (heic-decode). AVIF-in-HEIF kann sharp selbst.
//   AVIF, TIFF  sharp (TIFF: nur die erste Seite – ein mehrseitiger Scan
//               gehört als PDF geschickt)
//   BMP         kann libvips nicht, deshalb bmp-js
//   GIF (anim.) OpenAI lehnt animierte GIFs ab; erstes Bild als PNG
//
// Das Format wird an den Magic Bytes bestimmt, nie am gemeldeten contentType:
// Teams meldet eingefügte Bilder als "image/*" und hochgeladene Dateien ohne
// bekannte Endung als "application/octet-stream".
//
// SVG ist bewusst ausgeschlossen: ein Vektorbild ist kein Beleg, und ein
// Rasterizer für nutzergelieferte SVGs (externe Referenzen, Entities) ist
// Angriffsfläche ohne Nutzen.

import sharp, { type Sharp } from 'sharp';
import heicDecode from 'heic-decode';
import bmp from 'bmp-js';

/** Die Formate, in denen eine Datei abgelegt wird und das Modell erreicht. */
export const STORED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
} as const;

export type StoredMimeType = keyof typeof STORED_TYPES;

/** Was angenommen wird – für Fehlermeldungen und die Agent-Anweisungen. */
export const ACCEPTED_FORMATS = ['JPEG', 'PNG', 'WebP', 'GIF', 'HEIC/HEIF', 'AVIF', 'TIFF', 'BMP', 'PDF'];

type Detected =
  | { kind: 'native'; mimeType: StoredMimeType }
  | { kind: 'convert'; format: 'heif' | 'tiff' | 'bmp' };

/**
 * Nicht erkannte oder nicht lesbare Datei. Eigene Klasse, damit der Teams-Pfad
 * dem Nutzer eine eigene (englische) Meldung geben kann, statt den deutschen
 * Text durchzureichen.
 */
export class UnsupportedReceiptFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedReceiptFileError';
  }
}

export function detectReceiptFormat(bytes: Uint8Array): Detected | undefined {
  const at = (offset: number, ...signature: number[]) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));

  if (at(0, 0xff, 0xd8, 0xff)) return { kind: 'native', mimeType: 'image/jpeg' };
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: 'native', mimeType: 'image/png' };
  if (ascii(0, 4) === 'GIF8') return { kind: 'native', mimeType: 'image/gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'native', mimeType: 'image/webp' };
  // "%PDF-" steht laut Spezifikation irgendwo in den ersten 1024 Bytes, meist
  // an Position 0 – manche Scanner schreiben Müll davor.
  if (ascii(0, Math.min(bytes.length, 1024)).includes('%PDF-')) {
    return { kind: 'native', mimeType: 'application/pdf' };
  }

  // ISO-BMFF: "ftyp" an Position 4, danach die Brand (heic, heix, mif1, avif, …).
  if (ascii(4, 8) === 'ftyp') {
    const brand = ascii(8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis'].includes(brand)) {
      return { kind: 'convert', format: 'heif' };
    }
  }
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)) return { kind: 'convert', format: 'tiff' };
  if (ascii(0, 2) === 'BM') return { kind: 'convert', format: 'bmp' };

  return undefined;
}

export type NormalizedReceiptFile = {
  bytes: Uint8Array;
  mimeType: StoredMimeType;
  /** Gesetzt, wenn konvertiert wurde – nur fürs Log. */
  convertedFrom?: string;
};

/**
 * Obergrenze für konvertierte Bilder. Ein 600-dpi-TIFF-Scan hat schnell
 * 7000 px Kantenlänge; die Provider skalieren ohnehin herunter (Anthropic
 * weist über 8000 px ab), und das JPEG soll unter MAX_UPLOAD_BYTES bleiben.
 */
const MAX_EDGE_PX = 4096;

const toJpeg = (image: Sharp) =>
  image
    // EXIF-Orientierung anwenden: das JPEG trägt sie nicht mehr mit.
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 90 })
    .toBuffer();

/** Bytes in ein Format bringen, das das Modell lesen kann. Wirft bei allem anderen. */
export async function normalizeReceiptFile(bytes: Uint8Array): Promise<NormalizedReceiptFile> {
  const detected = detectReceiptFormat(bytes);
  if (!detected) {
    throw new UnsupportedReceiptFileError(
      `Dateiformat nicht erkannt. Erlaubt: ${ACCEPTED_FORMATS.join(', ')}.`,
    );
  }

  try {
    if (detected.kind === 'native') {
      if (detected.mimeType === 'image/gif' && ((await sharp(bytes).metadata()).pages ?? 1) > 1) {
        const png = await sharp(bytes, { pages: 1 }).png().toBuffer();
        return { bytes: new Uint8Array(png), mimeType: 'image/png', convertedFrom: 'gif (animated)' };
      }
      return { bytes, mimeType: detected.mimeType };
    }

    const jpeg = await convert(bytes, detected.format);
    return { bytes: new Uint8Array(jpeg), mimeType: 'image/jpeg', convertedFrom: detected.format };
  } catch (error) {
    if (error instanceof UnsupportedReceiptFileError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new UnsupportedReceiptFileError(`Datei konnte nicht gelesen werden (${reason}).`);
  }
}

async function convert(bytes: Uint8Array, format: 'heif' | 'tiff' | 'bmp'): Promise<Buffer> {
  if (format === 'bmp') {
    // bmp-js liefert pro Pixel A, B, G, R – umsortieren nach RGB.
    const decoded = bmp.decode(Buffer.from(bytes));
    const rgb = Buffer.alloc(decoded.width * decoded.height * 3);
    for (let src = 0, dst = 0; src < decoded.data.length; src += 4, dst += 3) {
      rgb[dst] = decoded.data[src + 3];
      rgb[dst + 1] = decoded.data[src + 2];
      rgb[dst + 2] = decoded.data[src + 1];
    }
    return toJpeg(sharp(rgb, { raw: { width: decoded.width, height: decoded.height, channels: 3 } }));
  }

  if (format === 'heif') {
    // AVIF und AV1-HEIF kann sharp selbst; HEVC (das iPhone-HEIC) nicht.
    try {
      return await toJpeg(sharp(bytes));
    } catch {
      const decoded = await heicDecode({ buffer: bytes });
      return toJpeg(
        sharp(Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), {
          raw: { width: decoded.width, height: decoded.height, channels: 4 },
        }),
      );
    }
  }

  return toJpeg(sharp(bytes, { pages: 1 }));
}
