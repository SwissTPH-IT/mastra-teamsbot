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

import type { ReceiptRow } from "../receipts/queries";
import { formatReceiptDate } from "../receipts/format";

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

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat("de-CH", {
  timeZone: "Europe/Zurich",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type Column = {
  header: string;
  value: (row: ReceiptRow, options: CsvOptions) => string | null;
};

/**
 * Die Spalten des Exports.
 *
 * Bewusst nicht `line_items` und nicht `raw_extraction`: verschachteltes JSON
 * in einer CSV-Zelle ist in Excel unbenutzbar. `file_hash` gehoert in kein
 * Buchhaltungsdokument. Alles andere aus app.receipts ist drin - der Export ist
 * die Stelle, an der man mehr Felder erwartet als in der Tabelle.
 */
const COLUMNS: Column[] = [
  { header: "Beleg-ID", value: (row) => row.id },
  { header: "Nutzer", value: (row) => row.userId },
  { header: "Belegdatum", value: (row) => formatReceiptDate(row.receiptDate) },
  { header: "Belegzeit", value: (row) => row.receiptTime },
  { header: "Haendler", value: (row) => row.merchant },
  { header: "Haendler-Adresse", value: (row) => row.merchantAddress },
  { header: "Haendler-Steuernummer", value: (row) => row.merchantTaxId },
  { header: "Referenznummer", value: (row) => row.referenceNumber },
  { header: "Kategorie", value: (row) => row.category },
  { header: "Belegart", value: (row) => row.receiptType },
  { header: "Zahlungsart", value: (row) => row.paymentMethod },
  { header: "Zwischensumme", value: (row, o) => decimal(row.subtotalAmount, o) },
  { header: "Rabatt", value: (row, o) => decimal(row.discountAmount, o) },
  { header: "MwSt-Betrag", value: (row, o) => decimal(row.vatAmount, o) },
  { header: "MwSt-Satz", value: (row, o) => decimal(row.vatRate, o) },
  { header: "Gesamtbetrag", value: (row, o) => decimal(row.totalAmount, o) },
  { header: "Waehrung", value: (row) => row.currency },
  { header: "Konfidenz", value: (row, o) => decimal(row.confidence, o) },
  {
    header: "Erfasst am",
    value: (row) => (row.createdAt ? TIMESTAMP_FORMATTER.format(row.createdAt) : null),
  },
  { header: "Dateireferenz", value: (row) => row.fileReference },
];

/**
 * numeric-Wert fuer die Zelle.
 *
 * Der Wert kommt als String aus Postgres und wird als String weitergegeben -
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

export function csvRowLine(row: ReceiptRow, options: CsvOptions): string {
  return toLine(
    COLUMNS.map((column) => column.value(row, options)),
    options.delimiter,
  );
}
