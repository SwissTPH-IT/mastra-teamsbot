"use server";

// Nachtraegliche Korrektur eines erfassten Belegs.
//
// Zwei Arten von Feldern gehen hier durch:
//
//   - Kategorie und Belegart, die der Extraktions-Agent bewusst leer laesst
//     ("Categorizing expenses is not your job") und die ein Mensch setzt.
//   - Die Fachwerte (Haendler, Datum, Betrag, Waehrung, MwSt., Zahlungsart,
//     bei Ausgaben ohne Beleg die Begruendung). Die Extraktion liest manchmal
//     falsch, und im Teams-Dialog sind nur vier Felder bestaetigbar - ohne
//     diesen Weg bliebe ein falsch gelesener Haendler fuer immer stehen.
//
// Gelesen werden die Werte im Dienst, mit denselben Parsern wie bei der
// Extraktion ("42,10", "14.03.2026"). Hier wird nichts interpretiert.
//
// Geschrieben wird ueber den Dienst (PATCH /receipts/:id), nicht in die
// Datenbank. Die Zeile wird dort auf (id, user_id) gematcht - eine geratene id
// trifft 0 Zeilen und ergibt 404, nicht die Zeile eines anderen.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { patchReceipt, type ReceiptPatch } from "@/lib/api/receipts";
import { isAuthError, isNotFound, isRejected, isUnlinkedAccount } from "@/lib/api/client";
import { describeRejection, submittedValues, type FormState } from "@/lib/receipts/form-state";

/**
 * Die Felder, die das Formular schicken darf. Alles andere im FormData wird
 * ignoriert - ein von Hand ergaenztes Feld soll nicht bis zum Dienst kommen.
 */
const PATCH_FIELDS = [
  "merchant",
  "receiptDate",
  "totalAmount",
  "currency",
  "vatAmount",
  "paymentMethod",
  "category",
  "receiptType",
  "reason",
] as const satisfies readonly (keyof ReceiptPatch)[];

/**
 * Korrektur speichern.
 *
 * Nimmt FormData statt getippter Argumente, damit das Formular ohne
 * JavaScript funktioniert: das Feld liegt im Formular, der Browser schickt es,
 * die Action liest es. Ein Client-Handler waere hier nur Zierde.
 *
 * Geschickt wird nur, was im Formular steht: die Begruendung gibt es nur bei
 * Ausgaben ohne Beleg, MwSt. und Zahlungsart nur bei Belegen. Ein fehlendes
 * Feld heisst "nicht angefasst", ein leeres heisst "entfernen".
 */
export async function saveCorrections(_previous: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id") ?? "");
  const values = submittedValues(form);
  if (!id) return { ok: false, message: "Missing receipt id.", fieldErrors: {}, values };

  const patch: ReceiptPatch = {};
  for (const field of PATCH_FIELDS) {
    if (form.has(field)) patch[field] = String(form.get(field) ?? "");
  }

  try {
    await patchReceipt(id, patch);
  } catch (error) {
    if (isAuthError(error)) redirect("/signin");
    if (isRejected(error)) return { ok: false, ...describeRejection(error.detail), values };
    if (isNotFound(error)) {
      return { ok: false, message: "This receipt no longer exists.", fieldErrors: {}, values };
    }
    if (isUnlinkedAccount(error)) {
      return {
        ok: false,
        message: "This account is not linked to any receipts.",
        fieldErrors: {},
        values,
      };
    }
    console.error("[frontend] Korrektur fehlgeschlagen:", error);
    return {
      ok: false,
      message: "Could not save — the receipt service did not accept it.",
      fieldErrors: {},
      values,
    };
  }

  // Detailseite, Liste (Betrag, Kategorie, Filter-Dropdown) und die Kennzahl
  // auf der Startseite - "layout" erfasst alle darunter liegenden Seiten.
  revalidatePath("/", "layout");
  return { ok: true };
}
