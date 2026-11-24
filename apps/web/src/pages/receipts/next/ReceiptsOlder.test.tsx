/**
 * THE VERIFIED BOOK CAN BE WALKED BACK PAST ITS FIRST WINDOW (r104 g2).
 *
 * A house with a year of deliveries loses every paper older than the newest 100
 * unless the page lets it search and read older ones, and says the window is
 * full. These cases fail with the Older button, the search or the sentence
 * removed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', activeRole: 'manager', user: null }),
  AuthContext: createContext<{ activeRestaurantId: string | null } | null>(null),
}));
vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return { ...mod, documentsApi: { ...mod.documentsApi, list: api.list, houseCurrency: () => Promise.resolve(null) } };
});
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: { listUnverified: () => Promise.resolve({ items: [] }) },
}));
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: { document: () => new Promise(() => {}) },
}));
vi.mock('../../documents/next/CanonicalDocumentPage', () => ({
  CanonicalDocumentPage: () => <div />,
}));
vi.mock('../../../services/api/orders', () => ({ getOrder: () => Promise.resolve(null) }));

import ReceiptsNext from './ReceiptsNext';

const paper = (n: number) =>
  ({
    id: `v${n}`,
    doc_type: 'invoice',
    status: 'verified',
    doc_number: `V-${n}`,
    doc_date: '2026-01-01',
    currency: 'USD',
    total: 10,
    created_at: new Date(Date.UTC(2026, 10, 20) - n * 3600_000).toISOString(),
  }) as unknown as ProcurementDocument;

const newest = Array.from({ length: 100 }, (_, i) => paper(i + 1));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

async function openLane() {
  fireEvent.click(await screen.findByRole('button', { name: /Verified · / }));
}

beforeEach(() => {
  api.list.mockReset();
  api.list.mockImplementation((o: { status?: string; before?: string; q?: string }) => {
    if (o.status !== 'verified') return Promise.resolve([]);
    if (o.before) return Promise.resolve([paper(101)]);
    if (o.q) return Promise.resolve([paper(150)]);
    return Promise.resolve(newest);
  });
});

describe('the verified lane past its first window', () => {
  it('says the window is full, and the 101st paper is reachable with Older papers', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openLane();
    expect(await screen.findByText(/Showing the newest 100 verified papers/)).toBeTruthy();
    expect(screen.queryByText(/V-101/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Older papers' }));
    expect(await screen.findByText(/V-101/)).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'verified', before: newest[99].created_at }),
    );
    // One short page later nothing is older, and the sentence goes.
    await waitFor(() => expect(screen.queryByText(/Showing the newest/)).toBeNull());
  });

  it('finds a paper by vendor or number', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openLane();
    fireEvent.change(await screen.findByLabelText('Search verified papers by vendor or number'), {
      target: { value: 'acme' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText(/V-150/)).toBeTruthy();
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'verified', q: 'acme' }));
  });

  it('says so when the older read fails', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openLane();
    api.list.mockImplementationOnce(() => Promise.reject(new Error('gateway is down')));
    fireEvent.click(await screen.findByRole('button', { name: 'Older papers' }));
    expect(await screen.findByText(/Older papers could not be read/)).toBeTruthy();
  });

  it('says nothing about older papers when the first window is not full', async () => {
    api.list.mockImplementation((o: { status?: string }) =>
      Promise.resolve(o.status === 'verified' ? newest.slice(0, 3) : []),
    );
    render(<ReceiptsNext />, { wrapper });
    await openLane();
    await screen.findByText(/V-1\b/);
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Older papers' })).toBeNull();
  });
});

describe('at a 375 px phone (r105)', () => {
  const before = window.innerWidth;
  afterEach(() => {
    window.innerWidth = before;
  });

  // jsdom has no layout, so this pins what a phone can actually reach: the
  // controls exist, are named, and no ancestor hides them below a breakpoint.
  const hiddenBelowBreakpoint = (el: Element | null) => {
    for (let n = el; n; n = n.parentElement)
      if (/(^|\s)hidden(\s|$)/.test(n.getAttribute('class') ?? '')) return true;
    return false;
  };

  it('the window sentence, the search and Older papers are all reachable and say what they do', async () => {
    window.innerWidth = 375;
    window.dispatchEvent(new Event('resize'));
    render(<ReceiptsNext />, { wrapper });
    await openLane();
    expect(await screen.findByText(/Showing the newest 100 verified papers/)).toBeTruthy();
    for (const el of [
      screen.getByRole('button', { name: 'Older papers' }),
      screen.getByLabelText('Search verified papers by vendor or number'),
      screen.getByRole('button', { name: 'Find' }),
    ])
      expect(hiddenBelowBreakpoint(el)).toBe(false);
    // And at 375 it still pages: the older paper arrives.
    fireEvent.click(screen.getByRole('button', { name: 'Older papers' }));
    expect(await screen.findByText(/V-101/)).toBeTruthy();
  });

  it('a search at 375 needs Find or Enter, and the field says so (walk g2 note)', async () => {
    window.innerWidth = 375;
    render(<ReceiptsNext />, { wrapper });
    await openLane();
    const box = await screen.findByLabelText('Search verified papers by vendor or number');
    fireEvent.change(box, { target: { value: 'acme' } });
    expect(api.list).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'acme' }));
    fireEvent.submit(box.closest('form') ?? box);
    expect(await screen.findByText(/V-150/)).toBeTruthy();
  });
});
