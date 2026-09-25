// Die Abrechnungs-Aufrufe. Duenn wie lib/api/receipts.ts: URL, Antwort-Typ.
//
// Auch hier ist der Typ der Vertrag mit dem Dienst und nicht das Schema. Was
// eine Abrechnung darf (nur Entwuerfe aendern, nur eigene Belege, nicht leer
// einreichen), entscheidet der Dienst; diese Datei reicht nur weiter. Eine
// zweite Pruefung hier waere eine zweite Wahrheit - und die Oberflaeche
// zeigt ohnehin nur, was der Dienst zurueckgibt.

import { apiRequest } from "./client";
import type { ApiReceipt, CurrencySummary } from "./receipts";

/**
 * Die Zustaende, die es heute gibt. Approved und Query aus der Vorlage
 * brauchen eine Pruefung durch Finance - diese Rolle gibt es nicht.
 */
export type SettlementStatus = "draft" | "submitted";

/**
 * Die Summe in der Abrechnungswaehrung. Jede Position zum Kurs ihres
 * Belegdatums umgerechnet (Frankfurter), gerechnet im Dienst.
 */
export type SettlementTotal = {
  currency: string;
  sum: string;
  /** Positionen ohne umgerechneten Betrag. Solange > 0, ist `sum` zu klein. */
  missingCount: number;
  /** Positionen, deren Tageskurs noch nicht feststeht. */
  provisionalCount: number;
};

export type ApiSettlement = {
  id: string;
  title: string;
  /** ISO-4217. Worauf die Abrechnung lautet. */
  currency: string;
  status: SettlementStatus;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  receiptCount: number;
  /** Fruehestes und spaetestes Belegdatum, YYYY-MM-DD. Gerechnet, nicht gespeichert. */
  periodStart: string | null;
  periodEnd: string | null;
  total: SettlementTotal;
  /** Je Originalwaehrung, unumgerechnet. */
  totals: CurrencySummary[];
};

/** Je Kategorie, in der Abrechnungswaehrung. */
export type CategoryTotal = CurrencySummary & { category: string | null };

/** Eine Position in der Abrechnungswaehrung. */
export type Conversion = {
  /** null: nicht rechenbar, siehe `missing`. */
  amount: string | null;
  /** 1 Abrechnungswaehrung = `rate` Belegwaehrung. null bei gleicher Waehrung. */
  rate: string | null;
  /** Tag, von dem der Kurs stammt. Kann vor dem Belegdatum liegen. */
  rateDate: string | null;
  provisional: boolean;
  missing: "amount" | "currency" | "date" | "rate" | null;
};

export type SettlementReceipt = ApiReceipt & { conversion: Conversion };

export type ApiSettlementDetail = ApiSettlement & {
  byCategory: CategoryTotal[];
  receipts: SettlementReceipt[];
};

type One = { settlement: ApiSettlementDetail };

export async function fetchSettlements(status?: SettlementStatus): Promise<ApiSettlement[]> {
  const payload = await apiRequest<{ settlements: ApiSettlement[] }>("/settlements", {
    query: { status },
  });
  return payload.settlements;
}

/** Wirft ApiError(404), wenn die Abrechnung dem Nutzer nicht gehoert. */
export async function fetchSettlement(id: string): Promise<ApiSettlementDetail> {
  const payload = await apiRequest<One>(`/settlements/${encodeURIComponent(id)}`);
  return payload.settlement;
}

/** Neue Abrechnung, optional gleich mit Belegen - alles oder nichts. */
export async function createSettlement(
  title: string,
  currency: string,
  receiptIds: string[] = [],
): Promise<ApiSettlementDetail> {
  const payload = await apiRequest<One>("/settlements", {
    method: "POST",
    body: receiptIds.length > 0 ? { title, currency, receiptIds } : { title, currency },
  });
  return payload.settlement;
}

/** Nur im Entwurf. Die Betraege rechnet der Dienst danach neu um. */
export async function changeSettlementCurrency(
  settlementId: string,
  currency: string,
): Promise<ApiSettlementDetail> {
  const payload = await apiRequest<One>(`/settlements/${encodeURIComponent(settlementId)}`, {
    method: "PATCH",
    body: { currency },
  });
  return payload.settlement;
}

export async function assignReceipts(
  settlementId: string,
  receiptIds: string[],
): Promise<ApiSettlementDetail> {
  const payload = await apiRequest<One>(
    `/settlements/${encodeURIComponent(settlementId)}/receipts`,
    { method: "POST", body: { receiptIds } },
  );
  return payload.settlement;
}

export async function removeReceipt(
  settlementId: string,
  receiptId: string,
): Promise<ApiSettlementDetail> {
  const payload = await apiRequest<One>(
    `/settlements/${encodeURIComponent(settlementId)}/receipts/${encodeURIComponent(receiptId)}`,
    { method: "DELETE" },
  );
  return payload.settlement;
}

export async function submitSettlement(settlementId: string): Promise<ApiSettlementDetail> {
  const payload = await apiRequest<One>(`/settlements/${encodeURIComponent(settlementId)}/submit`, {
    method: "POST",
  });
  return payload.settlement;
}

/** Nur Entwuerfe. Die Belege bleiben und sind danach wieder unassigned. */
export async function deleteSettlement(settlementId: string): Promise<void> {
  await apiRequest<void>(`/settlements/${encodeURIComponent(settlementId)}`, {
    method: "DELETE",
  });
}
