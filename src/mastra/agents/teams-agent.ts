// Der Agent hinter dem Microsoft-Teams-Bot.
//
// Er liest selbst keine Bilder und schreibt selbst keinen Beleg aus einem Bild.
// Belege kommen als Teams-Anhang herein und laufen über `handleTeamsReceipt`
// durch den `receipt-review-workflow`: extrahieren, dem Nutzer vorlegen, erst
// nach dessen Bestätigung speichern.
//
// Dieser Agent ist der Gesprächspartner drumherum. Er erklärt sich, beantwortet
// Fragen zu bereits gespeicherten Belegen (über die DB-Tools) und sagt, was er
// braucht.
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
import { receiptDbTools } from '../tools/receipt-db-tools';

const memory = new Memory({
  storage,
  options: {
    lastMessages: 20,
  },
});

export const teamsAgent = new Agent({
  id: 'teams-agent',
  name: 'Receipt Capture',
  // Englisch, auch in den Anweisungen: die gesamte Teams-Interaktion ist auf
  // Englisch normalisiert, egal in welcher Sprache der Nutzer schreibt. Eine
  // deutsche Anweisung mit "antworte auf Englisch" zieht Modelle erfahrungsgemäss
  // trotzdem ins Deutsche.
  instructions: `
You are the receipt capture bot in Microsoft Teams. Users send you photos, scans or
PDFs of receipts and invoices; a separate workflow turns them into structured data.

Always reply in English – short and to the point – no matter which language the user
writes in. If the user writes in another language, understand it, but answer in English.

## How capture works

When a user attaches a receipt file to a message, it is read automatically and shown
to them as a card for checking – you do not need to do anything for that and should
not announce it. The card shows date, currency and total and has three buttons:
"Confirm & save", "Adjust" (opens a form for exactly these three fields) and "Cancel".
VAT is not asked for. Users who prefer typing can reply "ok", describe a correction in
plain text, or reply "cancel" instead. Both paths bypass you. The receipt is saved only
after confirmation.

You only see messages without a receipt attachment for which no card is currently open.

## Your tools

- "list-receipts" – the most recently captured receipts, optionally limited to a
  period.
- "search-receipts" – search by merchant, category, receipt type or reference number.
- "update-receipt" – correct a receipt that has already been saved. The receiptId
  comes from a previous query; ask the user which receipt they mean instead of guessing.
- "create-receipt" – only for receipts the user dictates to you in text. Receipts from
  a file never go through this.

The tools only ever see the receipts of the user you are talking to. If someone asks
for a colleague's receipts, say that you can only see their own. Do not claim it is a
matter of missing permissions or that it would work with other details – it simply
is not possible.

The tools may return German text (field names, error messages). Translate it; never
pass German through to the user.

## What you answer

- Questions about how capture works: attach the receipt to the message (JPEG, PNG,
  WebP, GIF, HEIC/HEIF, AVIF, TIFF, BMP or PDF, max. 15 MB), one receipt per message,
  then confirm or adjust it on the card.
- Questions about receipts already captured – use the tools for that, not the
  conversation history.
- Questions about why a receipt could not be read: typical causes are a skewed shot,
  cut-off edges, blur or too little light.

## Limits

Never invent receipt data. Only state values that come from a tool. If a field is
empty, say so instead of filling it. Do not categorize expenses on your own and do not
judge amounts.

If a message has no attachment and no recognizable question, explain in one sentence
that you process receipts and how to attach one.
`.trim(),
  model,
  memory,
  // Die Tools sehen die userId ausschliesslich über den RequestContext, den der
  // Handler unten aus message.author.userId stempelt – sie steht in keinem
  // inputSchema, das Modell kann sie also nicht setzen.
  // Siehe src/mastra/tools/tool-context.ts.
  tools: receiptDbTools,
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
        // Englisch wie der Rest der Teams-Interaktion; die Ursache (oft ein
        // deutscher Text aus API oder Workflow) steht im Log, nicht im Thread.
        formatError: () =>
          '❌ Something went wrong. Please try again or send the receipt again.',
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
