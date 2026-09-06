/**
 * "Is this the bottle?" — the owed act on `/cellar`.
 *
 * THE REGRESSION. The rebuilt register could read a menu and could do nothing
 * with what it read: `WineRegister.tsx` said, in words, that "no path from a
 * detected title into the library or the cellar exists on this page yet". The
 * legacy question (`WineValidationModal.tsx:162`) confirmed readings into
 * component state and never wrote either. So the write is the regression, and
 * `writes the confirmed reading to the library` is the assertion that fails
 * against every version of this page before today.
 *
 * The rest holds the line the page has been holding for two passes:
 *   - "yes" adds to the LIBRARY and says so — no bottle reaches a shelf;
 *   - the engine's reading stays grey until a person takes it;
 *   - an unscored field says "not scored", never "unsure · 0%";
 *   - a refused write says nothing was written and keeps the reading.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('@/services/api/client', () => ({
  apiClient: { post: (...a: unknown[]) => api.post(...a) },
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import { IsThisTheBottlePanel, readingRefusals, sureness, type BottleReading } from './IsThisTheBottlePanel';
import { readingsFrom } from './readings';

const READING: BottleReading = {
  name: 'Öküzgözü',
  producer: 'Kavaklıdere',
  vintage: 2022,
  type: 'red',
  region: 'Elazığ',
  country: 'Türkiye',
  grape: 'Öküzgözü',
  confidence: { name: 0.94, producer: 0.91, vintage: 0.52 },
  source: 'menu_scan',
};

function draw(over: Partial<React.ComponentProps<typeof IsThisTheBottlePanel>> = {}) {
  const onRejected = vi.fn();
  const onConfirmed = vi.fn();
  const onClose = vi.fn();
  render(
    <IsThisTheBottlePanel
      open
      reading={READING}
      onClose={onClose}
      onRejected={onRejected}
      onConfirmed={onConfirmed}
      {...over}
    />,
  );
  return { onRejected, onConfirmed, onClose };
}

beforeEach(() => {
  api.post.mockReset().mockResolvedValue({ data: { id: 'sub-1' } });
});

describe('the shape and the primitive', () => {
  it('is a panel, named by its contract, closing in words', () => {
    draw();
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'panel');
    expect(dialog).toHaveAttribute('data-motion', 'settle');
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /Is this the bottle/ })).toBeInTheDocument();
  });
});

describe('the act — the write the question never had', () => {
  it('writes the confirmed reading to the library, sending no tenant and no author', async () => {
    const { onConfirmed } = draw();
    fireEvent.click(screen.getByTestId('bottle-confirm'));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [path, body] = api.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/wines/submissions');
    expect(body).toMatchObject({
      name: 'Öküzgözü',
      producer: 'Kavaklıdere',
      vintage: 2022,
      primaryType: 'red',
    });
    expect(body).not.toHaveProperty('restaurantId');
    expect(body).not.toHaveProperty('submittedBy');
    expect(onConfirmed).toHaveBeenCalledWith('sub-1');
  });

  it('says what "yes" does — the library, not a shelf', () => {
    draw();
    expect(
      screen.getByText(/Confirming adds it to the house library\. It puts no bottle on a shelf\./),
    ).toBeInTheDocument();
  });

  it('turns a bottle away without writing anything', () => {
    const { onRejected } = draw();
    fireEvent.click(screen.getByTestId('bottle-reject'));
    expect(onRejected).toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('carries the person’s corrections and marks them as theirs', async () => {
    draw();
    fireEvent.click(screen.getByTestId('bottle-fix'));
    fireEvent.change(screen.getByTestId('bottle-input-vintage'), { target: { value: '2021' } });
    expect(screen.getByTestId('bottle-changed')).toHaveTextContent('vintage');
    fireEvent.click(screen.getByTestId('bottle-confirm'));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect((api.post.mock.calls[0][1] as Record<string, unknown>).vintage).toBe(2021);
  });
});

describe('the engine’s hand stays grey', () => {
  it('renders an untouched field as the engine’s and a corrected one as ink', () => {
    draw();
    const before = within(screen.getByTestId('bottle-field-producer')).getByText('Kavaklıdere');
    expect(before).toHaveAttribute('data-ink', 'engine');

    fireEvent.click(screen.getByTestId('bottle-fix'));
    fireEvent.change(screen.getByTestId('bottle-input-producer'), { target: { value: 'Sevilen' } });
    fireEvent.click(screen.getByTestId('bottle-fix'));
    const after = within(screen.getByTestId('bottle-field-producer')).getByText('Sevilen');
    expect(after).toHaveAttribute('data-ink', 'person');
  });

  it('names where the reading came from, and that nothing is written yet', () => {
    draw();
    expect(screen.getByTestId('bottle-source')).toHaveTextContent(/read off a menu by the engine/);
    expect(screen.getByTestId('bottle-source')).toHaveTextContent(/Nothing about it has been written/);
  });
});

describe('four states, honestly', () => {
  it('says what did not happen when the write is refused, and keeps the reading', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('staging full'), { response: { status: 500 } }));
    draw();
    fireEvent.click(screen.getByTestId('bottle-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('bottle-failure')).toHaveTextContent(
        /was not added to the library \(staging full\)\. Nothing was written/,
      ),
    );
    // name and grape are both "Öküzgözü" here — assert the NAME field's cell.
    expect(within(screen.getByTestId('bottle-field-name')).getByText('Öküzgözü')).toBeInTheDocument();
  });

  it('names a refusal as a refusal', async () => {
    api.post.mockRejectedValue(Object.assign(new Error('nope'), { response: { status: 403 } }));
    draw();
    fireEvent.click(screen.getByTestId('bottle-confirm'));
    await waitFor(() =>
      expect(screen.getByTestId('bottle-failure')).toHaveTextContent(
        /may not add to the library \(403\)/,
      ),
    );
  });

  it('refuses an unanswerable reading with a reason beside the field', () => {
    draw({ reading: { ...READING, producer: '', type: '' } });
    expect(screen.getByTestId('bottle-problem-producer')).toBeInTheDocument();
    expect(screen.getByTestId('bottle-problem-type')).toBeInTheDocument();
    expect(screen.getByTestId('bottle-confirm')).toBeDisabled();
  });

  it('shows an absent value as a dash, never as an empty cell', () => {
    draw({ reading: { ...READING, region: '' } });
    expect(within(screen.getByTestId('bottle-field-region')).getByText('—')).toBeInTheDocument();
  });
});

describe('sureness — an unscored field is not an unsure one', () => {
  it('says "not scored" for absent, and never a zero percent', () => {
    expect(sureness(undefined)).toBe('not scored');
    expect(sureness(0.94)).toBe('sure · 94%');
    expect(sureness(0.72)).toBe('fairly sure · 72%');
    expect(sureness(0.4)).toBe('unsure · 40%');
    expect(sureness(0)).toBe('unsure · 0%');
  });

  it('prints "not scored" on a field the reader did not score', () => {
    draw();
    expect(screen.getByTestId('bottle-field-region')).toHaveTextContent('not scored');
    expect(screen.getByTestId('bottle-field-vintage')).toHaveTextContent('unsure · 52%');
  });
});

describe('readingsFrom — the translation, on its own', () => {
  it('reads the deprecated aliases the older pipeline layers still fill', () => {
    const [row] = readingsFrom([
      { name: 'Boğazkere', producer: 'Kavaklıdere', type: 'red', grape: 'Boğazkere', vintage: 2021 },
    ]);
    expect(row.type).toBe('red');
    expect(row.grape).toBe('Boğazkere');
  });

  it('prefers the current keys over the deprecated ones', () => {
    const [row] = readingsFrom([
      {
        name: 'Narince',
        producer: 'Kavaklıdere',
        wineType: 'white',
        type: 'red',
        grapeVariety: 'Narince',
        grape: 'wrong',
      },
    ]);
    expect(row.type).toBe('white');
    expect(row.grape).toBe('Narince');
  });

  it('drops a title the library could never accept, before anybody is asked', () => {
    expect(
      readingsFrom([
        { name: 'X', producer: 'Someone' },
        { name: 'A real name', producer: '' },
        { name: 'A real name', producer: 'Someone' },
        null,
        'nonsense',
      ]),
    ).toHaveLength(1);
  });

  it('leaves an unrecognised style empty rather than guessing red', () => {
    const [row] = readingsFrom([
      { name: 'Amber one', producer: 'Someone', wineType: 'orange' },
    ]);
    expect(row.type).toBe('');
  });

  it('leaves an absent confidence absent — never a zero', () => {
    const [row] = readingsFrom([
      { name: 'A wine', producer: 'Someone', confidence: 0.8, fieldConfidences: { producer: 0.6 } },
    ]);
    expect(row.confidence?.name).toBe(0.8);
    expect(row.confidence?.producer).toBe(0.6);
    expect(row.confidence?.region).toBeUndefined();
    expect('region' in (row.confidence ?? {})).toBe(false);
  });

  it('answers an empty list for anything that is not an array', () => {
    expect(readingsFrom(undefined as unknown as unknown[])).toEqual([]);
  });
});

describe('readingRefusals — the legacy rules, unchanged', () => {
  it('keeps all four', () => {
    expect(readingRefusals(READING)).toEqual({});
    expect(readingRefusals({ ...READING, name: 'ab' }).name).toMatch(/three letters/);
    expect(readingRefusals({ ...READING, producer: ' ' }).producer).toMatch(/who made it/);
    expect(readingRefusals({ ...READING, type: '' }).type).toMatch(/what kind/);
    expect(readingRefusals({ ...READING, vintage: 1800 }).vintage).toMatch(/between 1900/);
    // No vintage at all is legal, and is not the same as a wrong one.
    expect(readingRefusals({ ...READING, vintage: null }).vintage).toBeUndefined();
  });
});
