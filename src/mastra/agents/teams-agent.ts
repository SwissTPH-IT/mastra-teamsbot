// Der Agent hinter dem Microsoft-Teams-Bot.
//
// Er liest selbst keine Bilder. Belege kommen als Teams-Anhang herein und laufen
// über `handleTeamsReceipt` durch den `receipt-workflow` – denselben Workflow,
// den auch das Web-Frontend und das Studio benutzen. Dieser Agent ist der
// Gesprächspartner drumherum: er erklärt sich, beantwortet Rückfragen zu einem
// gerade erfassten Beleg und sagt, was er braucht.
//
// Die Webhook-Route, die Azure als Messaging-Endpoint braucht, leitet Mastra aus
// der `id` unten ab (nicht aus dem Registrierungs-Key in src/mastra/index.ts):
//   POST /api/agents/teams-agent/channels/teams/webhook

import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createTeamsAdapter } from '@chat-adapter/teams';
import { model } from '../model';
import { storage } from '../storage';
import { handleTeamsReceipt } from '../channels/teams-receipt-handler';

const memory = new Memory({
  storage,
  options: {
    lastMessages: 20,
  },
});

export const teamsAgent = new Agent({
  id: 'teams-agent',
  name: 'Belegerfassung',
  instructions: `
Du bist der Belegerfassungs-Bot in Microsoft Teams. Nutzer schicken dir Fotos oder
Scans von Quittungen, ein separater Workflow wandelt sie in strukturierte Daten um.

Antworte immer auf Deutsch, kurz und sachlich.

## Wie die Erfassung läuft

Hängt ein Nutzer ein Bild an die Nachricht, wird der Beleg automatisch verarbeitet
und das Ergebnis separat gepostet – du musst dafür nichts tun und sollst es auch
nicht ankündigen. Du siehst nur Nachrichten *ohne* Bildanhang.

## Was du beantwortest

- Fragen dazu, wie die Erfassung funktioniert: ein Foto der Quittung an die
  Nachricht anhängen (JPG, PNG, WebP oder GIF, maximal 15 MB), mehrere Belege
  dürfen in einer Nachricht sein.
- Rückfragen zu einem Beleg, dessen Ergebnis weiter oben im Verlauf steht.
- Fragen, warum ein Beleg nicht gelesen werden konnte: typische Ursachen sind
  schräge Aufnahme, angeschnittener Rand, Unschärfe oder zu wenig Licht.

## Grenzen

Erfinde niemals Belegdaten. Wenn ein Wert nicht im Verlauf steht, sage das und
bitte um ein neues Foto. Kategorisiere keine Ausgaben und bewerte keine Beträge –
das ist nicht deine Aufgabe.

Kommt eine Nachricht ohne Bild und ohne erkennbare Frage, erklär in einem Satz,
dass du Belegfotos verarbeitest und wie man eines anhängt.
`.trim(),
  model,
  memory,
  channels: {
    adapters: {
      teams: {
        // appId / appPassword / appTenantId liest der Adapter aus
        // TEAMS_APP_ID, TEAMS_APP_PASSWORD und TEAMS_APP_TENANT_ID.
        // SingleTenant passt zu einer App, die auf genau einen Azure-Tenant
        // registriert ist – dann MUSS TEAMS_APP_TENANT_ID gesetzt sein.
        adapter: createTeamsAdapter({
          appType: 'SingleTenant',
        }),
        // Ohne das bekommt der Nutzer bei einer Exception nichts zu sehen.
        formatError: (error: Error) =>
          `❌ Da ist etwas schiefgelaufen: ${error.message}\nBitte versuche es noch einmal oder schick den Beleg erneut.`,
      },
    },
    handlers: {
      // Alle drei Wege, auf denen ein Beleg hereinkommen kann: @-Mention im
      // Kanal, Direktnachricht, und Folgenachricht in einem abonnierten Thread.
      onMention: handleTeamsReceipt,
      onDirectMessage: handleTeamsReceipt,
      onSubscribedMessage: handleTeamsReceipt,
    },
  },
});
