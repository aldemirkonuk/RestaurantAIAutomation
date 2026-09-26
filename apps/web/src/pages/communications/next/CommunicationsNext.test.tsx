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

// ADR 0160 §113 Open item 3: senders and strangers live on this page now. The
// section is proved in `WhoIsWriting.test.tsx`; here it is a stub so this file
// stays a test of the PAGE and needs no auth context.
vi.mock('./WhoIsWriting', () => ({
  default: () => <section aria-label="Who is writing" data-testid="who-is-writing" />,
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
};

const base = {
  rows: [] as ProcurementHistoryItem[],
  glance: { threads: 4, draftsPending: 1, sentLast30: 9 },
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
      glance: { threads: null, draftsPending: 1, sentLast30: null },
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
      glance: { threads: 4, draftsPending: 1, sentLast30: 97, sentLast30Truncated: true },
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

  // ── ADR 0160 §113, Open item 3: senders and strangers moved here ──────────
  it('mounts the who-is-writing section (trust and add-vendor moved here from /promotions)', () => {
    render(<CommunicationsNext />);
    expect(screen.getByTestId('who-is-writing')).toBeInTheDocument();
  });

  /**
   * The sender and stranger reads must key their caches by house. The shared
   * `usePromotionsQueries` hooks do not (`['sender-reputation']`, `['prospects']`
   * are bare) and the house switcher does not clear the query cache — so a
   * value import of them here would show one house's trust ledger under another,
   * with a "Hold to trust" on it. Types may be imported; hooks may not.
   */
  it('no file here imports a HOOK from the un-keyed promotions queries', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'src', 'pages', 'communications', 'next');
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const dirent of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, dirent.name);
        if (dirent.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(dirent.name) && !/\.test\.tsx?$/.test(dirent.name)) {
          const source = readFileSync(full, 'utf8');
          if (/import\s+(?!type\b)[^;]*from\s*['"][^'"]*usePromotionsQueries['"]/.test(source)) offenders.push(full);
        }
      }
    };
    walk(dir);
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

  // ── ADR 0083, amended 2026-09-25 (founder: "amend ADR 0083") ─────────────
  // The house page names the three sources it owns. The report schedules (a
  // table no migration creates) and the Gmail watch (deployment plumbing, now
  // on the admin desk) are not on it, so neither can raise its banner.
  it('does not render the schedules card, the schedules figure or the Gmail watch line', () => {
    render(<CommunicationsNext />);
    expect(screen.queryByText(/Report schedules/i)).toBeNull();
    expect(screen.queryByText(/Scheduled reports/i)).toBeNull();
    expect(screen.queryByText(/Saved schedules could not be loaded/i)).toBeNull();
    expect(screen.queryByText(/Gmail inbound watch/i)).toBeNull();
    expect(screen.queryByText(/NOT configured/i)).toBeNull();
    // healthy owned sources: no banner at all
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // ── P4: every figure can say it failed, not only the history ──────────────
  it('a failed figure is distinguishable from an unanswered one', () => {
    mockData.current = {
      ...base,
      glance: { threads: null, draftsPending: null, sentLast30: 9 },
      failed: { ...noFailures, threads: true },
      failedSources: ['the thread index'],
    };
    render(<CommunicationsNext />);
    // the failed figure names its failure
    expect(screen.getByLabelText(/Threads: could not be loaded/i)).toBeInTheDocument();
    // the merely-unanswered one does not
    expect(screen.queryByLabelText(/Drafts waiting: could not be loaded/i)).toBeNull();
  });

  it('the banner names every failed owned source, not only the conversation book', () => {
    mockData.current = {
      ...base,
      glance: { threads: null, draftsPending: null, sentLast30: 9 },
      failed: { ...noFailures, threads: true, drafts: true },
      failedSources: ['the thread index', 'the drafts awaiting action'],
    };
    render(<CommunicationsNext />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('the thread index');
    expect(alert).toHaveTextContent('the drafts awaiting action');
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
