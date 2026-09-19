/**
 * OD-81 — the export shelf and the desk behind it.
 *
 * Two halves. The shelf's render contract, on a desk object: every status looks
 * like what it is, a download exists only for a written export, a failed one
 * carries the gateway's reason and a retry, and a list that could not be read
 * is never drawn as an empty one. And the desk itself, through the real hook
 * and the real API client functions, with only the HTTP boundary (`apiClient`)
 * and the auth context doubled: which route each act calls, that a queued
 * export is re-read until it settles, and that a refusal is written in the
 * gateway's own words.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReportExport } from '@/services/api/reports';

const auth = vi.hoisted(() => ({ rid: 'r1' as string | null, role: 'manager' as string | null }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid, activeRole: auth.role }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));

import ExportsShelf from './ExportsShelf';
import { REVOKE_AFTER_MS, reasonOf, saveFile, useReportExports, type ExportDesk } from './useReportExports';

const base: ReportExport = {
  id: 'e1',
  cutting: 'ledger',
  title: 'Figures of record',
  windowLabel: '365 days of COGS; the cellar as it stands today',
  windowDays: null,
  status: 'ready',
  failureReason: null,
  withheldCount: 8,
  csvBytes: 2048,
  htmlBytes: 6000,
  attempts: 1,
  requestedAt: '2026-09-17T09:00:00.000Z',
  startedAt: '2026-09-17T09:00:00.000Z',
  finishedAt: '2026-09-17T09:00:02.000Z',
};

function desk(over: Partial<ExportDesk> = {}): ExportDesk {
  return {
    canExport: true,
    readOnlyReason: null,
    exports: [],
    total: 0,
    page: 1,
    pageCount: 1,
    canPrevPage: false,
    canNextPage: false,
    prevPage: vi.fn(),
    nextPage: vi.fn(),
    loading: false,
    listFailure: null,
    refetch: vi.fn(),
    busy: null,
    error: null,
    clearError: vi.fn(),
    request: vi.fn(),
    retry: vi.fn(),
    download: vi.fn(),
    ...over,
  };
}

const shelf = (d: ExportDesk, onSheet = ['reading', 'till', 'ledger', 'writing'] as never[]) =>
  render(<ExportsShelf desk={d} onSheet={onSheet} tillDays={30} />);

describe('ExportsShelf — every status looks like what it is (OD-81)', () => {
  it('a written export offers its two files and says how many figures are withheld', () => {
    const d = desk({ exports: [base], total: 1 });
    shelf(d);
    const row = screen.getAllByRole('listitem')[0];
    expect(within(row).getByText('Ready')).toBeInTheDocument();
    expect(within(row).getByText(/8 figures are written as “withheld”/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Download Figures of record as CSV' }));
    expect(d.download).toHaveBeenCalledWith(base, 'csv');
    fireEvent.click(within(row).getByRole('button', { name: 'Download Figures of record as a print page' }));
    expect(d.download).toHaveBeenCalledWith(base, 'html');
    expect(within(row).queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('an export being written offers no download — there is no file yet', () => {
    shelf(desk({ exports: [{ ...base, status: 'queued', withheldCount: null, csvBytes: null, htmlBytes: null, finishedAt: null }], total: 1 }));
    const row = screen.getAllByRole('listitem')[0];
    expect(within(row).getByText('Being written')).toBeInTheDocument();
    expect(within(row).queryAllByRole('button')).toHaveLength(0);
  });

  it('a failed export prints the gateway’s reason verbatim and offers a retry, never a download', () => {
    const failed = {
      ...base,
      id: 'e2',
      status: 'failed' as const,
      failureReason: 'Not written: the Figures of record register could not be read: timeout',
      withheldCount: null,
      csvBytes: null,
      htmlBytes: null,
      attempts: 2,
    };
    const d = desk({ exports: [failed], total: 1 });
    shelf(d);
    const row = screen.getAllByRole('listitem')[0];
    expect(within(row).getByText('Not written')).toBeInTheDocument();
    expect(within(row).getByRole('note')).toHaveTextContent(failed.failureReason);
    expect(within(row).getByText(/attempt 2/)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Download/ })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Try again' }));
    expect(d.retry).toHaveBeenCalledWith('e2');
  });

  it('a list that could not be read says so, with its reason — not “nothing yet”', () => {
    const d = desk({ exports: undefined, total: null, listFailure: { status: 500, message: 'permission denied', forbidden: false } });
    shelf(d);
    expect(screen.getByRole('alert')).toHaveTextContent('The list of exports could not be read (permission denied).');
    expect(screen.queryByText('Nothing has been written up for this house yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    expect(d.refetch).toHaveBeenCalled();
  });

  it('while the list is in flight it says it is reading, not that there is nothing', () => {
    shelf(desk({ exports: undefined, total: null, loading: true }));
    expect(screen.getByRole('status')).toHaveTextContent('Reading this house’s exports…');
    expect(screen.queryByText('Nothing has been written up for this house yet.')).toBeNull();
  });

  it('states the range and total on the current page, and offers Next when there is more', () => {
    const { unmount } = shelf(
      desk({ exports: [base], total: 41, page: 1, pageCount: 3, canNextPage: true, canPrevPage: false }),
    );
    expect(screen.getByText('Exports 1 of 41 stored. Page 1 of 3.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    unmount();
    shelf(desk({ exports: [base], total: null, page: 2, canNextPage: true, canPrevPage: true }));
    expect(screen.getByText(/could not count this house’s exports; page 2 is listed/)).toBeInTheDocument();
  });

  it('shows the range for a full middle page, and disables Next on the last page', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ ...base, id: `e${i}` }));
    shelf(
      desk({
        exports: twenty,
        total: 41,
        page: 2,
        pageCount: 3,
        canPrevPage: true,
        canNextPage: false,
      }),
    );
    expect(screen.getByText('Exports 21–40 of 41 stored. Page 2 of 3.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  it('Previous and Next call back into the desk', () => {
    const d = desk({ exports: [base], total: 41, page: 2, pageCount: 3, canPrevPage: true, canNextPage: true });
    shelf(d);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(d.prevPage).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(d.nextPage).toHaveBeenCalled();
  });

  it('offers no paging controls when everything fits on one page', () => {
    shelf(desk({ exports: [base], total: 1, page: 1, pageCount: 1, canPrevPage: false, canNextPage: false }));
    expect(screen.getByText('Export 1 of 1 stored.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('says a page 1 empty list is the house’s own, and a later empty page is stale, not empty', () => {
    const { unmount } = shelf(desk({ exports: [], total: 0, page: 1 }));
    expect(screen.getByText('Nothing has been written up for this house yet.')).toBeInTheDocument();
    unmount();
    const d = desk({ exports: [], total: 20, page: 2, canPrevPage: true });
    shelf(d);
    expect(screen.getByText(/the list changed since you turned to it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(d.prevPage).toHaveBeenCalled();
  });

  it('offers only the cuttings on the sheet that read a register, and asks for the chosen one with no window', () => {
    const d = desk();
    shelf(d);
    const picker = screen.getByLabelText('Cutting to write up') as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.value)).toEqual(['reading', 'till', 'ledger']);
    fireEvent.change(picker, { target: { value: 'ledger' } });
    fireEvent.click(screen.getByRole('button', { name: 'Write it up' }));
    expect(d.request).toHaveBeenCalledWith('ledger', null);
  });

  it('a role that cannot export is told so, and is offered no control and no list', () => {
    shelf(desk({ canExport: false, readOnlyReason: 'Exports are written for owners and managers. Every figure is still on the sheet above.', exports: undefined }));
    expect(screen.getByRole('note')).toHaveTextContent('Exports are written for owners and managers.');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText('Cutting to write up')).toBeNull();
  });

  it('an act that did not go through is shown in words until dismissed', () => {
    const d = desk({ error: 'The export did not go through: 3 exports are already being written for this house. Wait for one to finish.' });
    shelf(d);
    expect(screen.getByRole('alert')).toHaveTextContent('3 exports are already being written');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(d.clearError).toHaveBeenCalled();
  });
});

/* ───────────────────────────────────────────── the desk, through its hook ── */

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('useReportExports — the desk (OD-81)', () => {
  beforeEach(() => {
    auth.rid = 'r1';
    auth.role = 'manager';
    api.get.mockReset();
    api.post.mockReset();
    vi.useRealTimers();
  });

  it('lists through the authenticated client, and re-reads a queued export until it settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queued = { ...base, status: 'queued', finishedAt: null };
    api.get
      .mockResolvedValueOnce({ data: { exports: [queued], total: 1 } })
      .mockResolvedValue({ data: { exports: [base], total: 1 } });
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.exports?.[0].status).toBe('queued'));
    expect(api.get).toHaveBeenCalledWith('/reports/exports', { params: { limit: 20, offset: 0 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    await waitFor(() => expect(result.current.exports?.[0].status).toBe('ready'));
    const calls = api.get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // Settled: nothing left to poll for.
    expect(api.get.mock.calls.length).toBe(calls);
  });

  it('a failed list read is a failure with the gateway’s sentence, never an empty list', async () => {
    api.get.mockRejectedValue({ message: 'Request failed with status code 500', response: { status: 500, data: { message: 'permission denied for table report_exports' } } });
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.listFailure).not.toBeNull());
    expect(result.current.listFailure).toMatchObject({ status: 500, message: 'permission denied for table report_exports' });
    expect(result.current.exports).toBeUndefined();
  });

  it('pages: nextPage reads offset 20, pageCount and the page flags follow the total', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ ...base, id: `e${i}` }));
    api.get.mockImplementation(async (_url: string, cfg: { params: { offset: number } }) =>
      cfg.params.offset === 0
        ? { data: { exports: twenty, total: 41 } }
        : { data: { exports: [base], total: 41 } },
    );
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.exports).toHaveLength(20));
    expect(result.current.page).toBe(1);
    expect(result.current.pageCount).toBe(3);
    expect(result.current.canPrevPage).toBe(false);
    expect(result.current.canNextPage).toBe(true);

    await act(async () => result.current.nextPage());
    await waitFor(() => expect(result.current.page).toBe(2));
    expect(api.get).toHaveBeenCalledWith('/reports/exports', { params: { limit: 20, offset: 20 } });
    await waitFor(() => expect(result.current.exports).toEqual([base]));
    expect(result.current.canPrevPage).toBe(true);

    await act(async () => result.current.prevPage());
    expect(result.current.page).toBe(1);
  });

  it('a request for a new export sends the reader back to page 1', async () => {
    api.get.mockResolvedValue({ data: { exports: [base], total: 41 } });
    api.post.mockResolvedValue({ data: { ...base, status: 'queued' } });
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.exports).toEqual([base]));

    await act(async () => result.current.nextPage());
    await waitFor(() => expect(result.current.page).toBe(2));

    await act(async () => result.current.request('ledger', null));
    expect(result.current.page).toBe(1);
  });

  it('when the gateway cannot count, Next stays offered exactly while the page came back full', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({ ...base, id: `e${i}` }));
    api.get.mockResolvedValueOnce({ data: { exports: twenty, total: null } });
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.exports).toHaveLength(20));
    expect(result.current.total).toBeNull();
    expect(result.current.pageCount).toBeNull();
    expect(result.current.canNextPage).toBe(true);
  });

  it('asks for an export, and the till with its window, on POST /reports/exports', async () => {
    api.get.mockResolvedValue({ data: { exports: [], total: 0 } });
    api.post.mockResolvedValue({ data: { ...base, status: 'queued' } });
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.exports).toEqual([]));

    await act(async () => result.current.request('ledger', null));
    await act(async () => result.current.request('till', 7));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenNthCalledWith(1, '/reports/exports', { cutting: 'ledger' });
    expect(api.post).toHaveBeenNthCalledWith(2, '/reports/exports', { cutting: 'till', days: 7 });
  });

  it('a refused request is written in the gateway’s words', async () => {
    api.get.mockResolvedValue({ data: { exports: [], total: 0 } });
    api.post.mockRejectedValue({
      message: 'Request failed with status code 429',
      response: { status: 429, data: { message: '3 exports are already being written for this house. Wait for one to finish.' } },
    });
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.exports).toEqual([]));
    await act(async () => result.current.request('ledger', null));
    await waitFor(() =>
      expect(result.current.error).toBe(
        'The export did not go through: 3 exports are already being written for this house. Wait for one to finish.',
      ),
    );
  });

  it('retries on POST /reports/exports/:id/retry', async () => {
    api.get.mockResolvedValue({ data: { exports: [], total: 0 } });
    api.post.mockResolvedValue({ data: { ...base, status: 'queued', attempts: 2 } });
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });
    await act(async () => result.current.retry('e2'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/reports/exports/e2/retry'));
  });

  it('downloads the file as text and names it from the row; a 409 body arriving as text still yields its sentence', async () => {
    api.get.mockImplementation(async (url: string) =>
      url === '/reports/exports' ? { data: { exports: [], total: 0 } } : { data: 'Mudavym report export\r\n' },
    );
    const created: Blob[] = [];
    const urlApi = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const saved = { create: urlApi.createObjectURL, revoke: urlApi.revokeObjectURL };
    urlApi.createObjectURL = vi.fn((b: Blob) => (created.push(b), 'blob:x'));
    urlApi.revokeObjectURL = vi.fn();
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('mudavym-ledger-2026-09-17.csv');
    });
    try {
      const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });
      await act(async () => result.current.download(base, 'csv'));
      await waitFor(() => expect(clicks).toHaveBeenCalled());
      expect(api.get).toHaveBeenCalledWith(
        '/reports/exports/e1/download',
        expect.objectContaining({ params: { format: 'csv' }, responseType: 'text' }),
      );
      expect(created[0].type).toBe('text/csv;charset=utf-8');
      expect(result.current.error).toBeNull();
      // The blob URL is let go only after the download has had time to start.
      await waitFor(() => expect(urlApi.revokeObjectURL).toHaveBeenCalledWith('blob:x'), {
        timeout: REVOKE_AFTER_MS + 1000,
      });
    } finally {
      clicks.mockRestore();
      urlApi.createObjectURL = saved.create;
      urlApi.revokeObjectURL = saved.revoke;
    }

    expect(
      reasonOf({ message: 'Request failed with status code 409', response: { data: '{"statusCode":409,"message":"This export is still being written."}' } }),
    ).toBe('This export is still being written.');
  });

  it('does not revoke the file’s URL in the tick it clicks — a browser may still be starting the download', () => {
    const urlApi = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const saved = { create: urlApi.createObjectURL, revoke: urlApi.revokeObjectURL };
    const order: string[] = [];
    urlApi.createObjectURL = vi.fn(() => (order.push('create'), 'blob:y'));
    const revoke = vi.fn(() => order.push('revoke'));
    urlApi.revokeObjectURL = revoke;
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      order.push(`click ${this.download} ${this.href}`);
    });
    vi.useFakeTimers();
    try {
      saveFile('mudavym-till-2026-09-17.html', 'text/html;charset=utf-8', '<!doctype html>');
      expect(order).toEqual(['create', 'click mudavym-till-2026-09-17.html blob:y']);
      expect(document.querySelector('a[download]')).toBeNull();
      vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(revoke).toHaveBeenCalledWith('blob:y');
      expect(order).toEqual(['create', 'click mudavym-till-2026-09-17.html blob:y', 'revoke']);
    } finally {
      vi.useRealTimers();
      clicks.mockRestore();
      urlApi.createObjectURL = saved.create;
      urlApi.revokeObjectURL = saved.revoke;
    }
  });

  it('a role that cannot export does not even read the list', async () => {
    auth.role = 'staff';
    const { result } = renderHook(() => useReportExports({ queryRoot: 'reports-next' }), { wrapper: wrapper() });
    expect(result.current.canExport).toBe(false);
    expect(result.current.readOnlyReason).toBe(
      'Exports are written for owners and managers. Every figure is still on the sheet above.',
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(api.get).not.toHaveBeenCalled();
  });
});
