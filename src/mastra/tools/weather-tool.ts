import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// Bewusst ohne externen API-Call gehalten, damit der Stack ohne
// zusätzliche Keys/Netzwerkzugriffe sofort lauffähig ist.
// Für echte Daten hier z.B. fetch() gegen eine Wetter-API einbauen.
export const weatherTool = createTool({
  id: 'get-weather',
  description: 'Gibt die aktuelle (simulierte) Wetterlage für eine Stadt zurück.',
  inputSchema: z.object({
    city: z.string().describe('Name der Stadt, z.B. "Basel"'),
  }),
  outputSchema: z.object({
    city: z.string(),
    temperatureC: z.number(),
    conditions: z.string(),
  }),
  execute: async ({ city }) => {
    const conditionsPool = ['Sonnig', 'Bewölkt', 'Regnerisch', 'Windig', 'Neblig'];
    return {
      city,
      temperatureC: Math.round(8 + Math.random() * 18),
      conditions: conditionsPool[Math.floor(Math.random() * conditionsPool.length)],
    };
  },
});
