// 404 fuer eine Abrechnung. Wie beim Beleg: "gibt es nicht" und "gehoert
// jemand anderem" sehen gleich aus, damit eine geratene id nichts verraet.

import Link from "next/link";
import { Panel } from "@/components/receipts/states";

export default function SettlementNotFound() {
  return (
    <Panel>
      <div className="text-[18px] font-semibold">Settlement not found</div>
      <div className="text-ink-2 max-w-[440px] text-[13.5px] leading-[1.6]">
        This settlement does not exist, or it is not one of yours.
      </div>
      <Link
        href="/settlements"
        className="bg-brand hover:bg-brand-deep mt-2 flex h-10 items-center rounded-[10px] px-4 text-[13.5px] font-medium text-white"
      >
        Back to settlements
      </Link>
    </Panel>
  );
}
