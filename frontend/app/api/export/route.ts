// Serverseitiger Export.
//
// Wichtig an dieser Route ist, was sie NICHT tut: sie baut keine eigene
// Abfrage. Sie parst dieselben Query-Parameter wie /belege
// (parseReceiptQuery), holt denselben Scope (resolveScope) und laeuft durch
// dieselbe WHERE-Bedingung (buildReceiptWhere, ueber streamReceipts). Was der
// Nutzer in der Tabelle sieht, ist damit genau das, was in der Datei landet -
// und ein spaeterer Berechtigungsfilter kann hier nicht vorbeilaufen.

import { NextResponse, type NextRequest } from "next/server";
import { parseReceiptQuery } from "@/lib/receipts/query-params";
import { streamReceipts } from "@/lib/receipts/queries";
import { resolveScope } from "@/lib/receipts/scope";
import { DEFAULT_EXPORT_FORMAT, EXPORT_FORMATS, exportFileName } from "@/lib/export/formats";

// Kein Caching: der Export haengt an Filtern und am aktuellen Datenbankstand.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = parseReceiptQuery(params);

  const formatName = params.get("format") ?? DEFAULT_EXPORT_FORMAT;
  const format = EXPORT_FORMATS[formatName];
  if (!format) {
    return NextResponse.json(
      {
        error: `Unbekanntes Exportformat "${formatName}".`,
        supported: Object.keys(EXPORT_FORMATS),
      },
      { status: 400 },
    );
  }

  const scope = await resolveScope();
  const stream = format.createStream(streamReceipts(scope, query), params);
  const fileName = exportFileName(query.from, query.to, format.extension);

  return new Response(stream, {
    headers: {
      "Content-Type": format.contentType,
      // Kein Content-Length: die Groesse steht erst fest, wenn die letzte Zeile
      // geschrieben ist. Die Antwort geht chunked raus.
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
