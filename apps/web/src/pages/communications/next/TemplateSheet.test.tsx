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
    expect(alert).toHaveTextContent('That does not mean the house has none.');
    // said ONCE
    expect((alert.textContent ?? '').match(/could not be read/g)).toHaveLength(1);
  });

  it('distinguishes "not read yet" from "this house has written none"', () => {
    mockData.current = { ...base, templates: null };
    const { rerender } = render(<TemplateSheet onClose={() => {}} />);
    expect(screen.getByText(/Reading the library/)).toBeInTheDocument();

    mockData.current = { ...base, templates: [] };
    rerender(<TemplateSheet onClose={() => {}} />);
    expect(screen.getByText(/No templates yet/)).toBeInTheDocument();
    // COMMS-W21: no route and no designer's aside
    expect(document.body.textContent ?? '').not.toMatch(/\/team|honest state|merges/);
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

  it('starts a template from an insight, saying where it came from without its key (COMMS-W27)', () => {
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
    expect(screen.getByText(/From something the house noticed · worked out 1 Sept? 2026/)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/weekday\.baseline|computed/);
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
    expect(screen.queryByText(/Saved as/)).toBeNull();
  });

  it('confirms a save only after the server accepted it', async () => {
    mockPost.mockResolvedValue({ data: { id: 't9', saved: true } });
    render(<TemplateSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Write a new template'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Late delivery' } });
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });
    fireEvent.click(screen.getByText('Save the template'));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Saved as “Late delivery”.');
    });
    expect(mockPost).toHaveBeenCalledWith(
      '/communications/letters/templates',
      expect.objectContaining({ name: 'Late delivery', category: 'price_query' }),
    );
  });
});

describe('the template editor keeps what was typed (COMMS-W28)', () => {
  const insight = {
    candidateKey: 'weekday.baseline.wednesday',
    category: 'sales',
    sentence: 'Wednesday came in 38% under its own average.',
    periodStart: '2026-08-01',
    periodEnd: '2026-08-28',
    computedAt: '2026-09-01T06:00:00Z',
  };

  it('Save says why it cannot be pressed while the letter is empty', () => {
    render(<TemplateSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Write a new template'));
    const save = screen.getByText('Save the template').closest('button') as HTMLButtonElement;
    expect(save).toBeDisabled();
    expect(screen.getByTestId('tpl-no-letter')).toHaveTextContent('Write the letter first.');
    expect(save).toHaveAttribute('aria-describedby', 'tpl-no-letter');
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });
    expect(save).toBeEnabled();
    expect(screen.queryByTestId('tpl-no-letter')).toBeNull();
  });

  it('once typed in, no other template can be opened over it, and the sheet says so', () => {
    mockData.current = { ...base, insights: [insight] };
    render(<TemplateSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Write a new template'));
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });

    const writeNew = screen.getByText('Write a new template').closest('button') as HTMLButtonElement;
    expect(writeNew).toBeDisabled();
    expect(screen.getByTestId('tpl-unsaved')).toHaveTextContent(
      'Save or discard the template below to start another.',
    );
    fireEvent.click(screen.getByText(/Wednesday came in 38% under/));
    fireEvent.click(writeNew);
    expect((screen.getByLabelText('The letter') as HTMLTextAreaElement).value).toBe('Merhaba,');

    fireEvent.click(screen.getByText('Discard'));
    expect(screen.queryByTestId('tpl-unsaved')).toBeNull();
    expect(screen.getByText('Write a new template').closest('button')).toBeEnabled();
  });

  it('an opened template nobody has typed in can be swapped freely', () => {
    mockData.current = { ...base, insights: [insight] };
    render(<TemplateSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Wednesday came in 38% under/));
    expect(screen.queryByTestId('tpl-unsaved')).toBeNull();
    fireEvent.click(screen.getByText('Write a new template'));
    expect((screen.getByLabelText('The letter') as HTMLTextAreaElement).value).toBe('');
  });

  it('the empty library points at the two ways to write one, never at sending a letter first', () => {
    render(<TemplateSheet onClose={() => {}} />);
    expect(screen.getByText('No templates yet. Write one below, or start from something the house noticed.')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/sent twice|write the letter first/i);
    expect(document.body.textContent ?? '').toMatch(/a letter the house writes again and again/);
  });
});

describe('leaving an unsaved template keeps it (COMMS-W34)', () => {
  it('Escape on a typed template hands the form to the page, then closes', async () => {
    const onHold = vi.fn();
    const onClose = vi.fn();
    render(<TemplateSheet onClose={onClose} onHold={onHold} />);
    fireEvent.click(screen.getByText('Write a new template'));
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onHold).toHaveBeenCalledWith({
      draft: expect.objectContaining({ body: 'Merhaba,' }),
      opened: expect.objectContaining({ body: '' }),
    });
  });

  it('an opened template nobody typed in leaves with nothing held', async () => {
    const onHold = vi.fn();
    const onClose = vi.fn();
    render(<TemplateSheet onClose={onClose} onHold={onHold} />);
    fireEvent.click(screen.getByText('Write a new template'));
    fireEvent.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
    expect(onHold).not.toHaveBeenCalled();
  });

  it('reopened with what was held, the form is back and still unsaved', () => {
    const opened = { name: '', category: 'price_query', subject: '', body: '' };
    render(<TemplateSheet onClose={() => {}} held={{ draft: { ...opened, body: 'Merhaba,' }, opened }} />);
    expect(screen.getByLabelText('The letter')).toHaveValue('Merhaba,');
    expect(screen.getByTestId('tpl-unsaved')).toBeInTheDocument();
  });
});
