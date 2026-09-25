// CSV-Serialisierung fuer den Export.
//
// Zwei Entscheidungen, die den Unterschied machen, ob die Datei in Excel mit
// CH/DE-Locale brauchbar ist:
//
//  1. UTF-8 MIT BOM. Excel raet die Kodierung sonst nach Codepage und zerlegt
//     jedes "ö" und "é" - und Haendlernamen sind voll davon.
//  2. Semikolon als Trennzeichen und Komma als Dezimaltrennzeichen. Excel
//     erwartet in dieser Locale das Listentrennzeichen der Systemeinstellung;
//     bei Komma-getrennten Dateien landet die ganze Zeile in einer Spalte.
//
// Zeilenende ist CRLF (RFC 4180 und das, was Excel erwartet).
//
// Spaltenkoepfe sind englisch wie die uebrige Oberflaeche, ohne Umlaute - der
// Dateiname und die Kopfzeile wandern in Excel und in Dateinamen weiter.

import type { ApiReceipt } from "../api/receipts";
import { formatReceiptDate, formatTimestamp } from "../receipts/format";
import { sourceLabel } from "../receipts/review";

/** Erlaubte Trennzeichen. Frei waehlbarer Text wuerde die Datei zerschiessen. */
export const CSV_DELIMITERS = { semicolon: ";", comma: ",", tab: "\t" } as const;
export type CsvDelimiterName = keyof typeof CSV_DELIMITERS;

export type CsvOptions = {
  delimiter: string;
  /**
   * Dezimaltrennzeichen. Bewusst NICHT frei kombinierbar: bei Komma als
   * Trennzeichen muss der Dezimalpunkt ein Punkt bleiben, sonst ist "1,50"
   * nicht von zwei Spalten zu unterscheiden.
   */
  decimalSeparator: "," | ".";
};

export function csvOptionsFor(delimiter: string): CsvOptions {
  return { delimiter, decimalSeparator: delimiter === "," ? "." : "," };
}

const BOM = "﻿";
const EOL = "\r\n";

type Column = {
  header: string;
  value: (row: ApiReceipt, options: CsvOptions) => string | null;
};

/**
 * Die Spalten des Exports.
 *
 * Bewusst nicht die Positionen und nicht der Rohausgabe-Block: verschachteltes
 * JSON in einer CSV-Zelle ist in Excel unbenutzbar - und der Dienst gibt
 * beides ohnehin nicht heraus. Eine Nutzerspalte gibt es nicht mehr: der
 * Export enthaelt ausschliesslich die eigenen Belege, eine Spalte mit immer
 * demselben Wert waere Ballast.
 */
const COLUMNS: Column[] = [
  { header: "Receipt ID", value: (row) => row.id },
  { header: "Receipt date", value: (row) => formatReceiptDate(row.receiptDate) },
  { header: "Receipt time", value: (row) => row.receiptTime },
  { header: "Merchant", value: (row) => row.merchant },
  { header: "Merchant address", value: (row) => row.merchantAddress },
  { header: "Merchant tax id", value: (row) => row.merchantTaxId },
  { header: "Reference number", value: (row) => row.referenceNumber },
  { header: "Category", value: (row) => row.category },
  { header: "Receipt type", value: (row) => row.receiptType },
  { header: "Payment method", value: (row) => row.paymentMethod },
  { header: "Subtotal", value: (row, o) => decimal(row.subtotalAmount, o) },
  { header: "Discount", value: (row, o) => decimal(row.discountAmount, o) },
  { header: "VAT amount", value: (row, o) => decimal(row.vatAmount, o) },
  { header: "VAT rate", value: (row, o) => decimal(row.vatRate, o) },
  { header: "Total", value: (row, o) => decimal(row.totalAmount, o) },
  { header: "Currency", value: (row) => row.currency },
  { header: "Confidence", value: (row, o) => decimal(row.confidence, o) },
  { header: "Issues", value: (row) => (row.issues.length > 0 ? row.issues.join("; ") : null) },
  { header: "Settlement", value: (row) => row.settlement?.title ?? null },
  { header: "Captured at", value: (row) => formatTimestamp(row.createdAt) },
  {
    header: "Corrected at",
    value: (row) => (row.correctedAt ? formatTimestamp(row.correctedAt) : null),
  },
  { header: "Source", value: (row) => sourceLabel(row) },
  { header: "Reason (no receipt)", value: (row) => row.reason },
  { header: "File reference", value: (row) => row.fileReference },
];

/**
 * numeric-Wert fuer die Zelle.
 *
 * Der Wert kommt als String aus dem Dienst und wird als String weitergegeben -
 * nur der Dezimalpunkt wird getauscht. Ein Umweg ueber Number wuerde bei
 * Betraegen Rundungsfehler einbauen, die hinterher nicht mehr zu erkennen sind.
 */
function decimal(value: string | null, options: CsvOptions): string | null {
  if (value === null) return null;
  return options.decimalSeparator === "." ? value : value.replace(".", options.decimalSeparator);
}

/** RFC 4180: quoten, sobald Trennzeichen, Anfuehrungszeichen oder Umbruch drin ist. */
function escapeCell(value: string | null, delimiter: string): string {
  if (value === null) return "";
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r");
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value;
}

function toLine(cells: (string | null)[], delimiter: string): string {
  return cells.map((cell) => escapeCell(cell, delimiter)).join(delimiter) + EOL;
}

export function csvHeaderLine(options: CsvOptions): string {
  return (
    BOM +
    toLine(
      COLUMNS.map((column) => column.header),
      options.delimiter,
    )
  );
}

export function csvRowLine(row: ApiReceipt, options: CsvOptions): string {
  return toLine(
    COLUMNS.map((column) => column.value(row, options)),
    options.delimiter,
  );
}
