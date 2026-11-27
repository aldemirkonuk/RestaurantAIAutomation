/**
 * A goal whose reading the gateway withheld from the reader's role (ADR 0348
 * item 3) says so, keeps the house's own setting, and is never read as a
 * goal that "could not be scored" or as 0% of the way (walk r33 R-F4).
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GOAL_READING_WITHHELD, goals, type GoalsRegister } from './rp-registers-goals';
import type { GoalsDesk } from './useGoalsDesk';

/** The gateway's withheld entry (`GoalsService.withheldProgress`). */
const WITHHELD = {
  goal: {
    id: 'g1',
    name: 'Wine revenue to 60k',
    metric_key: 'wine_revenue',
    direction: 'at_least',
    deadline: '2026-12-31',
    period: 'custom',
    target_value: 60000,
    current_value: null,
    baseline_value: null,
  },
  metricLabel: 'Wine revenue',
  unit: 'currency',
  current: null,
  target: 60000,
  progressPct: null,
  expectedByNow: null,
  onTrack: null,
  daysLeft: null,
  paceUnread: null,
  projectedAtDeadline: null,
  projectionHitsTarget: null,
  suggestedActions: [],
  withheldForRole: ['money', 'sales'],
};

/** A bottles goal staff do read. */
const BOTTLES = {
  ...WITHHELD,
  goal: { ...WITHHELD.goal, id: 'g2', name: 'Sell 400 bottles', metric_key: 'bottles_sold', target_value: 400 },
  metricLabel: 'Bottles sold',
  unit: 'units',
  current: 210,
  target: 400,
  progressPct: 0.525,
  onTrack: true,
  daysLeft: 48,
  withheldForRole: undefined,
};

const book = (...rows: unknown[]) =>
  goals.select({ status: 'active', goals: rows, total: rows.length }) as GoalsRegister;

const desk = {
  canWrite: false,
  readOnlyReason: null,
  busy: null,
  error: null,
  asking: null,
  proposal: null,
} as unknown as GoalsDesk;

describe('a goal whose reading is withheld from the role', () => {
  it('is read as withheld only when the gateway names classes', () => {
    expect(book(WITHHELD).goals[0].withheld).toBe(true);
    expect(book(BOTTLES).goals[0].withheld).toBe(false);
    expect(book({ ...WITHHELD, withheldForRole: [] }).goals[0].withheld).toBe(false);
    expect(book({ ...WITHHELD, withheldForRole: 'money' }).goals[0].withheld).toBe(false);
  });

  it('the card says who the reading is for, keeps the target and the date, and claims no progress', () => {
    render(<MemoryRouter>{goals.view(book(WITHHELD), { days: 30, goals: desk }).node}</MemoryRouter>);
    const card = screen.getByRole('heading', { name: 'Wine revenue to 60k' }).closest('li') as HTMLElement;
    expect(within(card).getByTestId('rp-goal-withheld')).toHaveTextContent(GOAL_READING_WITHHELD);
    expect(card).toHaveTextContent(/Target 60\.0K · Wine revenue · reach at least · by 31 Dec 2026/);
    expect(within(card).queryByText(/could not be scored/)).toBeNull();
    expect(within(card).queryByText(/Progress is unknown/)).toBeNull();
    expect(within(card).queryByRole('img')).toBeNull();
  });

  it('a goal staff do read is drawn as before beside it', () => {
    render(<MemoryRouter>{goals.view(book(WITHHELD, BOTTLES), { days: 30, goals: desk }).node}</MemoryRouter>);
    const card = screen.getByRole('heading', { name: 'Sell 400 bottles' }).closest('li') as HTMLElement;
    expect(within(card).queryByTestId('rp-goal-withheld')).toBeNull();
    expect(within(card).getByRole('img')).toBeInTheDocument();
    expect(screen.getAllByTestId('rp-goal-withheld')).toHaveLength(1);
  });

  it('the figures count it as written for owners and managers, never as unscored', () => {
    const view = goals.view(book(WITHHELD, BOTTLES), { days: 30 });
    const fig = (label: string) => view.figures?.find((f) => f.label === label)?.value;
    expect(fig('Could not be scored')).toBe('0');
    expect(fig('Written for owners and managers')).toBe('1');
    expect(view.notes).toContain(
      '1 goal’s reading is written for owners and managers, so it is neither drawn nor counted on pace.',
    );
    // An owner's book has no such figure or note.
    const owner = goals.view(book(BOTTLES), { days: 30 });
    expect(owner.figures?.some((f) => f.label === 'Written for owners and managers')).toBe(false);
    expect(owner.notes?.some((n) => /written for owners/.test(String(n)))).toBe(false);
  });

  it('two withheld goals are counted in the plural', () => {
    const second = { ...WITHHELD, goal: { ...WITHHELD.goal, id: 'g3', name: 'Average check over 95' } };
    const view = goals.view(book(WITHHELD, second), { days: 30 });
    expect(view.notes).toContain(
      '2 goals’ readings are written for owners and managers, so they are neither drawn nor counted on pace.',
    );
  });

  it('is not drawn as a bar, and its table row reads the dash, not 0', () => {
    const view = goals.view(book(WITHHELD, BOTTLES), { days: 30 });
    expect(view.cats?.data.map((d) => d.full)).toEqual(['Sell 400 bottles']);
    const row = view.table?.rows.find((r) => r.key === 'g1');
    expect(row?.cells[1]).toBe('—');
    expect(row?.cells[2]).toBe('60.0K');
  });
});
