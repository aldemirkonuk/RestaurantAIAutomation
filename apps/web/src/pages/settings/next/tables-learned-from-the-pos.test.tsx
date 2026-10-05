/**
 * ADR 0303 — tables learned from the till (analytics walk AW25 / AW30;
 * founder ruling 2026-10-04 "Learn from the POS": every POS table ref becomes
 * a table the owner can rename or hide; no drawing).
 *
 * Two surfaces. The room register on /reports no longer tells the owner to
 * draw a room no screen can draw, and says how many checks it cannot place.
 * Settings → Point of sale lists the tables the till has named, reads nothing
 * until it is opened, keeps loading / failed / empty apart, and offers Rename
 * and Hide only to an owner or a manager (founder fork F1).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SettingsNextData } from './useSettingsNextData';

const http = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: http.get, patch: http.patch },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown'),
}));

import { TillTablesOpener } from './PosSection';
import { CATALOGUE } from '../../reports/next/rp-catalogue';

/* ── the room register ──────────────────────────────────────────────────── */

const room = (extra: Record<string, unknown>) =>
  CATALOGUE.seats.view(
    CATALOGUE.seats.select({ sinceDays: 90, dataStatus: 'live', tables: [], ...extra }),
    { days: 30 },
  );

describe('the room register (ADR 0303)', () => {
  it('never asks for a drawing; with no table named it says so and where to rename', () => {
    const say = room({ checksWithoutTable: 0, checksAtHiddenTables: 0 }).say as string;
    expect(say).not.toMatch(/drawn/);
    expect(say).toBe(
      'The till has not named a table yet, so no check can be attributed to a seat. Tables appear here as checks arrive with one on them; rename or hide them under Settings → Point of sale.',
    );
  });

  it('with every table hidden and no check, says the tables are hidden, not that the till named none', () => {
    const say = room({ checksWithoutTable: 0, checksAtHiddenTables: 0, hiddenTablesInHouse: 3 }).say as string;
    expect(say).toBe(
      'Every table in this house is hidden, and this window held no check. Show a table again under Settings → Point of sale.',
    );
    expect(say).not.toMatch(/has not named/);
  });

  it('counts the checks the till sent without a table', () => {
    expect(room({ checksWithoutTable: 12 }).say).toBe(
      '12 checks in this window came from the till without a table, so none can be attributed to a seat. They are in takings.',
    );
  });

  it('notes both counts beside the tables it shows, and its basis is the shown tables', () => {
    const v = room({
      checksWithoutTable: 3,
      checksAtHiddenTables: 5,
      hiddenTables: 2,
      checksInWindow: 20,
      tables: [
        { tableId: 't1', label: 'T1', zone: null, seats: null, checks: 12, revenue: 900, covers: 20, avgCheck: 75, wineAttachRate: 0.5 },
      ],
    });
    expect(v.notes).toEqual([
      '3 checks came from the till without a table: counted in takings, not in the room.',
      '5 checks were at 2 hidden tables: counted in takings, not shown here.',
    ]);
    expect((v.basis ?? []).join(' ')).toContain('the till attributed to a shown table');
  });
});

/* ── Settings → Point of sale ───────────────────────────────────────────── */

function writer(over: Record<string, unknown> = {}) {
  return {
    busy: null,
    failed: null,
    run: vi.fn(async (_key: string, fn: () => Promise<void>) => {
      await fn();
      return true;
    }),
    clear: vi.fn(),
    ...over,
  };
}

function settingsData(over: Record<string, unknown> = {}) {
  return { restaurantId: 'r1', canManage: true, writer: writer(), ...over } as unknown as SettingsNextData;
}

const T7 = { id: 'tab-7', label: 'T7', pos_refs: { csv_import: 'T7' }, learned_at: '2026-10-04T00:31:00.000Z', hidden_at: null };
const STAFF = { id: 'tab-s', label: 'Staff', pos_refs: {}, learned_at: null, hidden_at: '2026-10-04T09:00:00.000Z' };

function draw(data = settingsData(), open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <TillTablesOpener data={data} />
    </QueryClientProvider>,
  );
  if (open) fireEvent.click(screen.getByRole('button', { name: /Tables the till has named/ }));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  http.get.mockResolvedValue({ data: [T7, STAFF] });
  http.patch.mockResolvedValue({ data: {} });
});

describe('Settings → Point of sale: tables the till has named (ADR 0303)', () => {
  it('reads nothing until it is opened', () => {
    draw(settingsData(), false);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('says it is opening before the read answers, and claims no table', () => {
    http.get.mockReturnValue(new Promise(() => {}));
    draw();
    expect(screen.getByRole('status').textContent).toMatch(/Opening the tables the till has named/);
    expect(screen.queryByText('T7')).toBeNull();
  });

  it('a failed read is an alert, never an empty list', async () => {
    http.get.mockRejectedValue(new Error('gateway timeout'));
    draw();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('gateway timeout');
    expect(alert.textContent).toContain('not the same as a till that has named none');
    expect(screen.queryByText(/has not named a table yet/)).toBeNull();
  });

  it('an empty read says the till has not named a table yet', async () => {
    http.get.mockResolvedValue({ data: [] });
    draw();
    expect(await screen.findByText(/The till has not named a table yet/)).toBeTruthy();
    expect(http.get).toHaveBeenCalledWith('/analytics/tables/r1');
  });

  it('lists each table with the till word, where it came from, and whether it is hidden', async () => {
    draw();
    expect(await screen.findByText('T7')).toBeTruthy();
    expect(screen.getByText('csv_import: T7')).toBeTruthy();
    expect(screen.getByText(/Learned from the till/)).toBeTruthy();
    expect(screen.getByText(/Added by hand\. Hidden/)).toBeTruthy();
    expect(screen.getByText(/No till word is recorded for it yet\. Hidden/)).toBeTruthy();
  });

  it('Hide and Show patch hidden through the writer', async () => {
    const data = settingsData();
    draw(data);
    await screen.findByText('T7');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(http.patch).toHaveBeenCalledWith('/analytics/tables/r1/tab-7', { hidden: true }));
    expect(data.writer.run).toHaveBeenCalledWith('table:tab-7', expect.any(Function));
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(http.patch).toHaveBeenCalledWith('/analytics/tables/r1/tab-s', { hidden: false }));
  });

  it('Rename patches the new label', async () => {
    draw();
    await screen.findByText('T7');
    fireEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]);
    fireEvent.change(screen.getByLabelText('New name for T7'), { target: { value: 'Window 7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(http.patch).toHaveBeenCalledWith('/analytics/tables/r1/tab-7', { label: 'Window 7' }));
  });

  it('a refused rename (409) is said on screen, not swallowed', async () => {
    draw(settingsData({
      writer: writer({ failed: { key: 'table:tab-7', message: 'Another table in this house is already called "Staff".' } }),
    }));
    await screen.findByText('T7');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('already called "Staff"');
    expect(alert.textContent).toContain('still the server’s');
  });

  it('a reader who may not manage sees the tables and no control', async () => {
    draw(settingsData({ canManage: false }));
    await screen.findByText('T7');
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
    expect(screen.getByText(/Only the owner or a manager can rename or hide a table/)).toBeTruthy();
  });
});
