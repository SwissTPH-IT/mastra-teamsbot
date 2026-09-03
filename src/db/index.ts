// Drizzle-Instanz für die Fachdaten im Schema "app".
//
// Läuft über denselben Pool wie PostgresStore (src/db/pool.ts). Fachdaten gehen
// ausschliesslich hierüber – nicht über `store.db` / `store.pool`. Die
// Mastra-Referenz bezeichnet den Direktzugriff ausdrücklich als Umgehung der
// Storage-Logik und als Weg für Low-Level-Sonderfälle.

import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from './pool';
import * as schema from './schema';

export const db = drizzle(pool, { schema });

export { schema };
export * from './schema';
