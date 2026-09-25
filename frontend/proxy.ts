// Alles hinter dem Login - mit genau drei Ausnahmen.
//
// Heisst in Next 16 "proxy" und nicht mehr "middleware" (die alte Benennung
// laeuft noch, warnt aber beim Build). Inhalt und Signatur sind dieselben:
// eine Funktion, die vor jedem Request laeuft.
//
// Der Matcher ist eine Positivliste des Oeffentlichen, keine Liste des
// Geschuetzten. Der Unterschied ist der Ernstfall: eine neue Seite ist damit
// automatisch geschuetzt. Waere es umgekehrt, waere jede neue Route
// versehentlich oeffentlich.
//
//   /api/healthz     muss ohne Anmeldung antworten, sonst ist der
//                    Railway-Healthcheck immer rot.
//   /api/auth/*      der Anmeldevorgang selbst.
//   /signin          die Anmeldeseite.
//
// Bild- und Export-Route liegen bewusst NICHT in den Ausnahmen: beide liefern
// Belegdaten aus.
//
// Die Pruefung selbst ist der `authorized`-Callback in auth.ts.

export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    "/((?!api/healthz|api/auth|signin|_next/static|_next/image|favicon.ico|swiss-tph.png).*)",
  ],
};
