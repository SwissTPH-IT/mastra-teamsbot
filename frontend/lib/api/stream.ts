// Alle Treffer eines Filters, seitenweise.
//
// Fuer den CSV-Export: der Dienst liefert hoechstens 200 Zeilen pro Aufruf, ein
// Export ueber ein Jahr sind mehr. Ein Generator statt eines Arrays, damit das
// erste Byte rausgeht, bevor die letzte Seite geholt ist.
//
// OFFSET und nicht Keyset: der Dienst bietet offset an, und eine
// Cursor-Schnittstelle gibt es nicht. Der Preis ist bekannt - zwischen zwei
// Seiten neu erfasste Belege koennen das Fenster verschieben. Fuer diesen Fall
// ist das vertretbar: erfasst wird in Teams, ein Beleg landet also nicht
// waehrend eines Exports mitten in der Sortierung, und die Sortierung ist
// Belegdatum absteigend - neue Belege kommen oben dazu, nicht in die Mitte.

import "server-only";
import { fetchReceiptPage, type ApiReceipt } from "./receipts";
import type { ReceiptQuery } from "../receipts/query-params";

/** Wie viele Zeilen pro Aufruf. Das Maximum des Dienstes. */
const PAGE_SIZE = 200;

/** Sicherung gegen eine Endlosschleife, falls `total` und Seiten auseinanderlaufen. */
const MAX_PAGES = 500;

export async function* streamReceipts(query: ReceiptQuery): AsyncGenerator<ApiReceipt[]> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await fetchReceiptPage({ ...query, page, pageSize: PAGE_SIZE });

    if (result.receipts.length === 0) return;
    yield result.receipts;
    if (result.receipts.length < PAGE_SIZE) return;
  }

  console.warn("[frontend] Export nach %d Seiten abgebrochen.", MAX_PAGES);
}
