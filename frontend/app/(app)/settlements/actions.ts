"use server";

// Die schreibenden Stellen fuer Abrechnungen.
//
// Alles geht ueber den Dienst (lib/api/settlements.ts), keine Pruefung hier:
// ob ein Beleg zugeordnet werden darf, entscheidet der Dienst im selben
// Statement, in dem er schreibt. Die Action uebersetzt nur seine Antwort in
// einen Satz fuer die Oberflaeche - englisch, weil die Oberflaeche englisch
// ist; der deutsche Text des Dienstes geht ins Server-Log.
//
// FormData statt getippter Argumente, wie bei den Korrekturen: die Formulare
// funktionieren damit auch ohne JavaScript.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError, isAuthError, isNotFound, isUnlinkedAccount } from "@/lib/api/client";
import {
  assignReceipts,
  changeSettlementCurrency,
  createSettlement,
  deleteSettlement,
  removeReceipt,
  submitSettlement,
} from "@/lib/api/settlements";
import { isSettlementCurrency } from "@/lib/settlements/currencies";

export type ActionState = { ok: true; message?: string } | { ok: false; message: string } | null;

/** Der Wert, der im Zuordnungsdialog fuer "Create new settlement" steht. */
const NEW = "new";

/**
 * Fehler des Dienstes -> Satz fuer die Oberflaeche.
 *
 * Nach `code`, nicht nach dem deutschen Text: der Dienst liefert den Grund
 * maschinenlesbar mit (siehe api/src/index.ts), und ein Wortlaut aendert sich
 * leichter als ein Code.
 */
function explain(error: unknown, action: string): ActionState {
  if (isAuthError(error)) redirect("/signin");
  if (isUnlinkedAccount(error)) {
    return { ok: false, message: "This account is not linked to any receipts." };
  }
  if (isNotFound(error)) return { ok: false, message: "This settlement no longer exists." };

  if (error instanceof ApiError) {
    switch (error.code) {
      case "locked":
        return {
          ok: false,
          message: "This settlement is submitted and locked: no new items, no corrections.",
        };
      case "receipts-unavailable":
        return {
          ok: false,
          message:
            "Some of these items are no longer available or sit in a submitted settlement. Nothing was changed.",
        };
      case "empty":
        return { ok: false, message: "An empty settlement cannot be submitted." };
      case "incomplete":
        return { ok: false, message: "Every item needs a receipt type before submitting." };
      case "unconverted":
        return {
          ok: false,
          message:
            "Some items have no amount in the settlement currency yet: amount, currency, date or exchange rate is missing.",
        };
      case "rates-pending":
        return {
          ok: false,
          message:
            "Some exchange rates are not final yet. The daily rate is fixed one to two days after the receipt date.",
        };
    }
    if (error.status === 400) {
      return error.fields?.includes("currency")
        ? { ok: false, message: "Choose a currency." }
        : { ok: false, message: "Please enter a title." };
    }
  }

  console.error(`[frontend] ${action} fehlgeschlagen:`, error);
  return { ok: false, message: "The receipt service did not accept this. Try again in a moment." };
}

/**
 * Nach jeder Aenderung: alles neu. Eine Zuordnung aendert die Belegliste
 * (Spalte "Assignment"), die Detailseite des Belegs, die Abrechnung und die
 * Kacheln auf der Startseite - einzeln aufzuzaehlen hiesse, eine zu vergessen.
 */
function refresh() {
  revalidatePath("/", "layout");
}

function readReceiptIds(form: FormData): string[] {
  return [...new Set(form.getAll("receiptId").map(String).filter(Boolean))];
}

/** Belege einer bestehenden oder einer neuen Abrechnung zuordnen. */
export async function assignToSettlement(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const receiptIds = readReceiptIds(form);
  const target = String(form.get("target") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const currency = String(form.get("currency") ?? "");

  if (receiptIds.length === 0) return { ok: false, message: "No items selected." };
  if (!target) return { ok: false, message: "Choose a settlement." };
  if (target === NEW && !title) return { ok: false, message: "Please enter a title." };
  if (target === NEW && !isSettlementCurrency(currency)) {
    return { ok: false, message: "Choose a currency." };
  }

  let settlementTitle: string;
  try {
    const settlement =
      target === NEW
        ? await createSettlement(title, currency, receiptIds)
        : await assignReceipts(target, receiptIds);
    settlementTitle = settlement.title;
  } catch (error) {
    return explain(error, "Zuordnung");
  }

  refresh();
  const what = receiptIds.length === 1 ? "1 item" : `${receiptIds.length} items`;
  return { ok: true, message: `${what} added to ${settlementTitle}` };
}

/** "New settlement" auf der Uebersicht: leer anlegen und hinein. */
export async function createEmptySettlement(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const title = String(form.get("title") ?? "").trim();
  const currency = String(form.get("currency") ?? "");
  if (!title) return { ok: false, message: "Please enter a title." };
  if (!isSettlementCurrency(currency)) return { ok: false, message: "Choose a currency." };

  let id: string;
  try {
    id = (await createSettlement(title, currency)).id;
  } catch (error) {
    return explain(error, "Anlegen");
  }

  refresh();
  redirect(`/settlements/${id}`);
}

/** Waehrung eines Entwurfs wechseln. Jede Position wird danach neu umgerechnet. */
export async function changeCurrencyAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const currency = String(form.get("currency") ?? "");
  if (!isSettlementCurrency(currency)) return { ok: false, message: "Choose a currency." };

  try {
    await changeSettlementCurrency(String(form.get("settlementId") ?? ""), currency);
  } catch (error) {
    return explain(error, "Waehrungswechsel");
  }

  refresh();
  return { ok: true };
}

export async function removeFromSettlement(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const settlementId = String(form.get("settlementId") ?? "");
  const receiptId = String(form.get("receiptId") ?? "");

  try {
    await removeReceipt(settlementId, receiptId);
  } catch (error) {
    return explain(error, "Entfernen");
  }

  refresh();
  return { ok: true };
}

export async function submitSettlementAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await submitSettlement(String(form.get("settlementId") ?? ""));
  } catch (error) {
    return explain(error, "Einreichen");
  }

  refresh();
  return { ok: true };
}

export async function deleteSettlementAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    await deleteSettlement(String(form.get("settlementId") ?? ""));
  } catch (error) {
    return explain(error, "Loeschen");
  }

  refresh();
  redirect("/settlements");
}
