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
import { SEAL_HEX } from './cal-format';
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
    reminderSent: false,
    ...over,
  };
}

const mutation = () => ({ mutate: vi.fn(), isPending: false, error: null });

/**
 * The reminder cron's status, as `GET /calendar/reminders/status` returns it.
 * Defaults to a served house that ran nine minutes before the fake clock, so a
 * test that wants "never run" or "not served" has to say so.
 */
function reminderStatus(over: Record<string, unknown> = {}) {
  return {
    jobName: 'calendar-reminders',
    cronExpression: '*/15 * * * *',
    intervalMinutes: 15,
    lookaheadDays: 60,
    granularity: 'days' as const,
    served: true,
    servedReason: null,
    armed: true,
    armedFlag: 'CALENDAR_REMINDERS_ENABLED',
    timeZone: 'America/Los_Angeles',
    ledgerReadable: true,
    lastRun: {
      startedAt: new Date(2026, 8, 15, 11, 51, 0).toISOString(),
      finishedAt: new Date(2026, 8, 15, 11, 51, 2).toISOString(),
      considered: 4,
      sent: 3,
      deferredQuietHours: 1,
      expired: 0,
      failed: 0,
      truncated: false,
      error: null,
    },
    nextRunAt: new Date(2026, 8, 15, 12, 15, 0).toISOString(),
    unconfirmed: 0,
    pending: 2,
    deliveredToMe: 7,
    viewer: {
      remindersEnabled: true,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      usingDefaults: false,
    },
    ...over,
  };
}

/**
 * One day of the published forecast, as `GET /calendar/weather` returns it.
 * NWS's own numbers for Palo Alto on 2026-09-03, recorded live.
 */
function reading(over: Record<string, unknown> = {}) {
  return {
    businessDate: '2026-09-17',
    issuer: 'NOAA/NWS',
    issuerDetail: 'MTR/91,89',
    issuedAt: new Date(2026, 8, 15, 5, 26, 0).toISOString(),
    fetchedAt: new Date(2026, 8, 15, 11, 55, 0).toISOString(),
    validFrom: '2026-09-17T06:00:00-07:00',
    validTo: '2026-09-18T06:00:00-07:00',
    temperatureHigh: 75,
    temperatureLow: 58,
    temperatureUnit: 'F' as const,
    precipitationProbability: 27,
    precipitationAmountMm: null,
    windSummary: '2 to 12 mph',
    shortForecast: 'Mostly Sunny then Chance Light Rain',
    ...over,
  };
}

/** The weather window with readings on one day, unless a test says otherwise. */
function weatherWindow(over: Record<string, unknown> = {}) {
  const readings = (over.readings as ReturnType<typeof reading>[] | undefined) ?? [reading()];
  return {
    window: {
      from: '2026-08-31',
      to: '2026-10-04',
      coordinate: { latitude: 37.4419, longitude: -122.143 },
      readings,
      forecastInAdvance: [],
      refusal: null,
      refusalReason: null,
      staleReason: null,
      ageMinutes: 5,
      issuer: 'NOAA/NWS',
      horizonDays: 7,
      advisories: [],
      advisoriesReadable: true,
      ...(over.window as Record<string, unknown>),
    },
    byDay: new Map(readings.map((r) => [r.businessDate, r])),
    isLoading: false,
    isError: false,
    errorMessage: '',
  };
}

/** A passed day's reconciliation, as `GET /calendar/day-record` returns it. */
function reconciled(over: Record<string, unknown> = {}) {
  return {
    businessDate: '2026-09-08',
    recorded: {
      covers: 41,
      sales: 3400,
      checkCount: 12,
      excluded: false,
      exclusionReason: null,
      ...(over.recorded as Record<string, unknown>),
    },
    forecastInAdvance: {
      issuer: 'NOAA/NWS',
      issuedAt: new Date(2026, 8, 5, 5, 26, 0).toISOString(),
      leadDays: 3,
      temperatureHigh: 75,
      temperatureLow: 58,
      temperatureUnit: 'F' as const,
      precipitationProbability: 27,
      shortForecast: 'Mostly Sunny',
    },
    line: 'The forecast that stood before this day is kept beside the record; no covers model exists yet to score it against.',
    ...over,
  };
}

function recordWindow(over: Record<string, unknown> = {}) {
  const days = (over.days as ReturnType<typeof reconciled>[] | undefined) ?? [reconciled()];
  return {
    window: {
      from: '2026-08-31',
      to: '2026-10-04',
      days,
      posConnected: true,
      recordedRefusal: null,
      weatherRefusal: null,
      pairsWritten: 0,
      ...(over.window as Record<string, unknown>),
    },
    byDay: new Map(days.map((d) => [d.businessDate, d])),
    isLoading: false,
    isError: false,
    errorMessage: '',
  };
}

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
      { id: 'ct-1', name: 'Cellar audit', color: SEAL_HEX, isDefault: false },
    ],
    typesKnown: true,
    providersById: new Map([['pv-1', { id: 'pv-1', name: 'Bodega Álvaro' }]]),
    providerList: [{ id: 'pv-1', name: 'Bodega Álvaro' }],
    providersKnown: true,
    ordersById: new Map(),
    ordersKnown: true,
    isRuledOff: () => false,
    reminderJob: {
      status: reminderStatus(),
      isLoading: false,
      isError: false,
      errorMessage: '',
      refetch: vi.fn(),
    },
    weather: weatherWindow(),
    record: recordWindow(),
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
      { name: 'Stocktake', color: SEAL_HEX },
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

  it('offers the email reminder channel disabled, with the reason', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Email' })).toBeDisabled();
    expect(within(sheet).getByText(/Email stays\s+disabled because nothing sends it/)).toBeInTheDocument();
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


/* ── the reminder job: server-side, and honest about itself (ADR 0109) ─────── */

describe('CalendarNext — reminders are kept by the house, not by this browser', () => {
  it('no longer claims reminders live in this browser, anywhere on the page', () => {
    draw();
    expect(screen.queryByText(/on this browser/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/there is no server-side reminder job/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Reminders are sent by the server — last run 9 minutes ago\./),
    ).toBeInTheDocument();
  });

  it('shows the last run and the next run on the reminder rows', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('Reminders — kept by the house')).toBeInTheDocument();
    expect(within(sheet).getByText(/Last run/)).toBeInTheDocument();
    expect(within(sheet).getByText(/9 minutes ago/)).toBeInTheDocument();
    expect(within(sheet).getByText(/4 due, 3 sent, 1 held for quiet hours/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Next run/)).toBeInTheDocument();
    expect(within(sheet).getByText(/in 15 minutes/)).toBeInTheDocument();
    expect(within(sheet).getByText(/every 15 minutes, on the server/)).toBeInTheDocument();
    expect(within(sheet).getByText(/2 entries are still waiting/)).toBeInTheDocument();
  });

  it('offers whole-day offsets only, because the column holds days', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    const sheet = screen.getByRole('dialog');
    for (const label of ['On the day', '1 day before', '2 days before', '1 week before']) {
      expect(within(sheet).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(sheet).queryByRole('button', { name: '15 min before' })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: '1 hour before' })).not.toBeInTheDocument();
    expect(within(sheet).getByText(/Whole days only/)).toBeInTheDocument();
  });

  it('writes the offset onto the row instead of into localStorage', () => {
    const update = mutation();
    state.current = mkData({
      events: [event({ id: 'e1', title: 'Vega Sicilia crate', date: '2026-09-17' })],
      update,
    });
    draw();
    fireEvent.click(screen.getByText('Vega Sicilia crate'));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: '2 days before' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save the entry' }));
    expect(update.mutate).toHaveBeenCalled();
    const [{ patch }] = update.mutate.mock.calls[0];
    expect(patch.reminderEnabled).toBe(true);
    expect(patch.reminderDaysBefore).toBe(2);
    expect(localStorage.getItem('wineops_scheduled_reminders')).toBeNull();
  });

  it('says a restaurant the scheduler does not serve gets NO reminder, and promises no next run', () => {
    state.current = mkData({
      reminderJob: {
        status: reminderStatus({
          served: false,
          servedReason:
            "This restaurant is not enumerated by the scheduler, so the reminder job does not run for it. It is opted in with one row in restaurant_feature_flags (flag_name = 'scheduled_communications', enabled = true).",
          nextRunAt: null,
          lastRun: null,
        }),
        isLoading: false,
        isError: false,
        errorMessage: '',
        refetch: vi.fn(),
      },
    });
    draw();
    expect(screen.getByText(/No reminders are sent for this restaurant\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(/No reminder will be sent/)).toBeInTheDocument();
    expect(within(sheet).getByText(/scheduled_communications/)).toBeInTheDocument();
    expect(within(sheet).queryByText(/Next run in/)).not.toBeInTheDocument();
  });

  it('separates "never run" from "the ledger could not be read"', () => {
    state.current = mkData({
      reminderJob: {
        status: reminderStatus({ lastRun: null }),
        isLoading: false,
        isError: false,
        errorMessage: '',
        refetch: vi.fn(),
      },
    });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    expect(
      within(screen.getByRole('dialog')).getByText(/never run for this restaurant/),
    ).toBeInTheDocument();

    state.current = mkData({
      reminderJob: {
        status: reminderStatus({ ledgerReadable: false, lastRun: null }),
        isLoading: false,
        isError: false,
        errorMessage: '',
        refetch: vi.fn(),
      },
    });
    draw();
    fireEvent.click(screen.getAllByRole('button', { name: 'New event' })[1]);
    expect(
      screen.getByText(/when this job last ran is unknown/),
    ).toBeInTheDocument();
  });

  it('says the job could not be read in words, never by implying it is fine', () => {
    state.current = mkData({
      reminderJob: {
        status: null,
        isLoading: false,
        isError: true,
        errorMessage: 'Request failed with status code 500',
        refetch: vi.fn(),
      },
    });
    draw();
    expect(screen.getByText(/The reminder job could not be read\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    expect(
      within(screen.getByRole('dialog')).getByText(/Whether reminders are being sent for this/),
    ).toBeInTheDocument();
  });

  it('names the reader\'s own quiet window, and what it does to a reminder', () => {
    state.current = mkData({
      reminderJob: {
        status: reminderStatus({
          viewer: {
            remindersEnabled: true,
            quietHours: { enabled: true, start: '22:00', end: '08:00' },
            usingDefaults: false,
          },
        }),
        isLoading: false,
        isError: false,
        errorMessage: '',
        refetch: vi.fn(),
      },
    });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(/Your quiet hours are 22:00—08:00/)).toBeInTheDocument();
    expect(within(sheet).getByText(/held for you alone until the window closes/)).toBeInTheDocument();
  });

  it('says the job is built but not switched on, rather than implying it is sending', () => {
    state.current = mkData({
      reminderJob: {
        status: reminderStatus({ armed: false, nextRunAt: null }),
        isLoading: false,
        isError: false,
        errorMessage: '',
        refetch: vi.fn(),
      },
    });
    draw();
    expect(screen.getByText(/The reminder job is built but not switched on\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(/CALENDAR_REMINDERS_ENABLED/)).toBeInTheDocument();
    expect(within(sheet).queryByText(/Next run/)).not.toBeInTheDocument();
  });

  it('reports a claim that was never confirmed rather than counting it as sent', () => {
    state.current = mkData({
      reminderJob: {
        status: reminderStatus({ unconfirmed: 2 }),
        isLoading: false,
        isError: false,
        errorMessage: '',
        refetch: vi.fn(),
      },
    });
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'New event' }));
    expect(
      within(screen.getByRole('dialog')).getByText(/claimed and never confirmed/),
    ).toBeInTheDocument();
  });

  it('says when an entry has already been reminded', () => {
    state.current = mkData({
      events: [
        event({
          id: 'e1',
          title: 'Vega Sicilia crate',
          date: '2026-09-17',
          reminderEnabled: true,
          reminderDaysBefore: 1,
          reminderSent: true,
        }),
      ],
    });
    draw();
    fireEvent.click(screen.getByText('Vega Sicilia crate'));
    expect(
      within(screen.getByRole('dialog')).getByText(/reminder has already been sent/),
    ).toBeInTheDocument();
  });
});

/* ── the sky, and what it may claim (ADR 0111 slices 2 and 3) ─────────────── */

describe('CalendarNext — the weather overlay', () => {
  it('draws the issuer’s own numbers, in the issuer’s own unit', () => {
    draw();
    // 75/58 F, exactly what NWS published for MTR/91,89. Not converted, not
    // rounded to a different scale — the number in the cell is the
    // meteorologist's.
    expect(screen.getByText('75°F')).toBeInTheDocument();
    expect(screen.getByText('58°F')).toBeInTheDocument();
  });

  it('puts the issuer and the issue time on every mark', () => {
    // The attribution is not decoration: it is the entire distinction between
    // a citable published forecast and the guess DESIGN-FOUNDATION §6 forbids.
    draw();
    const mark = screen.getByText('75°F').closest('.cn-sky');
    expect(mark).toBeTruthy();
    expect(mark?.getAttribute('title')).toContain('NOAA/NWS');
    expect(mark?.getAttribute('title')).toContain('MTR/91,89');
    expect(mark?.getAttribute('title')).toContain('issued');
  });

  it('names the issuer and the horizon in the standing line', () => {
    draw();
    expect(screen.getByText(/Sky by NOAA\/NWS, 7 days ahead/)).toBeInTheDocument();
  });

  it('says why a cell has no reading, never leaving it blank', () => {
    // A silently empty weather column is indistinguishable from a week of
    // clear skies. Every cell without a reading carries a reason.
    draw();
    const dark = document.querySelectorAll('.cn-sky[data-dark="true"]');
    expect(dark.length).toBeGreaterThan(0);
    expect(dark[0].textContent).toContain('no reading');
    expect(dark[0].getAttribute('title')).toBeTruthy();
  });

  it('prints the gateway’s refusal when the house has no coordinate', () => {
    // The state all fourteen production rows were in on 2026-09-03.
    state.current = mkData({
      weather: weatherWindow({
        readings: [],
        window: {
          coordinate: null,
          refusal:
            'No location is set for this house, so no forecast can be read. Set the address on Settings and the coordinate is captured with it.',
          refusalReason: 'no-coordinate',
          horizonDays: null,
        },
      }),
    });
    draw();
    expect(screen.getByText(/No location is set for this house/)).toBeInTheDocument();
  });

  it('keeps a stale forecast on screen and says how old it is', () => {
    state.current = mkData({
      weather: weatherWindow({
        window: {
          staleReason: 'The weather service answered 503.',
          ageMinutes: 143,
        },
      }),
    });
    draw();
    expect(screen.getByText(/answered 503/)).toBeInTheDocument();
    expect(screen.getByText(/143 minutes ago/)).toBeInTheDocument();
    // and the readings are still drawn — they are real, just old
    expect(screen.getByText('75°F')).toBeInTheDocument();
  });

  it('says the forecast register went dark rather than drawing a clear sky', () => {
    state.current = mkData({
      weather: { ...weatherWindow(), isError: true, errorMessage: 'Network Error', window: null, byDay: null },
    });
    draw();
    expect(
      screen.getByText(/The forecast register could not be read \(Network Error\)/),
    ).toBeInTheDocument();
  });

  it('refuses to imply there is no advisory when the advisory feed failed', () => {
    state.current = mkData({
      weather: weatherWindow({ window: { advisoriesReadable: false } }),
    });
    draw();
    expect(screen.getByText(/only that it does not know/)).toBeInTheDocument();
  });

  it('renders an advisory the issuer actually has in force', () => {
    state.current = mkData({
      weather: weatherWindow({
        window: {
          advisories: [
            {
              headline: 'Heat Advisory issued September 15',
              event: 'Heat Advisory',
              severity: 'Moderate',
              onset: null,
              ends: null,
            },
          ],
        },
      }),
    });
    draw();
    expect(screen.getByText('Heat Advisory')).toBeInTheDocument();
  });

  it('draws the flat hairline when the issuer published no chance of rain', () => {
    // Visibly different from a published 0%, which draws six empty ticks.
    state.current = mkData({
      weather: weatherWindow({ readings: [reading({ precipitationProbability: null })] }),
    });
    draw();
    expect(document.querySelector('.cn-rain[data-none="true"]')).toBeTruthy();
  });
});

describe('CalendarNext — a passed day holds the record', () => {
  it('shows what the ledger recorded beside what was forecast', () => {
    draw();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('covers · recorded')).toBeInTheDocument();
    expect(screen.getByText(/forecast said 75°F, 3d ahead/)).toBeInTheDocument();
  });

  it('never claims an accuracy it cannot compute', () => {
    // No covers model exists (slice 9, gated on 90 observed days) and no
    // temperature observation is recorded anywhere, so the line says so and
    // the cell never prints "out by N".
    draw();
    const mark = screen.getByText('41').closest('.cn-record');
    expect(mark?.getAttribute('title')).toContain('no covers model exists yet');
    expect(document.body.textContent).not.toMatch(/out by/);
  });

  it('renders an em dash, never a zero, when covers were not recorded', () => {
    state.current = mkData({
      record: recordWindow({
        days: [
          reconciled({
            recorded: { covers: null, sales: 3400, checkCount: 12, excluded: false, exclusionReason: null },
            line: 'Covers were not recorded on this day, so the forecast beside it cannot be scored.',
          }),
        ],
      }),
    });
    draw();
    expect(screen.getByText('covers not recorded')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('hatches a day the house was shut instead of drawing it as a zero', () => {
    // A closure counted as zero trading is the most damaging input a demand
    // model can be given.
    state.current = mkData({
      record: recordWindow({
        days: [
          reconciled({
            recorded: { covers: null, sales: null, checkCount: 0, excluded: true, exclusionReason: 'Labor Day' },
            line: 'Closed — Labor Day. Ruled out of the baselines.',
          }),
        ],
      }),
    });
    draw();
    expect(screen.getByText('closed')).toBeInTheDocument();
    expect(screen.getByText('ruled out')).toBeInTheDocument();
    expect(document.querySelector('.cn-cell[data-shut="true"]')).toBeTruthy();
  });

  it('says there is no sales register rather than reporting empty days', () => {
    state.current = mkData({
      record: recordWindow({ days: [], window: { posConnected: false } }),
    });
    draw();
    expect(
      screen.getByText(/No sales register is connected, so a passed day holds no record/),
    ).toBeInTheDocument();
  });

  it('says the ledger went dark when the recorded register refuses', () => {
    state.current = mkData({
      record: recordWindow({
        days: [],
        window: { recordedRefusal: 'The sales register could not be read.' },
      }),
    });
    draw();
    expect(screen.getByText('The sales register could not be read.')).toBeInTheDocument();
  });
});
