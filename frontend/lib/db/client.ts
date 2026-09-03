// Der Datenbankzugriff des Frontends.
//
// Eigener Pool, bewusst getrennt vom Pool des Agenten: das sind zwei Prozesse
// auf derselben Postgres-Instanz. Eine kleine Railway-Datenbank erlaubt rund 20
// Verbindungen insgesamt, die sich Agent (Default 8), Migrations-/Prune-Job und
// dieses Frontend teilen. Default hier deshalb 3 - die Oberflaeche liest nur.
//
// Das Schema kommt aus dem Agent-Repo (mastra-teamsbot/db/schema, also
// ../src/db/schema.ts) und wird hier NICHT dupliziert. Migrationen laufen
// ebenfalls dort; dieses Frontend fuehrt keine aus und legt keine Tabelle an.

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "mastra-teamsbot/db/schema";

const MAX_CONNECTIONS = Number(process.env.FRONTEND_DB_POOL_MAX) || 3;

let cached: NodePgDatabase<typeof schema> | undefined;

/**
 * Lazy, nicht auf Modulebene.
 *
 * `next build` laedt jedes Route- und Page-Modul, um Metadaten zu sammeln. Ein
 * Pool auf Modulebene wuerde dabei einen gueltigen DATABASE_URL im Build
 * verlangen - den es im Container-Build nicht gibt. Die Verbindung entsteht
 * deshalb erst beim ersten Request.
 */
export function getDb(): NodePgDatabase<typeof schema> {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL ist nicht gesetzt. Lokal: `docker compose up postgres -d` und den Wert " +
        "aus .env.example uebernehmen. Auf Railway: Referenz-Variable " +
        "${{ Postgres.DATABASE_URL }} - kein kopierter Connection String.",
    );
  }

  const pool = new Pool({
    connectionString,
    max: MAX_CONNECTIONS,
    idleTimeoutMillis: 30_000,
    // Railway terminiert TLS mit einem eigenen Zertifikat; ohne das schlaegt die
    // Verbindung mit SELF_SIGNED_CERT_IN_CHAIN fehl. Lokal (kein sslmode in der
    // URL) ist ssl schlicht aus. Gleiche Regel wie in src/db/pool.ts.
    ssl: /sslmode=(require|verify)/.test(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
  });

  // Ohne diesen Handler beendet ein Fehler auf einer IDLE-Verbindung den
  // Prozess: pg.Pool emittiert 'error', und ein unbehandeltes 'error'-Event ist
  // in Node eine uncaught exception. Genau das passiert bei jedem
  // Postgres-Neustart. Der Pool erholt sich selbst, die naechste Query oeffnet
  // eine neue Verbindung.
  pool.on("error", (error) => {
    console.error(
      "[db] Fehler auf einer idle-Verbindung (Pool erholt sich selbst):",
      error.message,
    );
  });

  cached = drizzle(pool, { schema });
  return cached;
}
