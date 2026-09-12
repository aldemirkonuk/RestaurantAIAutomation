/**
 * TemplateSheet contract (P1) — the page must not assert a behaviour it does
 * not have.
 *
 * The rebuild's banner said "Saving stores it for later", and `onSave` was
 * `onClose` — a function that ignores its argument. `GmailTemplateBuilder`
 * makes no network call and writes no storage; `SMSTemplateBuilder` says so in
 * a comment (`// Simulate save delay`). Pressing Save showed a success state
 * and discarded the work. Legacy has the same no-op and does NOT claim
 * otherwise, so the claim is a regression the rebuild introduced.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useTemplates', () => ({
  useTemplates: () => ({
    templates: [],
    isLoading: false,
    error: null,
    createTemplate: mockCreate,
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    refetch: vi.fn(),
  }),
}));

// The real builders are ~1500-line overlays; what matters here is the contract
// between the sheet and whatever the builder hands to `onSave`.
vi.mock('../../../components/documents/GmailTemplateBuilder', () => ({
  GmailTemplateBuilder: ({ onSave }: { onSave?: (t: unknown) => unknown }) => (
    <button
      type="button"
      data-testid="gmail-save"
      onClick={() =>
        void Promise.resolve(
          onSave?.({
          id: 'template-1',
          name: 'Weekly wine report',
          description: 'desc',
          subject: 'Weekly Wine Report - {{date}}',
          panels: [{ id: 'p1', type: 'text', content: 'hello', config: {} }],
          thumbnail: 'data:image/svg+xml,x',
          category: 'custom',
          created_at: new Date(),
          last_modified: new Date(),
          used_count: 0,
          }),
        ).catch(() => {})
      }
    >
      save gmail
    </button>
  ),
}));

vi.mock('../../../components/documents/SMSTemplateBuilder', () => ({
  SMSTemplateBuilder: ({ onSave }: { onSave?: (t: unknown) => unknown }) => (
    <button
      type="button"
      data-testid="sms-save"
      onClick={() =>
        void Promise.resolve(
          onSave?.({
          id: 'sms-1',
          name: 'Delivery nudge',
          category: 'delivery',
          message: 'Your order {{order_id}} ships today.',
          variables: ['{{order_id}}'],
          characterCount: 41,
          segmentCount: 1,
          created_at: new Date(),
          last_modified: new Date(),
          used_count: 0,
          tags: [],
          }),
        ).catch(() => {})
      }
    >
      save sms
    </button>
  ),
}));

import { TemplateSheet } from './TemplateSheet';

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue({ id: 'srv-1' });
});

describe('TemplateSheet — Save stores the template', () => {
  it('sends the email template to the server on save', async () => {
    render(<TemplateSheet channel="gmail" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('gmail-save'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.name).toBe('Weekly wine report');
    expect(payload.subject).toBe('Weekly Wine Report - {{date}}');
    expect(payload.type).toBe('email');
    expect(typeof payload.body).toBe('string');
    expect(payload.body.length).toBeGreaterThan(0);
  });

  it('sends the SMS template to the server on save, message verbatim', async () => {
    render(<TemplateSheet channel="sms" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('sms-save'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.name).toBe('Delivery nudge');
    expect(payload.type).toBe('sms');
    expect(payload.body).toBe('Your order {{order_id}} ships today.');
  });

  it('says a failed save in words, and does not close over it', async () => {
    const onClose = vi.fn();
    mockCreate.mockRejectedValue(new Error('Request failed with status code 400'));
    render(<TemplateSheet channel="gmail" onClose={onClose} />);
    fireEvent.click(await screen.findByTestId('gmail-save'));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/could not be saved/i),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/400/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the banner does not claim a persistence it has not performed', async () => {
    render(<TemplateSheet channel="gmail" onClose={vi.fn()} />);
    const banner = screen.getByRole('status');
    // The pre-fix sentence asserted storage that never happened.
    expect(banner).not.toHaveTextContent('Saving stores it for later');
    expect(banner).toHaveTextContent(/nothing is sent from here/i);
  });

  it('confirms a save only after the server has accepted it', async () => {
    let settle: (v: unknown) => void = () => {};
    mockCreate.mockReturnValue(new Promise((res) => { settle = res; }));
    render(<TemplateSheet channel="sms" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('sms-save'));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saving/i));
    expect(screen.getByRole('status')).not.toHaveTextContent(/stored/i);

    settle({ id: 'srv-1' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/stored/i));
  });
});
