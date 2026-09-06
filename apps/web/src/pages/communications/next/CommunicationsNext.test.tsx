/**
 * CommunicationsNext render contract — the MERGE verdict's promises: the
 * glance strip answers only from settled queries (EM otherwise), rows stay
 * short with prose inside the expansion, an AI draft can never look sent
 * (prc-02), and the template sheet says what is going on before anything else.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ProcurementHistoryItem } from '../../../hooks/queries/useConversationQueries';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

// Only the HOOK is replaced. `COMMS_SERVER_WINDOWS` passes through from the real
// module so the strip's floor note reads the same register the guard checks —
// a mock that restated the cap would be a second, silently-drifting copy of it.
vi.mock('./useCommsNextData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useCommsNextData')>()),
  useCommsNextData: () => mockData.current,
}));

// ADR 0118 — the two legacy builders are no longer mounted from this page, so
// there is nothing to stub for them. What the page owns now is the composer and
// the house library; both are proved in their own files, and here they are
// stubbed so this file stays a test of the PAGE.
vi.mock('./Compose/ComposeSheet', () => ({
  ComposeSheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="composer" /> : null,
}));
vi.mock('./TemplateSheet', () => ({
  TemplateSheet: () => <div data-testid="letter-library" />,
}));

import CommunicationsNext from './CommunicationsNext';

// The template sheet persists through `useTemplates` (P1), so the page tree now
// needs a query client. A fresh one per render keeps the tests independent.
function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function item(over: Partial<ProcurementHistoryItem>): ProcurementHistoryItem {
  return {
    id: 'c1',
    orderId: 'o1',
    providerId: 'p1',
    direction: 'OUTBOUND',
    emailType: 'PRICE_INQUIRY',
    status: 'SENT',
    roundCount: 1,
    createdAt: '2026-08-29T10:00:00Z',
    sentAt: '2026-08-29T10:00:00Z',
    draftContent: 'Dear Bodega, could you hold 6 at $18.40?',
    constraintFlags: null,
    rollingSummary: null,
    orderNumber: 'PO-014',
    quantity: 6,
    wineName: 'Albariño 2022',
    providerName: 'Bodega Álvaro',
    ...over,
  };
}

const noFailures = {
  history: false,
  threads: false,
  drafts: false,
  schedules: false,
  gmail: false,
};

const base = {
  rows: [] as ProcurementHistoryItem[],
  glance: { threads: 4, draftsPending: 1, sentLast30: 9, schedules: 2 },
  // The drafts THEMSELVES, added 2026-09-06 with the drafted-reply panel: the
  // strip's figure and this list come from one read, so a mock that carries the
  // count and not the rows is a mock of a state the hook cannot produce.
  drafts: [] as unknown[],
  draftsKnown: true,
  schedules: [],
  schedulesKnown: true,
  schedulesError: null as string | null,
  hasData: true,
  isError: false,
  errorMessage: '',
  failed: { ...noFailures },
  failedSources: [] as string[],
  refetch: vi.fn(),
};

beforeEach(() => {
  mockData.current = { ...base };
});

describe('CommunicationsNext', () => {
  it('shows the glance strip from settled queries and EM for unanswered ones', () => {
    mockData.current = {
      ...base,
      glance: { threads: null, draftsPending: 1, sentLast30: null, schedules: 2 },
    };
    render(<CommunicationsNext />);
    expect(screen.getByText('Threads')).toBeInTheDocument();
    // two unanswered figures render as em dashes, never zeros
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('keeps the row short and the prose inside the expansion', () => {
    mockData.current = { ...base, rows: [item({})] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
    expect(screen.queryByText(/could you hold 6/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Bodega Álvaro'));
    expect(screen.getByText(/could you hold 6/)).toBeInTheDocument();
  });

  it('a draft can never look sent', () => {
    mockData.current = { ...base, rows: [item({ status: 'PENDING_APPROVAL' })] };
    render(<CommunicationsNext />);
    expect(screen.getByText('AI draft · not sent')).toBeInTheDocument();
    expect(screen.queryByText(/^Sent$/)).not.toBeInTheDocument();
  });

  it('APPROVED is approval, never dispatch (the audit blocker case)', () => {
    mockData.current = { ...base, rows: [item({ status: 'APPROVED' })] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Approved · not sent')).toBeInTheDocument();
    expect(screen.queryByText(/^Sent$/)).not.toBeInTheDocument();
  });

  it('a truncated history window renders the sent figure as a floor', () => {
    mockData.current = {
      ...base,
      glance: { threads: 4, draftsPending: 1, sentLast30: 97, sentLast30Truncated: true, schedules: 2 },
    };
    render(<CommunicationsNext />);
    expect(screen.getByText('≥97')).toBeInTheDocument();
  });

  // ── ADR 0118: the legacy builders are retired from the rebuilt page ───────
  it('opens the house composer, not a template builder', () => {
    render(<CommunicationsNext />);
    expect(screen.queryByTestId('composer')).toBeNull();
    fireEvent.click(screen.getByText('Write a letter'));
    expect(screen.getByTestId('composer')).toBeInTheDocument();
  });

  it('opens the house letter library', () => {
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText("The house's letter templates"));
    expect(screen.getByTestId('letter-library')).toBeInTheDocument();
  });

  it('offers no template workshop at all', () => {
    render(<CommunicationsNext />);
    expect(screen.queryByText('Email template workshop')).toBeNull();
    expect(screen.queryByText('SMS template workshop')).toBeNull();
  });

  /**
   * The retirement as a RULE, not a habit.
   *
   * The two legacy builders still exist and the legacy `/communications` still
   * mounts them — that is ADR 0042's byte-for-byte promise and it is deliberate.
   * What must not come back is a rebuilt page importing them: the flag was
   * supposed to retire them, and a single `lazy(() => import(...))` slipped back
   * into any `next` file would quietly un-retire them with nothing failing.
   * Reading the source is the only check that can see that.
   */
  it('no rebuilt page imports the legacy template builders', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(process.cwd(), 'src', 'pages');
    const offenders: string[] = [];
    const walk = (dir: string, insideNext: boolean) => {
      // withFileTypes: the kind comes back WITH the entry, so there is no
      // separate stat of the same path to go stale between check and read.
      for (const dirent of readdirSync(dir, { withFileTypes: true })) {
        const entry = dirent.name;
        const full = join(dir, entry);
        if (dirent.isDirectory()) {
          walk(full, insideNext || entry === 'next');
          continue;
        }
        if (!insideNext || !/\.tsx?$/.test(entry)) continue;
        if (/\.test\.tsx?$/.test(entry)) continue;
        const source = readFileSync(full, 'utf8');
        // An IMPORT, not a mention: this file's own header explains what was
        // retired and names both builders, and a substring match would flag
        // the explanation as the offence.
        if (
          /(?:from|import\()\s*['"][^'"]*components\/documents\/(?:Gmail|SMS)TemplateBuilder/.test(
            source,
          )
        ) {
          offenders.push(full);
        }
      }
    };
    walk(root, false);
    expect(offenders).toEqual([]);
  });

  it('says a gateway failure in words', () => {
    mockData.current = {
      ...base,
      hasData: false,
      isError: true,
      errorMessage: 'down',
      failed: { ...noFailures, history: true },
      failedSources: ['the conversation book'],
    };
    render(<CommunicationsNext />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be reached');
  });

  // ── P3: a permanent failure is not latency ────────────────────────────────
  it('a failed schedule list is said as a failure, never as "hasn\'t answered yet"', () => {
    mockData.current = {
      ...base,
      glance: { ...base.glance, schedules: null },
      schedulesKnown: false,
      schedulesError: 'Request failed with status code 500',
      failed: { ...noFailures, schedules: true },
      failedSources: ['the report schedules'],
    };
    render(<CommunicationsNext />);
    expect(
      screen.getByText(/could not be loaded, so this list is not a record of what exists/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hasn’t answered yet/)).not.toBeInTheDocument();
  });

  it('an unanswered schedule list still says it has not answered', () => {
    mockData.current = {
      ...base,
      glance: { ...base.glance, schedules: null },
      schedulesKnown: false,
      schedulesError: null,
    };
    render(<CommunicationsNext />);
    expect(screen.getByText(/hasn’t answered yet/)).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument();
  });

  it('an empty schedule list is not confused with a failed one', () => {
    mockData.current = { ...base, glance: { ...base.glance, schedules: 0 }, schedules: [] };
    render(<CommunicationsNext />);
    expect(screen.getByText('No reports are scheduled.')).toBeInTheDocument();
  });

  // ── P4: every figure can say it failed, not only the history ──────────────
  it('a failed figure is distinguishable from an unanswered one', () => {
    mockData.current = {
      ...base,
      glance: { threads: null, draftsPending: null, sentLast30: 9, schedules: 2 },
      failed: { ...noFailures, threads: true },
      failedSources: ['the thread index'],
    };
    render(<CommunicationsNext />);
    // the failed figure names its failure
    expect(screen.getByLabelText(/Threads: could not be loaded/i)).toBeInTheDocument();
    // the merely-unanswered one does not
    expect(screen.queryByLabelText(/Drafts waiting: could not be loaded/i)).toBeNull();
  });

  it('the banner names every failed source, not only the conversation book', () => {
    mockData.current = {
      ...base,
      glance: { threads: null, draftsPending: 1, sentLast30: 9, schedules: null },
      failed: { ...noFailures, threads: true, schedules: true, gmail: true },
      failedSources: ['the thread index', 'the report schedules', 'the Gmail watch status'],
    };
    render(<CommunicationsNext />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('the thread index');
    expect(alert).toHaveTextContent('the report schedules');
    expect(alert).toHaveTextContent('the Gmail watch status');
    // and the retry is reachable when something other than the history failed
    expect(screen.getByText('Try again')).toBeInTheDocument();
  });

  // ── P5: the SMS line describes a channel that exists ──────────────────────
  it('does not claim SMS staging for a messaging channel nothing can reach', () => {
    render(<CommunicationsNext />);
    expect(screen.queryByText(/stage for the messaging channel/i)).toBeNull();
    expect(screen.getByText(/no SMS sender is reachable/i)).toBeInTheDocument();
  });
  // ── ADR 0084 put inbound vendor replies on this page; ADR 0083's row could
  //    not render one. All three of these throw on the merged tree. ──────────
  //
  // The fixture is the shape `conversation-ledger.spec.ts` asserts the gateway
  // returns for production's ten inbound rows: `direction: 'INBOUND'`,
  // `outbound_email_type` NULL, and `status` the column DEFAULT 'DRAFT' that
  // the inbound writer never sets.
  const inbound = () =>
    item({
      id: 'in-0',
      direction: 'INBOUND',
      emailType: null,
      status: 'DRAFT',
      orderId: null,
      orderNumber: null,
      quantity: null,
      wineName: null,
      draftContent: 'Vendor reply number 0',
    });

  it('renders an inbound vendor reply, which has no outbound email type', () => {
    mockData.current = { ...base, rows: [inbound()] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
    expect(screen.getByText(/Vendor reply/)).toBeInTheDocument();
  });

  it('never calls a vendor’s own reply an unsent AI draft', () => {
    mockData.current = { ...base, rows: [inbound()] };
    render(<CommunicationsNext />);
    // 'DRAFT' is the DEFAULT on an inbound row, not a lifecycle claim about it.
    expect(screen.queryByText('AI draft · not sent')).toBeNull();
    expect(screen.getByText('Received')).toBeInTheDocument();
  });

  it('renders a row whose status is null, and does not invent one for it', () => {
    // ADR 0084's deny-list admits `status.is.null` on purpose; the mapper
    // passes it straight through as `status: row.status`.
    mockData.current = { ...base, rows: [item({ status: null })] };
    render(<CommunicationsNext />);
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
    expect(screen.getByText('no status recorded')).toBeInTheDocument();
    expect(screen.queryByText(/^Sent$/)).toBeNull();
    expect(screen.queryByText('AI draft · not sent')).toBeNull();
  });
});
