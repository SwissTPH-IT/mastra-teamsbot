// Der Anmeldevorgang. Auth.js bringt beide Handler mit; hier wird nichts
// entschieden, die Konfiguration steht in auth.ts.
//
// Die Callback-URL der App-Registrierung in Entra muss auf genau diesen Pfad
// zeigen: <oeffentliche-url>/api/auth/callback/microsoft-entra-id

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
