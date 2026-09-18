// Serverseitiger Export.
//
// Wichtig an dieser Route ist, was sie NICHT tut: sie baut keine eigene
// Abfrage. Sie parst dieselben Query-Parameter wie /receipts
// (parseReceiptQuery) und holt die Zeilen ueber denselben Dienst-Aufruf wie die
// Liste (fetchReceiptPage, ueber streamReceipts). Was der Nutzer in der Tabelle
// sieht, ist damit genau das, was in der Datei landet.
//
// Der Mandantenfilter sitzt im Dienst und ist hier nicht umgehbar: es gibt
// keinen Parameter, der ihn beeinflusst, und die oid kommt aus der Session.

import { NextResponse, type NextRequest } from "next/server";
import { ApiError, isAuthError, isUnlinkedAccount } from "@/lib/api/client";
import { streamReceipts } from "@/lib/api/stream";
import { parseReceiptQuery } from "@/lib/receipts/query-params";
import { DEFAULT_EXPORT_FORMAT, EXPORT_FORMATS, exportFileName } from "@/lib/export/formats";

// Kein Caching: der Export haengt an Filtern, am Nutzer und am aktuellen
// Datenstand.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const query = parseReceiptQuery(params);

  const formatName = params.get("format") ?? DEFAULT_EXPORT_FORMAT;
  const format = EXPORT_FORMATS[formatName];
  if (!format) {
    return NextResponse.json(
      { error: `Unknown export format "${formatName}".`, supported: Object.keys(EXPORT_FORMATS) },
      { status: 400 },
    );
  }

  // Die erste Seite hier und nicht im Strom: ein Fehler muss VOR dem ersten
  // Byte auffallen. Sobald die Antwort laeuft, ist der Status gesetzt und ein
  // Abbruch landet als halbe Datei im Download-Ordner.
  const pages = streamReceipts(query);
  let first;
  try {
    first = await pages.next();
  } catch (error) {
    return failure(error);
  }

  const batches = (async function* () {
    if (!first.done && first.value) yield first.value;
    yield* pages;
  })();

  return new Response(format.createStream(batches, params), {
    headers: {
      "Content-Type": format.contentType,
      // Kein Content-Length: die Groesse steht erst fest, wenn die letzte Zeile
      // geschrieben ist. Die Antwort geht chunked raus.
      "Content-Disposition": `attachment; filename="${exportFileName(
        query.from,
        query.to,
        format.extension,
      )}"`,
      "Cache-Control": "no-store",
    },
  });
}

function failure(error: unknown): NextResponse {
  if (isAuthError(error)) {
    // Ein Redirect auf die Anmeldung waere hier eine HTML-Seite mit dem
    // Dateinamen einer CSV. 401 ist die ehrlichere Antwort.
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  if (isUnlinkedAccount(error)) {
    return NextResponse.json(
      { error: "No receipts are linked to this account yet." },
      { status: 403 },
    );
  }

  console.error("[frontend] Export fehlgeschlagen:", error);
  return NextResponse.json(
    { error: "The receipt service could not be reached." },
    { status: error instanceof ApiError ? error.status : 502 },
  );
}
