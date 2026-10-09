/**
 * HelpNext "Tours and tips" (F-553, F-239). Under HouseShell there was no
 * place to replay a page's tour or bring back a tip hidden with "Don't show
 * again" — LearnPanel mounts only in the legacy Sidebar — and "The app guide"
 * card sent a housed person to /get-started, the first-house sign-up.
 *
 * The guidance context is mocked: this file tests only that the page calls
 * the provider's own startTour/resetTips and goes to the tour's page.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Fetched } from './hp-readiness';
import type { ServiceState } from './hp-service';
import { DEFAULT_GUIDANCE_STATE, type GuidanceState } from '../../../guidance/types';

vi.mock('./useHelpNextData', () => ({ useHelpNextData: vi.fn() }));
vi.mock('../../../guidance/GuidanceProvider', () => ({ useGuidanceOptional: vi.fn() }));
import { useHelpNextData } from './useHelpNextData';
import { useGuidanceOptional } from '../../../guidance/GuidanceProvider';
import { TOUR_REGISTRY } from '../../../guidance/tours/registry';
import HelpNext from './HelpNext';

const ok = <T,>(data: T): Fetched<T> => ({ status: 'ok', data });
const SERVICE: ServiceState = {
  kind: 'answered',
  ready: true,
  httpStatus: 200,
  commit: 'abc1234',
  bootedAt: null,
  checkedAt: null,
  database: 'ok',
  supabaseClient: 'ok',
  reason: null,
  latencyMs: 40,
  readAt: new Date('2026-10-09T12:00:00.000Z'),
};

function guidance(state: Partial<GuidanceState> = {}) {
  return {
    state: { ...DEFAULT_GUIDANCE_STATE, ...state },
    startTour: vi.fn(),
    resetTips: vi.fn(),
  };
}

function renderHelp(g: ReturnType<typeof guidance> | null) {
  vi.mocked(useHelpNextData).mockReturnValue({
    role: 'owner',
    houseName: 'Sim Meyhouse',
    restaurantId: 'r-1',
    mcp: ok([]),
    oauth: ok({ scope: 'own', rows: [] }),
    pos: ok({ sources: [] }),
    mail: ok({ reader: { granted: true, enabled: true, lastReadAt: '2026-10-09T12:00:00.000Z', lastError: null } }),
    oneTap: ok([]),
    ordersPending: ok({ count: 0 }),
    askAi: ok([]),
    producers: ok({ served: true, producers: [] }),
    reminders: ok({ served: true, ledgerReadable: true, lastRun: null }),
    service: SERVICE,
    refetchAll: vi.fn(),
  } as unknown as ReturnType<typeof useHelpNextData>);
  vi.mocked(useGuidanceOptional).mockReturnValue(g as unknown as ReturnType<typeof useGuidanceOptional>);
  render(
    <MemoryRouter initialEntries={['/help']}>
      <Routes>
        <Route path="/help" element={<HelpNext />} />
        <Route path="/inventory" element={<p>inventory page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const toursCard = () => document.getElementById('hp-tours')!;

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('[data-test-anchor]').forEach((n) => n.remove());
});

describe('Tours and tips on Help (F-553)', () => {
  it('lists every page tour that has a page, but not the order sheet', () => {
    renderHelp(guidance());
    const card = within(toursCard());
    expect(card.getByText('Inventory command')).toBeInTheDocument();
    expect(card.getByText('Connections')).toBeInTheDocument();
    expect(card.queryByText('Building an order')).toBeNull();
  });

  it('"Take the tour" opens that page and starts its tour once the page has drawn', () => {
    vi.useFakeTimers();
    const g = guidance();
    renderHelp(g);
    const row = within(toursCard()).getByText('Inventory command').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Take the tour' }));
    expect(screen.getByText('inventory page')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(600));
    expect(g.startTour).not.toHaveBeenCalled();
    // The page's first tour anchor appears; the tour starts on the next poll.
    const el = document.createElement('div');
    el.setAttribute('data-test-anchor', '');
    document.body.appendChild(el);
    const first = TOUR_REGISTRY.inventory.steps[0].element;
    const spy = vi.spyOn(document, 'querySelector').mockImplementation((sel: string) => (sel === first ? el : null));
    act(() => vi.advanceTimersByTime(200));
    expect(g.startTour).toHaveBeenCalledWith('inventory');
    spy.mockRestore();
  });

  it('says how many tips are hidden and brings them back with the provider’s reset', () => {
    const g = guidance({ pages: { inventory: { tip: 'dismissed', tour: 'unseen' }, orders: { tip: 'dismissed', tour: 'completed' } } });
    renderHelp(g);
    const card = within(toursCard());
    expect(card.getByText(/2 page tips are hidden/)).toBeInTheDocument();
    fireEvent.click(card.getByRole('button', { name: 'Bring the tips back' }));
    expect(g.resetTips).toHaveBeenCalledTimes(1);
    expect(card.getByText(/each page shows its tip again/)).toBeInTheDocument();
  });

  it('says so in words when the tour layer is not on this screen', () => {
    renderHelp(null);
    expect(within(toursCard()).getByText('Tours cannot be started from this screen.')).toBeInTheDocument();
  });
});

describe('the app-guide card points at a place that exists for a housed person (F-239)', () => {
  it('links to Tours and tips on this page, never the first-house sign-up', () => {
    renderHelp(guidance());
    const card = screen.getByText('Take any page’s tour again, or bring back the tips you hid.').closest('a')!;
    expect(card.getAttribute('href')).toBe('/help#hp-tours');
    expect(document.querySelector('a[href^="/get-started"]')).toBeNull();
  });
});
