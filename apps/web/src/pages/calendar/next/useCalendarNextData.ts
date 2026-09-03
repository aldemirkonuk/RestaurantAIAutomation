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
  color?: string;
  isRecurring: boolean;
  parentEventId?: string;
  occurrenceDate?: string;
  recurrenceRule?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
}

/** The calendar's spine: the event types that describe goods arriving. */
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
   * No `limit` is sent on purpose. `GetCalendarEventsQueryDto.limit` is
   * `@IsInt()` with no `@Type(() => Number)`, and the global ValidationPipe
   * runs `transform: true` WITHOUT `enableImplicitConversion` (main.ts:52-56) —
   * so a query string `limit=500` stays a string, fails `@IsInt`, and the whole
   * read 400s. Measured against the local gateway, 2026-09-02. The server's own
   * default (100 per page, calendar.service.ts:277) therefore applies, and the
   * page reports its `hasMore` rather than quietly drawing a truncated month.
   */
  const eventsQ = useQuery({
    queryKey: ['mudavym', 'calendar', 'events', restaurantId, start, end],
    enabled: !!restaurantId,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiClient.get<{ events: ApiEvent[]; total?: number; hasMore?: boolean }>(
        `/calendar/events?startDate=${start}&endDate=${end}`,
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
