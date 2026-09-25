// Die Textantwort auf eine offene Karte. Die Karte spricht Englisch, also muss
// eine englische Antwort genauso zählen wie früher "passt" – und eine englische
// Einschränkung ("ok but …") darf keine Buchung auslösen.

import { describe, expect, it } from 'vitest';

// Der Handler zieht src/db mit, das DATABASE_URL beim Laden verlangt. Verbunden
// wird hier nie – classifyReply ist reine Logik.
process.env.DATABASE_URL ??= 'postgres://unused';
const { classifyReply } = await import('../src/mastra/channels/teams-receipt-handler');

describe('classifyReply', () => {
  it.each(['ok', 'Yes!', 'looks good', 'Confirm', 'lgtm', 'passt', '👍'])('"%s" bestätigt', text => {
    expect(classifyReply(text)).toEqual({ kind: 'confirm' });
  });

  it.each(['cancel', 'Discard', "don't save", 'abbrechen'])('"%s" bricht ab', text => {
    expect(classifyReply(text)).toEqual({ kind: 'cancel' });
  });

  it.each(['ok but the date is wrong', 'yes, except the total', "ok it isn't CHF", 'the total is 12.50'])(
    '"%s" ist eine Korrektur',
    text => {
      expect(classifyReply(text)).toEqual({ kind: 'correct', text });
    },
  );
});
