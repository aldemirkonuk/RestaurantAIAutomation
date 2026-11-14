/**
 * "What's coming" in a house younger than two of each weekday (r39 walk, on
 * r36 reports gap 1). The gateway withholds the projection and says why in
 * `basis.model` and `observed.young`; the page's headline said "no model
 * fitted this history", which is a different reason (nothing was tried).
 */
import { describe, expect, it } from 'vitest';
import { ahead } from './rp-registers-trade';

const payload = (observed: unknown) => ({
  model: null,
  modelFitted: false,
  horizon: 14,
  history: { dates: [], values: [] },
  forecast: [],
  totalForecastDemand: null,
  accuracy: null,
  basis: { demand: 'd', model: 'm', total: 't' },
  observed,
});

const viewOf = (observed: unknown) => ahead.view(ahead.select(payload(observed)), { days: 30 });

describe("the forecast in a young house says why nothing is projected", () => {
  it('names the days of records and the two-of-each-weekday floor', () => {
    const v = viewOf({ windowDays: 120, observedDays: 10, rateDays: 10, since: '2026-11-05', young: true, firstRecord: 'read' });
    expect(v.say).toBe(
      'Nothing is projected yet: the house has 10 days of records, and a forecast needs two of each weekday.',
    );
    expect(v.figures.map((f) => f.note)).toEqual([
      'Too few days of records to project from',
      'Too few days of records to project from',
    ]);
  });

  it('an older house that no model fitted keeps the old sentence', () => {
    const v = viewOf({ windowDays: 120, observedDays: 120, rateDays: 120, since: null, young: false, firstRecord: 'read' });
    expect(v.say).toBe('Nothing is projected: no model fitted this history, so no line is drawn and no total is claimed.');
    expect(v.figures[0].note).toBe('No model fitted this history');
  });

  it('a gateway that sends no observed window keeps the old sentence', () => {
    expect(viewOf(undefined).say).toBe(
      'Nothing is projected: no model fitted this history, so no line is drawn and no total is claimed.',
    );
  });
});
