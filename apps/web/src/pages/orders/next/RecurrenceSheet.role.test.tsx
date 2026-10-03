/**
 * Who sees working recurrence controls on RecurrenceSheet.
 *
 * ADR 0247, founder rulings of 2026-10-01: "Managers and owners only
 * (Recommended)", "Yes, replace needs a manager (Recommended)" and "Only on
 * their own order (Recommended)". Pause, resume, end and replacing a rule need
 * a manager or an owner. A first rule may be set by the person who placed the
 * order, or by a manager or an owner on any order. The gateway's 403 is the
 * real gate, so the last block asserts that a refusal from it is shown in
 * words. The cases marked [REVERT-FAILS] were run against the sheet on
 * origin/main and observed to fail.
 *
 * Every row goes through `toRow` on a payload shaped like the list route's, as
 * `Recurrence.test.tsx` does, so the sheet reads the rule and the order's
 * creator the way the page does.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';

const ME = 'u-me';
const SOMEONE_ELSE = 'u-someone-else';

const auth = vi.hoisted(() => ({
  activeRole: 'staff' as string | null,
  user: { userId: 'u-me' } as { userId: string } | null,
}));
const api = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

vi.mock('@/services/api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/api/client')>();
  return {
    ...real,
    apiClient: { post: (...args: unknown[]) => api.post(...args) },
  };
});

import {
  RECURRENCE_FIRST_RULE_ROLE_UNKNOWN,
  RECURRENCE_NEEDS_A_MANAGER,
  RECURRENCE_NOT_YOUR_ORDER,
  RECURRENCE_ROLE_UNKNOWN,
  RecurrenceSheet,
} from './RecurrenceSheet';
import { toRow } from './useOrdersNextData';

const providers = new Map<string, string>([['prov-1', 'Anadolu']]);

function orderWith(status: 'active' | 'paused' | 'ended' | null, createdBy: string | null) {
  return toRow(
    {
      id: 'o-1',
      orderNumber: 'ORD-2026-00042',
      restaurantId: 'r-1',
      inventoryId: 'inv-1',
      providerId: 'prov-1',
      quantity: 5,
      unitType: 'case',
      bottlesTotal: 60,
      finalPrice: 38.99,
      totalCost: 194.95,
      status: 'APPROVED',
      approvedAt: '2026-09-01T10:00:00.000Z',
      recurrenceFrequency: status ? 'weekly' : null,
      recurrenceAnchorDay: status ? 1 : null,
      recurrenceNextDueOn: status ? '2026-10-06' : null,
      recurrenceStatus: status,
      recurrenceParentOrderId: null,
      recurrenceOccurrenceOn: null,
      createdBy,
    } as never,
    providers,
  );
}

function draw(status: 'active' | 'paused' | 'ended' | null, createdBy: string | null = SOMEONE_ELSE) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RecurrenceSheet open onClose={() => {}} row={orderWith(status, createdBy)} />
    </QueryClientProvider>,
  );
}

const ACTS = ['recurrence-pause', 'recurrence-resume', 'recurrence-end'];

/** The first-rule form and its button are not offered. */
function expectNoFirstRuleForm() {
  expect(screen.queryByTestId('recurrence-frequency-weekly')).toBeNull();
  expect(screen.queryByTestId('recurrence-save')).toBeNull();
}

beforeEach(() => {
  auth.activeRole = 'staff';
  auth.user = { userId: ME };
  api.post.mockReset();
});

describe('staff', () => {
  it.each(['active', 'paused', 'ended'] as const)(
    '[REVERT-FAILS] see a rule that is %s, with no pause, resume, end or replace control, and are told why',
    (status) => {
      draw(status, ME);
      expect(screen.getByTestId('recurrence-current')).toBeTruthy();
      for (const id of ACTS) expect(screen.queryByTestId(id)).toBeNull();
      expectNoFirstRuleForm();
      expect(screen.getByTestId('recurrence-role-note').textContent).toBe(
        RECURRENCE_NEEDS_A_MANAGER,
      );
    },
  );

  it('may set the first rule on an approved order they placed', async () => {
    api.post.mockResolvedValue({ data: {} });
    draw(null, ME);
    expect(screen.queryByTestId('recurrence-role-note')).toBeNull();
    expect(screen.queryByTestId('recurrence-first-rule-note')).toBeNull();
    fireEvent.click(screen.getByTestId('recurrence-frequency-weekly'));
    const save = screen.getByTestId('recurrence-save') as HTMLButtonElement;
    expect(save.textContent).toBe('Set the rule');
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls[0][0]).toBe('/procurement/orders/o-1/recurrence');
  });

  it.each([
    ['someone else placed', SOMEONE_ELSE],
    ['with no recorded creator', null],
  ])(
    '[REVERT-FAILS] are not offered a first rule on an order %s, and are told why',
    (_label, createdBy) => {
      draw(null, createdBy);
      expectNoFirstRuleForm();
      expect(screen.getByTestId('recurrence-first-rule-note').textContent).toBe(
        RECURRENCE_NOT_YOUR_ORDER,
      );
    },
  );
});

describe('a role that is not known', () => {
  it('[REVERT-FAILS] gets no controls on a rule either, and is told its role is not confirmed, not that it is staff', () => {
    auth.activeRole = null;
    draw('active', ME);
    for (const id of ACTS) expect(screen.queryByTestId(id)).toBeNull();
    expectNoFirstRuleForm();
    expect(screen.getByTestId('recurrence-role-note').textContent).toBe(
      RECURRENCE_ROLE_UNKNOWN,
    );
  });

  it('[REVERT-FAILS] is not offered a first rule on an order someone else placed, and is told its role is not confirmed', () => {
    auth.activeRole = null;
    draw(null, SOMEONE_ELSE);
    expectNoFirstRuleForm();
    expect(screen.getByTestId('recurrence-first-rule-note').textContent).toBe(
      RECURRENCE_FIRST_RULE_ROLE_UNKNOWN,
    );
  });
});

describe('managers and owners', () => {
  it.each(['manager', 'owner'])(
    'a %s sees pause and end on an active rule, and pause posts',
    async (role) => {
      auth.activeRole = role;
      api.post.mockResolvedValue({ data: {} });
      draw('active');
      expect(screen.queryByTestId('recurrence-role-note')).toBeNull();
      expect(screen.getByTestId('recurrence-end')).toBeTruthy();
      expect(screen.getByTestId('recurrence-save').textContent).toBe('Replace the rule');
      fireEvent.click(screen.getByTestId('recurrence-pause'));
      await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
      expect(api.post.mock.calls[0][0]).toBe('/procurement/orders/o-1/recurrence/pause');
      expect(await screen.findByTestId('recurrence-done')).toBeTruthy();
    },
  );

  it('a manager sees resume on a paused rule', () => {
    auth.activeRole = 'manager';
    draw('paused');
    expect(screen.getByTestId('recurrence-resume')).toBeTruthy();
  });

  it.each(['manager', 'owner'])(
    'a %s is offered a first rule on an order someone else placed',
    (role) => {
      auth.activeRole = role;
      draw(null, SOMEONE_ELSE);
      expect(screen.queryByTestId('recurrence-first-rule-note')).toBeNull();
      fireEvent.click(screen.getByTestId('recurrence-frequency-weekly'));
      const save = screen.getByTestId('recurrence-save') as HTMLButtonElement;
      expect(save.textContent).toBe('Set the rule');
      expect(save.disabled).toBe(false);
    },
  );
});

describe('the gateway refuses', () => {
  it('[REVERT-FAILS] shows a 403 in the gateway’s words and says nothing was changed', async () => {
    // The page believes this person is a manager; the gateway, which is the
    // gate, says otherwise (a role changed since the page last read it).
    auth.activeRole = 'manager';
    const message = "Only managers and owners can pause an order's recurrence";
    api.post.mockRejectedValue(
      new AxiosError('Request failed with status code 403', 'ERR_BAD_REQUEST', undefined, {}, {
        status: 403,
        statusText: 'Forbidden',
        data: { statusCode: 403, message, error: 'Forbidden' },
        headers: {},
        config: { headers: new AxiosHeaders() },
      }),
    );
    draw('active');
    fireEvent.click(screen.getByTestId('recurrence-pause'));
    const error = await screen.findByTestId('recurrence-error');
    expect(error.textContent).toBe(`${message}. Nothing was changed.`);
    expect(screen.queryByTestId('recurrence-done')).toBeNull();
  });
});
