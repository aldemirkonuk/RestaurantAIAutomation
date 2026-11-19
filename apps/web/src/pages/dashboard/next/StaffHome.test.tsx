/**
 * StaffHome — what a person on the floor sees at `/` (N-11).
 *
 * Behaviour pinned here: the role gate (staff get the floor, everyone else the
 * desk), the three actions, the honest low-stock states, the swipe rule, and
 * the reduced-motion branch (the row never travels, the swipe still counts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const auth = vi.hoisted(() => ({ role: 'staff' as string }));
const spine = vi.hoisted(() => ({ lowStock: undefined as unknown }));
const askOpen = vi.hoisted(() => vi.fn());
const myWeek = vi.hoisted(() => vi.fn());
vi.mock('@/services/api/team', () => ({ getMyWeek: myWeek }));

vi.mock('@/contexts/AuthContext', async () => {
  const React = await import('react');
  return {
    AuthContext: React.createContext(null),
    useAuth: () => ({
      user: { userId: 'u1', name: 'Ada Konuk', email: 'ada@sim.test', role: auth.role },
      activeRestaurantId: 'rest-A',
      activeRole: auth.role,
      isAuthenticated: true,
    }),
  };
});
vi.mock('./useDashboardNextData', () => ({
  useDashboardSpine: () => ({
    stats: undefined,
    pending: undefined,
    lowStock: spine.lowStock,
    activity: undefined,
    alerts: undefined,
    refetch: () => {},
  }),
}));
vi.mock('./DashboardNext', () => ({ default: () => <div>the owner desk</div> }));
vi.mock('@/components/askai/events', () => ({ openAskAi: askOpen }));

import DashboardHome from './DashboardHome';
import StaffHome from './StaffHome';
import { pickShift } from './StaffShift';
import { SWIPE_COMMIT_PX, swipeCommits, swipeState, swipeTravel } from './staffSwipe';

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function mount(ui = <StaffHome />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const item = (id: string, name: string, stock: number, min: number) => ({
  id,
  wineName: name,
  stockLive: stock,
  thresholdMin: min,
});

function reduced(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('prefers-reduced-motion'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  auth.role = 'staff';
  spine.lowStock = [item('1', 'Barolo Cannubi', 1, 4), item('2', 'Etna Rosso', 0, 3)];
  askOpen.mockClear();
  myWeek.mockReset();
  myWeek.mockResolvedValue({ member: { id: 'm1', display_name: 'Ada' }, schedule: null, mine: [], open: [] });
  reduced(false);
});
afterEach(() => vi.restoreAllMocks());

describe('DashboardHome role gate', () => {
  it('shows staff the floor, not the owner desk', () => {
    mount(<DashboardHome />);
    expect(screen.getByRole('navigation', { name: 'What to do' })).toBeTruthy();
    expect(screen.queryByText('the owner desk')).toBeNull();
  });

  it.each(['owner', 'manager'])('shows %s the desk', (r) => {
    auth.role = r;
    mount(<DashboardHome />);
    expect(screen.getByText('the owner desk')).toBeTruthy();
  });
});

describe('StaffHome', () => {
  it('offers Count, Receive and Ask', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Count' }).getAttribute('href')).toBe('/inventory');
    expect(screen.getByRole('link', { name: 'Receive' }).getAttribute('href')).toBe('/receiving');
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(askOpen).toHaveBeenCalledTimes(1);
  });

  it('lists the most short bottle first, as a link that recounts it', () => {
    mount();
    const rows = screen.getAllByTestId('staff-low-row');
    expect(rows).toHaveLength(2);
    // Etna is 3 below its minimum, Barolo 3 below as well; stock 0 sorts by gap then order.
    const link = screen.getByRole('link', { name: /Etna Rosso, 0 left\. Recount/ });
    expect(link.getAttribute('href')).toBe('/inventory?wine=Etna%20Rosso');
  });

  it('says a failed read in words, never as an empty cellar', () => {
    spine.lowStock = null;
    mount();
    expect(screen.getByText(/couldn’t be reached/)).toBeTruthy();
    expect(screen.queryByText(/cellar holds/)).toBeNull();
  });

  it('says an empty answer is empty', () => {
    spine.lowStock = [];
    mount();
    expect(screen.getByText(/cellar holds/)).toBeTruthy();
  });

  it('shows a dash for an unknown count, not zero', () => {
    spine.lowStock = [{ id: '9', wineName: 'Unlabelled' }];
    mount();
    expect(screen.getByRole('link', { name: /Unlabelled, count not known/ })).toBeTruthy();
  });

  function swipe(el: Element, dx: number, dy = 0) {
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 10, clientY: 10, button: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 10 + dx, clientY: 10 + dy });
    const mid = (el as HTMLElement).style.transform;
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 10 + dx, clientY: 10 + dy });
    return mid;
  }

  it('recounts on a clear right swipe and the row follows the finger', () => {
    mount();
    const el = screen.getByRole('link', { name: /Etna Rosso/ });
    const mid = swipe(el, SWIPE_COMMIT_PX + 20);
    expect(mid).toMatch(/translateX\(/);
    expect(screen.getByTestId('where').textContent).toBe('/inventory?wine=Etna%20Rosso');
  });

  it('does not recount on a short or a vertical drag', () => {
    mount();
    const el = screen.getByRole('link', { name: /Etna Rosso/ });
    swipe(el, 30);
    swipe(el, 120, 100);
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('is not a draggable link, so a mouse drag cannot start the browser link drag and cancel the swipe', () => {
    mount();
    const el = screen.getByRole('link', { name: /Etna Rosso/ });
    expect(el.getAttribute('draggable')).toBe('false');
  });

  it('under reduced motion the row never travels but the swipe still counts', () => {
    reduced(true);
    mount();
    const el = screen.getByRole('link', { name: /Etna Rosso/ });
    const mid = swipe(el, SWIPE_COMMIT_PX + 20);
    expect(mid).toBe('');
    expect(screen.getByTestId('where').textContent).toBe('/inventory?wine=Etna%20Rosso');
  });
});

describe('staffSwipe rule', () => {
  it('is idle inside the dead zone, scroll when steep or leftward', () => {
    expect(swipeState(2, 2)).toBe('idle');
    expect(swipeState(40, 40)).toBe('scroll');
    expect(swipeState(-40, 0)).toBe('scroll');
    expect(swipeState(40, 5)).toBe('follow');
  });
  it('commits only past the threshold', () => {
    expect(swipeCommits(SWIPE_COMMIT_PX - 1, 0)).toBe(false);
    expect(swipeCommits(SWIPE_COMMIT_PX, 0)).toBe(true);
  });
  it('resists after the threshold', () => {
    expect(swipeTravel(-5)).toBe(0);
    expect(swipeTravel(40)).toBe(40);
    expect(swipeTravel(SWIPE_COMMIT_PX + 40)).toBe(SWIPE_COMMIT_PX + 10);
  });
});

describe('staff-home.css', () => {
  const css = readFileSync(resolve(__dirname, 'staff-home.css'), 'utf8');
  it('uses tokens only, so dark resolves: no colour literals', () => {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noComments).not.toMatch(/rgba?\(/);
  });
  it('keeps 56 px targets, no transition-all, and a reduced-motion branch', () => {
    expect(css).toMatch(/\.sh-action\s*{[^}]*min-height: 56px/);
    expect(css).toMatch(/\.sh-row__front\s*{[^}]*min-height: 56px/);
    expect(css).not.toMatch(/transition:\s*all|transition-property:\s*all/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});


function shift(over: Record<string, unknown>) {
  return {
    id: 's1',
    restaurant_id: 'rest-A',
    schedule_id: null,
    member_id: 'm1',
    shift_date: '2026-11-18',
    start_time: '17:00:00',
    end_time: '23:00:00',
    role: 'Floor',
    shift_type: 'dinner',
    state: 'scheduled',
    note: null,
    ...over,
  };
}

describe('pickShift', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m); // Wed 18 Nov 2026, local
  it('picks the one in progress', () => {
    const l = pickShift([shift({})] as never, at(19));
    expect(l?.when).toBe('now');
  });
  it('picks a later one today before tomorrow\'s', () => {
    const l = pickShift([shift({ id: 'b', shift_date: '2026-11-19' }), shift({ id: 'a' })] as never, at(9));
    expect(l).toMatchObject({ when: 'today', shift: { id: 'a' } });
  });
  it('moves past a shift that has ended to the next day', () => {
    const l = pickShift([shift({ id: 'a' }), shift({ id: 'b', shift_date: '2026-11-20' })] as never, at(23, 30));
    expect(l).toMatchObject({ when: 'later', shift: { id: 'b' } });
  });
  it('treats an end before its start as an overnight, still on at 01:00 of the start day only after start', () => {
    const night = shift({ start_time: '22:00:00', end_time: '02:00:00' });
    expect(pickShift([night] as never, at(23))?.when).toBe('now');
    expect(pickShift([night] as never, at(20))?.when).toBe('today');
  });
  it('skips a shift called out of', () => {
    expect(pickShift([shift({ state: 'callout' })] as never, at(9))).toBeNull();
  });
  it('is null when nothing is left', () => {
    expect(pickShift([shift({ shift_date: '2026-11-17' })] as never, at(9))).toBeNull();
  });
});

describe('the your-shift strip', () => {
  it('[REVERT-FAILS] says when the person is on, from their own week', async () => {
    const d = new Date();
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    myWeek.mockResolvedValue({
      member: { id: 'm1', display_name: 'Ada' },
      schedule: null,
      mine: [shift({ shift_date: iso, start_time: '00:00:00', end_time: '23:59:00', role: 'Sommelier' })],
      open: [],
    });
    mount();
    const strip = screen.getByRole('region', { name: 'Your shift' });
    await waitFor(() => expect(strip.textContent).toMatch(/On now/));
    expect(strip.textContent).toMatch(/12a to 11:59p/);
    expect(strip.textContent).toMatch(/Sommelier/);
    expect(screen.getByRole('link', { name: 'All shifts' }).getAttribute('href')).toBe('/team');
  });

  it('[REVERT-FAILS] says a failed read in words, never as a free week', async () => {
    myWeek.mockRejectedValue(new Error('503'));
    mount();
    await waitFor(() => expect(screen.getByText(/Your shifts couldn’t be reached/)).toBeTruthy());
    expect(screen.queryByText(/No shift left/)).toBeNull();
  });

  it('says when nothing is left this week, and when the roster has no row', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('No shift left this week.')).toBeTruthy());
    myWeek.mockResolvedValue({ member: null, schedule: null, mine: [], open: [] });
    mount();
    await waitFor(() => expect(screen.getByText(/aren’t on this house’s roster/)).toBeTruthy());
  });

  it('moves by opacity and transform only, and holds still under reduced motion', () => {
    const css = readFileSync(resolve(__dirname, 'staff-home.css'), 'utf8');
    const block = css.slice(css.indexOf('.sh-shift {'), css.indexOf('/* ── running low'));
    expect(block).not.toMatch(/transition:\s*all|transition-all/);
    expect(block).toMatch(/@keyframes sh-shift-in[\s\S]*opacity[\s\S]*transform/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.sh-shift \{\s*animation: none/);
  });
});
