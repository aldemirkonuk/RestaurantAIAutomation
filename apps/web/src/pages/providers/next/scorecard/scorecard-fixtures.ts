/**
 * Test fixtures for the scorecard views — the gateway's answer shapes, filled
 * with sketch 117's invented Skurnik record, as the gateway words them after
 * the founder's rulings of 2026-09-21 (percent with count; five records
 * everywhere, so three claims are listed rather than scored). Test-only;
 * nothing in the app imports this file.
 */

import type { DocketEntry, HouseClock, MeasureResult, Money, VendorScorecard } from './scorecard-types';

export const HOUSE: HouseClock = {
  zone: 'America/New_York',
  zoneSource: 'house',
  locale: 'en-US',
  localeSource: 'country',
  deadline:
    'A delivery is on time when it lands before midnight at the end of its expected day in America/New_York, this house’s time zone.',
};

export function measure(over: Partial<MeasureResult> & Pick<MeasureResult, 'key' | 'label'>): MeasureResult {
  return {
    outcome: 'answered',
    sample: 14,
    hits: 12,
    value: 12 / 14,
    percent: '86%',
    money: null,
    minimum: 5,
    minimumNoun: 'orders that landed or fell due',
    excluded: [],
    open: 0,
    rows: 14,
    reason: null,
    sentence: '86% on time — 12 of 14 by the expected date.',
    prior: {
      outcome: 'answered',
      sample: 13,
      hits: 9,
      value: 9 / 13,
      percent: '69%',
      money: null,
    },
    priorSentence: 'prior 90 d · 69% · 9 of 13',
    listed: null,
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
    house: HOUSE,
    measures: [
      measure({ key: 'onTime', label: 'On time' }),
      measure({
        key: 'linesAsOrdered',
        label: 'Lines as ordered',
        outcome: 'too_few',
        sample: 2,
        hits: 2,
        value: null,
        percent: null,
        rows: 2,
        sentence: '2 lines with a door verdict in 90 days — too few to score; 5 are needed.',
        prior: {
          outcome: 'too_few',
          sample: 0,
          hits: 0,
          value: null,
          percent: null,
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
        percent: null,
        rows: 0,
        reason: '502 upstream',
        sentence: 'The verified invoices did not answer (502 upstream). This line is unknown, not zero.',
        prior: {
          outcome: 'could_not_read',
          sample: 0,
          hits: null,
          value: null,
          percent: null,
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
        percent: null,
        rows: 11,
        open: 2,
        sentence:
          'Median 5 h 40 from our message to their next reply in the same thread, over 9 replies. Slowest 31 h.',
        prior: {
          outcome: 'answered',
          sample: 7,
          hits: null,
          value: 7 + 10 / 60,
          percent: null,
          money: null,
        },
        priorSentence: 'prior 90 d · 7 h 10 median · 7 replies',
      }),
      measure({
        key: 'credits',
        label: 'Credits',
        outcome: 'too_few',
        sample: 3,
        hits: 2,
        value: null,
        percent: null,
        money: null,
        minimumNoun: 'claims',
        rows: 3,
        open: 1,
        sentence:
          '3 claims in 90 days — too few to score; 5 are needed. 1 claim is still open or promised — in what was asked, not in what was recovered.',
        prior: {
          outcome: 'too_few',
          sample: 0,
          hits: 0,
          value: null,
          percent: null,
          money: null,
        },
        priorSentence: 'prior 90 d · nothing to compare with',
        listed: [
          entry({
            id: 'credits:c3',
            measure: 'credits',
            at: '2026-08-09T10:00:00Z',
            counted: true,
            hit: false,
            open: true,
            title: 'Claim c3 · qty short',
            detail: 'Promised, 39 days ago, not recovered — promised is not recovered.',
          }),
          entry({
            id: 'credits:c2',
            measure: 'credits',
            at: '2026-07-27T10:00:00Z',
            title: 'Claim c2 · qty short',
            detail: 'Credited $103.50 of $118.00 asked.',
          }),
          entry({
            id: 'credits:c1',
            measure: 'credits',
            at: '2026-07-03T10:00:00Z',
            title: 'Claim c1 · qty short',
            detail: 'Credited $182.50 of $182.50 asked.',
          }),
        ],
      }),
    ],
    quiet: false,
    fact: { text: '86% on time · 12 of 14', outcome: 'answered' },
    alerting: {
      built: false,
      sentence:
        'No alert is sent from these figures. A labelled set and a shadow run come first, and neither is built yet.',
    },
    ...over,
  };
}

/** A claim-money total as the gateway answers it, in the currency its orders STATE (dollars here). */
export function statedDollars(allowed: number, asked: number, percent: string | null): Money {
  return { currency: 'USD', allowed, asked, share: asked > 0 ? allowed / asked : null, percent };
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
