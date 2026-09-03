"use client";

// Fehlerzustand der Ansicht. Der haeufigste Fall ist eine nicht erreichbare
// Datenbank - dann ist die Meldung des Fehlers hilfreicher als eine leere
// Tabelle, die aussieht wie "keine Belege vorhanden".

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="border-danger/40 rounded-lg border px-6 py-10 text-center">
      <p className="text-fg text-sm font-medium">Die Belege konnten nicht geladen werden</p>
      <p className="text-fg-muted mx-auto mt-1.5 max-w-lg text-[13px] leading-relaxed">
        {error.message}
      </p>
      <button
        type="button"
        onClick={reset}
        className="border-line text-fg hover:bg-surface-2 mt-4 h-8 rounded-md border px-3 text-[13px] font-medium"
      >
        Erneut versuchen
      </button>
    </div>
  );
}
