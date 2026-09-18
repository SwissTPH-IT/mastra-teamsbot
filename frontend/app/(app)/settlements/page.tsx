// Die Abrechnungen - noch nicht gebaut.
//
// Die Seite existiert, damit der Navigationspunkt nicht ins Leere zeigt, wenn
// jemand die URL direkt aufruft (verlinkt ist er nicht, er ist ausgegraut).
// Inhalt ist die Absicht, nicht eine halbe Oberflaeche: was hier entsteht,
// steht in dev/api-service-und-entra-auth.md, Phase 5.

import Link from "next/link";
import { Panel } from "@/components/receipts/states";

export default function SettlementsPage() {
  return (
    <div className="flex flex-col gap-[22px]">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.018em]">Settlements</h1>
        <div className="text-ink-3 mt-[6px] text-[13px]">Not available yet</div>
      </div>

      <Panel>
        <div className="text-[18px] font-semibold">Settlements are coming</div>
        <div className="text-ink-2 max-w-[520px] text-[13.5px] leading-[1.6]">
          A settlement will group the receipts of one trip: title, purpose, destination and period,
          submitted once and then locked. Until then every receipt stays unassigned, and nothing is
          lost — assigning them later works on the receipts that are already here.
        </div>
        <Link href="/receipts" className="text-brand mt-2 text-[13px] font-medium">
          Back to receipts
        </Link>
      </Panel>
    </div>
  );
}
