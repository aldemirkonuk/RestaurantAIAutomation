/**
 * Sorting Office contracts — the drawer honesty rules that make Direction D
 * safe at volume: the waiting drawer opens only when every register behind it
 * has answered (a half-known queue would misstate the debt order); waiting
 * rows sort oldest-debt first, never by arrival; a filled window renders as a
 * floor (≥), never a total; OD-81's file truth stands in the reading pane;
 * ?doc= share links preselect; an empty house says so in words.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({
  reports: undefined as unknown,
  reportsError: false,
  paper: [] as unknown[],
  review: [] as unknown[],
  paperPending: false,
  paperReject: false,
  threads: { total: 0 } as unknown,
  active: [] as unknown[],
  unverified: { items: [] as unknown[] },
  unverifiedReject: false,
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
    list: (params?: { status?: string }) => {
      if (api.paperPending) return new Promise(() => {});
      if (api.paperReject) return Promise.reject(new Error('paper register down'));
      return Promise.resolve(params?.status === 'needs_review' ? api.review : api.paper);
    },
  },
}));
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: {
    listUnverified: () =>
      api.unverifiedReject
        ? Promise.reject(new Error('door register down'))
        : Promise.resolve(api.unverified),
  },
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
  api.review = [];
  api.paperPending = false;
  api.paperReject = false;
  api.threads = { total: 0 };
  api.active = [];
  api.unverified = { items: [] };
  api.unverifiedReject = false;
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
    // The review docs are deliberately ABSENT from the unfiltered window
    // (api.paper): the queue must come from its own status-filtered query, so
    // debt older than the 100 newest documents of any status still surfaces
    // (audit blocker 1).
    api.review = [
      paperDoc('p-new', { status: 'needs_review', doc_date: '2026-08-29', ties_out: false, tie_out_delta: -3.5 }),
      paperDoc('p-old', { status: 'needs_review', doc_date: '2026-08-10' }),
    ];
    api.paper = [paperDoc('p-fine')]; // processed — not a debt
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

  it('a waiting-register failure raises the banner too — the drawer is never silently stuck', async () => {
    // Audit blocker 2: threads/drafts/door failures used to be invisible.
    api.unverifiedReject = true;
    api.reports = [report('r1')];
    renderPage();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be refreshed'));
    expect(screen.getByRole('alert').textContent).toContain('door register down');
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('when every register is down the banner claims nothing', async () => {
    api.reportsError = true;
    api.reports = undefined;
    api.paperReject = true;
    renderPage();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be reached'));
    expect(screen.getByRole('alert').textContent).toContain('nothing below is claimed');
  });

  it('the "In the registers" header counts all four registers, Conversations included', async () => {
    api.reports = [report('r1')];
    api.paper = [paperDoc('p1'), paperDoc('p2')];
    api.threads = { total: 7 };
    api.timeline = {
      events: [
        { id: 'e1', source: 'pos_checks', occurredAt: '2026-08-01T10:00:00Z', correlationId: null, summary: 's' },
        { id: 'e2', source: 'decision_log', occurredAt: '2026-08-01T11:00:00Z', correlationId: null, summary: 's' },
        { id: 'e3', source: 'pos_checks', occurredAt: '2026-08-01T12:00:00Z', correlationId: null, summary: 's' },
      ],
    };
    renderPage();
    // 1 report + 2 paper + 7 threads + 3 timeline = 13
    await waitFor(() => expect(screen.getByText('13')).toBeTruthy());
  });

  it('the noise roll counts today by source and files yesterday away', async () => {
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    api.timeline = {
      events: [
        { id: 'e1', source: 'pos_checks', occurredAt: today, correlationId: null, summary: 's' },
        { id: 'e2', source: 'decision_log', occurredAt: today, correlationId: null, summary: 's' },
        { id: 'e3', source: 'pos_checks', occurredAt: yesterday, correlationId: null, summary: 's' },
      ],
    };
    renderPage();
    await waitFor(() => {
      const roll = screen.getByLabelText('Filed itself today').textContent ?? '';
      expect(roll).toContain('2 entries');
      expect(roll).toContain('1 pos checks');
      expect(roll).toContain('1 decision log');
    });
  });

  it('a failed clipboard write is said on the control, and the label recovers', async () => {
    // jsdom exposes no navigator.clipboard — the control must not throw or lie.
    api.reports = [report('r1', { summary: 'A summary.' })];
    renderPage(['/documents-reports?doc=r1']);
    await waitFor(() => expect(screen.getByText('Copy share link')).toBeTruthy());
    fireEvent.click(screen.getByText('Copy share link'));
    expect(screen.getByText('Copy failed — use the address bar')).toBeTruthy();
  });
});

describe('so-format', () => {
  it('renders unknown and unparseable dates as the em dash', () => {
    expect(fmtDate(null)).toBe(EM);
    expect(fmtDate('not-a-date')).toBe(EM);
    expect(fmtDate('2026-08-30T09:00:00Z')).toMatch(/Aug/);
  });

  it('renders a date-only value as that calendar day in every timezone', () => {
    // A Postgres `date` ('2026-08-20') must never show as Aug 19 west of UTC.
    expect(fmtDate('2026-08-20')).toMatch(/Aug 20/);
  });
});
