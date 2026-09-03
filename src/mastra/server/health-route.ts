// Health-Check für Railway.
//
// Die eingebauten GET /api und GET /health antworten, sobald der Prozess steht –
// sie sagen nichts darüber, ob die Datenbank erreichbar ist. Ein Container, der
// läuft, aber keine DB hat, kann keinen einzigen Beleg verarbeiten und soll
// deshalb auch nicht als gesund gelten.
//
// Der Pfad ist /healthz, NICHT /health: /health ist von Mastra belegt und
// gewinnt gegen eine gleichnamige eigene Route (sie liefert dann {"success":true}
// ohne jede DB-Prüfung). Das ist still und fällt sonst erst auf, wenn ein
// kaputter Deploy als gesund durchgewinkt wird.

import { registerApiRoute } from '@mastra/core/server';
import { pool } from '../../db/pool';

export const healthRoute = registerApiRoute('/healthz', {
  method: 'GET',
  openapi: {
    summary: 'Health-Check inklusive Datenbankverbindung',
    tags: ['ops'],
    responses: {
      '200': { description: 'Prozess und Datenbank erreichbar' },
      '503': { description: 'Datenbank nicht erreichbar' },
    },
  },
  handler: async c => {
    try {
      await pool.query('SELECT 1');
      return c.json({ status: 'ok', database: 'up' });
    } catch (error) {
      return c.json(
        {
          status: 'degraded',
          database: 'down',
          error: error instanceof Error ? error.message : String(error),
        },
        503,
      );
    }
  },
});
