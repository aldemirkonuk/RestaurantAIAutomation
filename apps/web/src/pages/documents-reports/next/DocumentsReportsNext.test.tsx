/**
 * Sorting Office contracts — the drawer honesty rules that make Direction D
 * safe at volume: the waiting drawer opens only when every register behind it
 * has answered (a half-known queue would misstate the debt order); waiting
 * rows sort oldest-debt first, never by arrival; a filled window renders as a
 * floor (≥), never a total; OD-81's file truth stands in the reading pane;
 * ?doc= share links preselect; an empty house says so in words.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({
  reports: undefined as unknown,
  reportsError: false,
  paper: [] as unknown[],
  paperPending: false,
  threads: { total: 0 } as unknown,
  active: [] as unknown[],
  unverified: { items: [] as unknown[] },
  timeline: { events: [] as unknown[] },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));
vi.mock('../../../hooks/queries/useReportQueries', () => ({
  useGeneratedReports: () => ({
    data: api.reports,
    isError: api.reportsError,
    error: api.reportsError ? new Error('reports register down') : null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../../hooks/queries/useConversationQueries', () => ({
  useConversationThreads: () => ({ data: api.threads, refetch: vi.fn() }),
}));
vi.mock('../../../hooks/queries/useDraftEmailQueries', () => ({
  useActiveConversations: () => ({ data: api.active, refetch: vi.fn() }),
}));
vi.mock('../../../services/api/documents', () => ({
  documentsApi: {
    list: () =>
      api.paperPending ? new Promise(() => {}) : Promise.resolve(api.paper),
  },
}));
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: { listUnverified: () => Promise.resolve(api.unverified) },
}));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: () => Promise.resolve({ data: api.timeline }) },
}));

import DocumentsReportsNext from './DocumentsReportsNext';
import { useSortingOfficeData } from './useSortingOfficeData';
import { EM, fmtDate } from './so-format';

const report = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  restaurantId: 'r1',
  title: `Report ${id}`,
  reportType: 'weekly',
  status: 'completed',
  createdAt: '2026-08-30T09:00:00Z',
  ...over,
});

const paperDoc = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: 'processed',
  doc_number: `INV-${id}`,
  doc_date: '2026-08-20',
  created_at: '2026-08-20T10:00:00Z',
  ties_out: true,
  tie_out_delta: null,
  ...over,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage(initialEntries: string[] = ['/documents-reports']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <DocumentsReportsNext />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.reports = [];
  api.reportsError = false;
  api.paper = [];
  api.paperPending = false;
  api.threads = { total: 0 };
  api.active = [];
  api.unverified = { items: [] };
  api.timeline = { events: [] };
});

describe('useSortingOfficeData', () => {
  it('keeps the waiting drawer null until every register behind it has answered', async () => {
    api.paperPending = true; // the paper register never answers
    api.active = [{ id: 'c1', createdAt: '2026-08-29T10:00:00Z' }];
    const r = renderHook(() => useSortingOfficeData(), { wrapper });
    // reports answered → the page has data, but the queue must stay unknown
    await waitFor(() => expect(r.result.current.hasData).toBe(true));
    expect(r.result.current.waiting).toBeNull();
    expect(r.result.current.paperCount).toBeNull();
  });

  it('sorts the waiting queue oldest-debt first across registers, never by arrival', async () => {
    api.paper = [
      paperDoc('p-new', { status: 'needs_review', doc_date: '2026-08-29', ties_out: false, tie_out_delta: -3.5 }),
      paperDoc('p-old', { status: 'needs_review', doc_date: '2026-08-10' }),
      paperDoc('p-fine'), // processed — not a debt
    ];
    api.active = [{ id: 'c1', createdAt: '2026-08-20T10:00:00Z', providerName: 'Kermit' }];
    api.unverified = {
      items: [
        { orderId: 'o1', orderNumber: 'PO-77', countedAt: '2026-08-25T08:00:00Z', countedQtyBottles: 12, ageHours: 140 },
      ],
    };
    const r = renderHook(() => useSortingOfficeData(), { wrapper });
    await waitFor(() => expect(r.result.current.waiting).not.toBeNull());
    const keys = (r.result.current.waiting ?? []).map((w) => w.key);
    expect(keys).toEqual(['paper-p-old', 'draft-c1', 'door-o1', 'paper-p-new']);
    const titles = (r.result.current.waiting ?? []).map((w) => w.title);
    expect(titles[3]).toBe('INV-p-new does not tie out');
    expect((r.result.current.waiting ?? [])[3].detail).toBe('off by $3.50');
  });

  it('marks a filled paper window as a floor, never a total', async () => {
    api.paper = Array.from({ length: 100 }, (_, i) => paperDoc(`p${i}`));
    const r = renderHook(() => useSortingOfficeData(), { wrapper });
    await waitFor(() => expect(r.result.current.paperCount).toBe(100));
    expect(r.result.current.paperCapped).toBe(true);
  });
});

describe('DocumentsReportsNext', () => {
  it('says in words why the waiting drawer is closed while a register is unanswered', async () => {
    api.paperPending = true;
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/registers haven’t all answered/)).toBeTruthy(),
    );
    // the header count is an em dash, not a zero
    expect(screen.getByLabelText('Waiting on you').textContent).toContain(EM);
  });

  it('renders a filled window with the ≥ floor mark', async () => {
    api.paper = Array.from({ length: 100 }, (_, i) => paperDoc(`p${i}`));
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText('Vendor paper').textContent).toContain('≥100'),
    );
  });

  it('OD-81: a report with no file says so, disabled with the reason — never a dead button', async () => {
    api.reports = [report('r1', { pdfUrl: null, excelUrl: null, csvUrl: null, summary: 'A summary.' })];
    renderPage(['/documents-reports?doc=r1']);
    await waitFor(() => expect(screen.getByText('No file was attached')).toBeTruthy());
    expect(screen.queryByText(/Open the file/)).toBeNull();
  });

  it('honours ?doc= share links by opening that report in the reading pane', async () => {
    api.reports = [
      report('r1', { title: 'August depletion' }),
      report('r2', { title: 'Vendor price drift', summary: 'Prices moved.' }),
    ];
    renderPage(['/documents-reports?doc=r2']);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Vendor price drift'),
    );
    expect(screen.getByText('Prices moved.')).toBeTruthy();
  });

  it('an empty house says so in words instead of an empty pane', async () => {
    api.reports = [];
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/The house has written no reports yet/)).toBeTruthy(),
    );
  });

  it('a partial register failure is branch-aware: last answer kept, not "nothing is claimed"', async () => {
    api.reportsError = true;
    api.reports = undefined; // reports register down…
    api.paper = [paperDoc('p1')]; // …but paper answered
    renderPage();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be refreshed'));
    expect(screen.getByRole('alert').textContent).not.toContain('nothing below is claimed');
  });
});

describe('so-format', () => {
  it('renders unknown and unparseable dates as the em dash', () => {
    expect(fmtDate(null)).toBe(EM);
    expect(fmtDate('not-a-date')).toBe(EM);
    expect(fmtDate('2026-08-30T09:00:00Z')).toMatch(/Aug/);
  });
});
