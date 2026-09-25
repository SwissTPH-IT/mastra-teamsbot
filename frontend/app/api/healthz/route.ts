// Health-Check fuer Railway.
//
// Die Frage, die ein Healthcheck beantwortet, ist NICHT "ist alles in Ordnung",
// sondern "hilft ein Neustart dieses Containers". Railway killt bei Rot den
// Container und blockiert den Deploy. Daraus folgen drei verschiedene
// Antworten:
//
//   API_URL fehlt          -> 503. Eine Fehlkonfiguration, die sich nie von
//                             selbst behebt und beim Deploy auffallen MUSS.
//                             Ohne sie liefe jeder Aufruf gegen localhost und
//                             die Oberflaeche behauptete, der Dienst antworte
//                             nicht - die falsche Diagnose fuer eine nicht
//                             gesetzte Variable.
//   Dienst nicht erreichbar -> 200 mit `api: "down"`. Ein Neustart des
//                             Frontends repariert einen fremden Dienst nicht;
//                             er waere eine Neustartschleife fuer das Problem
//                             eines anderen Services. Die Oberflaeche selbst
//                             funktioniert: /signin laedt, und jede Datenseite
//                             erklaert den Zustand (states.tsx).
//   sonst                  -> 200.
//
// Ohne Anmeldung erreichbar (siehe proxy.ts) - sonst ist der Healthcheck
// dauerhaft rot. Deshalb steht hier auch nichts ueber Daten: nur, ob die Kette
// steht.
//
// Der Pfad ist /api/healthz, weil in Next alles unter app/api liegt. Bei
// Mastra ist /health belegt - dieses Problem gibt es hier nicht.

import { NextResponse } from "next/server";
import { pingApi } from "@/lib/api/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const api = await pingApi();

  if (!api.configured) {
    return NextResponse.json(
      {
        status: "misconfigured",
        api: "unconfigured",
        error:
          "API_URL is not set on this service. Every request would go to localhost. " +
          "Set it to the receipt service, e.g. http://receipt-api.railway.internal:4000",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    status: "ok",
    api: api.reachable ? "up" : "down",
    apiUrl: api.url,
    ...(api.reachable ? {} : { apiError: api.error }),
  });
}
