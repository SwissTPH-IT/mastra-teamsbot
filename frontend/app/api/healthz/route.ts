// Health-Check fuer Railway.
//
// Pruefung inklusive Datenbank, nicht nur "der Prozess laeuft": eine
// Oberflaeche ohne Datenbank kann keine einzige Zeile anzeigen und soll nicht
// als gesund durchgehen. Gleiche Logik wie /healthz beim Agenten
// (src/mastra/server/health-route.ts).
//
// Der Pfad ist /api/healthz, weil in Next alles unter app/api liegt. Bei
// Mastra ist /health belegt - dieses Problem gibt es hier nicht.

import { NextResponse } from "next/server";
import { pingDatabase } from "@/lib/receipts/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await pingDatabase();
    return NextResponse.json({ status: "ok", database: "up" });
  } catch (error) {
    return NextResponse.json(
      {
        status: "degraded",
        database: "down",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
