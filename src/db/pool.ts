// Der EINE pg.Pool der Anwendung.
//
// Sowohl PostgresStore (Mastra-Schema) als auch Drizzle (Fachdaten im Schema
// "app") laufen darüber. Die @mastra/pg-Referenz beschreibt genau diesen Fall:
// "Pre-configured pg.Pool instance. Use this for direct control over the
// connection pool, or for integration with libraries that expect a pg.Pool."
// (https://mastra.ai/reference/storage/postgresql)
//
// Wichtig dabei: übergeben wir den Pool selbst, schliesst `store.close()` ihn
// NICHT – der Lifecycle liegt bei uns (siehe closePool()).

import { Pool } from 'pg';

/**
 * Poolgrösse bewusst klein.
 *
 * PostgresStore würde von sich aus bis zu 20 Verbindungen öffnen (Default `max`
 * in der Referenz). Eine kleine Railway-Postgres-Instanz erlaubt insgesamt rund
 * 20 – die teilen sich Agent, der Migrations-/Prune-Job und später das Frontend.
 * 8 lässt Luft; über DB_POOL_MAX anpassbar, wenn die Instanz grösser wird.
 */
const MAX_CONNECTIONS = Number(process.env.DB_POOL_MAX) || 8;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL ist nicht gesetzt. Lokal: `docker compose up postgres` und den Wert aus ' +
      '.env.example übernehmen. Auf Railway: Referenz-Variable ${{ Postgres.DATABASE_URL }}.',
  );
}

export const pool = new Pool({
  connectionString,
  max: MAX_CONNECTIONS,
  idleTimeoutMillis: 30_000,
  // Railway terminiert TLS mit einem eigenen Zertifikat. Ohne das schlägt die
  // Verbindung mit SELF_SIGNED_CERT_IN_CHAIN fehl. Lokal (kein sslmode in der
  // URL) ist ssl schlicht aus.
  ssl: /sslmode=(require|verify)/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
});

/**
 * Ohne diesen Handler beendet ein Fehler auf einer IDLE-Verbindung den ganzen
 * Prozess: pg.Pool emittiert dann 'error', und ein unbehandeltes 'error'-Event
 * ist in Node ein uncaught exception.
 *
 * Genau das passiert bei jedem Postgres-Neustart und bei jedem Verbindungsabbruch
 * – also auch, wenn Railway die Datenbank kurz durchstartet. Der Agent würde
 * mitsterben, obwohl der Pool sich von selbst erholt: die kaputte Verbindung
 * wird verworfen, die nächste Query öffnet eine neue.
 *
 * Mitloggen und weiterlaufen ist deshalb richtig. Ob die Datenbank wirklich
 * erreichbar ist, beantwortet GET /healthz.
 */
pool.on('error', error => {
  console.error('[db] Fehler auf einer idle-Verbindung (Pool erholt sich selbst):', error.message);
});

/** Schliesst den Pool. Für Skripte (migrate/prune) und Tests. */
export async function closePool(): Promise<void> {
  await pool.end();
}
