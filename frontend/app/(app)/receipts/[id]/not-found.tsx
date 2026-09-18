// 404 fuer einen Beleg.
//
// Derselbe Text fuer "gibt es nicht" und "gehoert jemand anderem": der Dienst
// unterscheidet die beiden Faelle nach aussen nicht, und diese Seite soll es
// auch nicht tun. Eine Meldung "gehoert jemand anderem" waere die Auskunft,
// dass die geratene id existiert.

import Link from "next/link";
import { Panel } from "@/components/receipts/states";

export default function ReceiptNotFound() {
  return (
    <Panel>
      <div className="text-[18px] font-semibold">Receipt not found</div>
      <div className="text-ink-2 max-w-[440px] text-[13.5px] leading-[1.6]">
        This receipt does not exist, or it is not one of yours.
      </div>
      <Link
        href="/receipts"
        className="bg-brand hover:bg-brand-deep mt-2 flex h-10 items-center rounded-[10px] px-4 text-[13.5px] font-medium text-white"
      >
        Back to receipts
      </Link>
    </Panel>
  );
}
