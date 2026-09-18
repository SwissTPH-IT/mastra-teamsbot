"use server";

// Die einzige schreibende Stelle der Oberflaeche.
//
// Kategorie und Belegart sind die beiden Felder, die der Extraktions-Agent
// bewusst leer laesst ("Categorizing expenses is not your job") - sie muessen
// also hier gesetzt werden koennen. Betrag, Datum und Waehrung bleiben dem
// Teams-Dialog vorbehalten: dort liegt das Belegbild daneben, und zwei Wege zu
// derselben Zahl sind einer zu viel.
//
// Geschrieben wird ueber den Dienst (PATCH /receipts/:id), nicht in die
// Datenbank. Die Zeile wird dort auf (id, user_id) gematcht - eine geratene id
// trifft 0 Zeilen und ergibt 404, nicht die Zeile eines anderen.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { patchReceipt } from "@/lib/api/receipts";
import { isAuthError, isNotFound, isUnlinkedAccount } from "@/lib/api/client";

export type SaveState = { ok: true } | { ok: false; message: string } | null;

/**
 * Korrektur speichern.
 *
 * Nimmt FormData statt getippter Argumente, damit das Formular ohne
 * JavaScript funktioniert: das Feld liegt im Formular, der Browser schickt es,
 * die Action liest es. Ein Client-Handler waere hier nur Zierde.
 */
export async function saveCorrections(_previous: SaveState, form: FormData): Promise<SaveState> {
  const id = String(form.get("id") ?? "");
  if (!id) return { ok: false, message: "Missing receipt id." };

  // Leerstring heisst "nicht gesetzt" und wird im Dienst zu NULL - dieselbe
  // Regel wie bei der Extraktion. Ohne sie stuende in category ein
  // Leerstring, der in jeder Liste als vergebene Kategorie mitzaehlt.
  const patch = {
    category: String(form.get("category") ?? ""),
    receiptType: String(form.get("receiptType") ?? ""),
  };

  try {
    await patchReceipt(id, patch);
  } catch (error) {
    if (isAuthError(error)) redirect("/signin");
    if (isNotFound(error)) return { ok: false, message: "This receipt no longer exists." };
    if (isUnlinkedAccount(error)) {
      return { ok: false, message: "This account is not linked to any receipts." };
    }
    console.error("[frontend] Korrektur fehlgeschlagen:", error);
    return { ok: false, message: "Could not save — the receipt service did not accept it." };
  }

  // Beide Ansichten: die Detailseite zeigt die neuen Werte, und in der Liste
  // aendert sich die Kategoriespalte samt Filter-Dropdown.
  revalidatePath(`/receipts/${id}`);
  revalidatePath("/receipts");
  return { ok: true };
}
