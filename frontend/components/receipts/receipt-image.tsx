"use client";

// Das Belegbild mit Drehen und Vergroessern.
//
// Beides aus der Vorlage und beides hier echt: gescannte Kassenzettel kommen
// oft um 90 Grad verdreht aus der Kamera, und der Betrag steht im kleinsten
// Druck des Belegs.
//
// Gedreht wird per CSS-Transform im Browser - die Datei bleibt unangetastet.
// Eine gedrehte Kopie zu speichern hiesse, das Original zu veraendern, an dem
// die Extraktion haengt und das im Zweifel der Nachweis ist.

import { useState } from "react";

const BUTTON =
  "border-line bg-panel text-ink-2 hover:bg-surface h-[34px] rounded-[9px] border px-3 text-[12.5px]";

export function ReceiptImage({ src, capturedAt }: { src: string; capturedAt: string }) {
  const [quarterTurns, setQuarterTurns] = useState(0);
  const rotated = quarterTurns % 2 === 1;

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="border-line bg-surface h-[430px] w-full overflow-hidden rounded-xl border">
        {/* Kein next/image: die Bilder kommen als Proxy-Antwort aus dem
            Agenten-Volume, haben keine bekannten Abmessungen und sollen nicht
            durch die Bildoptimierung laufen (sie sind pro Nutzer und duerfen
            nicht in einem gemeinsamen Cache liegen). */}
        <img
          src={src}
          alt="Receipt"
          className="h-full w-full object-contain transition-transform duration-150"
          style={{
            transform: `rotate(${quarterTurns * 90}deg)`,
            // Bei 90/270 Grad tauschen Breite und Hoehe die Rollen; ohne
            // Skalierung ragt das Bild aus dem Rahmen.
            ...(rotated ? { scale: "0.72" } : {}),
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <a href={src} target="_blank" rel="noreferrer" className={BUTTON}>
          Zoom
        </a>
        <button
          type="button"
          onClick={() => setQuarterTurns((turns) => turns + 1)}
          className={BUTTON}
        >
          Rotate
        </button>
        <span className="text-ink-3 ml-auto text-[11.5px]">{capturedAt}</span>
      </div>
    </div>
  );
}
