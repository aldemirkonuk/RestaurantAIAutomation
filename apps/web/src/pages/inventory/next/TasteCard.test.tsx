/**
 * The taste card: five states in words, no number from the 0..10 scale
 * anywhere on a row, a mark on every row, a withheld value for a conflict, and
 * a form that sends only what a person set. Fixtures are synthetic.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TasteData, TasteAxis } from '../../../services/api/taste';

const api = vi.hoisted(() => ({ get: vi.fn(), add: vi.fn() }));
vi.mock('../../../services/api/taste', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getTaste: api.get,
  addHouseTaste: api.add,
}));

import TasteCard, { TASTE_ABSENT, TASTE_EMPTY, TASTE_FAILED } from './TasteCard';

const ax = (v: number, over: Partial<TasteAxis> = {}): TasteAxis => ({
  v, lo: null, hi: null, conf: 0.6, prov: [{ kind: 'staff_note', share: 1 }], bandOnly: false, ...over,
});
const layer = (name: string | null, source = 'house', noteText: string | null = null) => ({
  source, version: 1, method: 'ordinal', statedByName: name, statedAt: '2026-11-19T10:00:00Z', hasNote: noteText !== null, noteText,
});
const ready = (data: Partial<TasteData['effective'] & object> | null, layers = [layer('Ayşe')]) => ({
  state: 'ready' as const,
  data: { effective: data === null ? null : { axes: {}, descriptors: [], texture: [], conflicts: [], ...data }, layers },
});

function mount(kind?: string, own?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TasteCard row={{ id: 'i1', kind }} house={own ? { kind: own } : undefined} restaurantId="r1" canManage={false} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  api.get.mockReset();
  api.add.mockReset();
});

describe('the form follows the kind', () => {
  it.each([['wine', 'taste-chip-oak', 'taste-chip-savoury'], ['beer', 'taste-chip-bready', 'taste-chip-savoury'], ['food', 'taste-chip-savoury', 'taste-chip-oak']])('a %s good: its words are offered, the other kind\'s are not', async (kind, yes, no) => {
    api.get.mockResolvedValue(ready(null));
    mount(kind);
    fireEvent.click(await screen.findByRole('button', { name: 'Describe the taste' }));
    expect(screen.getByTestId(yes)).toBeTruthy();
    expect(screen.queryByTestId(no)).toBeNull();
  });
});

describe('which kind wins', () => {
  it("the house's own kind beats the library's", async () => {
    api.get.mockResolvedValue(ready(null));
    mount('wine', 'beer');
    fireEvent.click(await screen.findByRole('button', { name: 'Describe the taste' }));
    expect(screen.getByTestId('taste-chip-bready')).toBeTruthy();
    expect(screen.queryByTestId('taste-chip-oak')).toBeNull();
  });
});

describe('the five states, in words', () => {
  it('loading says it is reading', () => {
    api.get.mockImplementation(() => new Promise(() => undefined));
    mount();
    expect(screen.getByTestId('taste-card').textContent).toContain('Reading how this tastes');
  });

  it('ready and empty says nobody has described it, and offers the form', async () => {
    api.get.mockResolvedValue(ready(null, []));
    mount();
    expect((await screen.findByTestId('taste-empty')).textContent).toBe(TASTE_EMPTY);
    expect(screen.getByRole('button', { name: 'Describe the taste' })).toBeTruthy();
    expect(screen.queryByTestId('taste-rows')).toBeNull();
  });

  it('absent says it is not switched on, with no button', async () => {
    api.get.mockResolvedValue({ state: 'absent' });
    mount();
    expect((await screen.findByTestId('taste-absent')).textContent).toBe(TASTE_ABSENT);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('failed says so, shows nothing as known, and Try again reads again', async () => {
    api.get.mockResolvedValueOnce({ state: 'failed', reason: TASTE_FAILED });
    mount();
    const said = await screen.findByTestId('taste-failed');
    expect(said.textContent).toBe(TASTE_FAILED);
    expect(screen.queryByTestId('taste-rows')).toBeNull();
    expect(screen.queryByTestId('taste-empty')).toBeNull();
    api.get.mockResolvedValueOnce(ready({ axes: { salty: ax(5) } }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('taste-row-salty')).toBeTruthy();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('a query that throws is failed too', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    mount();
    expect((await screen.findByTestId('taste-failed')).textContent).toBe(TASTE_FAILED);
  });
});

describe('the rows', () => {
  const profile = () =>
    ready({
      axes: {
        salty: ax(6.36, { lo: 5.1, hi: 7.4 }),
        sweet: ax(2.2, { conf: 0.9, prov: [{ kind: 'recipe', share: 0.7 }, { kind: 'staff_note', share: 0.3 }] }),
        umami: ax(8.8, { conf: 0.3, bandOnly: true, lo: 6, hi: 9.9, prov: [{ kind: 'class_default', share: 1 }] }),
        bitter: ax(4.1, { conf: 0.95, prov: [{ kind: 'measured', share: 1 }] }),
      },
      descriptors: ['savoury', 'not_in_the_list'],
    });

  it('shows one row per known axis, strongest first, with a band word and bar', async () => {
    api.get.mockResolvedValue(profile());
    mount();
    await screen.findByTestId('taste-rows');
    const ids = [...screen.getByTestId('taste-rows').querySelectorAll('[data-testid^="taste-row-"]')].map((r) => r.getAttribute('data-testid'));
    expect(ids).toEqual(['taste-row-umami', 'taste-row-salty', 'taste-row-bitter', 'taste-row-sweet']);
    expect(screen.getByTestId('taste-band-salty').textContent).toBe('pronounced');
    expect(screen.getByTestId('taste-bar-salty').getAttribute('aria-label')).toBe('Salty: pronounced');
    expect(screen.getByTestId('taste-whisker-salty')).toBeTruthy();
    expect(screen.queryByTestId('taste-whisker-sweet')).toBeNull();
  });

  it('shows no number on any row, and none in a bar label', async () => {
    api.get.mockResolvedValue(profile());
    mount();
    await screen.findByTestId('taste-rows');
    for (const row of screen.getByTestId('taste-rows').querySelectorAll('[data-testid^="taste-row-"]')) {
      expect(row.textContent, row.getAttribute('data-testid') ?? '').not.toMatch(/\d/);
      for (const el of row.querySelectorAll('[aria-label]')) expect(el.getAttribute('aria-label')).not.toMatch(/\d/);
    }
    expect(screen.getByTestId('taste-summary').textContent).not.toMatch(/\d/);
  });

  it('a band-only axis (conf below 0.4) shows the word alone: no bar, no whisker, no figure, and no part of the summary', async () => {
    api.get.mockResolvedValue(profile());
    mount();
    await screen.findByTestId('taste-rows');
    const row = screen.getByTestId('taste-row-umami');
    expect(row.getAttribute('data-band-only')).toBe('true');
    expect(within(row).getByTestId('taste-band-umami').textContent).toBe('dominant');
    expect(screen.queryByTestId('taste-bar-umami')).toBeNull();
    expect(screen.queryByTestId('taste-whisker-umami')).toBeNull();
    expect(row.textContent).not.toMatch(/\d/);
    expect(screen.getByTestId('taste-summary').textContent).toBe('Mainly salty, with some bitter.');
  });

  it('every rendered axis row carries a provenance mark, one per kind of source', async () => {
    api.get.mockResolvedValue(profile());
    mount();
    await screen.findByTestId('taste-rows');
    const rows = [...screen.getByTestId('taste-rows').querySelectorAll('[data-testid^="taste-row-"]')];
    expect(rows.length).toBe(4);
    for (const r of rows) {
      const axis = (r.getAttribute('data-testid') as string).replace('taste-row-', '');
      expect(within(r as HTMLElement).getByTestId(`taste-mark-${axis}`)).toBeTruthy();
    }
    expect(screen.getByTestId('taste-mark-salty').getAttribute('data-marks')).toBe('bubble');
    expect(screen.getByTestId('taste-mark-sweet').getAttribute('data-marks')).toBe('tick bubble');
    expect(screen.getByTestId('taste-mark-umami').getAttribute('data-marks')).toBe('hatched');
    expect(screen.getByTestId('taste-mark-bitter').getAttribute('data-marks')).toBe('solid');
    expect(screen.getByTestId('taste-mark-salty').getAttribute('aria-label')).toBe('Where it came from: a staff note');
  });

  it('shows the words a person chose and never an unlisted code', async () => {
    api.get.mockResolvedValue(profile());
    mount();
    expect((await screen.findByTestId('taste-words')).textContent).toBe('Described as savoury.');
    expect(screen.getByTestId('taste-card').textContent).not.toContain('not_in_the_list');
  });

  it('a row opens to its source, range and next step, by keyboard-reachable button', async () => {
    api.get.mockResolvedValue(profile());
    mount();
    await screen.findByTestId('taste-rows');
    const more = screen.getByRole('button', { name: 'Details for Umami' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const d = screen.getByTestId('taste-detail-umami').textContent ?? '';
    expect(d).toContain('a typical value for this kind of good');
    expect(d).toContain('Describe the taste');
    expect(d).not.toMatch(/\d/);
  });

  it('a conflict says the sources disagree and withholds the value', async () => {
    api.get.mockResolvedValue(ready({ axes: { salty: ax(6.4), sour: ax(5) }, conflicts: [{ axis: 'salty', gap: 4 }] }));
    mount();
    const c = await screen.findByTestId('taste-conflict-salty');
    expect(c.textContent).toBe('Sources disagree on salty.');
    expect(screen.queryByTestId('taste-row-salty')).toBeNull();
    expect(c.textContent).not.toMatch(/\d/);
    expect(screen.getByTestId('taste-row-sour')).toBeTruthy();
  });

  it('the footer names who stated it, when, and how many sources; each layer is listed with its note as text', async () => {
    api.get.mockResolvedValue(ready({ axes: { salty: ax(5) } }, [layer('Ayşe', 'house', '<b>more salt</b>'), layer('Mert')]));
    mount();
    const f = await screen.findByTestId('taste-footer');
    expect(f.textContent).toMatch(/^Stated by Ayşe and Mert, .+, 2 sources\.$/);
    const list = screen.getByTestId('taste-layers');
    expect(list.querySelectorAll('li').length).toBe(2);
    expect(list.textContent).toContain('<b>more salt</b>');
    expect(list.querySelector('b')).toBeNull();
  });

  it('one layer says one source', async () => {
    api.get.mockResolvedValue(ready({ axes: { salty: ax(5) } }));
    mount();
    expect((await screen.findByTestId('taste-footer')).textContent).toMatch(/, 1 source\.$/);
  });
});

describe('describing the taste', () => {
  const open = async () => {
    api.get.mockResolvedValue(ready(null, []));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Describe the taste' }));
  };

  it('starts with nothing set: Save is off and says why', async () => {
    await open();
    expect((screen.getByTestId('taste-save') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('taste-form-hint').textContent).toContain('Pick a word');
    for (const k of ['sweet', 'salty', 'umami', 'funky']) expect((screen.getByTestId(`taste-level-${k}`) as HTMLSelectElement).value).toBe('');
  });

  it('saves only the axes that were set, with chips and a trimmed note, then re-reads', async () => {
    await open();
    fireEvent.click(screen.getByTestId('taste-chip-savoury'));
    fireEvent.click(screen.getByTestId('taste-chip-rich'));
    fireEvent.click(screen.getByTestId('taste-chip-crisp'));
    fireEvent.change(screen.getByTestId('taste-level-salty'), { target: { value: 'medium' } });
    fireEvent.change(screen.getByTestId('taste-note'), { target: { value: '  needs more salt  ' } });
    api.add.mockResolvedValue(ready({ axes: { salty: ax(5) }, descriptors: ['savoury', 'rich'] }));
    api.get.mockResolvedValue(ready({ axes: { salty: ax(5) }, descriptors: ['savoury', 'rich'] }));
    fireEvent.click(screen.getByTestId('taste-save'));
    await waitFor(() => expect(api.add).toHaveBeenCalledTimes(1));
    expect(api.add).toHaveBeenCalledWith(
      'good',
      'i1',
      { axes: { salty: { v: 5 } }, descriptors: ['savoury', 'rich'], texture: ['crisp'], note: 'needs more salt', method: 'ordinal' },
      'r1',
    );
    expect(await screen.findByTestId('taste-row-salty')).toBeTruthy();
    expect(screen.getByTestId('taste-band-salty').textContent).toBe('medium');
    expect(screen.queryByTestId('taste-form')).toBeNull();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('"none" is a statement: it sends a real 0, while an axis left alone is not sent', async () => {
    await open();
    fireEvent.change(screen.getByTestId('taste-level-sweet'), { target: { value: 'none' } });
    api.add.mockResolvedValue(ready({ axes: {} }));
    fireEvent.click(screen.getByTestId('taste-save'));
    await waitFor(() => expect(api.add).toHaveBeenCalled());
    const body = api.add.mock.calls[0][2];
    expect(body.axes).toEqual({ sweet: { v: 0 } });
    expect(Object.keys(body.axes)).not.toContain('salty');
  });

  it('putting an axis back to "Not said" un-sets it', async () => {
    await open();
    fireEvent.change(screen.getByTestId('taste-level-sweet'), { target: { value: 'light' } });
    fireEvent.change(screen.getByTestId('taste-level-sweet'), { target: { value: '' } });
    expect((screen.getByTestId('taste-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('chips alone are saved as a word-only description', async () => {
    await open();
    fireEvent.click(screen.getByTestId('taste-chip-fresh'));
    api.add.mockResolvedValue(ready({ axes: {} }));
    fireEvent.click(screen.getByTestId('taste-save'));
    await waitFor(() => expect(api.add).toHaveBeenCalled());
    expect(api.add.mock.calls[0][2]).toEqual({ descriptors: ['fresh'], method: 'cata' });
  });

  it('a refusal is said in the gateway\'s own sentence and nothing is shown as saved', async () => {
    await open();
    fireEvent.change(screen.getByTestId('taste-level-sweet'), { target: { value: 'light' } });
    api.add.mockResolvedValue({ state: 'failed', reason: 'That word is not one the house uses.', status: 400 });
    fireEvent.click(screen.getByTestId('taste-save'));
    expect((await screen.findByTestId('taste-form-said')).textContent).toBe('That word is not one the house uses. Nothing was saved.');
    expect(screen.getByTestId('taste-form')).toBeTruthy();
  });

  it('a save whose outcome is unknown says so and reads again', async () => {
    await open();
    fireEvent.change(screen.getByTestId('taste-level-sweet'), { target: { value: 'light' } });
    api.add.mockResolvedValue({ state: 'failed', reason: null, status: 500 });
    fireEvent.click(screen.getByTestId('taste-save'));
    expect((await screen.findByTestId('taste-form-said')).textContent).toContain('may or may not have been saved');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('Cancel closes the form and writes nothing', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('taste-form')).toBeNull();
    expect(api.add).not.toHaveBeenCalled();
  });
});

describe('the touch rules', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/pages/inventory/next/taste-card.css'), 'utf8');

  it('gives More, the level selects and the Aroma fold 44 px on a phone or a coarse pointer', () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\), \(pointer: coarse\) \{[^@]*?\.tc-more,\s*\.tf-level select,\s*\.tf-set summary \{\s*min-height: 44px;/,
    );
  });
});
