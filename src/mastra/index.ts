import { Mastra } from '@mastra/core';
import { chatRoute } from '@mastra/ai-sdk';
import { storage } from './storage';
import { assistantAgent } from './agents/assistant-agent';
import { receiptExtractionAgent } from './agents/receipt-agent';
import { receiptChatAgent } from './agents/receipt-chat-agent';
import { teamsAgent } from './agents/teams-agent';
import { receiptCorrectionAgent } from './agents/receipt-correction-agent';
import { receiptExtractionWorkflow } from './workflows/receipt-extraction-workflow';
import { receiptReviewWorkflow } from './workflows/receipt-review-workflow';
import { receiptRoutes } from './server/receipt-routes';
import { healthRoute } from './server/health-route';
import { MAX_UPLOAD_BYTES } from './receipts/upload-store';

export const mastra = new Mastra({
  agents: {
    assistantAgent,
    receiptExtractionAgent,
    // Wendet Freitext-Korrekturen auf einen Kandidatensatz an. Wird nur aus dem
    // Review-Workflow heraus aufgerufen, nicht direkt von einem Nutzer.
    receiptCorrectionAgent,
    // Der Teams-Bot. Achtung: die Webhook-Route hängt an der `id` des Agents
    // ('teams-agent'), nicht an diesem Key:
    //   POST /api/agents/teams-agent/channels/teams/webhook
    teamsAgent,
    // Der :agentId in der Chat-Route ist dieser Property-Key, nicht die id des
    // Agents. Das Frontend spricht also /chat/receiptChatAgent an.
    receiptChatAgent,
  },
  workflows: {
    // Die Extraktion allein – vom Web-Pfad (extract-receipt-tool) und aus dem
    // Studio aufgerufen. Läuft immer durch, suspendiert nie.
    receiptExtractionWorkflow,
    // Extraktion + Kontrolle durch den Nutzer + DB-Write. Der Teams-Pfad.
    receiptReviewWorkflow,
  },
  storage,
  server: {
    // 0.0.0.0 ist zwingend nötig, damit der Server im Container von außen
    // (über den Docker-Portmapping) erreichbar ist. "localhost" wäre nur
    // innerhalb des Containers selbst erreichbar.
    host: process.env.MASTRA_HOST || '0.0.0.0',
    port: Number(process.env.PORT) || 4111,
    // Der Frontend-Container proxied über seine eigenen Route Handler, dafür
    // braucht es kein CORS. Der Eintrag hier erlaubt zusätzlich den direkten
    // Weg aus dem Browser (siehe README, Variante B).
    cors: {
      origin: (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').split(','),
      credentials: true,
    },
    // Default liegt deutlich unter einem Handyfoto.
    bodySizeLimit: MAX_UPLOAD_BYTES + 1024 * 1024,
    apiRoutes: [
      // Streamt Agent-Antworten im AI-SDK-Format, das assistant-ui erwartet.
      // version: 'v7' passt zu ai@7 / @ai-sdk/react@4 im Frontend.
      chatRoute({
        path: '/chat/:agentId',
        version: 'v7',
        defaultOptions: {
          // Tool-Aufruf plus Zusammenfassung brauchen mehrere Schritte.
          maxSteps: 8,
        },
      }),
      ...receiptRoutes,
      healthRoute,
    ],
    build: {
      swaggerUI: true,
      openAPIDocs: true,
    },
  },
});
