/**
 * CalendarNext data — the book for one window of days, read straight from the
 * gateway through the authenticated `apiClient`.
 *
 * Why this page does not reuse `hooks/queries/useCalendarQueries`: those hooks
 * are deliberately forgiving in ways a page built under ADR 0020 cannot be.
 * `useCalendarEvents` returns `[]` on any failure in DEV and silently
 * substitutes an IndexedDB copy otherwise (useCalendarQueries.ts:49-63), and
 * the create/update mutations swallow a real 4xx into a fabricated
 * `{ _pending: true }` "saved offline" success (:147-166). Both turn *absence*
 * into *health*: an empty grid that means "the gateway refused" is
 * indistinguishable from a genuinely quiet month. Here a failure is a failure
 * and the page says which register could not be read.
 *
 * It also does not reuse `services/api/calendar.ts`'s `mapApiEvent`, which
 * drops `eventTimeEnd`, `eventDateEnd`, `orderId`, `source`, `reminderEnabled`
 * and `reminderDaysBefore` on the floor (calendar.ts:64-82) — a calendar that
 * cannot read an event's end time cannot draw it, let alone resize it.
 *
 * Every query is keyed by `activeRestaurantId`, so switching restaurant can
 * never leave the previous tenant's events on screen.
 */

import { useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import { useCalendarEventsSubscription } from '../../../contexts/RealtimeContext';
import { apiClient } from '../../../services/api/client';
import { fetchProviders, type Provider } from '../../../services/api/providers';
import { useOrders } from '../../../hooks/queries/useOrderQueries';
import { canonicalStatus } from '../../../lib/mudavym/status';
import { expandAllRecurringEvents } from '../../../lib/calendar/recurrence';
import type { Order } from '../../../services/api/types';
import { dayKey, rangeFor, type CalView } from './cal-format';

/* ── The gateway's own shape (calendar.dto.ts CalendarEventResponseDto) ───── */

interface ApiEvent {
  id: string;
  restaurantId: string;
  title: string;
  description?: string;
  eventType: string;
  eventDate: string;
  eventDateEnd?: string;
  allDay: boolean;
  eventTime?: string;
  eventTimeEnd?: string;
  providerId?: string;
  orderId?: string;
  source: string;
  status: EventStatus;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
  /** Written by the reminder cron (ADR 0109); false until it has sent. */
  reminderSent?: boolean;
  color?: string;
  isRecurring: boolean;
  parentEventId?: string;
  occurrenceDate?: string;
  recurrenceRule?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * `GET /calendar/reminders/status` — the reminder cron's own account of itself
 * (apps/api-gateway/src/calendar/calendar.controller.ts, route "reminders/status";
 * built in calendar-reminders.service.ts `statusFor`).
 *
 * Four of these fields exist only so the page cannot lie:
 *  - `served` — the cron enumerates opted-in tenants (ADR 0022), so for a house
 *    it does not serve there is no next run to promise. `null` means the opt-in
 *    register itself could not be read.
 *  - `ledgerReadable` — false separates "the run ledger was unreachable" from
 *    "this job has never run", which are the same empty `lastRun` otherwise.
 *  - `unconfirmed` — rows claimed and never confirmed: a crash between claim and
 *    send. Never folded into `sent`.
 *  - `granularity` — the column is INTEGER days, so the sheet must not offer
 *    minutes.
 */
export interface ReminderJobStatus {
  jobName: string;
  cronExpression: string;
  intervalMinutes: number;
  lookaheadDays: number;
  granularity: 'days';
  served: boolean | null;
  servedReason: string | null;
  /**
   * The env switch `CALENDAR_REMINDERS_ENABLED`. OFF by default: the job writes
   * real inbox rows and phone pushes, so it is not gated on the page's design
   * flag. `served: true, armed: false` is a real state — this house would be
   * served and nothing is being sent — and the page must say so.
   */
  armed: boolean;
  armedFlag: string;
  timeZone: string | null;
  ledgerReadable: boolean;
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    considered: number;
    sent: number;
    deferredQuietHours: number;
    expired: number;
    failed: number;
    truncated: boolean;
    error: string | null;
  } | null;
  nextRunAt: string | null;
  unconfirmed: number | null;
  pending: number | null;
  deliveredToMe: number | null;
  viewer: {
    remindersEnabled: boolean;
    quietHours: { enabled: boolean; start: string; end: string };
    usingDefaults: boolean;
  };
}

/**
 * `GET /calendar/weather?from&to` — the published forecast for this house's own
 * coordinate (`apps/api-gateway/src/calendar/calendar.controller.ts` route
 * "weather"; built in `weather/weather.service.ts` `windowFor`).
 *
 * Three fields exist only so the grid cannot lie about the sky:
 *  - `refusal` — the whole overlay is dark and this is the sentence that says
 *    why. An empty `readings` list with a null refusal is a real "the issuer
 *    published nothing for these dates"; with a refusal it is a failure, and
 *    they must never draw the same.
 *  - `staleReason` — the readings below are real but old, because the refresh
 *    failed. The cells still draw; the page says how old.
 *  - `horizonDays` — NWS publishes seven days, not sixteen. A cell past the
 *    horizon says "beyond the forecast" rather than looking broken.
 */
export interface WeatherReading {
  businessDate: string;
  issuer: string;
  issuerDetail: string | null;
  issuedAt: string;
  fetchedAt: string;
  validFrom: string;
  validTo: string;
  temperatureHigh: number | null;
  temperatureLow: number | null;
  /** The ISSUER's own unit, unconverted. NWS publishes F for US locations. */
  temperatureUnit: 'C' | 'F';
  /** Percent, or null where the issuer published none — never 0. */
  precipitationProbability: number | null;
  precipitationAmountMm: number | null;
  windSummary: string | null;
  shortForecast: string | null;
}

export interface WeatherAdvisory {
  headline: string;
  event: string;
  severity: string | null;
  onset: string | null;
  ends: string | null;
}

export interface WeatherWindow {
  from: string;
  to: string;
  coordinate: { latitude: number; longitude: number } | null;
  readings: WeatherReading[];
  forecastInAdvance: WeatherReading[];
  refusal: string | null;
  refusalReason:
    | 'no-coordinate'
    | 'outside-coverage'
    | 'issuer-unreachable'
    | 'issuer-refused'
    | 'issuer-malformed'
    | 'store-unreadable'
    | null;
  staleReason: string | null;
  ageMinutes: number | null;
  issuer: string;
  horizonDays: number | null;
  advisories: WeatherAdvisory[];
  advisoriesReadable: boolean;
}

/**
 * `GET /calendar/day-record?from&to` — what each PASSED day held, and the
 * forecast that stood before it began (ADR 0111 slice 3).
 *
 * `recorded.covers` is `null`, never 0, when no check on the day carried a
 * cover count: a POS that does not send them and a night nobody came are
 * different facts. `line` is the sentence the cell prints, built by the
 * gateway so the page cannot soften it.
 */
export interface ReconciledDay {
  businessDate: string;
  recorded: {
    covers: number | null;
    sales: number | null;
    checkCount: number;
    excluded: boolean;
    exclusionReason: string | null;
  } | null;
  forecastInAdvance: {
    issuer: string;
    issuedAt: string;
    leadDays: number;
    temperatureHigh: number | null;
    temperatureLow: number | null;
    temperatureUnit: 'C' | 'F';
    precipitationProbability: number | null;
    shortForecast: string | null;
  } | null;
  /**
   * What the nearest station actually MEASURED on this day (added 2026-09-04).
   * Null when no station reported it.
   */
  observed: {
    stationId: string;
    stationName: string | null;
    observationCount: number;
    temperatureHigh: number | null;
    temperatureLow: number | null;
    temperatureUnit: 'C' | 'F';
    precipitationTotalMm: number | null;
  } | null;
  /**
   * The forecast's error on this day: absolute degrees CELSIUS between the
   * forecast high and the observed high. **Lower is better** — it is an error,
   * not a goodness. Null when either side is missing.
   */
  forecastErrorC: number | null;
  /** Why there is no score, in the gateway's own words. Null when there is one. */
  scoreWithheld: string | null;
  /**
   * The sentence the cell prints. Built by the gateway so the page cannot
   * soften it; it already carries the error when there is one.
   */
  line: string;
}

export interface DayRecordWindow {
  from: string;
  to: string;
  days: ReconciledDay[];
  posConnected: boolean;
  recordedRefusal: string | null;
  weatherRefusal: string | null;
  pairsWritten: number;
}

export type EventStatus = 'pending' | 'approved' | 'dismissed' | 'completed' | 'cancelled';

export interface EventTypeRow {
  id: string;
  name: string;
  color: string;
  icon?: string;
  /** The gateway's own field name — the eight built-ins are `true` (calendar.service.ts:799-856). */
  isDefault: boolean;
}

export interface CalEvent {
  /** Display id — for a virtual occurrence this is `<seriesId>__occ_<date>`. */
  id: string;
  /** The row the gateway will actually mutate. */
  seriesId: string;
  /** True when this row is a client-expanded occurrence of a recurring series. */
  isOccurrence: boolean;
  title: string;
  description: string | null;
  type: string;
  /** Local `YYYY-MM-DD`. */
  date: string;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  allDay: boolean;
  status: EventStatus;
  providerId: string | null;
  orderId: string | null;
  source: string;
  color: string | null;
  isRecurring: boolean;
  /** The gateway's rule, passed through verbatim for client-side expansion. */
  recurrenceRule?: Record<string, unknown>;
  reminderEnabled: boolean;
  reminderDaysBefore: number | null;
  /**
   * True once the server job has sent this entry's reminder. Until 2026-09-03
   * this column had no writer at all (calendar.service.ts:1118 read it and
   * nothing wrote it); the sheet now shows it so an operator can tell a
   * reminder that went out from one still waiting.
   */
  reminderSent: boolean;
}

/** The calendar's spine: the event types that describe goods arriving. */
/**
 * The largest page the gateway will serve: `GetCalendarEventsQueryDto.limit`
 * carries `@Max(500)` (apps/api-gateway/src/calendar/dto/calendar.dto.ts:356).
 */
const EVENT_WINDOW_LIMIT = 500;

const DELIVERY_TYPES = new Set(['delivery', 'delivery_eta', 'order']);

/** An order the orders book says has landed. `partially_received` has not. */
const ARRIVED = new Set(['delivered', 'verified', 'completed']);

export function isDelivery(e: CalEvent): boolean {
  return DELIVERY_TYPES.has(e.type);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function toCalEvent(raw: ApiEvent): CalEvent {
  return {
    id: raw.id,
    seriesId: raw.id,
    isOccurrence: false,
    title: raw.title,
    description: str(raw.description),
    type: raw.eventType,
    date: String(raw.eventDate).split('T')[0],
    endDate: raw.eventDateEnd ? String(raw.eventDateEnd).split('T')[0] : null,
    startTime: str(raw.eventTime),
    endTime: str(raw.eventTimeEnd),
    allDay: !!raw.allDay,
    status: raw.status ?? 'pending',
    providerId: str(raw.providerId),
    orderId: str(raw.orderId),
    source: raw.source ?? 'manual',
    color: str(raw.color),
    isRecurring: !!raw.isRecurring,
    recurrenceRule: raw.recurrenceRule,
    reminderEnabled: !!raw.reminderEnabled,
    reminderSent: raw.reminderSent === true,
    reminderDaysBefore:
      typeof raw.reminderDaysBefore === 'number' && Number.isFinite(raw.reminderDaysBefore)
        ? raw.reminderDaysBefore
        : null,
  };
}

/** HTTP status of a rejected apiClient call, when there is one. */
function statusOf(err: unknown): number | null {
  const r = (err as { response?: { status?: number } } | null)?.response;
  return typeof r?.status === 'number' ? r.status : null;
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'unknown error';
}

export interface CalendarPayload {
  title: string;
  eventType: string;
  eventDate: string;
  eventDateEnd?: string;
  allDay?: boolean;
  eventTime?: string;
  eventTimeEnd?: string;
  providerId?: string;
  orderId?: string;
  status?: EventStatus;
  description?: string;
  color?: string;
  reminderEnabled?: boolean;
  reminderDaysBefore?: number;
  recurrence?: {
    frequency: string;
    interval: number;
    daysOfWeek?: number[];
    endType: string;
    endAfterCount?: number;
    endOnDate?: string;
  };
}

/**
 * `PATCH /calendar/events/:id` accepts a strict whitelist —
 * UpdateCalendarEventDto (calendar.dto.ts:229-296) has **no** `providerId`,
 * `orderId` or `recurrence`, and the gateway runs `forbidNonWhitelisted`.
 * Sending one 400s the whole edit, so the vendor link and the repeat rule are
 * create-time only; the sheet says so rather than offering a control that
 * throws.
 */
const UPDATABLE = [
  'title',
  'description',
  'eventType',
  'eventDate',
  'eventDateEnd',
  'allDay',
  'eventTime',
  'eventTimeEnd',
  'status',
  'reminderEnabled',
  'reminderDaysBefore',
  'color',
] as const;

export function updatablePart(patch: Partial<CalendarPayload>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of UPDATABLE) {
    const v = (patch as Record<string, unknown>)[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export interface CalendarFilter {
  /** Free text over title, note and vendor name. */
  q?: string;
  /** One `eventType` value, or '' for every type. */
  type?: string;
}

export function useCalendarNextData(view: CalView, cursor: Date, filter: CalendarFilter = {}) {
  const { activeRestaurantId } = useAuth();
  const restaurantId = activeRestaurantId ?? '';
  const qc = useQueryClient();
  const { start, end } = useMemo(() => rangeFor(view, cursor), [view, cursor]);

  /**
   * The window asks for the page maximum, 500. This used to be impossible:
   * `GetCalendarEventsQueryDto.limit` was `@IsInt()` with no
   * `@Type(() => Number)`, and the global ValidationPipe runs `transform: true`
   * WITHOUT `enableImplicitConversion` (main.ts:51-57), so any `?limit=` stayed
   * a string, failed `@IsInt` and 400d the whole read. Fixed 2026-09-03 in
   * `apps/api-gateway/src/calendar/dto/calendar.dto.ts:328-359`; verified live
   * against the local gateway (`?limit=50` and `?limit=500` → 200, `?limit=abc`
   * and `?limit=501` → 400).
   *
   * 500 is `@Max(500)` — the server will not serve a larger page — so a month
   * denser than 500 events is still possible in principle. The page keeps
   * reporting the server's `hasMore` rather than quietly drawing a truncated
   * month; it does not silently paginate.
   */
  const eventsQ = useQuery({
    queryKey: ['mudavym', 'calendar', 'events', restaurantId, start, end],
    enabled: !!restaurantId,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiClient.get<{ events: ApiEvent[]; total?: number; hasMore?: boolean }>(
        `/calendar/events?startDate=${start}&endDate=${end}&limit=${EVENT_WINDOW_LIMIT}`,
      );
      return {
        rows: (res.data?.events ?? []).map(toCalEvent),
        total: typeof res.data?.total === 'number' ? res.data.total : null,
        hasMore: res.data?.hasMore === true,
      };
    },
  });

  const typesQ = useQuery({
    queryKey: ['mudavym', 'calendar', 'event-types', restaurantId],
    enabled: !!restaurantId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await apiClient.get<EventTypeRow[]>(`/calendar/event-types/${restaurantId}`);
      return res.data ?? [];
    },
  });

  const providersQ = useQuery({
    queryKey: ['mudavym', 'calendar', 'providers', restaurantId],
    enabled: !!restaurantId,
    staleTime: 5 * 60_000,
    queryFn: () => fetchProviders(restaurantId),
  });

  /**
   * The reminder job's status. Its own query rather than a field on the events
   * read, because it must survive an events failure: a page whose calendar read
   * 500s still has to be able to say whether reminders are being sent.
   * `staleTime` is one interval — asking more often than the job runs tells the
   * reader nothing new.
   */
  const reminderQ = useQuery({
    queryKey: ['mudavym', 'calendar', 'reminder-status', restaurantId],
    enabled: !!restaurantId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async () => {
      const res = await apiClient.get<ReminderJobStatus>('/calendar/reminders/status');
      return res.data;
    },
  });

  /**
   * The weather overlay (ADR 0111 slice 2).
   *
   * Its own query, keyed on the window, so a calendar read that 500s still
   * leaves the sky readable and vice versa. `staleTime` is 15 minutes against a
   * gateway max age of 60: asking more often than the issuer republishes tells
   * the reader nothing, and the gateway will not call NWS again inside the hour
   * anyway — it answers from the register it kept.
   */
  const weatherQ = useQuery({
    queryKey: ['mudavym', 'calendar', 'weather', restaurantId, start, end],
    enabled: !!restaurantId,
    staleTime: 15 * 60_000,
    queryFn: async () => {
      const res = await apiClient.get<WeatherWindow>(
        `/calendar/weather?from=${start}&to=${end}`,
      );
      return res.data;
    },
  });

  /**
   * What the passed days in this window actually held (ADR 0111 slice 3).
   *
   * Separate from the weather read even though the gateway composes both,
   * because the two registers refuse separately: "no POS is connected" and "no
   * location is set" are different sentences and a cell prints a different one
   * for each.
   */
  const recordQ = useQuery({
    queryKey: ['mudavym', 'calendar', 'day-record', restaurantId, start, end],
    enabled: !!restaurantId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await apiClient.get<DayRecordWindow>(
        `/calendar/day-record?from=${start}&to=${end}`,
      );
      return res.data;
    },
  });

  const ordersQ = useOrders();

  /** Anything else in the app moving a calendar row refreshes this window. */
  useCalendarEventsSubscription(
    useCallback(() => {
      void eventsQ.refetch();
    }, [eventsQ]),
  );

  /* ── The window, with recurring series expanded into their occurrences ──── */

  const events: CalEvent[] = useMemo(() => {
    const rows = eventsQ.data?.rows;
    if (!rows) return [];
    // The shared expander (lib/calendar/recurrence.ts) reads `recurrenceRule`
    // and stamps each occurrence with `isVirtualOccurrence` + `parentEventId`.
    const expanded = expandAllRecurringEvents(
      rows as unknown as Array<Record<string, unknown> & { id: string; title: string; date: string }>,
      start,
      end,
    ) as unknown as Array<
      CalEvent & { isVirtualOccurrence?: boolean; parentEventId?: string }
    >;
    return expanded.map((e) => ({
      ...e,
      date: typeof e.date === 'string' ? e.date : dayKey(e.date as unknown as Date),
      seriesId: e.isVirtualOccurrence ? (e.parentEventId ?? e.seriesId) : e.seriesId,
      isOccurrence: !!e.isVirtualOccurrence,
    }));
  }, [eventsQ.data, start, end]);

  const providersById = useMemo(() => {
    const rows = providersQ.data;
    if (!rows) return null;
    return new Map<string, Provider>(rows.map((p) => [p.id, p]));
  }, [providersQ.data]);

  const ordersById = useMemo(() => {
    const rows = ordersQ.data;
    if (!rows) return null;
    return new Map<string, Order>(rows.map((o) => [o.id, o]));
  }, [ordersQ.data]);

  /**
   * Ruled off — the account for this line is settled. Two honest sources, and
   * only two: the calendar's own `completed` status, and (when the orders book
   * has answered) a linked order the book says arrived. While the orders book
   * is unknown, only the first can rule a line off, and the page says so.
   */
  const isRuledOff = useCallback(
    (e: CalEvent): boolean => {
      if (e.status === 'completed') return true;
      if (!e.orderId || !ordersById) return false;
      const order = ordersById.get(e.orderId);
      return !!order && ARRIVED.has(canonicalStatus(order.status));
    },
    [ordersById],
  );

  /**
   * The search box and the type picker narrow what is DRAWN, never what was
   * read — `events` above stays the honest window, so the counts in the
   * standing line and the "N hidden by the filter" note both come from it.
   */
  const q = (filter.q ?? '').trim().toLowerCase();
  const typeFilter = filter.type ?? '';
  const shown = useMemo(() => {
    if (!q && !typeFilter) return events;
    return events.filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false;
      if (!q) return true;
      const vendor = e.providerId ? (providersById?.get(e.providerId)?.name ?? '') : '';
      return `${e.title} ${e.description ?? ''} ${vendor}`.toLowerCase().includes(q);
    });
  }, [events, q, typeFilter, providersById]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of shown) {
      const list = m.get(e.date);
      if (list) list.push(e);
      else m.set(e.date, [e]);
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        return (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99');
      });
    }
    return m;
  }, [shown]);

  /**
   * One lookup per cell. Built from the gateway's own arrays rather than
   * re-derived: the newest-per-day rule lives server-side (weather.service.ts
   * `newestPerDay`) so the grid and the register can never disagree about which
   * issuance a day is showing.
   */
  const weatherByDay = useMemo(() => {
    const rows = weatherQ.data?.readings;
    if (!rows) return null;
    return new Map<string, WeatherReading>(rows.map((r) => [r.businessDate, r]));
  }, [weatherQ.data]);

  const recordByDay = useMemo(() => {
    const rows = recordQ.data?.days;
    if (!rows) return null;
    return new Map<string, ReconciledDay>(rows.map((r) => [r.businessDate, r]));
  }, [recordQ.data]);

  /* ── Mutations ─────────────────────────────────────────────────────────── */

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['mudavym', 'calendar'] });
  }, [qc]);

  const create = useMutation({
    mutationFn: async (payload: CalendarPayload) => {
      const res = await apiClient.post<ApiEvent>('/calendar/events', payload);
      return toCalEvent(res.data);
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CalendarPayload> }) => {
      const res = await apiClient.patch<ApiEvent>(`/calendar/events/${id}`, updatablePart(patch));
      return toCalEvent(res.data);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async ({ id, scope }: { id: string; scope?: 'this' | 'all' }) => {
      await apiClient.delete(`/calendar/events/${id}${scope === 'all' ? '?scope=all' : ''}`);
    },
    onSuccess: invalidate,
  });

  const createType = useMutation({
    mutationFn: async (row: { name: string; color: string }) => {
      const res = await apiClient.post<EventTypeRow>('/calendar/event-types', {
        restaurantId,
        name: row.name,
        color: row.color,
        icon: 'tag',
      });
      return res.data;
    },
    onSuccess: invalidate,
  });

  const deleteType = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/calendar/event-types/${id}`);
    },
    onSuccess: invalidate,
  });

  /* ── What the page is allowed to claim ─────────────────────────────────── */

  const eventsError = eventsQ.error;
  const forbidden = statusOf(eventsError) === 403;

  return {
    /** Window bounds actually requested — quoted in the error line. */
    start,
    end,
    events,
    shown,
    /** Rows the filter is holding back — never silently dropped. */
    hiddenByFilter: events.length - shown.length,
    byDay,
    /** undefined until the first answer; the grid draws days either way. */
    hasEvents: eventsQ.data !== undefined,
    /** The gateway paged this window — say so rather than draw a short month. */
    truncated: eventsQ.data?.hasMore === true,
    windowTotal: eventsQ.data?.total ?? null,
    isLoading: eventsQ.isLoading,
    isError: eventsQ.isError,
    forbidden,
    errorMessage: messageOf(eventsError),
    noRestaurant: !restaurantId,
    refetch: () => {
      void eventsQ.refetch();
      void typesQ.refetch();
      void providersQ.refetch();
      void reminderQ.refetch();
      void weatherQ.refetch();
      void recordQ.refetch();
    },

    /**
     * The server-side reminder job. `status` is null until the gateway answers;
     * `isError` is the branch that must render words, because a reminder page
     * that cannot read the job must not imply the job is fine.
     */
    reminderJob: {
      status: reminderQ.data ?? null,
      isLoading: reminderQ.isLoading,
      isError: reminderQ.isError,
      errorMessage: messageOf(reminderQ.error),
      refetch: () => {
        void reminderQ.refetch();
      },
    },

    /**
     * The sky over this window, and the record of the days that have passed.
     *
     * `byDay` is the newest issuance for each date; `recordByDay` the passed
     * days' reconciliation. Both are Maps so a cell is one lookup, and both are
     * `null`-when-unknown rather than empty-when-unknown: `isError` on either
     * makes the page say which register went dark, never draw a clear sky.
     */
    weather: {
      window: weatherQ.data ?? null,
      byDay: weatherByDay,
      isLoading: weatherQ.isLoading,
      isError: weatherQ.isError,
      errorMessage: messageOf(weatherQ.error),
    },
    record: {
      window: recordQ.data ?? null,
      byDay: recordByDay,
      isLoading: recordQ.isLoading,
      isError: recordQ.isError,
      errorMessage: messageOf(recordQ.error),
    },

    eventTypes: typesQ.data ?? [],
    typesKnown: typesQ.data !== undefined,
    providersById,
    providerList: providersQ.data ?? [],
    providersKnown: providersById !== null,
    ordersById,
    ordersKnown: ordersById !== null,
    isRuledOff,

    create,
    update,
    remove,
    createType,
    deleteType,
  };
}

export type CalendarData = ReturnType<typeof useCalendarNextData>;
