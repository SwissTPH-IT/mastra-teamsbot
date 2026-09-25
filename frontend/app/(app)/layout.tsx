// Die Huelle: Seitenleiste links, Inhalt rechts. Wie in der Vorlage.
//
// Die Routengruppe (app) existiert, damit die Anmeldeseite (/signin) diese
// Huelle NICHT bekommt - sie soll keine Navigation zeigen, in der nichts
// anklickbar ist.

import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { fetchSummary } from "@/lib/api/receipts";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  // Die Middleware faengt das normalerweise ab. Hier nochmal, weil eine Seite
  // ohne Session sonst mit einer nichtssagenden Fehlermeldung rendert - und
  // weil die Middleware bei einer Fehlkonfiguration des Matchers stillschweigend
  // nicht laufen wuerde.
  if (!session?.user) redirect("/signin");

  const receiptCount = await countReceipts();

  return (
    <div className="bg-bg flex min-h-dvh items-start">
      <Sidebar
        userName={session.user.name ?? "Signed in"}
        userEmail={session.user.email ?? ""}
        receiptCount={receiptCount}
        signOut={
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button
              type="submit"
              className="border-line bg-panel text-ink-2 hover:bg-surface flex h-[34px] w-full items-center justify-center gap-[7px] rounded-[9px] border px-3 text-[12.5px]"
            >
              Sign out
            </button>
          </form>
        }
      />

      <div className="min-w-0 flex-1 px-12 pt-10 pb-[132px] max-w-[1196px]">{children}</div>
    </div>
  );
}

/**
 * Der Zaehler am Navigationspunkt "Receipts".
 *
 * Fehler werden hier geschluckt und zu `null`: ein nicht verknuepftes Konto
 * (403) oder ein kurz nicht erreichbarer Dienst darf nicht die ganze Huelle
 * zerlegen. Die Seite selbst erklaert den Zustand dann ausfuehrlich - ein
 * fehlendes Badge ist die richtige Menge Aufregung an dieser Stelle.
 */
async function countReceipts(): Promise<number | null> {
  try {
    const summary = await fetchSummary();
    return summary.reduce((sum, entry) => sum + entry.count, 0);
  } catch {
    return null;
  }
}
