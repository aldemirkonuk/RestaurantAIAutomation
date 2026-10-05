/**
 * ADR 0303, amendment 2026-10-05 — "Add a table" in Settings → Point of sale
 * (founder, verbatim "Follow-up: 'Add a table' (Recommended)"; option text: "A
 * small separate PR adds 'Add a table' to Settings → Point of sale, for owners
 * and managers. Waiting checks with that word link to it automatically.").
 *
 * The till never makes a table from a word with no number in it, so an owner
 * or a manager adds one here by name. A clash is the gateway's 409 sentence,
 * said on screen; an add re-reads the list, and the new row says how many
 * waiting checks it took.
 */
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SettingsNextData } from './useSettingsNextData';

const http = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: http.get, patch: http.patch, post: http.post },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown'),
}));

import { TillTablesOpener } from './PosSection';

const T7 = { id: 'tab-7', label: 'T7', pos_refs: { csv_import: 'T7' }, learned_at: '2026-10-04T00:31:00.000Z', hidden_at: null };
const BAR = { id: 'tab-bar', label: 'Bar', pos_refs: {}, learned_at: null, hidden_at: null };

/** The page's own writer, as `useWriter` keeps it: a failure is held and rendered. */
function Page({ canManage, runs }: { canManage: boolean; runs: string[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const writer = {
    busy,
    failed,
    run: async (key: string, fn: () => Promise<void>) => {
      runs.push(key);
      setBusy(key);
      setFailed(null);
      try {
        await fn();
        return true;
      } catch (e) {
        setFailed({ key, message: e instanceof Error ? e.message : 'unknown' });
        return false;
      } finally {
        setBusy(null);
      }
    },
    clear: () => setFailed(null),
  };
  return <TillTablesOpener data={{ restaurantId: 'r1', canManage, writer } as unknown as SettingsNextData} />;
}

function draw(canManage = true) {
  const runs: string[] = [];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <Page canManage={canManage} runs={runs} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Tables the till has named/ }));
  return runs;
}

async function typeName(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Add a table' }));
  fireEvent.change(screen.getByLabelText('Name of the new table'), { target: { value: name } });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  http.get.mockResolvedValue({ data: [T7] });
  http.post.mockResolvedValue({ data: { ...BAR, seats: null, checksLinked: 2 } });
});

describe('who may add a table (founder fork F1, "Owner or manager")', () => {
  it('an owner or a manager is offered "Add a table", and it asks for a name only', async () => {
    draw(true);
    await typeName('Bar');
    expect(screen.getByLabelText('Name of the new table').getAttribute('maxlength')).toBe('60');
    expect(screen.queryByLabelText(/seat/i)).toBeNull();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('anyone else sees the tables, no add control, and who may add', async () => {
    draw(false);
    await screen.findByText('T7');
    expect(screen.queryByRole('button', { name: 'Add a table' })).toBeNull();
    expect(
      screen.getByText('Only the owner or a manager can rename or hide a table. Adding one by hand is theirs too.'),
    ).toBeTruthy();
  });

  it('with no table yet, anyone else is told only an owner or a manager can add one', async () => {
    http.get.mockResolvedValue({ data: [] });
    draw(false);
    expect(await screen.findByText('Only the owner or a manager can add a table by hand.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a table' })).toBeNull();
  });

  it('an owner with no table yet can still add one', async () => {
    http.get.mockResolvedValue({ data: [] });
    draw(true);
    expect(await screen.findByRole('button', { name: 'Add a table' })).toBeTruthy();
  });
});

describe('adding a table', () => {
  it('posts the name, re-reads the list, and the new row says how many waiting checks it took', async () => {
    const runs = draw(true);
    await screen.findByText('T7');
    http.get.mockResolvedValue({ data: [BAR, T7] });
    await typeName('Bar');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(http.post).toHaveBeenCalledWith('/analytics/tables/r1', { label: 'Bar' }));
    expect(runs).toContain('table:add');
    expect(await screen.findByText('Added just now. It took 2 checks that were waiting with its name.')).toBeTruthy();
    expect(http.get).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Bar')).toBeTruthy();
    expect(screen.queryByLabelText('Name of the new table')).toBeNull();
  });

  it.each<[number | null, string]>([
    [0, 'Added just now. No check was waiting with its name.'],
    [1, 'Added just now. It took 1 check that was waiting with its name.'],
    [null, 'Added just now. How many waiting checks it took could not be counted.'],
  ])('a count of %s is said as such, never as a guess', async (count, said) => {
    http.post.mockResolvedValue({ data: { ...BAR, checksLinked: count } });
    draw(true);
    await screen.findByText('T7');
    http.get.mockResolvedValue({ data: [BAR, T7] });
    await typeName('Bar');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(said)).toBeTruthy();
  });

  it('a clash is the gateway’s sentence, on screen; the form stays open and nothing is re-read', async () => {
    http.post.mockRejectedValue(new Error('This house already has a table called "T7".'));
    draw(true);
    await screen.findByText('T7');
    await typeName('t7');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('This house already has a table called "T7".');
    expect(alert.textContent).toContain('still the server’s');
    expect(screen.getByLabelText('Name of the new table')).toBeTruthy();
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('a blank name cannot be sent, and Cancel closes the form', async () => {
    draw(true);
    await typeName('   ');
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name of the new table')).toBeNull();
    expect(http.post).not.toHaveBeenCalled();
  });
});
