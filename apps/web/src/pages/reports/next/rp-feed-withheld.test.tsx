/**
 * r108 reports-2 — the web half of the staff withhold (ADR 0348).
 *
 * The gateway (#2149, #2204) keeps the feed's money sentences, Figures of
 * record, spend pacing and a purchasing goal from staff. These pin what the
 * page then says: a counted withheld sentence instead of a short or empty
 * feed, a held-back card instead of a hidden one or a zero, and a register
 * the gateway answered `withheldForRole: true` read as held back, never as
 * an empty register. Real hook, real catalogue; only HTTP and the role are
 * doubled, as in useReportsNextData.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ rid: 'r1' as string | null, role: 'staff' as string | null }));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid, activeRole: auth.role }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: {},
    updatePreferences: vi.fn(),
    updatePreferencesAsync: vi.fn(),
    isLoading: false,
    isPlaceholderData: false,
    error: null,
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (pick: (s: { user: { userId: string } | null }) => unknown) => pick({ user: { userId: 'u1' } }),
}));
vi.mock('./useGoalsDesk', () => ({ useGoalsDesk: () => ({}) }));
vi.mock('./useReportExports', () => ({ useReportExports: () => ({}) }));

import { useReportsNextData } from './useReportsNextData';
import { CATALOGUE } from './rp-catalogue';
import { failureLine, withheldSentenceWords } from './rp-format';
import type { AnalysisId } from './rp-sheet';

const READING = '/analytics/insights/r1?limit=40';
const FINANCIAL = '/analytics/financial/r1';
const CASHFLOW = '/analytics/cashflow/r1';
const SEASONALITY = '/analytics/seasonality/r1';
const GOALS_LIST = '/analytics/goals/r1?status=active';
const MONEY: AnalysisId[] = ['ledger', 'pacing', 'bench'];

const SENTENCE = { rule_key: 'insight:a', sentence: 'Barolo ran low twice this week.', category: 'stock', score: 3 };

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}
const paths = () => api.get.mock.calls.map((c) => String(c[0]));
const mount = (showing: AnalysisId[]) =>
  renderHook(() => useReportsNextData(30, () => {}, showing), { wrapper: wrapper() });

function answer(over: Record<string, unknown> = {}) {
  api.get.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path in over) return { data: over[path] };
    if (path === READING) return { data: { insights: [SENTENCE] } };
    if (path === FINANCIAL) return { data: { cogs365: 1200, inventoryValueAtCost: 800 } };
    if (path === CASHFLOW) return { data: { spendLast30d: 410, spendPrev30d: 390 } };
    if (path === SEASONALITY) return { data: { weekdays: [] } };
    if (path === GOALS_LIST) return { data: [] };
    return { data: {} };
  });
}

describe('r108 — staff are told the money cards are kept, never handed a hidden card', () => {
  beforeEach(() => {
    auth.rid = 'r1';
    answer();
  });

  it('[REVERT-FAILS] staff: Figures of record, spend pacing and Against ourselves ask nothing and say who they are for', async () => {
    auth.role = 'staff';
    const { result } = mount(MONEY);
    await waitFor(() => expect(paths()).toContain(READING));
    for (const p of [FINANCIAL, CASHFLOW, SEASONALITY, GOALS_LIST]) expect(paths()).not.toContain(p);
    for (const id of MONEY) {
      const reg = result.current.registers[id]!;
      expect(reg.data).toBeUndefined();
      expect(reg.loading).toBe(false);
      expect(reg.failure?.heldBack).toEqual({ readers: ['owner', 'manager'], known: true });
      // The card prints a sentence, not a figure and not a zero.
      expect(failureLine(CATALOGUE[id].register, reg.failure!)).toMatch(
        /is written for owners and managers\. Nothing below is claimed\.$/,
      );
    }
  });

  it.each(['owner', 'manager'])('%s: the three registers are read and answered', async (role) => {
    auth.role = role;
    const { result } = mount(MONEY);
    await waitFor(() => {
      for (const id of MONEY) expect(result.current.registers[id]!.loading).toBe(false);
    });
    for (const p of [FINANCIAL, CASHFLOW, SEASONALITY, GOALS_LIST]) expect(paths()).toContain(p);
    for (const id of MONEY) {
      expect(result.current.registers[id]!.failure).toBeNull();
      expect(result.current.registers[id]!.data).toBeDefined();
    }
  });

  it('[REVERT-FAILS] a register the gateway answers as withheld is held back, not read as empty', async () => {
    // The page took the reader for a manager; the gateway, which decides, did not.
    auth.role = 'manager';
    answer({
      [FINANCIAL]: { withheldForRole: true, register: 'financial' },
      [CASHFLOW]: { withheldForRole: true, register: 'cashflow' },
    });
    const { result } = mount(MONEY);
    await waitFor(() => {
      for (const id of MONEY) expect(result.current.registers[id]!.loading).toBe(false);
    });
    for (const id of MONEY) {
      const reg = result.current.registers[id]!;
      expect(reg.data).toBeUndefined();
      expect(reg.failure?.heldBack?.known).toBe(true);
      expect(reg.failure?.forbidden).toBe(true);
    }
  });
});

describe('r108 — the feed says how many sentences it kept back', () => {
  const { reading } = CATALOGUE;
  const ctx = { days: 30 };

  it('[REVERT-FAILS] a short feed counts what was withheld, under the sentences it kept', () => {
    const feed = reading.select({ insights: [SENTENCE], withheldForRole: 2 }) as { rows: unknown[]; withheld: number };
    expect(feed.withheld).toBe(2);
    expect(feed.rows).toHaveLength(1);
    const view = reading.view(feed, ctx);
    expect(view.say).toBeUndefined();
    expect(view.notes).toContain(withheldSentenceWords(2));
  });

  it('[REVERT-FAILS] a feed kept whole is not drawn as a quiet house', () => {
    const view = reading.view(reading.select({ insights: [], withheldForRole: 4 }), ctx);
    expect(String(view.say)).toContain(withheldSentenceWords(4));
    expect(String(view.say)).not.toMatch(/no insight for this restaurant yet/);
  });

  it('a holder’s feed carries no withheld sentence at all', () => {
    const view = reading.view(reading.select({ insights: [SENTENCE] }), ctx);
    expect(view.notes.some((n) => /kept to owners and managers/.test(String(n)))).toBe(false);
    const quiet = reading.view(reading.select({ insights: [] }), ctx);
    expect(String(quiet.say)).toMatch(/no insight for this restaurant yet/);
  });

  it('one sentence is said in the singular', () => {
    expect(withheldSentenceWords(1)).toBe(
      '1 sentence is about sales, money, suppliers or people, kept to owners and managers. Nothing about it is claimed here.',
    );
  });
});

describe('r108 — a purchasing goal kept from staff is counted, never drawn', () => {
  const { goals } = CATALOGUE;

  it('[REVERT-FAILS] the withheld stub is not a goal row, and the card says how many were kept', () => {
    const reg = goals.select({
      goals: [
        { goal: { id: 'g1', name: 'Bottles', metric_key: 'bottles_sold', target_value: 40 }, current_value: 12 },
        { goal: { id: 'g2', withheldForRole: true }, withheldForRole: true },
      ],
      total: 2,
      computed: 1,
      withheldForRole: 1,
    }) as { goals: Array<{ name: string }>; total: number; withheld: number };
    expect(reg.goals.map((g) => g.name)).toEqual(['Bottles']);
    expect(reg.total).toBe(1);
    expect(reg.withheld).toBe(1);
    const view = goals.view(reg, { days: 30 });
    expect(view.notes.join(' ')).toMatch(/1 goal is about money and suppliers, kept to owners and managers/);
  });
});
