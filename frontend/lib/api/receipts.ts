// Die Beleg-Aufrufe. Duenn: URL zusammensetzen, Antwort typisieren.
//
// Die Typen hier sind der VERTRAG mit dem Dienst, nicht das Datenbankschema.
// Absichtlich von Hand gepflegt und nicht aus src/db/schema.ts importiert: das
// Frontend soll den Dienst nur ueber seine Schnittstelle kennen. Ein
// Schema-Import waere eine zweite, stillschweigende Kopplung - und genau die
// war der Grund, das Frontend umzubauen.
//
// Alle Betraege sind Strings. node-postgres parst `numeric` bewusst nicht (ein
// double haelt den Wert nicht exakt), und der Dienst gibt genau das weiter.
// Number() passiert nur zur Anzeige, nie auf dem Weg in den Export.

import { apiRequest } from "./client";
import type { ReceiptQuery } from "../receipts/query-params";

export type ApiReceipt = {
  id: string;
  merchant: string | null;
  merchantAddress: string | null;
  merchantTaxId: string | null;
  /** Kalendertag als YYYY-MM-DD. Kein Zeitpunkt - siehe lib/receipts/format.ts. */
  receiptDate: string | null;
  receiptTime: string | null;
  referenceNumber: string | null;
  totalAmount: string | null;
  subtotalAmount: string | null;
  discountAmount: string | null;
  vatAmount: string | null;
  vatRate: string | null;
  currency: string | null;
  paymentMethod: string | null;
  category: string | null;
  receiptType: string | null;
  /** Deterministisch berechnet, kein Modellwert. "0.00" bis "1.00". */
  confidence: string | null;
  issues: string[];
  lineItemCount: number;
  /**
   * "local:uploads/<uploadId>". Das Bild selbst liegt beim Agenten.
   * null heisst: ohne Beleg im Web erfasst.
   */
  fileReference: string | null;
  /** Warum es keinen Beleg gibt. Nur bei Ausgaben ohne Beleg gesetzt. */
  reason: string | null;
  /** Wann ein Mensch zuletzt einen Fachwert berichtigt hat. null: nie. */
  correctedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReceiptPage = {
  receipts: ApiReceipt[];
  /** Zeilen dieser Seite. */
  count: number;
  /** Alle Treffer unter denselben Filtern. Basis fuer Paginierung und Export. */
  total: number;
};

/** Eine Seite der Liste. Filter, Sortierung und Paginierung macht der Dienst. */
export async function fetchReceiptPage(query: ReceiptQuery): Promise<ReceiptPage> {
  return apiRequest<ReceiptPage>("/receipts", {
    query: {
      q: query.q,
      from: query.from,
      to: query.to,
      category: query.category,
      source: query.source,
      sort: query.sort,
      dir: query.dir,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    },
  });
}

/** Anzahl und Summe je Waehrung - die Kennzahl auf der Startseite. */
export type CurrencySummary = {
  /** null bei Belegen, auf denen keine Waehrung zu lesen war. */
  currency: string | null;
  count: number;
  /** Summe als String, in Postgres gerechnet. Siehe Kopfkommentar. */
  sum: string;
};

/**
 * Die Kennzahl. Nimmt dieselben Filter wie die Liste, damit "unassigned" und
 * die Tabelle nie zwei verschiedene Wahrheiten zeigen.
 */
export async function fetchSummary(query?: ReceiptQuery): Promise<CurrencySummary[]> {
  const payload = await apiRequest<{ byCurrency: CurrencySummary[] }>("/receipts/summary", {
    query: query
      ? {
          q: query.q,
          from: query.from,
          to: query.to,
          category: query.category,
          source: query.source,
        }
      : undefined,
  });
  return payload.byCurrency;
}

/** Ein einzelner Beleg. Wirft ApiError(404), wenn er dem Nutzer nicht gehoert. */
export async function fetchReceipt(id: string): Promise<ApiReceipt> {
  const payload = await apiRequest<{ receipt: ApiReceipt }>(`/receipts/${encodeURIComponent(id)}`);
  return payload.receipt;
}

/** Die Kategorien, die dieser Nutzer vergeben hat - fuer das Filter-Dropdown. */
export async function fetchCategories(): Promise<string[]> {
  const payload = await apiRequest<{ categories: string[] }>("/receipts/categories");
  return payload.categories;
}

/**
 * Die Felder, die die Detailansicht korrigieren darf. Deckt sich mit
 * PATCH /receipts/:id.
 *
 * Betraege, Datum und Waehrung gehen als ROHER Text an den Dienst ("42,10",
 * "14.03.2026"). Gelesen wird dort, mit denselben Parsern wie bei der
 * Extraktion - eine zweite Lese-Logik hier wuerde irgendwann anders lesen.
 */
export type ReceiptPatch = {
  merchant?: string | null;
  receiptDate?: string | null;
  totalAmount?: string | null;
  currency?: string | null;
  vatAmount?: string | null;
  paymentMethod?: string | null;
  category?: string | null;
  receiptType?: string | null;
  reason?: string | null;
};

/**
 * Korrektur speichern.
 *
 * Kategorie und Belegart setzt immer ein Mensch (der Extraktions-Agent laesst
 * sie bewusst leer). Die Fachwerte korrigiert er, wo die Extraktion falsch
 * gelesen hat - oder wo er sich bei einer Ausgabe ohne Beleg vertippt hat.
 * Ob eine Aenderung als Korrektur zaehlt (corrected_at), entscheidet der
 * Dienst: nur wenn sich ein Fachwert tatsaechlich aendert.
 */
export async function patchReceipt(id: string, patch: ReceiptPatch): Promise<ApiReceipt> {
  const payload = await apiRequest<{ receipt: ApiReceipt }>(`/receipts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    // null -> Leerstring: der Dienst nimmt Strings und macht aus leer NULL.
    // Leer bedeutet "nicht gesetzt", und genau das soll es.
    body: Object.fromEntries(
      Object.entries(patch)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, value ?? ""]),
    ),
  });
  return payload.receipt;
}

/** Eine Ausgabe ohne Beleg. Werte roh, wie getippt - gelesen wird im Dienst. */
export type ManualReceiptInput = {
  /** Beim Rendern des Formulars vergeben; macht ein doppeltes Absenden harmlos. */
  id: string;
  merchant: string;
  receiptDate: string;
  totalAmount: string;
  currency: string;
  category: string;
  reason: string;
};

/**
 * Ausgabe ohne Beleg anlegen. Idempotent ueber `id`: ein zweites Absenden
 * liefert dieselbe Zeile zurueck, statt eine zweite anzulegen.
 */
export async function createManualReceipt(input: ManualReceiptInput): Promise<ApiReceipt> {
  const payload = await apiRequest<{ receipt: ApiReceipt }>("/receipts/manual", {
    method: "POST",
    body: input,
  });
  return payload.receipt;
}
