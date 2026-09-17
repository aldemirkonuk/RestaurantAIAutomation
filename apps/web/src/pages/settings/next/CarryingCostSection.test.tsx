/**
 * The Carrying cost register — the number nothing in this product ever asked.
 *
 * PRE-FIX PROOF, MEASURED (2026-09-06, in `/Users/aldemirkonuk/Projects/wt-p4`)
 * ---------------------------------------------------------------------------
 *   git grep -c carrying_cost $(git rev-parse HEAD) -- apps supabase
 *                                                        ->  no match
 *
 * There was no column, no route, no register and no field. THE FOUNDER,
 * 2026-09-05 batch 59, answering the commodity plan's §12 Q5: *"Twice a year,
 * and the house types its carrying cost."*
 *
 * The component is rendered directly rather than through `SettingsNext`: what
 * is under test is the register's own contract, and the page's mounting of it
 * is asserted in `SettingsNext.test.tsx`.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CarryingCostSection, MAX_PERCENT, MIN_PERCENT, readTyped } from './CarryingCostSection';
import type { SettingsNextData } from './useSettingsNextData';

function remote(data: unknown, status = 'ok') {
  return {
    status,
    data,
    error: status === 'error' ? 'gateway unreachable' : null,
    reload: vi.fn(),
    set: vi.fn(),
  };
}

function reg(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    percentPerMonth: null,
    basis: null,
    readable: true,
    reason: null,
    statedAt: null,
    statedBy: null,
    ...over,
  };
}

function mount(over: Record<string, unknown> = {}) {
  const saveCarryingCost = vi.fn(() => Promise.resolve(true));
  const data = {
    canManage: true,
    saveCarryingCost,
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    houseCarryingCost: remote(reg()),
    ...over,
  } as unknown as SettingsNextData;
  render(<CarryingCostSection data={data} />);
  return { saveCarryingCost };
}

const field = () => screen.getByLabelText(/carrying cost, percent a month/i);
const record = () => screen.getByRole('button', { name: /record/i });

describe('what the typed text means, decided once', () => {
  it('reads a plain number and says what Record will write, in a year as well', () => {
    const out = readTyped('0.75', null);
    expect(out.value).toBe(0.75);
    expect(out.canRecord).toBe(true);
    expect(out.sentence).toContain('Record will write 0.75 percent a month');
    // The annual figure is the one a person can sanity-check against their own
    // cost of money; the monthly one alone is easy to be an order out on.
    expect(out.sentence).toContain('9.0 percent a year');
  });

  it('refuses the FRACTION spelling and says which direction it would push a saving', () => {
    const out = readTyped('0.0075', null);
    expect(out.canRecord).toBe(false);
    expect(out.sentence).toContain('This field is a PERCENT');
    // The reason it matters, not just that it is wrong.
    expect(out.sentence).toContain('almost free');
  });

  it('refuses a percent a YEAR typed into a percent a month', () => {
    const out = readTyped('9', null);
    expect(out.canRecord).toBe(true); // 9 %/month is inside the bounds, if odd
    const tooBig = readTyped('75', null);
    expect(tooBig.canRecord).toBe(false);
    expect(tooBig.sentence).toContain('900 percent a year');
  });

  it('refuses text, and refuses re-recording the value already there', () => {
    expect(readTyped('a lot', null).canRecord).toBe(false);
    expect(readTyped('a lot', null).sentence).toContain('not a number');
    expect(readTyped('0.75', 0.75).canRecord).toBe(false);
    expect(readTyped('0.75', 0.75).sentence).toContain('already recorded');
  });

  it('admits exactly the bounds the database admits, at both ends', () => {
    expect(readTyped(String(MIN_PERCENT), null).canRecord).toBe(true);
    expect(readTyped(String(MAX_PERCENT), null).canRecord).toBe(true);
    expect(readTyped(String(MIN_PERCENT / 2), null).canRecord).toBe(false);
    expect(readTyped(String(MAX_PERCENT + 0.001), null).canRecord).toBe(false);
  });
});

describe('three states, never two', () => {
  it('unanswered says what it costs — no saving is shown anywhere', () => {
    mount();
    expect(screen.getByText(/No saving is shown anywhere/i)).toBeInTheDocument();
    expect(screen.getByText(/says its saving is UNMEASURED/i)).toBeInTheDocument();
  });

  it('answered says what a saving would be worked out against, and who typed it', () => {
    mount({
      houseCarryingCost: remote(
        reg({
          percentPerMonth: 0.75,
          basis: 'cash at 9 percent plus the walk-in',
          statedAt: '2026-09-06T09:00:00.000Z',
          statedBy: { userId: 'u1', name: 'A Manager' },
        }),
      ),
    });
    // Twice on purpose: the consequence line says what a saving would be
    // worked out against, and the field's own sentence says it is already
    // recorded so Record stays inert.
    expect(screen.getAllByText(/0.75 percent a month/)).toHaveLength(2);
    expect(screen.getByText(/may state a saving in this house/i)).toBeInTheDocument();
    expect(screen.getByText(/typed by · A Manager/i)).toBeInTheDocument();
    expect(screen.getByText(/cash at 9 percent plus the walk-in/)).toBeInTheDocument();
  });

  it('a failed READ is its own state, never an unanswered question', () => {
    mount({ houseCarryingCost: remote(reg({ readable: false, reason: 'permission denied' })) });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/could not be read/i);
    expect(alert).toHaveTextContent(/permission denied/);
    expect(alert).toHaveTextContent(/not the same as a house that has not been asked/i);
  });
});

describe('nothing is recorded by opening the page', () => {
  it('Record is inert until a person types something admissible', () => {
    const { saveCarryingCost } = mount();
    expect(record()).toBeDisabled();
    fireEvent.change(field(), { target: { value: '0.0075' } });
    expect(record()).toBeDisabled();
    fireEvent.change(field(), { target: { value: '0.75' } });
    expect(record()).toBeEnabled();
    expect(saveCarryingCost).not.toHaveBeenCalled();
  });

  it('Record sends the number and the basis a person typed, and nothing else', () => {
    const { saveCarryingCost } = mount();
    fireEvent.change(field(), { target: { value: '0.75' } });
    fireEvent.change(screen.getByLabelText(/what you counted/i), {
      target: { value: '  cash and the walk-in  ' },
    });
    fireEvent.click(record());
    expect(saveCarryingCost).toHaveBeenCalledWith(0.75, 'cash and the walk-in');
  });

  it('an empty basis is sent as null, never as an empty sentence', () => {
    const { saveCarryingCost } = mount();
    fireEvent.change(field(), { target: { value: '1.2' } });
    fireEvent.click(record());
    expect(saveCarryingCost).toHaveBeenCalledWith(1.2, null);
  });

  it('a reader may read the rule they may not change', () => {
    mount({ canManage: false });
    expect(field()).toBeDisabled();
    expect(record()).toBeDisabled();
    expect(screen.getByText(/Only managers and owners/i)).toBeInTheDocument();
  });

  it('a change whose audit row failed is VISIBLE, never assumed', () => {
    mount({
      houseCarryingCost: remote(
        reg({ percentPerMonth: 0.75, audited: false, auditReason: 'audit insert refused' }),
      ),
    });
    expect(screen.getByText(/was not written to the trail/i)).toBeInTheDocument();
    expect(screen.getByText(/audit insert refused/)).toBeInTheDocument();
  });
});
