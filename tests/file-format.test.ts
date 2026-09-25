// Welche Dateien als Beleg angenommen werden und in welcher Form sie beim
// Modell ankommen. Die Beispieldateien entstehen hier mit sharp bzw. bmp-js,
// damit keine Binärdateien im Repo liegen müssen.
//
// HEVC-HEIC (das iPhone-Format) ist nicht dabei: die Prebuilt-libvips kann es
// nicht schreiben, und ein eingechecktes Sample wäre die einzige Alternative.
// Der Pfad dahin (heic-decode) wird über AVIF-in-HEIF bis zum Fallback
// abgedeckt, nicht aber die HEVC-Dekodierung selbst.

import { describe, expect, it } from 'vitest';
import sharp, { type Sharp } from 'sharp';
import bmp from 'bmp-js';
import {
  UnsupportedReceiptFileError,
  detectReceiptFormat,
  normalizeReceiptFile,
} from '../src/mastra/receipts/file-format';

const base = () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#c33' } });
const bytesOf = async (image: Sharp) => new Uint8Array(await image.toBuffer());

const MINIMAL_PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

describe('Belegformate', () => {
  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
    ['gif', 'image/gif'],
  ] as const)('reicht %s unverändert durch', async (format, mimeType) => {
    const bytes = await bytesOf(base().toFormat(format));
    const normalized = await normalizeReceiptFile(bytes);

    expect(normalized.mimeType).toBe(mimeType);
    expect(normalized.convertedFrom).toBeUndefined();
    expect(normalized.bytes).toBe(bytes);
  });

  it('reicht ein PDF unverändert durch – es geht als File-Part ans Modell', async () => {
    const normalized = await normalizeReceiptFile(MINIMAL_PDF);
    expect(normalized.mimeType).toBe('application/pdf');
    expect(normalized.bytes).toBe(MINIMAL_PDF);
  });

  it.each([
    ['tiff', () => base().tiff()],
    ['heif', () => base().avif()],
  ] as const)('konvertiert %s nach JPEG', async (format, make) => {
    const bytes = await bytesOf(make());
    expect(detectReceiptFormat(bytes)).toEqual({ kind: 'convert', format });

    const normalized = await normalizeReceiptFile(bytes);
    expect(normalized.mimeType).toBe('image/jpeg');
    expect(normalized.convertedFrom).toBe(format);

    const meta = await sharp(normalized.bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 40, 30]);
  });

  it('konvertiert BMP nach JPEG, mit den richtigen Farben', async () => {
    // bmp-js schreibt 24-bit; data ist pro Pixel A, B, G, R.
    const width = 4;
    const height = 2;
    const data = Buffer.alloc(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i + 1] = 0x00; // B
      data[i + 2] = 0x00; // G
      data[i + 3] = 0xff; // R
    }
    const bytes = new Uint8Array(bmp.encode({ data, width, height }).data);

    const normalized = await normalizeReceiptFile(bytes);
    expect(normalized).toMatchObject({ mimeType: 'image/jpeg', convertedFrom: 'bmp' });

    const { data: rgb } = await sharp(normalized.bytes).raw().toBuffer({ resolveWithObject: true });
    // JPEG ist verlustbehaftet – rot bleibt aber rot.
    expect(rgb[0]).toBeGreaterThan(200);
    expect(rgb[1]).toBeLessThan(60);
    expect(rgb[2]).toBeLessThan(60);
  });

  it('macht aus einem animierten GIF das erste Bild als PNG', async () => {
    // Zwei verschiedene Bilder: identische Frames fasst der GIF-Encoder zusammen.
    const red = await base().png().toBuffer();
    const blue = await sharp({
      create: { width: 40, height: 30, channels: 3, background: '#33c' },
    })
      .png()
      .toBuffer();
    const animated = await sharp([red, blue], { join: { animated: true } }).gif().toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);

    const normalized = await normalizeReceiptFile(new Uint8Array(animated));
    expect(normalized).toMatchObject({ mimeType: 'image/png', convertedFrom: 'gif (animated)' });
  });

  it('lehnt SVG und Unbekanntes ab, statt zu raten', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    await expect(normalizeReceiptFile(svg)).rejects.toBeInstanceOf(UnsupportedReceiptFileError);
    await expect(normalizeReceiptFile(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(
      UnsupportedReceiptFileError,
    );
  });

  it('meldet eine kaputte Datei mit bekannter Signatur als nicht lesbar', async () => {
    const truncated = (await bytesOf(base().tiff())).subarray(0, 16);
    await expect(normalizeReceiptFile(truncated)).rejects.toBeInstanceOf(UnsupportedReceiptFileError);
  });
});
