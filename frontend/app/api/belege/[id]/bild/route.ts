// Belegbild fuer die Detailansicht.
//
// Die Bilder liegen NICHT in Postgres, sondern als Dateien im Datenverzeichnis
// des Agenten (app.receipts.file_reference haelt nur den Zeiger
// "local:uploads/<uploadId>"). Das Frontend hat auf dieses Verzeichnis keinen
// Zugriff - es ist ein anderer Service mit einem anderen Volume. Deshalb ein
// Proxy auf den Endpunkt des Agenten.
//
// Die Route haengt bewusst an der BELEG-id und nicht an der uploadId: so laeuft
// der Zugriff durch getReceipt() und damit durch denselben Scope wie die
// Ansicht. Eine Route auf die uploadId waere der Weg, an jedes Bild zu kommen,
// ohne die Zeile sehen zu duerfen.

import { NextResponse } from "next/server";
import { getReceipt } from "@/lib/receipts/queries";
import { resolveScope } from "@/lib/receipts/scope";

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

  const scope = await resolveScope();
  const receipt = await getReceipt(scope, id);
  if (!receipt) {
    return NextResponse.json({ error: "Beleg nicht gefunden." }, { status: 404 });
  }

  const match = LOCAL_REFERENCE.exec(receipt.fileReference);
  if (!match) {
    return NextResponse.json(
      { error: `Referenzschema wird nicht unterstuetzt: ${receipt.fileReference}` },
      { status: 501 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${MASTRA_URL}/receipts/${match[1]}/file`, { cache: "no-store" });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Der Agent-Service ist nicht erreichbar, das Belegbild liegt dort.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "Belegbild nicht verfuegbar." },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
      // private: die Datei gehoert einem Nutzer, sie soll in keinem gemeinsamen
      // Cache liegen.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
