/**
 * A cutting laid flat (`?flat=<id>`, founder /goal 2026-11-07). One `Cutting`
 * in a MemoryRouter with a stub register, as ReportsNext.test.tsx wraps the
 * page; a probe reads the URL back. Cases (a)–(h) are the lane's specs.
 */

import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { openStack } from '@/components/mudavym/overlayState';
import Cutting from './Cutting';
import { Working } from './rp-plot';
import { CATALOGUE } from './rp-catalogue';
import { readsRegister } from './rp-spec';
import { ANALYSIS_IDS, type AnalysisId, type GraphType } from './rp-sheet';
import { failureLine, heldBackFailure } from './rp-format';
import type { ArrangeApi } from './rp-arrange';
import type { Register } from './useReportsNextData';

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
      within(dialog).getByText(/The window you pick is kept in the page link, so a reload or a shared link opens on it\./),
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
  });
});
