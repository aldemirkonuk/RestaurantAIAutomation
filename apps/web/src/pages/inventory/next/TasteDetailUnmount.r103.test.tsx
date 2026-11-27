/**
 * r103: a taste row's closed detail wrap kept its grid track, and a grid track's size clamps at 0 so the
 * row-gap it adds (4 px) stayed: every More then Less left the card 4 px taller than before. The wrap now
 * unmounts when the close tween ends (at once under reduced motion), so the row is its old height again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TasteAxis } from '../../../services/api/taste';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: api.get }));

import TasteCard from './TasteCard';

const ax = (v: number): TasteAxis => ({ v, lo: null, hi: null, conf: 0.6, prov: [{ kind: 'staff_note', share: 1 }], bandOnly: false });
const layer = { source: 'house', version: 1, method: 'ordinal', statedByName: 'Ayşe', statedAt: '2026-11-19T10:00:00Z', hasNote: false, noteText: null };

beforeEach(() => {
  cleanup();
  api.get.mockReset();
  api.get.mockResolvedValue({ state: 'ready', data: { effective: { axes: { umami: ax(7) }, descriptors: [], texture: [], conflicts: [] }, layers: [layer] } });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function card() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><TasteCard row={{ id: 'i1' }} restaurantId="r1" canManage={false} /></QueryClientProvider>);
  await screen.findByTestId('taste-row-umami');
}
const more = () => screen.getByRole('button', { name: 'Details for Umami' });
const wrapEl = () => screen.queryByTestId('taste-detail-wrap-umami');
function ended(el: Element, propertyName: string) {
  const ev = createEvent.transitionEnd(el);
  Object.defineProperty(ev, 'propertyName', { value: propertyName });
  fireEvent(el, ev);
}

describe('a closed taste detail leaves no wrap behind (r103)', () => {
  it('Less keeps the wrap while it closes, and the end of the close removes it', async () => {
    await card();
    fireEvent.click(more());
    fireEvent.click(more());
    expect(wrapEl()).toHaveAttribute('data-open', 'false');   // still there: it is tweening shut
    ended(wrapEl()!, 'margin-top');                           // not the track: no unmount yet
    expect(wrapEl()).not.toBeNull();
    ended(wrapEl()!, 'grid-template-rows');
    expect(wrapEl()).toBeNull();
    expect(more()).toHaveTextContent('More');
  });

  it('the end of the OPEN tween never removes it, and it can be opened again after a close', async () => {
    await card();
    fireEvent.click(more());
    ended(wrapEl()!, 'grid-template-rows');
    expect(wrapEl()).toHaveAttribute('data-open', 'true');
    fireEvent.click(more());
    ended(wrapEl()!, 'grid-template-rows');
    expect(wrapEl()).toBeNull();
    fireEvent.click(more());
    expect(screen.getByTestId('taste-detail-umami').textContent).toMatch(/^Source:/);
  });

  it('under reduced motion Less removes the wrap at once (no tween, so no end to wait for)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
    await card();
    fireEvent.click(more());
    expect(wrapEl()).not.toBeNull();
    fireEvent.click(more());
    expect(wrapEl()).toBeNull();
  });
});
