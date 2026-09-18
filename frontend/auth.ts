// Der Login. Entra ID, Authorization Code Flow, Session als verschluesseltes
// Cookie (JWT-Strategie) - keine Session-Tabelle, weil das Frontend keine
// Datenbank mehr anfasst.
//
// Was diese Datei liefert, ist genau EIN Wert: die Entra Object ID (`oid`) des
// angemeldeten Menschen. Damit ruft der API-Client den Belegdienst
// (X-Subject-Aad), und DER loest `oid` -> Teams-userId auf. Das Frontend kennt
// die Teams-userId nie und kann sie deshalb auch nicht verwechseln.
//
// Bewusst KEIN Zugriffstoken fuer die API: dafuer braeuchte es eine zweite
// App-Registrierung in Entra (eine mit "expose an API" und einem Scope). Die
// ist nicht angelegt, und solange der Dienst dem Frontend ueber den
// Service-Token vertraut, braucht es sie nicht. `openid profile email` genuegt
// - diese Oberflaeche ruft keine Graph-API.
//
// Wenn das Frontend spaeter selbst schreiben soll, was ueber "eigene Belege"
// hinausgeht, ist die API-Registrierung der naechste Schritt, und dann
// wandert hier ein access_token herein statt der oid.

import NextAuth, { type NextAuthConfig } from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

const ISSUER =
  process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER ?? "https://login.microsoftonline.com/common/v2.0";

export const authConfig: NextAuthConfig = {
  // Railway terminiert TLS vor dem Container; ohne trustHost baut Auth.js die
  // Callback-URL aus dem internen Host und der Redirect geht ins Leere.
  trustHost: true,

  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: ISSUER,
      authorization: { params: { scope: "openid profile email" } },

      /**
       * Eigenes profile() statt des mitgelieferten.
       *
       * Das Standard-Profil des Providers holt das Profilbild ueber die
       * Graph-API. Das ist ein zusaetzlicher Netzwerkaufruf bei jeder
       * Anmeldung, ein Bild als base64 im Session-Cookie - und es braucht
       * User.Read, das wir nicht anfordern. Die Initialen in der Seitenleiste
       * kommen aus dem Namen.
       */
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name ?? profile.preferred_username ?? null,
          email: profile.email ?? profile.preferred_username ?? null,
          image: null,
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    // Ein Arbeitstag. Der Default von 30 Tagen passt nicht zu Daten, die
    // Spesen einzelner Personen zeigen, und es gibt kein Zugriffstoken, dessen
    // Ablauf die Sitzung sonst begrenzen wuerde.
    maxAge: 12 * 60 * 60,
  },

  pages: { signIn: "/signin" },

  callbacks: {
    /**
     * Die Tuer. Wird von der Middleware ausgewertet (middleware.ts) und
     * entscheidet nur eines: angemeldet oder nicht. WELCHE Belege jemand sieht,
     * entscheidet ausschliesslich der API-Dienst anhand der oid - hier gibt es
     * keinen zweiten Filter, der damit auseinanderlaufen koennte.
     */
    authorized({ auth: session }) {
      return !!session?.user;
    },

    /**
     * `oid` und `tid` aus dem ID-Token ins Cookie.
     *
     * `profile` gibt es nur beim Anmelden; bei jedem spaeteren Aufruf steht das
     * Token schon geschrieben und wird unveraendert durchgelassen.
     */
    async jwt({ token, profile }) {
      if (profile) {
        token.oid = typeof profile.oid === "string" ? profile.oid : undefined;
        token.tid = typeof profile.tid === "string" ? profile.tid : undefined;
      }
      return token;
    },

    async session({ session, token }) {
      session.oid = typeof token.oid === "string" ? token.oid : undefined;
      session.tid = typeof token.tid === "string" ? token.tid : undefined;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
