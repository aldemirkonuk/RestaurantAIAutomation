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
import { bench, goalsNowFrom, type BenchRegister } from './rp-registers-bench';

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

describe('the bench — a goal’s "now" agrees with the Goals cutting (F-816)', () => {
  const GOAL = {
    id: 'g1',
    name: 'Food cost',
    metric_key: 'food_cost_pct',
    baseline_value: 34,
    current_value: 34,
    target_value: 28,
  };
  const withGoal = { ...PAYLOAD, activeGoals: [GOAL] };
  const goalRow = (view: ReturnType<typeof bench.view>) =>
    view.table!.rows.find((r) => r.key === 'goal-g1')!;

  it('prints the Goals cutting’s own reading, not the stored value', () => {
    const goalsData = { goals: [{ id: 'g1', current: 31 }] };
    const view = bench.view(read(withGoal), { ...ctx, goalsNow: goalsNowFrom(goalsData) });
    expect(goalRow(view).cells[0]).toBe('Food cost — since it was set');
    expect(goalRow(view).cells[2]).toBe('31');
    expect(text(view.notes)).not.toMatch(/last stored/);
  });

  it('a goal the Goals cutting could not read prints a dash, as that cutting does', () => {
    const view = bench.view(read(withGoal), {
      ...ctx,
      goalsNow: goalsNowFrom({ goals: [{ id: 'g1', current: null }] }),
    });
    expect(goalRow(view).cells[2]).toBe('—');
  });

  it('without that reading, the stored value is printed and named as stored', () => {
    const view = bench.view(read(withGoal), ctx);
    expect(goalRow(view).cells[0]).toMatch(/last stored/);
    expect(goalRow(view).cells[2]).toBe('34');
    expect(text(view.notes)).toMatch(/can trail the Goals cutting/);
  });

  it('goalsNowFrom answers nothing until the Goals register has data', () => {
    expect(goalsNowFrom(undefined)).toBeUndefined();
    expect(goalsNowFrom({ goals: [{ id: 'g1', current: 2 }, { id: '', current: 3 }] })).toEqual({ g1: 2 });
  });
});
