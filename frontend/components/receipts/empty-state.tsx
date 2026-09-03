// Zwei verschiedene Meldungen, weil es zwei verschiedene Lagen sind: "es gibt
// noch keine Belege" ist ein Hinweis auf den Teams-Flow, "kein Treffer" ein
// Hinweis auf die eigenen Filter. Eine gemeinsame Meldung waere in beiden
// Faellen die falsche.

import Link from "next/link";

export function NoDataYet() {
  return (
    <Frame title="Noch keine Belege erfasst">
      Belege werden in Microsoft Teams eingereicht: Bild an den Bot senden, Vorschlag bestaetigen.
      Erst nach der Bestaetigung entsteht hier eine Zeile.
    </Frame>
  );
}

export function NoMatches() {
  return (
    <Frame title="Keine Treffer">
      Es gibt Belege, aber keinen, der zu diesen Filtern passt. Zeitraum weiter fassen oder{" "}
      <Link href="/belege" className="text-accent underline">
        Filter zuruecksetzen
      </Link>
      .
    </Frame>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-line rounded-lg border border-dashed px-6 py-12 text-center">
      <p className="text-fg text-sm font-medium">{title}</p>
      <p className="text-fg-muted mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed">
        {children}
      </p>
    </div>
  );
}
