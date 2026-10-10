/**
 * "Against ourselves" (the bench) — what its notes say.
 *
 * F-794: the gateway leaves `activeGoals` out of the overview for any role
 * but owner and manager. The cutting must then say nothing about goals — not
 * "no goal is running", which would be a false sentence to a reader who was
 * simply not shown them.
 *
 * F-797: since F-186 the cashflow loader reads the whole window or refuses,
 * so a pair of zeros means no delivered order, and an unread window is the
 * buying lens not answering.
 */

import { describe, expect, it } from 'vitest';
import { bench, type BenchRegister } from './rp-registers-bench';

const ctx = { days: 30 };

const PAYLOAD = {
  cashflow: { spendLast30d: 0, spendPrev30d: 0, paceDeltaPct: null },
  seasonality: { trendPerDayPct: 0.1, weekdayProfile: [] },
  insights: [],
  activeGoals: [],
};

const read = (raw: unknown) => bench.select(raw) as BenchRegister;
const text = (nodes: unknown[]) => nodes.filter((n) => typeof n === 'string').join(' ');

describe('the bench — goals the reader may not see (F-794)', () => {
  it('an owner with no goal running is told so, and sees the count', () => {
    const view = bench.view(read(PAYLOAD), ctx);
    expect(text(view.notes)).toMatch(/No goal is running/);
    expect(view.figures.map((f) => f.label)).toContain('Goals running');
  });

  it('when the gateway left the goals out, nothing is said about goals', () => {
    const { activeGoals: _gone, ...staff } = PAYLOAD;
    const view = bench.view(read(staff), ctx);
    expect(text(view.notes)).not.toMatch(/goal/i);
    expect(view.figures.map((f) => f.label)).not.toContain('Goals running');
  });
});

describe('the bench — what a pair of zeros means (F-797)', () => {
  it('reads zeros as no delivered order, not as a read that may have failed', () => {
    const notes = text(bench.view(read(PAYLOAD), ctx).notes);
    expect(notes).toMatch(/no order was delivered in either window/);
    expect(notes).not.toMatch(/failed query/);
  });

  it('an unread buying window says the buying lens did not answer', () => {
    const view = bench.view(read({ ...PAYLOAD, cashflow: null }), ctx);
    expect(text(view.notes)).toMatch(/The buying lens did not answer/);
    expect(view.figures[0].note).toBe('the buying lens did not answer');
  });
});
