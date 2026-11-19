/**
 * The drawer's first-screen taste line (TasteSummary.tsx): the card's own
 * sentence with its marks; nothing when nothing is known; a failed read said.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TasteAxis, TasteEffective } from '../../../services/api/taste';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: api.get }));

import TasteSummary, { TASTE_LINE_FAILED } from './TasteSummary';

const ax = (v: number, over: Partial<TasteAxis> = {}): TasteAxis => ({ v, lo: null, hi: null, conf: 0.9, prov: [{ kind: 'staff_line', share: 1 }], bandOnly: false, ...over });
const layer = { source: 'house', version: 1, method: 'ordinal', statedByName: 'Ayşe', statedAt: '2026-11-19T10:00:00Z', hasNote: false, noteText: null };
const ready = (axes: TasteEffective['axes'], extra: Partial<TasteEffective> = {}) => ({
  state: 'ready' as const,
  data: { effective: { axes, descriptors: [], texture: [], conflicts: [], ...extra }, layers: [layer] },
});

function mount(onOpen = vi.fn(), open = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TasteSummary id="i1" restaurantId="r1" open={open} onOpen={onOpen} />
    </QueryClientProvider>,
  );
  return onOpen;
}

beforeEach(() => {
  cleanup();
  api.get.mockReset();
});

describe('the first-screen taste line', () => {
  it('says the sentence and a mark, and opens the card when pressed', async () => {
    api.get.mockResolvedValue(ready({ sweet: ax(8.4), sour: ax(5) }));
    const onOpen = mount();
    const btn = await screen.findByTestId('taste-line-open');
    expect(btn.textContent).toBe('Mainly sweet, with some sour.');
    expect(screen.getByTestId('taste-line-marks').getAttribute('data-marks')).toBe('bubble');
    expect(screen.getByTestId('taste-line-marks').getAttribute('aria-label')).toBe('Where it came from: what staff said');
    expect(screen.getByTestId('taste-line').textContent).not.toMatch(/\d/);
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('good', 'i1', 'r1');
  });

  it('its button says whether the evidence is open', async () => {
    api.get.mockResolvedValue(ready({ sweet: ax(8.4) }));
    mount(vi.fn(), true);
    expect((await screen.findByTestId('taste-line-open')).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('taste-line-open').getAttribute('aria-controls')).toBe('ivd-evidence');
  });

  it('says nothing when no profile exists, while it is read, and when taste notes are off', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: { effective: null, layers: [] } });
    mount();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId('taste-line')).toBeNull();
    cleanup();
    api.get.mockImplementation(() => new Promise(() => undefined));
    mount();
    expect(screen.queryByTestId('taste-line')).toBeNull();
    cleanup();
    api.get.mockReset();
    api.get.mockResolvedValue({ state: 'absent' });
    mount();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTestId('taste-line')).toBeNull();
  });

  it('a failed read says so in words and is still a way to the card (and a thrown read too)', async () => {
    api.get.mockResolvedValue({ state: 'failed', reason: 'x' });
    const onOpen = mount();
    expect((await screen.findByTestId('taste-line-open')).textContent).toBe(TASTE_LINE_FAILED);
    expect(screen.getByTestId('taste-line').getAttribute('data-state')).toBe('failed');
    expect(screen.queryByTestId('taste-line-marks')).toBeNull();
    fireEvent.click(screen.getByTestId('taste-line-open'));
    expect(onOpen).toHaveBeenCalled();
    cleanup();
    api.get.mockReset();
    api.get.mockRejectedValue(new Error('boom'));
    mount();
    expect((await screen.findByTestId('taste-line-open')).textContent).toBe(TASTE_LINE_FAILED);
  });

  it('a profile of words only reads "Described as", with the marks of its layers', async () => {
    api.get.mockResolvedValue(ready({}, { descriptors: ['oak'], texture: [] }));
    mount();
    expect((await screen.findByTestId('taste-line-open')).textContent).toBe('Described as oak.');
    expect(screen.getByTestId('taste-line-marks').getAttribute('data-marks')).toBe('bubble');
  });
});

describe('the phone placement', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/pages/inventory/next/taste-card.css'), 'utf8');
  it('shows the head copy and hides the foot copy at 640px and below, the head copy never above', () => {
    expect(css).toMatch(/\.tc-line--head\s*\{\s*display:\s*none;/);
    const phone = css.slice(css.indexOf('@media (max-width: 640px)', css.indexOf('.tc-line--head')));
    expect(phone).toMatch(/\.tc-line--head\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*44px;/);
    expect(phone).toMatch(/\.tc-line--foot\s*\{[^}]*display:\s*none;/);
  });
});
