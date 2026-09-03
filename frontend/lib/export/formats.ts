// Format-Registry des Export-Endpunkts.
//
// Sie existiert, damit ein zweites Format (.xlsx ist absehbar gewuenscht)
// daneben passt, ohne den Route Handler oder die Query-Schicht anzufassen:
// dort wird nur noch EXPORT_FORMATS[name] nachgeschlagen. Implementiert ist
// jetzt ausschliesslich CSV.

import type { ReceiptRow } from "../receipts/queries";
import { csvHeaderLine, csvOptionsFor, csvRowLine } from "./csv";

export type ExportFormat = {
  contentType: string;
  extension: string;
  /**
   * Verwandelt die Baender aus streamReceipts() in einen Byte-Strom.
   *
   * Bewusst Strom und nicht Buffer: ein Export ueber mehrere Jahre soll nicht
   * erst vollstaendig im Speicher stehen, bevor das erste Byte rausgeht.
   */
  createStream: (
    batches: AsyncIterable<ReceiptRow[]>,
    params: URLSearchParams,
  ) => ReadableStream<Uint8Array>;
};

const csv: ExportFormat = {
  // charset im Content-Type, obwohl das BOM in der Datei steht: Browser und
  // Tabellenprogramme lesen mal das eine, mal das andere.
  contentType: "text/csv; charset=utf-8",
  extension: "csv",
  createStream: (batches, params) => {
    const options = csvOptionsFor(resolveDelimiter(params.get("delimiter")));
    const encoder = new TextEncoder();
    const iterator = batches[Symbol.asyncIterator]();
    let headerSent = false;

    // pull() statt alles in start(): so fragt der Stream erst das naechste Band
    // an, wenn der Verbraucher das vorige abgenommen hat. Ohne das laege der
    // gesamte Export doch wieder im Speicher, nur eben im Stream-Puffer.
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!headerSent) {
          headerSent = true;
          controller.enqueue(encoder.encode(csvHeaderLine(options)));
          return;
        }

        const { value, done } = await iterator.next();
        if (done || !value) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(value.map((row) => csvRowLine(row, options)).join("")));
      },
      async cancel(reason) {
        // Bricht der Client den Download ab, wird auch der Generator beendet -
        // sonst laeuft die Datenbankabfrage ins Leere weiter.
        await iterator.return?.(reason);
      },
    });
  },
};

export const EXPORT_FORMATS: Record<string, ExportFormat> = { csv };

export const DEFAULT_EXPORT_FORMAT = "csv";

/** Nur die drei sinnvollen Trennzeichen; alles andere faellt auf ";" zurueck. */
function resolveDelimiter(raw: string | null): string {
  switch (raw) {
    case ",":
    case "comma":
      return ",";
    case "tab":
    case "\t":
      return "\t";
    default:
      return ";";
  }
}

/**
 * Dateiname mit Zeitraum, z. B. belege_2026-01-01_2026-03-31.csv.
 *
 * Ohne gesetzten Zeitraum steht das Abrufdatum drin - ein Dateiname wie
 * "belege.csv" ist im Download-Ordner nach dem zweiten Export nicht mehr
 * zuzuordnen.
 */
export function exportFileName(from: string | null, to: string | null, extension: string): string {
  const today = new Date().toISOString().slice(0, 10);

  const range =
    from && to ? `${from}_${to}` : from ? `ab_${from}` : to ? `bis_${to}` : `alle_${today}`;

  return `belege_${range}.${extension}`;
}
