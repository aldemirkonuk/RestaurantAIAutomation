/**
 * r98 (motion needs M6, M8): the taste line holds its slot and gives it back after the sheet's slide;
 * a taste row's "More" opens by height and opacity and "Less" closes the same detail; a drawer card
 * holds its answered height. jsdom has no layout or animation, so the states and the rules (read from
 * the stylesheets) are pinned. Reduced motion draws no tween: the rules say none, and the slot goes at once.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TasteAxis } from '../../../services/api/taste';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: api.get }));

import TasteSummary, { HOLD_COLLAPSE_MS, HOLD_GRACE_MS } from './TasteSummary';
import TasteCard from './TasteCard';

const css = (f: string) => readFileSync(resolve(__dirname, f), 'utf8');
const ax = (v: number): TasteAxis => ({ v, lo: null, hi: null, conf: 0.6, prov: [{ kind: 'staff_note', share: 1 }], bandOnly: false });
const empty = { state: 'ready' as const, data: { effective: null, layers: [] } };
const layer = { source: 'house', version: 1, method: 'ordinal', statedByName: 'Ayşe', statedAt: '2026-11-19T10:00:00Z', hasNote: false, noteText: null };

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

beforeEach(() => { cleanup(); api.get.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('the taste line holds its slot (M6)', () => {
  it('holds the foot slot while the read is pending, as the head one always did', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    wrap(<TasteSummary id="i1" restaurantId="r1" open={false} onOpen={() => {}} />);
    const hold = screen.getByTestId('taste-line-hold');
    expect(hold).toHaveAttribute('aria-hidden', 'true');
    expect(hold.className).toContain('tc-line--foot');
  });

  it('an empty answer keeps the room until the sheet has slid, gives it back over 200 ms, then removes it', async () => {
    vi.useFakeTimers();
    api.get.mockResolvedValue(empty);
    wrap(<TasteSummary id="i1" restaurantId="r1" open={false} onOpen={() => {}} />);
    await settle();
    // answered empty at ~0 ms: still held, not collapsing (the slide is running)
    expect(screen.getByTestId('taste-line-hold')).not.toHaveAttribute('data-collapsing');
    await act(async () => { vi.advanceTimersByTime(HOLD_GRACE_MS - 1); });
    expect(screen.getByTestId('taste-line-hold')).not.toHaveAttribute('data-collapsing');
    await act(async () => { vi.advanceTimersByTime(2); });
    expect(screen.getByTestId('taste-line-hold')).toHaveAttribute('data-collapsing', 'true');
    await act(async () => { vi.advanceTimersByTime(HOLD_COLLAPSE_MS + 1); });
    expect(screen.queryByTestId('taste-line-hold')).toBeNull();
  });

  it('under reduced motion the room goes at the same time with no collapse step', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    api.get.mockResolvedValue(empty);
    wrap(<TasteSummary id="i1" restaurantId="r1" open={false} onOpen={() => {}} />);
    await settle();
    await act(async () => { vi.advanceTimersByTime(HOLD_GRACE_MS + 1); });
    // The give-back is timed from the answer (r103): React draws the answer, then the timer runs.
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId('taste-line-hold')).toBeNull();
  });

  it('a line with something to say replaces the hold (one on the page, never both)', async () => {
    api.get.mockResolvedValue({ state: 'ready', data: { effective: { axes: { sweet: ax(8) }, descriptors: [], texture: [], conflicts: [] }, layers: [layer] } });
    wrap(<TasteSummary id="i1" restaurantId="r1" open={false} onOpen={() => {}} />);
    expect(await screen.findByTestId('taste-line')).toBeInTheDocument();
    expect(screen.queryByTestId('taste-line-hold')).toBeNull();
  });

  it('the stylesheets hold 23 px on the foot, tween the give-back, stop under reduced motion, and a card keeps 94 px', () => {
    const t = css('taste-card.css');
    expect(t).toMatch(/\.tc-line--foot\.tc-line--hold \{\s*min-height: 23px;/);
    expect(t).toMatch(/\.tc-line--hold \{[^}]*transition: min-height 200ms ease-in-out/);
    expect(t).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.tc-line--hold \{\s*transition: none;/);
    // At every width, the one-column phone sheet included (r98 walk finding 2): no media guard on the hold.
    const drawer = css('item-drawer.css');
    expect(drawer).toMatch(/\n\.ivd-card \{[^}]*min-height: 94px;/);
    expect(drawer).not.toMatch(/@media \(min-width: 768px\) \{\s*\.ivd-card \{\s*min-height/);
  });
});

describe('"More" opens a row\'s detail by height and opacity (M8)', () => {
  async function card() {
    api.get.mockResolvedValue({ state: 'ready', data: { effective: { axes: { umami: ax(7) }, descriptors: [], texture: [], conflicts: [] }, layers: [layer] } });
    wrap(<TasteCard row={{ id: 'i1' }} restaurantId="r1" canManage={false} />);
    return screen.findByTestId('taste-row-umami');
  }
  const more = () => screen.getByRole('button', { name: 'Details for Umami' });

  it('draws no detail until it is asked for, opens it in a wrapper that tweens, and Less closes the same wrapper', async () => {
    await card();
    expect(screen.queryByTestId('taste-detail-wrap-umami')).toBeNull();
    fireEvent.click(more());
    const wrap1 = screen.getByTestId('taste-detail-wrap-umami');
    expect(wrap1).toHaveAttribute('data-open', 'true');
    expect(screen.getByTestId('taste-detail-umami').textContent).toMatch(/^Source:/);
    expect(more()).toHaveTextContent('Less');
    fireEvent.click(more());
    // the same node stays (so the close can tween); it reads closed
    expect(screen.getByTestId('taste-detail-wrap-umami')).toBe(wrap1);
    expect(wrap1).toHaveAttribute('data-open', 'false');
    expect(more()).toHaveTextContent('More');
    expect(more()).toHaveAttribute('aria-expanded', 'false');
  });

  it('the stylesheet opens over 200 ms on the house curve with the text fading in at 40 ms, closes over 140 ms, and stops under reduced motion', () => {
    const t = css('taste-card.css');
    expect(t).toMatch(/\.tc-detail-wrap\[data-open='true'\] \{[^}]*transition: grid-template-rows 200ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    expect(t).toMatch(/\.tc-detail-wrap \{[^}]*grid-template-rows: 0fr;[^}]*transition: grid-template-rows 140ms ease-in/);
    expect(t).toMatch(/\.tc-detail-wrap\[data-open='true'\] \.tc-detail \{[^}]*transition: opacity 160ms ease-out 40ms/);
    expect(t).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.tc-detail-wrap,\s*\.tc-detail-wrap \.tc-detail \{\s*transition: none;/);
  });
});
