// Health-Check fuer Railway.
//
// Pruefung inklusive Belegdienst, nicht nur "der Prozess laeuft": diese
// Oberflaeche hat keine eigene Datenbank mehr, ohne den Dienst kann sie keine
// einzige Zeile anzeigen und soll nicht als gesund durchgehen. Der Dienst
// prueft in seinem /healthz die Datenbank mit, die Kette ist damit
// vollstaendig.
//
// Ohne Anmeldung erreichbar (siehe middleware.ts) - sonst ist der Healthcheck
// dauerhaft rot. Deshalb steht hier auch nichts ueber Daten: nur erreichbar
// oder nicht.
//
// Der Pfad ist /api/healthz, weil in Next alles unter app/api liegt. Bei
// Mastra ist /health belegt - dieses Problem gibt es hier nicht.

import { NextResponse } from "next/server";
import { pingApi } from "@/lib/api/client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pingApi();
    return NextResponse.json({ status: "ok", api: "up" });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        api: "down",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
