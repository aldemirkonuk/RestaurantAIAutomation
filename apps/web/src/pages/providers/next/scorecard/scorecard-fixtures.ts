/**
 * Test fixtures for the scorecard views — the gateway's answer shapes, filled
 * with sketch 117's invented Skurnik record. Test-only; nothing in the app
 * imports this file.
 */

import type { DocketEntry, MeasureResult, VendorScorecard } from './scorecard-types';

export function measure(over: Partial<MeasureResult> & Pick<MeasureResult, 'key' | 'label'>): MeasureResult {
  return {
    outcome: 'answered',
    sample: 14,
    hits: 12,
    value: 12 / 14,
    money: null,
    minimum: 5,
    minimumNoun: 'deliveries with an expected date',
    excluded: [],
    open: 0,
    rows: 14,
    reason: null,
    sentence: '12 of 14 landed by the expected date.',
    prior: {
      outcome: 'answered',
      sample: 13,
      hits: 9,
      value: 9 / 13,
      money: null,
    },
    priorSentence: 'prior 90 d · 9 of 13',
    ...over,
  };
}

export function card(over: Partial<VendorScorecard> = {}): VendorScorecard {
  return {
    providerId: 'p1',
    providerName: 'Skurnik',
    window: {
      days: 90,
      from: '2026-06-19T12:00:00.000Z',
      to: '2026-09-17T12:00:00.000Z',
      priorFrom: '2026-03-21T12:00:00.000Z',
    },
    measures: [
      measure({ key: 'onTime', label: 'On time' }),
      measure({
        key: 'linesAsOrdered',
        label: 'Lines as ordered',
        outcome: 'too_few',
        sample: 2,
        hits: 2,
        value: null,
        rows: 2,
        sentence: '2 lines with a door verdict in 90 days — too few to score; 5 are needed.',
        prior: {
          outcome: 'too_few',
          sample: 0,
          hits: 0,
          value: null,
          money: null,
        },
        priorSentence: 'prior 90 d · nothing to compare with',
      }),
      measure({
        key: 'priceAsAgreed',
        label: 'Price as agreed',
        outcome: 'could_not_read',
        sample: 0,
        hits: null,
        value: null,
        rows: 0,
        reason: '502 upstream',
        sentence: 'The verified invoices did not answer (502 upstream). This line is unknown, not zero.',
        prior: {
          outcome: 'could_not_read',
          sample: 0,
          hits: null,
          value: null,
          money: null,
        },
        priorSentence: 'prior 90 d · could not be read',
      }),
      measure({
        key: 'replyTime',
        label: 'Reply time',
        sample: 9,
        hits: null,
        value: 5 + 40 / 60,
        rows: 11,
        open: 2,
        sentence:
          'Median 5 h 40 from our message to their next reply in the same thread, over 9 replies. Slowest 31 h.',
        prior: {
          outcome: 'answered',
          sample: 7,
          hits: null,
          value: 7 + 10 / 60,
          money: null,
        },
        priorSentence: 'prior 90 d · 7 h 10 median · 7 replies',
      }),
      measure({
        key: 'credits',
        label: 'Credits',
        sample: 3,
        hits: 2,
        value: 286 / 412.5,
        money: [{ currency: 'USD', allowed: 286, asked: 412.5 }],
        rows: 3,
        open: 1,
        sentence: '$286.00 recovered by credit memo of $412.50 asked, on 3 claims; 2 credited.',
        prior: {
          outcome: 'too_few',
          sample: 0,
          hits: 0,
          value: null,
          money: null,
        },
        priorSentence: 'prior 90 d · nothing to compare with',
      }),
    ],
    tone: {
      outcome: 'answered',
      read: 1,
      messages: 9,
      labelledByPerson: 0,
      sentence:
        'A model read the tone of 1 of 9 vendor messages; no person has labelled one. Tone is in no figure above.',
    },
    quiet: false,
    fact: { text: '12 of 14 on time', outcome: 'answered' },
    alerting: {
      built: false,
      sentence:
        'No alert is sent from these figures. A labelled set and a shadow run come first, and neither is built yet.',
    },
    ...over,
  };
}

export function entry(over: Partial<DocketEntry> & Pick<DocketEntry, 'id' | 'measure'>): DocketEntry {
  return {
    at: '2026-09-10T10:00:00Z',
    window: 'current',
    counted: true,
    hit: true,
    open: false,
    excludedBecause: null,
    title: 'PO-2231',
    detail: 'Landed by the expected date (10 Sep 2026).',
    source: { table: 'procurement_orders', id: over.id, orderId: over.id },
    ...over,
  };
}
