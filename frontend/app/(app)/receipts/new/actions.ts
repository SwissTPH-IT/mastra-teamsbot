"use server";

// Ausgabe ohne Beleg erfassen.
//
// Die zweite schreibende Stelle der Oberflaeche. Wie die Korrektur geht sie
// ueber den Dienst (POST /receipts/manual) und nicht in die Datenbank, und wie
// dort wird hier nichts gelesen oder geprueft: Betrag, Datum und die
// 20-CHF-Grenze entscheidet der Dienst. Das Formular zeigt die Grenze nur an.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createManualReceipt } from "@/lib/api/receipts";
import { assignReceipts } from "@/lib/api/settlements";
import { isAuthError, isRejected, isUnlinkedAccount } from "@/lib/api/client";
import { describeRejection, submittedValues, type FormState } from "@/lib/receipts/form-state";

export async function createManualEntry(_previous: FormState, form: FormData): Promise<FormState> {
  const values = submittedValues(form);
  const field = (name: string) => String(form.get(name) ?? "");

  // Die Begruendung ist Pflicht. Hier vorab, weil es der haeufigste Fehler ist
  // und die Meldung am Feld stehen soll - der Dienst prueft trotzdem.
  if (field("reason").trim() === "") {
    return {
      ok: false,
      message: "A reason is required when there is no receipt.",
      fieldErrors: { reason: "Required: why there is no receipt." },
      values,
    };
  }

  let id: string;
  try {
    const receipt = await createManualReceipt({
      // Beim Rendern der Seite vergeben. Ein zweites Absenden desselben
      // Formulars trifft damit dieselbe Zeile, statt eine zweite anzulegen.
      id: field("id"),
      merchant: field("merchant"),
      receiptDate: field("receiptDate"),
      totalAmount: field("totalAmount"),
      currency: field("currency"),
      category: field("category"),
      reason: field("reason"),
    });
    id = receipt.id;
  } catch (error) {
    if (isAuthError(error)) redirect("/signin");
    if (isRejected(error)) return { ok: false, ...describeRejection(error), values };
    if (isUnlinkedAccount(error)) {
      return {
        ok: false,
        message:
          "This account is not linked yet. Send the Teams bot one message first, then try again.",
        fieldErrors: {},
        values,
      };
    }
    console.error("[frontend] Erfassung ohne Beleg fehlgeschlagen:", error);
    return {
      ok: false,
      message: "Could not save — the receipt service did not accept it.",
      fieldErrors: {},
      values,
    };
  }

  // Gleich in einen Entwurf legen, wenn gewaehlt. Zwei Aufrufe statt einem:
  // Zuordnen ist Sache des Abrechnungs-Endpunkts, der die Regeln kennt
  // (Entwurf, eigener Beleg). Scheitert nur dieser Schritt, gibt es die
  // Ausgabe trotzdem - die Detailseite zeigt "Not in a settlement yet" und
  // bietet die Zuordnung an. Ein Fehler hier darf das Angelegte nicht
  // verdecken; ein erneutes Absenden wuerde sonst nichts Neues bewirken.
  const settlementId = field("settlementId");
  if (settlementId) {
    try {
      await assignReceipts(settlementId, [id]);
    } catch (error) {
      console.error("[frontend] Zuordnung nach der Erfassung fehlgeschlagen:", error);
    }
  }

  // Liste, Startseite und die Anzahl in der Seitenleiste.
  revalidatePath("/", "layout");
  // redirect() wirft - deshalb ausserhalb des try, sonst faengt der catch ihn.
  redirect(`/receipts/${encodeURIComponent(id)}`);
}
