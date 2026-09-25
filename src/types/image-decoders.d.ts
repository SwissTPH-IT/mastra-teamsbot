// Die beiden Decoder bringen keine eigenen Typen mit. Deklariert ist nur, was
// src/mastra/receipts/file-format.ts und tests/file-format.test.ts benutzen.

declare module 'heic-decode' {
  function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<{
    width: number;
    height: number;
    /** RGBA, 4 Bytes pro Pixel. */
    data: Uint8ClampedArray;
  }>;
  export default decode;
}

declare module 'bmp-js' {
  const bmp: {
    decode(buffer: Buffer): {
      width: number;
      height: number;
      /** A, B, G, R – 4 Bytes pro Pixel, Alpha bei 24-bit-BMPs 0. */
      data: Buffer;
    };
    /** Nur für Tests: schreibt ein 24-bit-BMP aus A, B, G, R. */
    encode(image: { data: Buffer; width: number; height: number }): { data: Buffer };
  };
  export default bmp;
}
