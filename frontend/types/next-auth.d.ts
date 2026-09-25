// Die Felder, die diese Anwendung an Session und Token haengt.
//
// Ohne diese Erweiterung ist `session.oid` fuer TypeScript nicht vorhanden -
// und der API-Client haette an genau der Stelle ein `as any`, an der die
// Mandantentrennung haengt.

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session extends DefaultSession {
    /**
     * Entra Object ID des angemeldeten Menschen. Geht als X-Subject-Aad an den
     * Belegdienst; die Zuordnung zur Teams-userId macht dort app.users.
     */
    oid?: string;
    tid?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    oid?: string;
    tid?: string;
  }
}
