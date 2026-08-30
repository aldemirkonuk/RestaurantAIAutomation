/**
 * CommunicationsNext render contract — the MERGE verdict's promises: the
 * glance strip answers only from settled queries (EM otherwise), rows stay
 * short with prose inside the expansion, an AI draft can never look sent
 * (prc-02), and the template sheet says what is going on before anything else.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ProcurementHistoryItem } from '../../../hooks/queries/useConversationQueries';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useCommsNextData', () => ({
  useCommsNextData: () => mockData.current,
}));

vi.mock('../../../components/documents/GmailTemplateBuilder', () => ({
  GmailTemplateBuilder: () => <div data-testid="gmail-builder" />,
}));
vi.mock('../../../components/documents/SMSTemplateBuilder', () => ({
  SMSTemplateBuilder: () => <div data-testid="sms-builder" />,
}));

import CommunicationsNext from './CommunicationsNext';

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

const base = {
  rows: [] as ProcurementHistoryItem[],
  glance: { threads: 4, draftsPending: 1, sentLast30: 9, schedules: 2 },
  schedules: [],
  schedulesKnown: true,
  hasData: true,
  isError: false,
  errorMessage: '',
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

  it('the template sheet leads with what is going on', async () => {
    render(<CommunicationsNext />);
    fireEvent.click(screen.getByText('Email template workshop'));
    expect(screen.getByText('You are editing a saved template. Nothing is sent from here.')).toBeInTheDocument();
    expect(await screen.findByTestId('gmail-builder')).toBeInTheDocument();
  });

  it('says a gateway failure in words', () => {
    mockData.current = { ...base, hasData: false, isError: true, errorMessage: 'down' };
    render(<CommunicationsNext />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be reached');
  });
});
