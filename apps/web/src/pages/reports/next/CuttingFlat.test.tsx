/**
 * A cutting laid flat (`?flat=<id>`, founder /goal 2026-11-07). One `Cutting`
 * in a MemoryRouter with a stub register, as ReportsNext.test.tsx wraps the
 * page; a probe reads the URL back. Cases (a)–(h) are the lane's specs.
 */

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { openStack } from '@/components/mudavym/overlayState';
import { AuthContext } from '@/contexts/AuthContext';
import Cutting from './Cutting';
import { Working } from './rp-plot';
import { CATALOGUE } from './rp-catalogue';
import { readsRegister } from './rp-spec';
import { ANALYSIS_IDS, type AnalysisId, type GraphType } from './rp-sheet';
import { failureLine, heldBackFailure } from './rp-format';
import type { ArrangeApi } from './rp-arrange';
import type { Register } from './useReportsNextData';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FLAT_CSS = readFileSync(resolve(__dirname, 'reports-flat.css'), 'utf8');

const noop = vi.fn();
const arrangeStub: ArrangeApi = {
  ...{ picked: null, origin: null, message: '', cols: 12, keyDown: () => noop },
  ...{ pickUp: noop, place: noop, cancel: noop, nudge: noop, resize: noop },
};

const swapOptions = ANALYSIS_IDS.map((id) => ({ id, taken: false }));

const reg = (data: unknown, loading = false): Register<unknown> => ({
  data,
  loading,
  failure: null,
  refetch: vi.fn(),
});
const inFlight = () => reg(undefined, true);

const TILL = CATALOGUE.till.select({
  posConnected: true,
  revenue: 4210,
  checkCount: 96,
  from: '2026-08-03',
  to: '2026-09-01',
  days: 30,
  timezone: 'Europe/Istanbul',
  dailySeries: [
    { date: '2026-08-04', revenue: 310 },
    { date: '2026-08-11', revenue: 480 },
  ],
});
const answered = (data: unknown) => reg(data);

function Probe() {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
}

/** The page's state around one cutting, so an onGraph call would redraw it. */
function Harness({
  id,
  register,
  initialGraph,
  initialArranging = false,
  onGraph,
  onDays = vi.fn(),
}: {
  id: AnalysisId;
  register?: Register<unknown>;
  initialGraph?: GraphType;
  initialArranging?: boolean;
  onGraph?: (g: GraphType) => void;
  onDays?: (d: number) => void;
}) {
  const [graph, setGraph] = useState<GraphType>(initialGraph ?? CATALOGUE[id].graphs[0] ?? 'table');
  const [arranging, setArranging] = useState(initialArranging);
  return (
    <>
      <button type="button" onClick={() => setArranging((v) => !v)}>
        toggle arranging
      </button>
      <Cutting
        id={id}
        graph={graph}
        register={register}
        ctx={{ days: 30 }}
        arranging={arranging}
        swapOptions={swapOptions}
        arrange={arrangeStub}
        onGraph={(g) => {
          onGraph?.(g);
          setGraph(g);
        }}
        onSwap={vi.fn()}
        onRemove={vi.fn()}
        onDays={onDays}
      />
    </>
  );
}

function paint(node: React.ReactNode, entries: string[] = ['/reports']) {
  return render(
    <MemoryRouter initialEntries={entries}>
      {node}
      <Probe />
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent;
const opener = (title: string) =>
  screen.getByRole('button', { name: `Show ${title} full screen` });

afterEach(() => {
  document.body.style.overflow = '';
});

describe('a cutting laid flat', () => {
  it('(a) every register that reads one offers it while reading; none while arranging or for the desk', () => {
    for (const id of ANALYSIS_IDS) {
      const spec = CATALOGUE[id];
      const { unmount } = paint(
        <Harness id={id} register={readsRegister(spec) ? inFlight() : undefined} />,
      );
      const name = `Show ${spec.title} full screen`;
      if (readsRegister(spec)) {
        const button = screen.getByRole('button', { name });
        expect(button).toHaveAttribute('title', name);
        fireEvent.click(screen.getByText('toggle arranging'));
        expect(screen.queryByRole('button', { name })).toBeNull();
      } else {
        expect(id).toBe('writing');
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
      unmount();
    }
  });

  it('(b) opens a titled dialog with the drawing; its Draw as never writes the sheet', () => {
    const onGraph = vi.fn();
    paint(<Harness id="till" register={answered(TILL)} initialGraph="area" onGraph={onGraph} />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(opener('Through the till'));
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.querySelector('.rp-plot')).not.toBeNull();
    expect(within(dialog).getByText(/^This view is not saved to your sheet\./)).toBeInTheDocument();

    const drawAs = within(dialog).getByRole('combobox', { name: 'Draw Through the till as' });
    expect(drawAs).toHaveValue('area');
    fireEvent.change(drawAs, { target: { value: 'table' } });
    expect(within(dialog).getByRole('table')).toBeInTheDocument();
    expect(onGraph).toHaveBeenCalledTimes(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to the sheet' }));
    fireEvent.click(screen.getByText('toggle arranging'));
    const sheetDrawAs = screen.getByRole('combobox', { name: 'Draw Through the till as' });
    expect(sheetDrawAs).toHaveValue('area');
  });

  it('(c) Esc closes, drops ?flat, returns focus', async () => {
    paint(<Harness id="till" register={answered(TILL)} />);
    const button = opener('Through the till');
    fireEvent.click(button);
    expect(where()).toBe('/reports?flat=till');
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    expect(within(dialog).getByRole('button', { name: 'Back to the sheet' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/reports');
    expect(opener('Through the till')).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('(c) the Back button ends in the same state as Esc', async () => {
    paint(<Harness id="till" register={answered(TILL)} />);
    fireEvent.click(opener('Through the till'));
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to the sheet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/reports');
    expect(opener('Through the till')).toHaveFocus();
  });

  it('(c) Tab stays inside the dialog', () => {
    paint(<Harness id="till" register={answered(TILL)} />);
    fireEvent.click(opener('Through the till'));
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    const back = within(dialog).getByRole('button', { name: 'Back to the sheet' });
    fireEvent.keyDown(back, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(back);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
    expect(back).toHaveFocus();
  });

  it('(d) a cold ?flat=till opens the till; closing removes the param', async () => {
    paint(<Harness id="till" register={answered(TILL)} />, ['/reports?flat=till']);
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to the sheet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/reports');
  });

  it('(d) ?flat=bogus opens nothing, and neither does ?flat=till while arranging', () => {
    const { unmount } = paint(<Harness id="till" register={answered(TILL)} />, [
      '/reports?flat=bogus',
    ]);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    paint(<Harness id="till" register={answered(TILL)} initialArranging />, ['/reports?flat=till']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('(d) two flat params open one dialog, never two', () => {
    paint(
      <>
        <Harness id="till" register={answered(TILL)} />
        <Harness id="week" register={inFlight()} />
      </>,
      ['/reports?flat=till&flat=week'],
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Through the till' })).toBeInTheDocument();
  });

  it('(e) a withheld register says its held sentence', () => {
    const failure = heldBackFailure(['owner', 'manager'], 'staff');
    const held: Register<unknown> = { ...reg(undefined), failure };
    paint(<Harness id="seats" register={held} />, ['/reports?flat=seats']);
    const dialog = screen.getByRole('dialog', { name: CATALOGUE.seats.title });
    expect(
      within(dialog).getByText(failureLine(CATALOGUE.seats.register, failure)),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Read it again' })).toBeNull();
    expect(held.refetch).not.toHaveBeenCalled();
  });

  it('(e) a register in flight shows the same skeleton in the dialog', () => {
    paint(<Harness id="week" register={inFlight()} />, ['/reports?flat=week']);
    const dialog = screen.getByRole('dialog', { name: CATALOGUE.week.title });
    expect(within(dialog).getByRole('status', { name: 'Reading the register' })).toBeInTheDocument();
  });

  it('(f) the till picker writes through onDays', () => {
    const onDays = vi.fn();
    paint(<Harness id="till" register={answered(TILL)} onDays={onDays} />, ['/reports?flat=till']);
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    const group = within(dialog).getByRole('group', { name: 'Till window' });
    expect(
      within(dialog).getByText(
        /The window and the day, week or month you pick are kept in the page link, so a reload or a shared link opens on them\./,
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: '90 days' }));
    expect(onDays).toHaveBeenCalledWith(90);
    fireEvent.click(within(group).getByRole('button', { name: '365 days' }));
    expect(onDays).toHaveBeenCalledWith(365);
  });

  it('(g) the working is open in the dialog and closed on the sheet', () => {
    paint(<Harness id="till" register={answered(TILL)} />, ['/reports?flat=till']);
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    expect(within(dialog).getByRole('button', { name: 'Hide the working' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const section = screen.getByRole('region', { name: 'Through the till' });
    expect(within(section).getByRole('button', { name: 'Show the working' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('the working', () => {
  it('(h) renders two identical basis lines as two lines, with no key collision', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<Working lines={['Same sentence.', 'Same sentence.']} defaultOpen />);
      expect(screen.getAllByText('Same sentence.')).toHaveLength(2);
      const collided = errors.mock.calls.some((c) =>
        c.some((a) => typeof a === 'string' && a.includes('same key')),
      );
      expect(collided).toBe(false);
    } finally {
      errors.mockRestore();
    }
  });
});

/** Three registers on one sheet, in this order, each its own Cutting (the page's shape). */
const ORDER: AnalysisId[] = ['till', 'week', 'seats'];
function Sheet3({ order = ORDER }: { order?: AnalysisId[] }) {
  const held: Register<unknown> = { ...reg(undefined), failure: heldBackFailure(['owner', 'manager'], 'staff') };
  return (
    <>
      {order.map((id) => (
        <Cutting
          key={id}
          id={id}
          graph={CATALOGUE[id].graphs[0] ?? 'table'}
          register={id === 'till' ? answered(TILL) : id === 'seats' ? held : inFlight()}
          ctx={{ days: 30 }}
          arranging={false}
          swapOptions={swapOptions}
          arrange={arrangeStub}
          onGraph={vi.fn()}
          onSwap={vi.fn()}
          onRemove={vi.fn()}
          onDays={vi.fn()}
          flatOrder={order}
        />
      ))}
    </>
  );
}
const titleOf = (id: AnalysisId) => CATALOGUE[id].title;
const dialogNamed = (id: AnalysisId) => screen.getByRole('dialog', { name: titleOf(id) });

describe('full screen steps through the sheet (r108 g1)', () => {
  it('[REVERT-FAILS] a step lands on a dialog marked stepped, so it does not replay the arrival fade; an opening is not', () => {
    paint(<Sheet3 />);
    fireEvent.click(opener(titleOf('till')));
    expect(dialogNamed('till')).not.toHaveAttribute('data-stepped');
    fireEvent.click(within(dialogNamed('till')).getByRole('button', { name: `Next: ${titleOf('week')}` }));
    expect(dialogNamed('week')).toHaveAttribute('data-stepped');
    fireEvent.click(within(dialogNamed('week')).getByRole('button', { name: `Previous: ${titleOf('till')}` }));
    expect(dialogNamed('till')).toHaveAttribute('data-stepped');
  });

  it('steps in sheet order, says where, hides the button at an end, and focuses the direction it came by', () => {
    paint(<Sheet3 />);
    fireEvent.click(opener(titleOf('till')));
    let dialog = dialogNamed('till');
    expect(within(dialog).getByText('1 of 3')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Previous/ })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: `Next: ${titleOf('week')}` }));
    expect(where()).toBe('/reports?flat=week');
    dialog = dialogNamed('week');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByText('2 of 3')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: `Next: ${titleOf('seats')}` })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: `Previous: ${titleOf('till')}` }));
    expect(where()).toBe('/reports?flat=till');
    expect(within(dialogNamed('till')).getByRole('button', { name: `Next: ${titleOf('week')}` })).toBeInTheDocument();
    // Stepping to an EARLIER sibling: the cutting left behind must not pull focus back to its own opener.
    expect(within(dialogNamed('till')).getByRole('button', { name: 'Back to the sheet' })).toHaveFocus();
    // The last one: no Next, no wrap, and focus falls back to Back, the one control it can offer.
    fireEvent.click(within(dialogNamed('till')).getByRole('button', { name: `Next: ${titleOf('week')}` }));
    fireEvent.click(within(dialogNamed('week')).getByRole('button', { name: `Next: ${titleOf('seats')}` }));
    dialog = dialogNamed('seats');
    expect(within(dialog).getByText('3 of 3')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Next/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Back to the sheet' })).toHaveFocus();
  });

  it('[REVERT-FAILS] a step does not replay the arrival: only an opening is marked to settle in (r109)', () => {
    paint(<Sheet3 />);
    fireEvent.click(opener(titleOf('till')));
    expect(dialogNamed('till')).not.toHaveAttribute('data-stepped');
    fireEvent.click(within(dialogNamed('till')).getByRole('button', { name: `Next: ${titleOf('week')}` }));
    expect(dialogNamed('week')).toHaveAttribute('data-stepped', 'true');
    // The stylesheet takes the arrival off a stepped dialog.
    expect(FLAT_CSS).toMatch(/\.rp-flat\[data-stepped='true'\]\s*\{\s*animation:\s*none;/);
  });

  it('[REVERT-FAILS] a stepped dialog stays settled when the page replaces the entry without the step marker (r109)', () => {
    // The window, compare and grain setters replace the entry with no state; the arrival must not start on an open dialog.
    function Replace() {
      const navigate = useNavigate();
      return (
        <button type="button" data-testid="replace" onClick={() => navigate('/reports?flat=week&days=90', { replace: true })}>
          replace
        </button>
      );
    }
    paint(
      <>
        <Sheet3 />
        <Replace />
      </>,
    );
    fireEvent.click(opener(titleOf('till')));
    fireEvent.click(within(dialogNamed('till')).getByRole('button', { name: `Next: ${titleOf('week')}` }));
    expect(dialogNamed('week')).toHaveAttribute('data-stepped', 'true');
    fireEvent.click(screen.getByTestId('replace'));
    expect(where()).toBe('/reports?flat=week&days=90');
    expect(dialogNamed('week')).toHaveAttribute('data-stepped', 'true');
  });

  it('a withheld cutting shows its held sentence when stepped to', () => {
    paint(<Sheet3 />, ['/reports?flat=week']);
    fireEvent.click(within(dialogNamed('week')).getByRole('button', { name: `Next: ${titleOf('seats')}` }));
    const failure = heldBackFailure(['owner', 'manager'], 'staff');
    expect(
      within(dialogNamed('seats')).getByText(failureLine(CATALOGUE.seats.register, failure)),
    ).toBeInTheDocument();
  });

  it('a step replaces the entry: one Back leaves full screen, the scroll lock and the overlay stack are free', async () => {
    paint(<Sheet3 />);
    fireEvent.click(opener(titleOf('till')));
    fireEvent.click(within(dialogNamed('till')).getByRole('button', { name: `Next: ${titleOf('week')}` }));
    fireEvent.click(within(dialogNamed('week')).getByRole('button', { name: `Next: ${titleOf('seats')}` }));
    expect(document.body.style.overflow).toBe('hidden');
    expect(openStack).toHaveLength(1);
    fireEvent.click(within(dialogNamed('seats')).getByRole('button', { name: 'Back to the sheet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/reports');
    expect(document.body.style.overflow).toBe('');
    expect(openStack).toHaveLength(0);
    // Focus lands on the cutting last viewed.
    expect(opener(titleOf('seats'))).toHaveFocus();
  });

  it('a cold link steps without inventing an entry of ours: closing removes the param in place', async () => {
    paint(<Sheet3 />, ['/reports?flat=till']);
    fireEvent.click(within(dialogNamed('till')).getByRole('button', { name: `Next: ${titleOf('week')}` }));
    fireEvent.click(within(dialogNamed('week')).getByRole('button', { name: 'Back to the sheet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(where()).toBe('/reports');
  });

  it('Left and Right step, but not from a select, an input or a focused chart, nor with a modifier', () => {
    paint(<Sheet3 />, ['/reports?flat=week']);
    const dialog = dialogNamed('week');
    const chart = document.createElement('div');
    chart.className = 'rp-plot';
    dialog.appendChild(chart);
    const input = document.createElement('input');
    dialog.appendChild(input);
    for (const el of [chart, input]) {
      fireEvent.keyDown(el, { key: 'ArrowRight' });
      expect(where()).toBe('/reports?flat=week');
    }
    const select = within(dialog).queryByRole('combobox');
    if (select) {
      fireEvent.keyDown(select, { key: 'ArrowRight' });
      expect(where()).toBe('/reports?flat=week');
    }
    fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true });
    expect(where()).toBe('/reports?flat=week');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(where()).toBe('/reports?flat=seats');
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(where()).toBe('/reports?flat=seats'); // no wrap
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(where()).toBe('/reports?flat=week');
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(where()).toBe('/reports?flat=till'); // no wrap
  });

  it('a lone cutting, or one the order does not name, offers no step', () => {
    paint(<Sheet3 order={['till']} />, ['/reports?flat=till']);
    const dialog = dialogNamed('till');
    expect(within(dialog).queryByRole('group', { name: 'Move through the sheet' })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(where()).toBe('/reports?flat=till');
describe('Fill the screen (r109 g1)', () => {
  const proto = HTMLElement.prototype as unknown as { requestFullscreen?: unknown };
  let fsEl: Element | null = null;
  const exit = vi.fn();
  const request = vi.fn();

  function enable() {
    fsEl = null;
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fsEl });
    request.mockImplementation(function (this: Element) {
      fsEl = this;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    exit.mockImplementation(() => {
      fsEl = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    proto.requestFullscreen = request;
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  }

  afterEach(() => {
    request.mockReset();
    exit.mockReset();
    delete proto.requestFullscreen;
    for (const k of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen']) {
      delete (document as unknown as Record<string, unknown>)[k];
    }
  });

  it('Fill the screen asks the browser for the dialog; Back gives it back and the lock count returns to 0', async () => {
    enable();
    paint(<Harness id="till" register={answered(TILL)} />);
    fireEvent.click(opener('Through the till'));
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    const fill = within(dialog).getByRole('button', { name: 'Fill the screen' });
    expect(fill).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(fill);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.instances[0]).toBe(dialog);
    expect(request).toHaveBeenCalledWith({ navigationUI: 'hide' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Leave full screen' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to the sheet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(exit).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('');
  });

  it("the browser's own Escape leaves its full screen and puts the label back; the flat stays open", async () => {
    enable();
    paint(<Harness id="till" register={answered(TILL)} />);
    fireEvent.click(opener('Through the till'));
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fill the screen' }));
    await waitFor(() => within(dialog).getByRole('button', { name: 'Leave full screen' }));
    fsEl = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Fill the screen' })).toHaveAttribute('aria-pressed', 'false'),
    );
    expect(screen.getByRole('dialog', { name: 'Through the till' })).toBeInTheDocument();
    expect(exit).not.toHaveBeenCalled();
  });

  it('no button when fullscreenEnabled is false (iPhone Safari)', () => {
    enable();
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
    paint(<Harness id="till" register={answered(TILL)} />);
    fireEvent.click(opener('Through the till'));
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    expect(within(dialog).queryByRole('button', { name: /full screen|Fill the screen/i })).toBeNull();
  });

  it('no button when the root cannot ask for full screen', () => {
    enable();
    delete proto.requestFullscreen;
    paint(<Harness id="till" register={answered(TILL)} />);
    fireEvent.click(opener('Through the till'));
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    expect(within(dialog).queryByRole('button', { name: 'Fill the screen' })).toBeNull();
  });

  it('a phone-sized touch screen asks for landscape once in, and gives the lock back on close', async () => {
    enable();
    const lock = vi.fn(() => Promise.resolve());
    const unlock = vi.fn();
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { lock, unlock } });
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    try {
      paint(<Harness id="till" register={answered(TILL)} />);
      fireEvent.click(opener('Through the till'));
      const dialog = screen.getByRole('dialog', { name: 'Through the till' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Fill the screen' }));
      await waitFor(() => expect(lock).toHaveBeenCalledWith('landscape'));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Back to the sheet' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(unlock).toHaveBeenCalledTimes(1);
    } finally {
      window.matchMedia = mm;
      delete (window.screen as unknown as Record<string, unknown>).orientation;
    }
  });

  it('a refused lock fails silently', async () => {
    enable();
    const lock = vi.fn(() => Promise.reject(new Error('NotSupportedError')));
    Object.defineProperty(window.screen, 'orientation', { configurable: true, value: { lock, unlock: vi.fn() } });
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
    try {
      paint(<Harness id="till" register={answered(TILL)} />);
      fireEvent.click(opener('Through the till'));
      const dialog = screen.getByRole('dialog', { name: 'Through the till' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Fill the screen' }));
      await waitFor(() => expect(lock).toHaveBeenCalled());
      expect(within(dialog).getByRole('button', { name: 'Leave full screen' })).toBeInTheDocument();
    } finally {
      window.matchMedia = mm;
      delete (window.screen as unknown as Record<string, unknown>).orientation;
    }
  });
});

describe('Copy link (r109 g5)', () => {
  const THE_LINK = 'flat=till&days=90&compare=prior&grain=week';
  const messy = `/reports?${THE_LINK}&restaurant=h-9&token=secret&utm=1&sheet=abc`;
  const houses = {
    activeRestaurantId: 'h1',
    availableRestaurants: [
      { id: 'h0', name: 'Elsewhere', city: null, chain_id: null, chain_name: null },
      { id: 'h1', name: 'Antalya Meyhouse', city: null, chain_id: null, chain_name: null },
    ],
  } as never;
  const setClipboard = (value: unknown) =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).clipboard;
    vi.useRealTimers();
  });

  it('copies origin + /reports with only flat, days, compare and grain; says so once, politely', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard({ writeText });
    paint(<Harness id="till" register={answered(TILL)} />, [messy]);
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/reports?${THE_LINK}`);
    const status = await within(dialog).findByText('Link copied.');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    // The button does not morph.
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox')).toBeNull();
  });

  it('the line goes after four seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setClipboard({ writeText: () => Promise.resolve() });
    paint(<Harness id="till" register={answered(TILL)} />, [messy]);
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    await within(dialog).findByText('Link copied.');
    await act(async () => {
      vi.advanceTimersByTime(4100);
    });
    expect(within(dialog).queryByText('Link copied.')).toBeNull();
  });

  it('a refused clipboard shows the link in a read-only, selected field: no dead end', async () => {
    setClipboard({ writeText: () => Promise.reject(new Error('NotAllowedError')) });
    paint(<Harness id="till" register={answered(TILL)} />, [messy]);
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    const box = (await within(dialog).findByDisplayValue(`${window.location.origin}/reports?${THE_LINK}`)) as HTMLInputElement;
    expect(box).toHaveAttribute('readonly');
    expect(within(dialog).getByText('Copy it from here')).toBeInTheDocument();
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);
    expect(within(dialog).queryByText('Link copied.')).toBeNull();
  });

  it('no clipboard at all shows the same field', async () => {
    paint(<Harness id="till" register={answered(TILL)} />, [messy]);
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await within(dialog).findByText('Copy it from here')).toBeInTheDocument();
  });

  it('the head names the active house, and the link never carries it', () => {
    setClipboard({ writeText: vi.fn(() => Promise.resolve()) });
    paint(
      <AuthContext.Provider value={houses}>
        <Harness id="till" register={answered(TILL)} />
      </AuthContext.Provider>,
      ['/reports?flat=till'],
    );
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    expect(dialog.querySelector('.rp-cut__window')?.textContent).toMatch(/^Antalya Meyhouse · /);
    expect(dialog.querySelector('.rp-cut__window')?.textContent).not.toMatch(/Elsewhere/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toMatch(/Antalya|h1/);
  });

  it('with no house to name, the window line is the page\'s own', () => {
    paint(<Harness id="till" register={answered(TILL)} />, ['/reports?flat=till']);
    const dialog = screen.getByRole('dialog', { name: 'Through the till' });
    expect(dialog.querySelector('.rp-cut__window')?.textContent).not.toContain(' · Antalya');
    expect(dialog.querySelector('.rp-cut__window')?.textContent?.startsWith('Antalya')).toBe(false);
  });
});
