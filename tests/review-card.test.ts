// Die Adaptive Card und der Weg zurück: Button-IDs und die Übernahme der
// Dialog-Eingaben. Beides braucht weder Datenbank noch Modell – und beides
// entscheidet darüber, ob eine Buchung geschrieben wird.

import { describe, expect, it } from 'vitest';
import { cardToAdaptiveCard } from '@chat-adapter/teams/cards';
import {
  buildEditModal,
  buildReviewCard,
  parseActionId,
  parseEditModalCallbackId,
} from '../src/mastra/channels/receipt-review-card';
import { applyReviewEdits, type ReceiptCandidate } from '../src/mastra/receipts/candidate';
import type { CardElement } from 'chat';

/**
 * Der Adapter exportiert unter `/cards` eine eigene Kopie des Card-Typs, die
 * enger ist als die des Chat SDK (kein `section` etc.). Beim echten Posten läuft
 * die Karte durch die gleichwertige Funktion im Adapter selbst, die den Typ des
 * SDK nimmt – hier also nur die Typen zusammenführen, nicht die Semantik.
 */
const toAdaptive = (card: CardElement) =>
  cardToAdaptiveCard(card as Parameters<typeof cardToAdaptiveCard>[0]);

const candidate: ReceiptCandidate = {
  merchant: 'Migros Basel',
  merchantAddress: null,
  merchantTaxId: null,
  receiptDate: '2026-03-14',
  receiptTime: null,
  referenceNumber: null,
  totalAmount: '42.10',
  subtotalAmount: null,
  discountAmount: null,
  vatAmount: '3.20',
  vatRate: '8.100',
  currency: 'CHF',
  paymentMethod: 'Karte',
  receiptType: null,
  category: null,
  lineItems: [],
  issues: [],
};

const RUN_ID = 'run-0815';

describe('Adaptive Card', () => {
  it('trägt die runId in jeder actionId, damit eine alte Karte erkennbar alt ist', () => {
    const card = toAdaptive(
      buildReviewCard({ candidate, runId: RUN_ID, round: 0, maxRounds: 3, isRecheck: false }),
    ) as unknown as { actions: { data: { actionId: string } }[] };

    const ids = card.actions.map(action => action.data.actionId);
    expect(ids).toEqual([
      `receipt-review:confirm:${RUN_ID}`,
      `receipt-review:edit:${RUN_ID}`,
      `receipt-review:cancel:${RUN_ID}`,
    ]);

    for (const id of ids) {
      expect(parseActionId(id)?.runId).toBe(RUN_ID);
    }
  });

  it('zeigt genau die vier bestätigungspflichtigen Felder plus Händler', () => {
    const card = toAdaptive(
      buildReviewCard({ candidate, runId: RUN_ID, round: 0, maxRounds: 3, isRecheck: false }),
    ) as unknown as { body: { type: string; facts?: { title: string; value: string }[] }[] };

    const facts = card.body.find(element => element.type === 'FactSet')?.facts;
    expect(facts?.map(fact => fact.title)).toEqual([
      'Händler',
      'Datum',
      'Währung',
      'Steuer (MwSt.-Betrag)',
      'Total (Betrag)',
    ]);
  });

  it('ignoriert fremde actionIds – Mastras Tool-Freigaben laufen über denselben Handler', () => {
    expect(parseActionId('tool_approve:abc')).toBeNull();
    expect(parseActionId('receipt-review:confirm:')).toBeNull();
    expect(parseEditModalCallbackId('receipt-review:cancel:run-1')).toBeNull();
    expect(parseEditModalCallbackId('receipt-review:edit:run-1')).toEqual({ runId: 'run-1' });
    expect(parseEditModalCallbackId('receipt-review:edit:run-1~1700000000042')).toEqual({
      runId: 'run-1',
      cardMessageId: '1700000000042',
    });
  });

  it('belegt den Dialog mit dem Stand der Karte vor', () => {
    const modal = buildEditModal({ candidate, runId: RUN_ID });
    const byId = Object.fromEntries(
      modal.children
        .filter((child): child is Extract<typeof child, { id: string }> => 'id' in child)
        .map(child => [child.id, child]),
    );

    expect(Object.keys(byId)).toEqual(['receiptDate', 'currency', 'vatAmount', 'totalAmount']);
    expect(byId.receiptDate).toMatchObject({ type: 'date_input', initialValue: '2026-03-14' });
    expect(byId.currency).toMatchObject({ type: 'select', initialOption: 'CHF' });
    expect(byId.totalAmount).toMatchObject({ type: 'text_input', initialValue: '42.10' });
  });

  it('behält bei einem Fehlversuch die Eingabe des Nutzers, statt sie zu verwerfen', () => {
    const modal = buildEditModal({
      candidate,
      runId: RUN_ID,
      errors: { totalAmount: 'Betrag nicht lesbar.' },
      values: { totalAmount: 'zwölf' },
    });

    expect(JSON.stringify(modal)).toContain('zwölf');
    expect(JSON.stringify(modal)).toContain('Betrag nicht lesbar.');
  });
});

describe('Dialog-Eingaben übernehmen', () => {
  it('parst dieselben Schreibweisen wie die Extraktion', () => {
    const { candidate: edited, errors } = applyReviewEdits(candidate, {
      receiptDate: '2026-03-03',
      currency: 'EUR',
      totalAmount: "1'234,50",
    });

    expect(errors).toEqual({});
    expect(edited).toMatchObject({
      receiptDate: '2026-03-03',
      currency: 'EUR',
      totalAmount: '1234.50',
      // Nicht angefasste Felder bleiben, wie sie waren.
      vatAmount: '3.20',
      merchant: 'Migros Basel',
    });
  });

  it('macht ein geleertes Feld zu null – das ist der Weg, einen falschen Wert loszuwerden', () => {
    const { candidate: edited, errors } = applyReviewEdits(candidate, { vatAmount: '   ' });

    expect(errors).toEqual({});
    expect(edited.vatAmount).toBeNull();
  });

  it('meldet eine unlesbare Eingabe, statt still null zu speichern', () => {
    const { candidate: edited, errors } = applyReviewEdits(candidate, {
      totalAmount: 'zwölf',
      currency: 'YEN',
      receiptDate: 'irgendwann',
    });

    expect(Object.keys(errors).sort()).toEqual(['currency', 'receiptDate', 'totalAmount']);
    // Der Kandidat bleibt in den beanstandeten Feldern unverändert.
    expect(edited.totalAmount).toBe('42.10');
    expect(edited.currency).toBe('CHF');
    expect(edited.receiptDate).toBe('2026-03-14');
  });
});
