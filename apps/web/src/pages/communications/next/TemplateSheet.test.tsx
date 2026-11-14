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
const mockGet = vi.hoisted(() => vi.fn());

vi.mock('./Compose/useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Compose/useComposeData')>()),
  useComposeData: () => mockData.current,
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: { post: mockPost, get: mockGet },
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
  mockGet.mockReset();
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

// ── the order letter (ADR 0313, 4a-ii) ──────────────────────────────────────

const HOUSE_WORDS = '{{greeting}}\n\nOur order:\n\n{{order_lines}}\n\n{{ask}}\n\n{{signer}}';
const DEFAULT_EN = '{{greeting}}\n\nHere is our order request:\n\n{{order_lines}}\n\n{{ask}}\n\n{{signer}}';

function letterView(over: Record<string, unknown> = {}) {
  return {
    key: 'order_request',
    locale: 'en',
    mayEdit: true,
    template: { id: 't-ol', name: 'Our order letter', draft: HOUSE_WORDS, lastEditedBy: 'Deniz', lastEditedAt: '2026-10-08T09:00:00Z' },
    published: null,
    rendersFrom: 'default',
    draftRefusals: [],
    versions: [],
    defaults: { en: DEFAULT_EN, tr: DEFAULT_EN },
    tokens: [
      { key: 'greeting', required: true, says: "Hello and the vendor's first name" },
      { key: 'order_lines', required: true, says: 'Each line' },
      { key: 'ask', required: true, says: 'Asks the vendor to confirm' },
      { key: 'signer', required: true, says: 'Who placed the order' },
      { key: 'needed_by', required: false, says: 'The date the order is needed by' },
    ],
    ...over,
  };
}

async function openLetter(view = letterView()) {
  mockGet.mockResolvedValue({ data: view });
  render(<TemplateSheet onClose={() => {}} />);
  fireEvent.click(screen.getByText('Open the order letter'));
  return (await screen.findByLabelText('The draft')) as HTMLTextAreaElement;
}

describe('the order letter', () => {
  it('is never in the library or the purpose picker, and is read only when opened', () => {
    mockData.current = {
      ...base,
      templates: [
        { id: 'a', name: 'Price ask', subject: null, body: 'Hi', category: 'price_query', mergeFields: [], lastEditedBy: null, lastEditedAt: null, lastUsedAt: null },
        { id: 'b', name: 'Our order letter', subject: null, body: HOUSE_WORDS, category: 'order_request', mergeFields: [], lastEditedBy: null, lastEditedAt: null, lastUsedAt: null },
      ],
      sender: { categories: ['price_query', 'order_request'] },
    };
    render(<TemplateSheet onClose={() => {}} />);
    expect(screen.getByText('Price ask')).toBeInTheDocument();
    expect(screen.queryByText('Our order letter')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Write a new template'));
    const options = Array.from((screen.getByLabelText('Purpose') as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['price_query']);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('staff read it and cannot change it', async () => {
    const box = await openLetter(letterView({ mayEdit: false }));
    expect(box.readOnly).toBe(true);
    expect(screen.getByTestId('order-letter-read-only')).toHaveTextContent(/Only an owner or a manager/);
    expect(screen.queryByText('Save the draft')).not.toBeInTheDocument();
    expect(screen.queryByText('Publish')).not.toBeInTheDocument();
    expect(screen.queryByText(/Copy v/)).not.toBeInTheDocument();
    expect(screen.getByText('{{greeting}} *')).toBeDisabled();
  });

  it("says vendors receive Mudavym's words until something is published", async () => {
    await openLetter();
    expect(screen.getByTestId('order-letter-live')).toHaveTextContent(/Vendors receive Mudavym's words: nothing of the house's has been published/);
  });

  it('saves a draft as the order letter, with no subject, and says vendors are unaffected', async () => {
    const box = await openLetter();
    fireEvent.change(box, { target: { value: `${HOUSE_WORDS}\nWith thanks,` } });
    expect(screen.getByText('Preview')).toBeDisabled();
    expect(screen.getByText('Publish')).toBeDisabled();
    mockPost.mockResolvedValueOnce({ data: { id: 't-ol', saved: true, published: false } });
    fireEvent.click(screen.getByText('Save the draft'));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0]).toEqual([
      '/communications/letters/templates',
      { id: 't-ol', name: 'Our order letter', category: 'order_request', body: `${HOUSE_WORDS}\nWith thanks,` },
    ]);
    expect(await screen.findByText(/Vendors still receive the published words/)).toBeInTheDocument();
  });

  it('shows each refused sentence when the server refuses the words', async () => {
    const box = await openLetter();
    fireEvent.change(box, { target: { value: `${HOUSE_WORDS}\n3 cases` } });
    mockPost.mockRejectedValueOnce({
      response: { data: { message: 'These words cannot go into the order letter.', refusals: [{ rule: 'numeral', says: 'Write no figures: "3" is a figure.' }] } },
    });
    fireEvent.click(screen.getByText('Save the draft'));
    expect(await screen.findByTestId('order-letter-refusals')).toHaveTextContent('Write no figures: "3" is a figure.');
    expect(screen.getByText(/Nothing changed for vendors/)).toBeInTheDocument();
  });

  it('publishes only what it previewed, sending the preview hash', async () => {
    await openLetter();
    expect(screen.getByText('Publish')).toBeDisabled();
    mockPost.mockResolvedValueOnce({
      data: {
        locale: 'en',
        previewHash: 'h'.repeat(64),
        refusals: [],
        samples: [
          { label: "an owner's order with a price", subject: 'Order PO-1042', body: 'Hello Ayşe, Our order: ...' },
          { label: 'an order with no price on file', subject: 'Order PO-1042', body: 'Hello Ayşe, ...' },
        ],
      },
    });
    fireEvent.click(screen.getByText('Preview'));
    expect(await screen.findByTestId('order-letter-preview')).toHaveTextContent("an owner's order with a price");
    expect(mockPost).toHaveBeenLastCalledWith('/communications/letters/templates/order-request/preview', { locale: 'en' });
    await waitFor(() => expect(screen.getByText('Publish')).not.toBeDisabled());
    mockPost.mockResolvedValueOnce({ data: { version: 1 } });
    fireEvent.click(screen.getByText('Publish'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenLastCalledWith('/communications/letters/templates/order-request/publish', {
        previewHash: 'h'.repeat(64),
        locale: 'en',
      }),
    );
    expect(await screen.findByText(/Published as version 1/)).toBeInTheDocument();
  });

  it('an edit after the preview cannot be published', async () => {
    const box = await openLetter();
    mockPost.mockResolvedValueOnce({ data: { locale: 'en', previewHash: 'h'.repeat(64), refusals: [], samples: [{ label: 'x', subject: 's', body: 'b' }] } });
    fireEvent.click(screen.getByText('Preview'));
    await waitFor(() => expect(screen.getByText('Publish')).not.toBeDisabled());
    fireEvent.change(box, { target: { value: `${HOUSE_WORDS}\nKind regards,` } });
    expect(screen.getByText('Publish')).toBeDisabled();
  });

  it('copies a version into the draft and says nothing was published', async () => {
    await openLetter(
      letterView({
        versions: [{ id: 'v1', version: 1, locale: 'en', kind: 'publish', body: HOUSE_WORDS, by: 'Deniz', at: '2026-10-08T10:00:00Z' }],
        published: { id: 'v1', version: 1, locale: 'en', kind: 'publish', body: HOUSE_WORDS, by: 'Deniz', at: '2026-10-08T10:00:00Z' },
        rendersFrom: 'house',
      }),
    );
    expect(screen.getByTestId('order-letter-live')).toHaveTextContent(/your published words, version 1, published by Deniz/);
    expect(screen.getByTestId('order-letter-versions')).toHaveTextContent('v1 · English · published · live');
    mockPost.mockResolvedValueOnce({ data: { restored: true, published: false } });
    fireEvent.click(screen.getByText('Copy v1 into the draft'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenLastCalledWith('/communications/letters/templates/order-request/restore', { versionId: 'v1' }),
    );
    expect(await screen.findByText(/Nothing was published/)).toBeInTheDocument();
  });

  it('reset asks first, then publishes Mudavym\'s words', async () => {
    await openLetter();
    fireEvent.click(screen.getByText("Reset to Mudavym's words"));
    expect(mockPost).not.toHaveBeenCalled();
    mockPost.mockResolvedValueOnce({ data: { version: 2 } });
    fireEvent.click(screen.getByText('Reset'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenLastCalledWith('/communications/letters/templates/order-request/reset', { locale: 'en' }),
    );
  });

  it('a failed read says so, never "no letter"', async () => {
    mockGet.mockRejectedValueOnce(new Error('network down'));
    render(<TemplateSheet onClose={() => {}} />);
    fireEvent.click(screen.getByText('Open the order letter'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read \(network down\.\)\. That does not mean the house has none/);
  });
});
