import { Agent } from '@mastra/core/agent';
import { model } from '../model';
import { Memory } from '@mastra/memory';
import { storage } from '../storage';
import { weatherTool } from '../tools/weather-tool';

const memory = new Memory({
  storage,
  options: {
    // Kurzfristiger Gesprächskontext
    lastMessages: 10,
    // Langfristiger, strukturierter Nutzerspeicher (persistiert über Sessions hinweg)
    workingMemory: {
      enabled: true,
      template: `# Nutzerprofil
- Name:
- Präferenzen:
- Letztes Thema:
`,
    },
  },
});

export const assistantAgent = new Agent({
  id: 'assistant-agent',
  name: 'Assistant',
  instructions: `Du bist ein hilfreicher, präziser Assistent.
Antworte auf Deutsch, außer der Nutzer schreibt in einer anderen Sprache.
Wenn nach Wetter gefragt wird, nutze das "get-weather"-Tool.
Merke dir relevante Nutzerinformationen im Working Memory.`,
  // Format: "<provider>/<model>" – Provider-Wechsel = Config-Änderung, kein Rewrite.
  // Passe das über die Umgebungsvariable MASTRA_MODEL an (siehe .env.example).
  model,
  tools: { weatherTool },
  memory,
});
