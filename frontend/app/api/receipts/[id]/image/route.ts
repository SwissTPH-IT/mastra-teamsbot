// Belegbild fuer die Detailansicht.
//
// Die Bilder liegen NICHT in Postgres und auch nicht beim Belegdienst, sondern
// als Dateien im Datenverzeichnis des Agenten (receipts.file_reference haelt
// nur den Zeiger "local:uploads/<uploadId>"). Diese Oberflaeche hat auf das
// Verzeichnis keinen Zugriff - anderer Service, anderes Volume. Deshalb ein
// Proxy auf den Endpunkt des Agenten.
//
// Die Route haengt bewusst an der BELEG-id und nicht an der uploadId: so laeuft
// der Zugriff durch fetchReceipt() und damit durch dieselbe Pruefung wie die
// Detailseite. Eine Route auf die uploadId waere der Weg, an jedes Bild zu
// kommen, ohne die Zeile sehen zu duerfen - und der Endpunkt des Agenten hat
// selbst keine Autorisierung.

import { NextResponse } from "next/server";
import { isAuthError, isNotFound, isUnlinkedAccount } from "@/lib/api/client";
import { fetchReceipt } from "@/lib/api/receipts";

export const dynamic = "force-dynamic";

const MASTRA_URL = (process.env.MASTRA_URL || "http://localhost:4111").replace(/\/+$/, "");

/**
 * Nur das heute existierende Referenzschema. Kommt ein Objektspeicher dazu
 * ("s3:..."), soll diese Stelle laut auffallen und nicht stillschweigend eine
 * falsche URL bauen - siehe README, "Offene Luecke: Objektspeicher".
 */
const LOCAL_REFERENCE = /^local:uploads\/([A-Za-z0-9-]+\.[a-z]{3,4})$/;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let fileReference: string | null;
  try {
    fileReference = (await fetchReceipt(id)).fileReference;
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    if (isNotFound(error) || isUnlinkedAccount(error)) {
      // Fremder Beleg und nicht existierender Beleg sehen gleich aus. Sonst
      // beantwortet ein 403 die Frage, ob eine geratene id existiert.
      return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
    }
    console.error("[frontend] Beleg fuer Bildabruf nicht ladbar:", error);
    return NextResponse.json({ error: "Receipt service unavailable." }, { status: 502 });
  }

  // Ausgabe ohne Beleg: es gibt schlicht kein Bild. 404 und nicht 501 - das
  // ist kein fehlendes Feature, sondern der erwartete Zustand.
  if (fileReference === null) {
    return NextResponse.json({ error: "This expense has no receipt image." }, { status: 404 });
  }

  const match = LOCAL_REFERENCE.exec(fileReference);
  if (!match) {
    return NextResponse.json(
      { error: `Unsupported file reference scheme: ${fileReference}` },
      { status: 501 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${MASTRA_URL}/receipts/${match[1]}/file`, { cache: "no-store" });
  } catch (error) {
    return NextResponse.json(
      {
        error: "The agent service holds the image and is not reachable.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "Receipt image not available." },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      // private: die Datei gehoert einem Nutzer, sie soll in keinem
      // gemeinsamen Cache liegen.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
