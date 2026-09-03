/**
 * Sorting Office contracts — the drawer honesty rules that make Direction D
 * safe at volume: the waiting drawer opens only when every register behind it
 * has answered (a half-known queue would misstate the debt order); waiting
 * rows sort oldest-debt first from their OWN status-filtered query, never by
 * arrival; a filled window renders as a floor (≥), never a total; the house
 * count is the gateway's exact total, not an array length; a failure in ANY
 * register raises the banner, and "nothing below is claimed" is said only
 * when nothing below claims anything; OD-81's file truth stands; ?doc= share
 * links preselect and say so when the report is gone; an empty house says so.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({
  reports: [] as unknown[],
  reportsTotal: null as number | null,
  reportsReject: false,
  paper: [] as unknown[],
  review: [] as unknown[],
  paperPending: false,
  paperReject: false,
  threads: { total: 0 } as unknown,
  threadsError: false,
  active: [] as unknown[],
  activeError: false,
  unverified: { items: [] as unknown[] },
  unverifiedReject: false,
  timeline: { events: [] as unknown[] } as {
    events: unknown[];
    failedSources?: string[];
    sourcesQueried?: string[];
  },
  timelineReject: false,
  crossFile: {
    periodStart: null,
    periodEnd: null,
    paper: null,
    conversations: null,
  } as unknown,
  crossFileReject: false,
  crossFileHangs: false,
  refileSpy: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));
vi.mock('../../../services/api/reports', () => ({
  REPORT_TYPES: [
    'inventory_summary',
    'sales_analysis',
    'procurement_history',
    'financial_summary',
    'compliance_report',
  ],
  listReportsWithTotal: () =>
    api.reportsReject
      ? Promise.reject(new Error('reports register down'))
      : Promise.resolve({
          reports: api.reports,
          total: api.reportsTotal ?? api.reports.length,
        }),
  getReportCrossFile: () =>
    api.crossFileHangs
      ? new Promise(() => {})
      : api.crossFileReject
        ? Promise.reject(new Error('cross-file down'))
        : Promise.resolve(api.crossFile),
  refileReport: (...args: unknown[]) => api.refileSpy(...(args as [])),
}));
vi.mock('../../../hooks/queries/useConversationQueries', () => ({
  useConversationThreads: () => ({
    data: api.threadsError ? undefined : api.threads,
    isError: api.threadsError,
    isFetching: false,
    error: api.threadsError ? new Error('threads register down') : null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../../hooks/queries/useDraftEmailQueries', () => ({
  useActiveConversations: () => ({
    data: api.activeError ? undefined : api.active,
    isError: api.activeError,
    isFetching: false,
    error: api.activeError ? new Error('drafts register down') : null,
    refetch: vi.fn(),
  }),
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
  apiClient: {
    get: () =>
      api.timelineReject
        ? Promise.reject(new Error('timeline register down'))
        : Promise.resolve({ data: api.timeline }),
  },
}));

import DocumentsReportsNext from './DocumentsReportsNext';
import { settledError, useSortingOfficeData } from './useSortingOfficeData';
import { EM, fmtDate, fmtMoney, sortKey } from './so-format';

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
  // The column's own default. Real rows carry it; the page used to ignore it.
  currency: 'USD',
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
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={initialEntries}>
          <DocumentsReportsNext />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  api.reports = [];
  api.reportsTotal = null;
  api.reportsReject = false;
  api.paper = [];
  api.review = [];
  api.paperPending = false;
  api.paperReject = false;
  api.threads = { total: 0 };
  api.threadsError = false;
  api.active = [];
  api.activeError = false;
  api.unverified = { items: [] };
  api.unverifiedReject = false;
  api.timeline = { events: [] };
  api.timelineReject = false;
  api.crossFile = { periodStart: null, periodEnd: null, paper: null, conversations: null };
  api.crossFileReject = false;
  api.crossFileHangs = false;
  api.refileSpy = vi.fn(() => Promise.resolve({}));
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
    // Locale-robust: the amount is the document's, and it names its unit.
    expect((r.result.current.waiting ?? [])[3].detail).toMatch(/^off by .*3\.50/);
    expect((r.result.current.waiting ?? [])[3].detail).toMatch(/\$|USD/);
  });

  it('sends a row with an unparseable date to the END of the queue, never the top', async () => {
    api.review = [
      paperDoc('p-broken', { status: 'needs_review', doc_date: 'not-a-date', created_at: 'also-broken' }),
      paperDoc('p-old', { status: 'needs_review', doc_date: '2026-08-10' }),
    ];
    const r = renderHook(() => useSortingOfficeData(), { wrapper });
    await waitFor(() => expect(r.result.current.waiting).not.toBeNull());
    const keys = (r.result.current.waiting ?? []).map((w) => w.key);
    expect(keys).toEqual(['paper-p-old', 'paper-p-broken']);
  });

  it('marks a filled paper window as a floor, never a total', async () => {
    api.paper = Array.from({ length: 100 }, (_, i) => paperDoc(`p${i}`));
    const r = renderHook(() => useSortingOfficeData(), { wrapper });
    await waitFor(() => expect(r.result.current.paperCount).toBe(100));
    expect(r.result.current.paperCapped).toBe(true);
  });

  it('reports the gateway total, not the array length', async () => {
    api.reports = [report('r1'), report('r2'), report('r3')];
    api.reportsTotal = 47;
    const r = renderHook(() => useSortingOfficeData(), { wrapper });
    await waitFor(() => expect(r.result.current.reportsTotal).toBe(47));
    expect(r.result.current.reports).toHaveLength(3);
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

  it('the House drawer shows the exact total and discloses what the list omits', async () => {
    api.reports = [report('r1'), report('r2'), report('r3')];
    api.reportsTotal = 47;
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText('House reports').textContent).toContain('47'),
    );
    expect(screen.getByLabelText('House reports').textContent).toContain('44 more filed');
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
      report('r2', { title: 'Vendor price drift', summary: 'Prices moved.', reportType: 'price_drift' }),
    ];
    renderPage(['/documents-reports?doc=r2']);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Vendor price drift'),
    );
    expect(screen.getByText('Prices moved.')).toBeTruthy();
    // a DB enum is never shown raw
    expect(screen.getByText(/House report · price drift/)).toBeTruthy();
    expect(screen.queryByText(/price_drift/)).toBeNull();
  });

  it('a ?doc= id that no longer resolves is said, not silently discarded', async () => {
    api.reports = [report('r1')];
    renderPage(['/documents-reports?doc=deleted-report']);
    await waitFor(() =>
      expect(screen.getByText(/That report is no longer here/)).toBeTruthy(),
    );
  });

  it('an empty house says so in words instead of an empty pane', async () => {
    api.reports = [];
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/The house has written no reports yet/)).toBeTruthy(),
    );
  });

  it('a partial register failure is branch-aware: last answer kept, not "nothing is claimed"', async () => {
    api.reportsReject = true; // reports register down…
    api.paper = [paperDoc('p1')]; // …but paper answered
    renderPage();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('could not be refreshed'));
    expect(screen.getByRole('status').textContent).toContain('House reports');
    expect(screen.getByRole('status').textContent).not.toContain('nothing below is claimed');
  });

  it('a waiting-register failure raises the banner too — the drawer is never silently stuck', async () => {
    // Audit blocker 2: threads/drafts/door failures used to be invisible.
    api.unverifiedReject = true;
    api.reports = [report('r1')];
    renderPage();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('could not be refreshed'));
    expect(screen.getByRole('status').textContent).toContain('the door count');
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('a threads or drafts failure is not swallowed either', async () => {
    api.threadsError = true;
    api.reports = [report('r1')];
    renderPage();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Conversations'));
  });

  it('claims "nothing below" only when every register is down', async () => {
    api.reportsReject = true;
    api.paperReject = true;
    api.threadsError = true;
    api.activeError = true;
    api.unverifiedReject = true;
    api.timelineReject = true;
    renderPage();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be reached'));
    expect(screen.getByRole('alert').textContent).toContain('nothing below is claimed');
  });

  it('never claims "nothing below" while any register still answers', async () => {
    // Opus blocker 2: reports+paper down but conversations and the log up —
    // the drawers below make real claims, so the banner must not deny them.
    api.reportsReject = true;
    api.paperReject = true;
    api.threads = { total: 4 };
    renderPage();
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('could not be refreshed'));
    expect(screen.getByRole('status').textContent).not.toContain('nothing below is claimed');
  });

  it('publishes no summed "In the registers" figure — the addends share no unit', async () => {
    // ADR 0086. `procurement_documents` is one of the timeline's six sources
    // (logs-timeline.service.ts:196-233), so every vendor document in the
    // recent window was counted once as paper and again as a log event, and a
    // re-file inflated it a third time through `system_audit_log`. Beyond the
    // double count the sum had no unit at all: house reports, vendor
    // documents, conversation threads and log lines are four different kinds
    // of thing. The four drawers below already speak for themselves.
    api.reports = [report('r1')];
    api.paper = [paperDoc('p1'), paperDoc('p2')];
    api.threads = { total: 7 };
    api.timeline = {
      events: [
        { id: 'e1', source: 'pos_checks', occurredAt: '2026-08-01T10:00:00Z', correlationId: null, summary: 's' },
        { id: 'e2', source: 'procurement_documents', occurredAt: '2026-08-01T11:00:00Z', correlationId: null, summary: 's' },
        { id: 'e3', source: 'pos_checks', occurredAt: '2026-08-01T12:00:00Z', correlationId: null, summary: 's' },
      ],
    };
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText('Conversations').textContent).toContain('7'),
    );
    expect(screen.queryByText('In the registers')).toBeNull();
    // and nothing else prints the old sum (1 + 2 + 7 + 3)
    expect(screen.queryByText('13')).toBeNull();
  });

  it('the waiting drawer names the debt the door query actually means: a bottle count', async () => {
    // receiving.service.ts:43-44 — "a delivery with a case count and no bottle
    // count is unverified". The old sentence said "no paperwork", which sends
    // a manager looking for an invoice that was never the point.
    api.unverified = {
      items: [
        { orderId: 'o1', orderNumber: 'PO-77', countedAt: '2026-08-25T08:00:00Z', countedQtyBottles: 12, ageHours: 140 },
      ],
    };
    renderPage();
    await waitFor(() => expect(screen.getByText(/PO-77/)).toBeTruthy());
    expect(screen.getByText(/PO-77/).textContent).toMatch(/bottle/i);
    expect(screen.queryByText(/no paperwork/i)).toBeNull();
  });

  it('a filled timeline window whose oldest event is still today floors the routine count', async () => {
    // The strip renders a count filtered out of a 100-row window. The window
    // being full is not on its own enough to floor it — see the next test.
    const today = new Date();
    api.timeline = {
      events: Array.from({ length: 100 }, (_, i) => ({
        id: `e${i}`,
        source: 'pos_checks',
        occurredAt: new Date(today.getTime() - i * 1000).toISOString(),
        correlationId: null,
        summary: 's',
      })),
    };
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText('Filed itself today').textContent).toContain('≥100 entries'),
    );
  });

  it('a filled window whose oldest event predates today does NOT floor the routine count', async () => {
    // Every one of today's entries is inside a window that reaches back past
    // midnight, so the count is exact even though the window is full.
    const now = Date.now();
    const yesterday = now - 86_400_000;
    api.timeline = {
      events: [
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `t${i}`,
          source: 'pos_checks',
          occurredAt: new Date(now - i * 1000).toISOString(),
          correlationId: null,
          summary: 's',
        })),
        ...Array.from({ length: 98 }, (_, i) => ({
          id: `y${i}`,
          source: 'decision_log',
          occurredAt: new Date(yesterday - i * 1000).toISOString(),
          correlationId: null,
          summary: 's',
        })),
      ],
    };
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText('Filed itself today').textContent).toContain('2 entries'),
    );
    expect(screen.getByLabelText('Filed itself today').textContent).not.toContain('≥');
  });

  it('a timeline source that failed server-side raises the banner instead of shrinking a number', async () => {
    // logs-timeline.service.ts catches each source to [] and returns 200, so a
    // 500 in one source used to render as a smaller count with no banner at
    // all — absence reported as health, on a page whose subject is counts.
    api.timeline = {
      events: [
        { id: 'e1', source: 'pos_checks', occurredAt: new Date().toISOString(), correlationId: null, summary: 's' },
      ],
      failedSources: ['procurement_documents', 'system_audit_log'],
      sourcesQueried: [
        'pos_checks',
        'decision_log',
        'inventory_transactions',
        'procurement_documents',
        'system_audit_log',
      ],
    };
    api.reports = [report('r1')];
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('could not be refreshed'),
    );
    expect(screen.getByRole('status').textContent).toContain('procurement_documents');
    // and the count it produced is a floor, because two registers contributed
    // nothing to it
    expect(screen.getByLabelText('System log').textContent).toContain('≥1');
  });

  it('an unknown thread count in the cross-file is an em dash, never a zero', async () => {
    api.reports = [
      report('r1', { summary: 'A summary.', periodStart: '2026-03-01', periodEnd: '2026-03-31' }),
    ];
    api.crossFile = {
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      paper: { count: 12, sample: 'INV-88' },
      conversations: null,
    };
    renderPage(['/documents-reports?doc=r1']);
    await waitFor(() =>
      expect(screen.getByText('Vendor paper (12 documents · INV-88)')).toBeTruthy(),
    );
    expect(screen.getByRole('link', { name: /Conversations/ }).textContent).toContain(EM);
    expect(screen.queryByText(/Conversations \(0 threads\)/)).toBeNull();
  });

  it('the review strip agrees with itself: one document needs review, many need review', async () => {
    api.review = [paperDoc('p1', { status: 'needs_review' })];
    renderPage();
    await waitFor(() =>
      expect(screen.getByLabelText('Vendor paper').textContent).toContain('1 needs review'),
    );
  });

  it('a tie-out delta declares the document currency instead of assuming dollars', async () => {
    api.review = [
      paperDoc('p1', {
        status: 'needs_review',
        ties_out: false,
        tie_out_delta: -3.5,
        currency: 'EUR',
      }),
    ];
    renderPage();
    await waitFor(() => expect(screen.getByText(/does not tie out/)).toBeTruthy());
    const row = screen.getByText(/does not tie out/).parentElement;
    expect(row?.textContent).toMatch(/€3\.50|EUR/);
    expect(row?.textContent).not.toContain('$3.50');
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

  it('cross-files a period report to its registers, counted and linked at the right routes', async () => {
    api.reports = [
      report('r1', { summary: 'A summary.', periodStart: '2026-03-01', periodEnd: '2026-03-31' }),
    ];
    api.crossFile = {
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      paper: { count: 12, sample: 'INV-88' },
      conversations: { count: 2 },
    };
    renderPage(['/documents-reports?doc=r1']);
    await waitFor(() =>
      expect(screen.getByText('Vendor paper (12 documents · INV-88)')).toBeTruthy(),
    );
    // the links must land in the registers they name
    expect(
      screen.getByRole('link', { name: /Vendor paper \(12/ }).getAttribute('href'),
    ).toBe('/receipts');
    expect(
      screen.getByRole('link', { name: /Conversations \(2 threads\)/ }).getAttribute('href'),
    ).toBe('/communications');
  });

  it('a failed cross-file check is said, never rendered as empty registers', async () => {
    api.reports = [
      report('r1', { summary: 'A summary.', periodStart: '2026-03-01', periodEnd: '2026-03-31' }),
    ];
    api.crossFileReject = true;
    renderPage(['/documents-reports?doc=r1']);
    await waitFor(() =>
      expect(screen.getByText('The cross-file could not be checked.')).toBeTruthy(),
    );
    expect(screen.queryByText(/Vendor paper \(/)).toBeNull();
  });

  it('a cross-file query still in flight says the unknown, not the failure', async () => {
    // The pane's failure sentence is gated on the SAME settledError rule as
    // the page banner. Measured, not assumed: on @tanstack/react-query 5.90.16
    // a refetch after an error resets `status` to 'pending', so `isError &&
    // isFetching` does not arise today and the two rules agree — which is
    // exactly why the divergence had gone unnoticed. This pins the shared
    // rule so a version or option change (placeholderData, keepPreviousData)
    // cannot reintroduce the flash on one of the two branches only.
    api.reports = [
      report('r1', { summary: 'A summary.', periodStart: '2026-03-01', periodEnd: '2026-03-31' }),
    ];
    api.crossFileHangs = true;
    renderPage(['/documents-reports?doc=r1']);
    await waitFor(() => expect(screen.getByText(`Cross-filed under: ${EM}`)).toBeTruthy());
    expect(screen.queryByText('The cross-file could not be checked.')).toBeNull();
  });

  it('a failed re-file is said on the filing row, and reopening clears it', async () => {
    api.reports = [report('r1', { reportType: 'inventory_summary', summary: 'A summary.' })];
    api.refileSpy = vi.fn(() => Promise.reject(new Error('refused')));
    renderPage(['/documents-reports?doc=r1']);
    await waitFor(() => expect(screen.getByText('File to…')).toBeTruthy());
    fireEvent.click(screen.getByText('File to…'));
    fireEvent.click(screen.getByText('sales analysis'));
    await waitFor(() =>
      expect(screen.getByText(/The re-file did not take/)).toBeTruthy(),
    );
    // closing and reopening is a new session — the old failure does not resurface
    fireEvent.click(screen.getByText('File to…'));
    fireEvent.click(screen.getByText('File to…'));
    expect(screen.queryByText(/The re-file did not take/)).toBeNull();
  });

  it('File to… offers every type, marks the current one, and re-files on choice', async () => {
    api.reports = [report('r1', { reportType: 'inventory_summary', summary: 'A summary.' })];
    renderPage(['/documents-reports?doc=r1']);
    await waitFor(() => expect(screen.getByText('File to…')).toBeTruthy());
    fireEvent.click(screen.getByText('File to…'));
    const current = screen.getByText('inventory summary · current');
    expect((current as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('procurement history'));
    await waitFor(() =>
      expect(api.refileSpy).toHaveBeenCalledWith('r1', 'procurement_history'),
    );
  });

  it('a failed clipboard write is said on the control, and the label recovers', async () => {
    // jsdom exposes no navigator.clipboard — the control must not throw or lie.
    api.reports = [report('r1', { summary: 'A summary.' })];
    renderPage(['/documents-reports?doc=r1']);
    await waitFor(() => expect(screen.getByText('Copy share link')).toBeTruthy());
    fireEvent.click(screen.getByText('Copy share link'));
    expect(screen.getByText('Copy failed — use the address bar')).toBeTruthy();
    // …and reverts, so the control stays usable
    await waitFor(() => expect(screen.getByText('Copy share link')).toBeTruthy(), {
      timeout: 3000,
    });
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
    // The suite pins TZ to America/New_York (vitest config) so this fails on
    // a naive UTC-midnight parse; the canary proves the pin took effect.
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0);
    expect(fmtDate('2026-08-20')).toMatch(/Aug 20/);
  });

  it('refuses rolled-over impossible dates instead of normalizing them', () => {
    expect(fmtDate('2026-02-30')).toBe(EM);
  });

  it('an amount without a recorded currency says so instead of borrowing one', () => {
    expect(fmtMoney(3.5, null)).toBe('3.50 (currency not recorded)');
    expect(fmtMoney(3.5, 'EUR')).toMatch(/€|EUR/);
    // Intl formats any well-formed code, known or not, and names it.
    expect(fmtMoney(3.5, 'ZZZ')).toMatch(/ZZZ/);
    // A malformed one throws inside Intl; the code is still the truest thing
    // we hold about the unit, so it is printed rather than swapped for a guess.
    expect(fmtMoney(3.5, 'US')).toBe('3.50 US');
  });

  it('settledError refuses to call a fetch in flight a verdict', () => {
    expect(settledError({ isError: true, isFetching: false })).toBe(true);
    expect(settledError({ isError: true, isFetching: true })).toBe(false);
    expect(settledError({ isError: false, isFetching: false })).toBe(false);
  });

  it('sortKey agrees with fmtDate on date-only values and sends unknowns last', () => {
    // local-midnight key: a date-only Aug 20 must key AFTER a UTC instant
    // that renders as Aug 19 locally (02:00Z is the prior evening in NY).
    expect(sortKey('2026-08-20')).toBeGreaterThan(sortKey('2026-08-20T02:00:00Z'));
    expect(sortKey('not-a-date')).toBe(Number.POSITIVE_INFINITY);
  });
});
