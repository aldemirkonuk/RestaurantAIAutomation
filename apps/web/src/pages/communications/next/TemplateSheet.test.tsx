/**
 * The house's letter library — what it may say, and what it may never say.
 *
 * The two things this file exists to stop:
 *   1. an unreadable library rendering as an empty one ("no templates" is a
 *      claim; "could not be read" is the truth), and
 *   2. a save that failed closing the editor and reporting success — the exact
 *      regression the previous TemplateSheet shipped, and the reason ADR 0083
 *      exists.
 *
 * It also pins the founder's 2026-09-04 call: a staff broadcast is NOT one of
 * the composer's purposes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mockPost = vi.hoisted(() => vi.fn());

vi.mock('./Compose/useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Compose/useComposeData')>()),
  useComposeData: () => mockData.current,
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: { post: mockPost, get: vi.fn() },
}));

import { TemplateSheet } from './TemplateSheet';

const base = {
  restaurantId: 'r1',
  sender: null,
  senderFailed: false,
  senderError: null,
  book: [],
  bookFailed: false,
  bookError: null,
  byProvider: new Map(),
  templates: [],
  templatesFailed: false,
  templatesError: null,
  insights: [],
  insightsFailed: false,
  insightsError: null,
  queued: [],
  queuedFailed: false,
  refetchQueued: vi.fn(),
};

beforeEach(() => {
  mockData.current = { ...base };
  mockPost.mockReset();
});

describe('the house letter library', () => {
  it('says a failed read as a failure, never as an empty shelf', () => {
    mockData.current = {
      ...base,
      templates: null,
      templatesFailed: true,
      // The gateway's OWN sentence, verbatim — the page relays it and adds only
      // the consequence. Restating the failure here is what printed it twice,
      // nested inside itself, in the first browser capture of this sheet.
      templatesError:
        "The house's letter templates could not be read (column communication_templates.category does not exist).",
    };
    render(<TemplateSheet onClose={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('could not be read');
    expect(alert).toHaveTextContent('unknown, not empty');
    // said ONCE
    expect((alert.textContent ?? '').match(/could not be read/g)).toHaveLength(1);
  });

  it('distinguishes "not read yet" from "this house has written none"', () => {
    mockData.current = { ...base, templates: null };
    const { rerender } = render(<TemplateSheet onClose={() => {}} />);
    expect(screen.getByText(/Reading the library/)).toBeInTheDocument();

    mockData.current = { ...base, templates: [] };
    rerender(<TemplateSheet onClose={() => {}} />);
    expect(screen.getByText(/has written no template yet/)).toBeInTheDocument();
  });

  it('never prints a fabricated author or last-use for a row that has none', () => {
    mockData.current = {
      ...base,
      templates: [
        {
          id: 't1',
          name: 'Standing order query',
          subject: null,
          body: 'Merhaba,',
          category: 'price_query',
          mergeFields: null,
          lastEditedBy: null,
          lastEditedAt: null,
          lastUsedAt: null,
        },
      ],
    };
    render(<TemplateSheet onClose={() => {}} />);
    // "unknown", not "nobody" and not "never" — a row written before the
    // migration has no author recorded and never will.
    expect(screen.getByText(/last edited by unknown/)).toBeInTheDocument();
    expect(screen.getByText(/last used unknown/)).toBeInTheDocument();
    expect(screen.getByText(/none declared/)).toBeInTheDocument();
  });

  it('offers the five vendor purposes and never a staff broadcast', () => {
    render(<TemplateSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Write a new template'));
    const select = screen.getByLabelText('Purpose') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toEqual([
      'Order confirmation',
      'Price query',
      'Delivery dispute',
      'Invoice mismatch',
      'Promotion reply',
    ]);
    expect(options.join(' ')).not.toMatch(/broadcast|staff|crew/i);
  });

  it('starts a template from an insight, carrying its rule key', () => {
    mockData.current = {
      ...base,
      insights: [
        {
          candidateKey: 'weekday.baseline.wednesday',
          category: 'sales',
          sentence: 'Wednesday came in 38% under its own average.',
          periodStart: '2026-08-01',
          periodEnd: '2026-08-28',
          computedAt: '2026-09-01T06:00:00Z',
        },
      ],
    };
    render(<TemplateSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Wednesday came in 38% under/));
    expect(screen.getByText(/from weekday\.baseline\.wednesday/)).toBeInTheDocument();
    expect((screen.getByLabelText('The letter') as HTMLTextAreaElement).value).toContain(
      'Wednesday came in 38% under',
    );
  });

  it('a failed save keeps the editor open and says nothing was stored', async () => {
    mockPost.mockRejectedValue(new Error('boom'));
    render(<TemplateSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Write a new template'));
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });
    fireEvent.click(screen.getByText('Save the template'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('was NOT saved');
    });
    // The author's work is still in front of them.
    expect(screen.getByLabelText('The letter')).toBeInTheDocument();
    expect(screen.queryByText(/Stored on the server/)).toBeNull();
  });

  it('confirms a save only after the server accepted it', async () => {
    mockPost.mockResolvedValue({ data: { id: 't9', saved: true } });
    render(<TemplateSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Write a new template'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Late delivery' } });
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });
    fireEvent.click(screen.getByText('Save the template'));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Stored on the server');
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/communications/letters/templates',
      expect.objectContaining({ name: 'Late delivery', category: 'price_query' }),
    );
  });
});
