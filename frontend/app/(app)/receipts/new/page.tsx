// Ausgabe ohne Beleg erfassen.
//
// Die Vorlage zeigt das als Dialog ueber der Liste. Hier ist es eine eigene
// Seite: sie funktioniert ohne JavaScript, hat eine Adresse (Zurueck-Button,
// Lesezeichen) und braucht keine abgefangene Route. Aufbau und Texte sind die
// des Dialogs - siehe frontend/README.md, Abweichungen von der Vorlage.

import Link from "next/link";
import { ManualEntryForm } from "@/components/receipts/manual-entry-form";
import { fetchSettlements, type ApiSettlement } from "@/lib/api/settlements";

// Jede Anzeige bekommt eine eigene id (siehe unten) - nie aus einem Cache.
export const dynamic = "force-dynamic";

export default async function NewExpensePage() {
  // Die id der kuenftigen Zeile, vergeben beim Rendern. Sie ist der
  // Idempotenz-Key: ein doppelt abgeschicktes Formular (Doppelklick, Reload
  // nach dem POST) trifft im Dienst dieselbe Zeile, statt eine zweite Ausgabe
  // anzulegen. Eine Ausgabe ohne Beleg hat keinen Datei-Hash, der das sonst
  // uebernimmt.
  const entryId = crypto.randomUUID();

  // Heute nach Schweizer Kalender, nicht nach der Zone des Servers (UTC) -
  // kurz nach Mitternacht waere sonst gestern vorgeschlagen.
  const today = new Intl.DateTimeFormat("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());

  // Die Entwuerfe fuer "Settlement (optional)". Scheitert das, bleibt die
  // Auswahl leer statt die Seite zu verweigern: Erfassen geht auch ohne, und
  // zuordnen laesst sich danach auf der Detailseite.
  let drafts: ApiSettlement[] = [];
  try {
    drafts = await fetchSettlements("draft");
  } catch (error) {
    console.error("[frontend] Entwuerfe fuer die Erfassung nicht ladbar:", error);
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <nav className="text-ink-3 flex items-center gap-[10px] text-[13px]">
        <Link href="/receipts" className="text-brand font-medium">
          Receipts
        </Link>
        <span>/</span>
        <span className="text-ink-2">Add expense without receipt</span>
      </nav>

      <div className="border-line bg-panel flex w-full max-w-[760px] flex-col gap-5 rounded-2xl border p-[26px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-[-0.012em]">
              Add expense without receipt
            </h1>
            <div className="text-ink-3 mt-[5px] text-[13px]">
              Allowed up to 20.00 CHF per item. Above that a receipt is mandatory.
            </div>
          </div>
          <Link
            href="/receipts"
            aria-label="Close"
            className="border-line bg-panel text-ink-2 hover:bg-surface flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border text-sm"
          >
            ×
          </Link>
        </div>

        <ManualEntryForm
          entryId={entryId}
          today={today}
          drafts={drafts.map((draft) => ({ id: draft.id, title: draft.title }))}
          teamsUrl={process.env.TEAMS_CHAT_URL ?? null}
        />
      </div>
    </div>
  );
}
