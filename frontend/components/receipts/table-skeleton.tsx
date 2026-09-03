// Ladezustand mit der Form des Ergebnisses, nicht mit einem Spinner: die
// Tabelle springt dadurch beim Eintreffen der Daten nicht.
//
// Bewusst eine Komponente und KEIN app/belege/loading.tsx: eine loading.tsx
// gilt auch fuer die Kind-Segmente, also fuer /belege/<id>. Der Response
// beginnt dann zu streamen, bevor die Seite weiss, ob es den Beleg gibt - und
// ein notFound() danach kann den Status nicht mehr auf 404 setzen, die
// 404-Seite ginge mit 200 raus. Die Suspense-Grenze steht deshalb in
// app/belege/page.tsx und umfasst nur die Liste.

export function TableSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-live="polite">
      <span className="sr-only">Belege werden geladen</span>
      <div className="flex justify-end">
        <div className="bg-surface-2 h-8 w-40 animate-pulse rounded-md" />
      </div>
      <div className="border-line overflow-hidden rounded-lg border">
        <div className="bg-surface-2 border-line h-9 border-b" />
        {Array.from({ length: 12 }, (_, index) => (
          <div
            key={index}
            className="border-line flex h-9 items-center gap-3 border-b px-3 last:border-0"
          >
            <div className="bg-surface-2 h-3 w-20 animate-pulse rounded" />
            <div className="bg-surface-2 h-3 w-48 animate-pulse rounded" />
            <div className="bg-surface-2 ml-auto h-3 w-24 animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
