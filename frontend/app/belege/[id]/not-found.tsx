import Link from "next/link";

export default function NotFound() {
  return (
    <div className="border-line rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="text-fg text-sm font-medium">Beleg nicht gefunden</p>
      <p className="text-fg-muted mt-1.5 text-[13px]">
        Die id gehoert zu keinem gespeicherten Beleg.{" "}
        <Link href="/belege" className="text-accent underline">
          Zur Uebersicht
        </Link>
      </p>
    </div>
  );
}
