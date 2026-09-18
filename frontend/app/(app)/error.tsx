"use client";

// Die Fehlergrenze der angemeldeten Ansicht.
//
// Sie faengt, was die Seiten NICHT selbst einordnen - ein unerwarteter Fehler
// beim Rendern. Erwartete Faelle (nicht verknuepftes Konto, Dienst nicht
// erreichbar, Beleg nicht gefunden) behandeln die Seiten mit eigenen Texten,
// weil sie dort etwas erklaeren koennen.
//
// Ohne diese Datei zeigt Next die eigene Fehlerseite, und die kommt ohne
// Navigation - der Nutzer landet in einer Sackgasse.

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="border-line bg-panel flex flex-col items-center gap-3 rounded-[14px] border px-12 py-[72px] text-center">
      <div className="text-[18px] font-semibold">Something went wrong</div>
      <div className="text-ink-2 max-w-[440px] text-[13.5px] leading-[1.6]">
        This view could not be rendered. Your receipts are not affected.
      </div>
      <button
        type="button"
        onClick={reset}
        className="bg-brand hover:bg-brand-deep mt-2 h-10 rounded-[10px] px-4 text-[13.5px] font-medium text-white"
      >
        Try again
      </button>
    </div>
  );
}
