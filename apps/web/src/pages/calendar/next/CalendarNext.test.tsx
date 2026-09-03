/**
 * CalendarNext render contract.
 *
 * Two things are under test and nothing else: the founder's KEEP verdict
 * ("I really prefer the new version") kept whole — Month / Week / Day / Agenda,
 * drag to move, click an empty slot to create, full editing, custom types,
 * vendor links, the command-palette deep link — and the honesty rules: an
 * unread register says so in words, an unknown is an em dash, a control with
 * no backend is disabled with a reason, and the thing that is deliberately not
 * built (the meeting memo) is genuinely absent.
 *
 * The data hook is mocked; the components are the real ones.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useCalendarNextData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useCalendarNextData')>();
  return { ...actual, useCalendarNextData: () => state.current };
});

import CalendarNext from './CalendarNext';
import type { CalEvent } from './useCalendarNextData';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

function event(over: Partial<CalEvent> & { id: string; title: string; date: string }): CalEvent {
  return {
    seriesId: over.id,
    isOccurrence: false,
    description: null,
    type: 'delivery',
    endDate: null,
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    status: 'pending',
    providerId: null,
    orderId: null,
    source: 'manual',
    color: null,
    isRecurring: false,
    reminderEnabled: false,
    reminderDaysBefore: null,
    ...over,
  };
}

const mutation = () => ({ mutate: vi.fn(), isPending: false, error: null });

function mkData(over: Record<string, unknown> = {}) {
  const events = (over.events as CalEvent[] | undefined) ?? [];
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  return {
    start: '2026-08-31',
    end: '2026-10-04',
    events,
    shown: events,
    hiddenByFilter: 0,
    byDay,
    hasEvents: true,
    isLoading: false,
    isError: false,
    forbidden: false,
    errorMessage: '',
    noRestaurant: false,
    refetch: vi.fn(),
    eventTypes: [
      { id: 'default-delivery', name: 'Delivery', color: '#3b82f6', isDefault: true },
      { id: 'ct-1', name: 'Cellar audit', color: '#1A5E6B', isDefault: false },
    ],
    typesKnown: true,
    providersById: new Map([['pv-1', { id: 'pv-1', name: 'Bodega Álvaro' }]]),
    providerList: [{ id: 'pv-1', name: 'Bodega Álvaro' }],
    providersKnown: true,
    ordersById: new Map(),
    ordersKnown: true,
    isRuledOff: () => false,
    create: mutation(),
    update: mutation(),
    remove: mutation(),
    createType: mutation(),
    deleteType: mutation(),
    ...over,
  };
}

function draw(path = '/calendar') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <CalendarNext />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // A fixed clock so the month grid is the same page of the book every run.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 15, 12, 0, 0));
  state.current = mkData();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ── the verdict: the page the founder liked, kept whole ──────────────────── */

describe('CalendarNext — the KEEP', () => {
  it('opens on the month, with the day as the unit of record', () => {
    state.current = mkData({
      events: [event({ id: 'e1', title: 'Vega Sicilia crate', date: '2026-09-17' })],
    });
    draw();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('September 2026');
    expect(screen.getByText('Vega Sicilia crate')).toBeInTheDocument();
    // deliveries are the spine — the ribbon carries the seal rule
    expect(screen.getByText('Vega Sicilia crate')).toHaveAttribute('data-spine', 'true');
    expect(screen.getByText(/1 delivery/)).toBeInTheDocument();
    // and every day of the grid is drawn, present or absent
    expect(screen.getByLabelText(/Thursday, September 17/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Friday, September 18 — nothing written/)).toBeInTheDocument();
  });

  it('carries all four magnifications and switches between them', () => {
    draw();
    for (const label of ['Month', 'Week', 'Day', 'Agenda']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('all day')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('The next ninety days');
  });

  it('moves an event by dragging its ribbon onto another day', () => {
    const data = mkData({
      events: [event({ id: 'e1', title: 'Vega Sicilia crate', date: '2026-09-17' })],
    });
    state.current = data;
    draw();
    fireEvent.dragStart(screen.getByText('Vega Sicilia crate'));
    const target = screen.getByLabelText(/Friday, September 18/);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    expect((data.update as { mutate: ReturnType<typeof vi.fn> }).mutate).toHaveBeenCalledWith({
      id: 'e1',
      patch: { eventDate: '2026-09-18' },
    });
  });

  it('opens the sheet on the hour when an empty slot in the week grid is clicked', () => {
    const { container } = draw();
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    const slots = container.querySelectorAll('.cn-slot');
    expect(slots.length).toBeGreaterThan(0);
    fireEvent.click(slots[7]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Starts')).toHaveValue('13:00');
  });

  it('deep-links into create from the command palette, including date=today', () => {
    draw('/calendar?openModal=true&date=today');
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByLabelText('Date')).toHaveValue('2026-09-15');
  });

  it('edits an existing entry, custom types included', () => {
    const data = mkData({
      events: [event({ id: 'e1', title: 'Vega Sicilia crate', date: '2026-09-17' })],
    });
    state.current = data;
    draw();
    fireEvent.click(screen.getByText('Vega Sicilia crate'));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByLabelText('Title')).toHaveValue('Vega Sicilia crate');
    // the server-backed custom type is offered, and can be added to
    expect(within(sheet).getByRole('button', { name: 'Cellar audit' })).toBeInTheDocument();
    expect(
      within(sheet).getByRole('button', { name: 'Delete the Cellar audit type' }),
    ).toBeInTheDocument();
    fireEvent.change(within(sheet).getByLabelText('New type name'), { target: { value: 'Stocktake' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add' }));
    expect((data.createType as { mutate: ReturnType<typeof vi.fn> }).mutate).toHaveBeenCalledWith(
      { name: 'Stocktake', color: '#1A5E6B' },
      expect.anything(),
    );
  });
});

/* ── the house idiom: a delivery that arrived is ruled off ────────────────── */

describe('CalendarNext — ruling off', () => {
  it('rules a day off only when every delivery on it arrived', () => {
    const events = [
      event({ id: 'e1', title: 'Vega Sicilia crate', date: '2026-09-17', status: 'completed' }),
      event({ id: 'e2', title: 'Chablis pallet', date: '2026-09-17' }),
    ];
    state.current = mkData({ events, isRuledOff: (e: CalEvent) => e.status === 'completed' });
    draw();
    fireEvent.click(screen.getByLabelText(/Thursday, September 17/));
    expect(screen.getByText('1 of 2 ruled off — the day is still open.')).toBeInTheDocument();
    expect(screen.queryByText(/every delivery on this day arrived/)).not.toBeInTheDocument();
  });

  it('rules the day off, under the seal, once the account is settled', () => {
    const events = [
      event({ id: 'e1', title: 'Vega Sicilia crate', date: '2026-09-17', status: 'completed' }),
    ];
    state.current = mkData({ events, isRuledOff: () => true });
    draw();
    fireEvent.click(screen.getByLabelText(/Thursday, September 17/));
    expect(screen.getByText(/Ruled off — every delivery on this day arrived/)).toBeInTheDocument();
  });
});

/* ── honesty ──────────────────────────────────────────────────────────────── */

describe('CalendarNext — honesty', () => {
  it('says a failed read in words, not as an empty month, and offers a retry', () => {
    const data = mkData({
      hasEvents: false,
      isError: true,
      errorMessage: 'Network Error',
      events: [],
    });
    state.current = data;
    draw();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /calendar register could not be read \(Network Error\)/,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Nothing below is claimed/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(data.refetch).toHaveBeenCalled();
  });

  it('names a 403 as a permission answer rather than a quiet schedule', () => {
    state.current = mkData({ hasEvents: false, isError: true, forbidden: true, events: [] });
    draw();
    expect(screen.getByRole('status')).toHaveTextContent(/403/);
    expect(screen.getByRole('status')).toHaveTextContent(/not an empty schedule/);
  });

  it('renders an em dash — never a zero — for a register that has not answered', () => {
    state.current = mkData({
      hasEvents: false,
      isLoading: false,
      events: [],
      ordersKnown: false,
    });
    draw();
    expect(screen.getByText('— The book has not been read.')).toBeInTheDocument();
    expect(screen.getByText(/orders book has not answered/)).toBeInTheDocument();
    expect(screen.queryByText('0 deliveries')).not.toBeInTheDocument();
  });

  it('admits an unread vendor book on the line that needed it', () => {
    state.current = mkData({
      events: [event({ id: 'e1', title: 'Vega Sicilia crate', date: '2026-09-17', providerId: 'pv-9' })],
      providersById: null,
      providersKnown: false,
      providerList: [],
    });
    draw();
    fireEvent.click(screen.getByLabelText(/Thursday, September 17/));
    expect(screen.getByText(/vendor — the vendor book has not answered/)).toBeInTheDocument();
  });

  it('offers the email reminder channel disabled, with the reason, and says reminders are per-browser', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Reminders — on this browser')).toBeInTheDocument();
    expect(within(sheet).getByText(/fires only while Mudavym is open on this machine/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Email' })).toBeDisabled();
    expect(within(sheet).getByText(/Email is disabled because nothing sends it/)).toBeInTheDocument();
  });

  it('refuses the vendor link and the repeat rule on edit, in words, instead of dropping them', () => {
    state.current = mkData({
      events: [
        event({ id: 'e1', title: 'Vega Sicilia crate', date: '2026-09-17', providerId: 'pv-1' }),
      ],
    });
    draw();
    fireEvent.click(screen.getByText('Vega Sicilia crate'));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(/the update route accepts no vendor field/)).toBeInTheDocument();
    expect(within(sheet).getByText(/no recurrence field/)).toBeInTheDocument();
  });

  it('never asks for a meeting memo it cannot store', () => {
    state.current = mkData({
      events: [event({ id: 'e1', title: 'Tasting with Álvaro', date: '2026-09-17', type: 'meeting' })],
    });
    draw();
    fireEvent.click(screen.getByText('Tasting with Álvaro'));
    expect(screen.queryByText(/memo/i)).not.toBeInTheDocument();
  });

  it('says how many entries the filter is holding back', () => {
    state.current = mkData({ hiddenByFilter: 3 });
    draw();
    expect(screen.getByText(/3 entries are held back by the filter/)).toBeInTheDocument();
  });
});
