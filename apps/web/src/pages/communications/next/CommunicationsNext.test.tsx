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

vi.mock('../../../components/documents/GmailTemplateBuilder', () => ({
  GmailTemplateBuilder: () => <div data-testid="gmail-builder" />,
}));
vi.mock('../../../components/documents/SMSTemplateBuilder', () => ({
  SMSTemplateBuilder: () => <div data-testid="sms-builder" />,
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

  it('the template sheet leads with what is going on', async () => {
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Email template workshop'));
    // "a saved template" was itself untrue: the sheet never passes
    // `editingTemplate`, so the builder always opens on a NEW, unsaved one.
    expect(screen.getByText('You are editing a new template. Nothing is sent from here.')).toBeInTheDocument();
    expect(await screen.findByTestId('gmail-builder')).toBeInTheDocument();
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
});
