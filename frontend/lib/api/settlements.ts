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

export type ApiSettlement = {
  id: string;
  title: string;
  status: SettlementStatus;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  receiptCount: number;
  /** Fruehestes und spaetestes Belegdatum, YYYY-MM-DD. Gerechnet, nicht gespeichert. */
  periodStart: string | null;
  periodEnd: string | null;
  /** Je Waehrung. CHF und EUR werden nicht addiert. */
  totals: CurrencySummary[];
};

export type CategoryTotal = CurrencySummary & { category: string | null };

export type ApiSettlementDetail = ApiSettlement & {
  byCategory: CategoryTotal[];
  receipts: ApiReceipt[];
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
  receiptIds: string[] = [],
): Promise<ApiSettlementDetail> {
  const payload = await apiRequest<One>("/settlements", {
    method: "POST",
    body: receiptIds.length > 0 ? { title, receiptIds } : { title },
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
