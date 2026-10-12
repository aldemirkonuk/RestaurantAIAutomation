import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api, ApiError } from "./client";
import type {
  AppNotification,
  CalendarEvent,
  FeedResponse,
  InventoryItem,
  NotificationPage,
  ProcurementOrder,
  TodayPulse,
} from "./types";
import { useSession } from "@/state/session";
import { addDaysToKey, houseDateKey, mondayOfKey } from "@/lib/houseDate";
import type { HouseSummary } from "@/auth/houseChoice";
import { houseFrameOfPulse, type HouseMoneyFrame } from "@/lib/houseMoney";
import { readsHouseGoals } from "@/components/today/pulseStripView";

export const feedKey = ["mobile", "feed"] as const;
export const pulseKey = ["mobile", "pulse"] as const;
export const notificationsKey = ["notifications"] as const;

function useAuthed() {
  const status = useSession((s) => s.status);
  const restaurantId = useSession((s) => s.user?.restaurantId);
  const userId = useSession((s) => s.user?.id);
  return { enabled: status === "signedIn", restaurantId, userId };
}

export function useFeed() {
  const { enabled } = useAuthed();
  return useQuery({
    queryKey: [...feedKey],
    queryFn: () => api<FeedResponse>("/mobile/feed"),
    enabled,
    refetchInterval: 60_000,
  });
}

export function useTodayPulse() {
  const { enabled } = useAuthed();
  return useQuery({
    queryKey: [...pulseKey],
    // "Tonight" is the house's night, read on the house's clock by the
    // gateway (F-674) — not this phone's midnight.
    queryFn: () => api<TodayPulse>("/mobile/today-pulse"),
    enabled,
    refetchInterval: 5 * 60_000,
  });
}

/**
 * The house's money and formats tag, read off the pulse (F-885), so every
 * money figure on the phone prints the house's way, and its zone, so dates
 * are the house's days (F-1029). Unknown until the pulse answers: a figure
 * with no symbol, never a dollar; a date in the phone's zone.
 */
export function useHouseMoneyFrame(): HouseMoneyFrame {
  const { data } = useTodayPulse();
  return houseFrameOfPulse(data);
}

/** The houses this person belongs to (the chooser's list; F-675). */
export function useHouses() {
  const { enabled, userId } = useAuthed();
  return useQuery({
    queryKey: ["auth", "houses", userId],
    queryFn: async () => {
      const body = await api<{ houses?: HouseSummary[] }>("/auth/houses");
      return Array.isArray(body.houses) ? body.houses : [];
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Whole cellar in one list; search/filter happens client-side like web. */
export function useInventory() {
  const { enabled, restaurantId } = useAuthed();
  return useQuery({
    queryKey: ["inventory", "list", restaurantId],
    queryFn: async () => {
      const body = await api<any>(`/inventory/${restaurantId}`);
      return (body.items ?? body.data ?? body) as InventoryItem[];
    },
    enabled: enabled && !!restaurantId,
  });
}

export function useInventoryItem(itemId: string) {
  const { enabled, restaurantId } = useAuthed();
  return useQuery({
    queryKey: ["inventory", "item", itemId],
    queryFn: async () => {
      const body = await api<any>(`/inventory/${restaurantId}/item/${itemId}`);
      return (body.item ?? body.data ?? body) as InventoryItem;
    },
    enabled: enabled && !!restaurantId && !!itemId,
  });
}

/** 14-day depletion series + busy-hours heatmap for the detail page. */
export function useItemActivity(itemId: string) {
  const { enabled, restaurantId } = useAuthed();
  return useQuery({
    queryKey: ["inventory", "activity", itemId],
    queryFn: () => api<any>(`/inventory/${restaurantId}/item/${itemId}/activity`),
    enabled: enabled && !!restaurantId && !!itemId,
    staleTime: 10 * 60_000,
  });
}

export function useInventorySummary() {
  const { enabled, restaurantId } = useAuthed();
  return useQuery({
    queryKey: ["inventory", "summary", restaurantId],
    queryFn: () => api<any>(`/inventory/${restaurantId}/summary`),
    enabled: enabled && !!restaurantId,
    staleTime: 5 * 60_000,
  });
}

export function usePendingOrders() {
  const { enabled } = useAuthed();
  return useQuery({
    queryKey: ["orders", "pending"],
    queryFn: () => api<ProcurementOrder[]>("/procurement/orders/pending"),
    enabled,
  });
}

export function useOrderHistory() {
  const { enabled } = useAuthed();
  return useQuery({
    queryKey: ["orders", "history"],
    queryFn: async () => {
      const body = await api<any>("/procurement/orders/history?limit=50");
      return (body.orders ?? body.items ?? body) as ProcurementOrder[];
    },
    enabled,
  });
}

/**
 * An order this phone already holds from its order lists (F-1409), or
 * undefined. "Count it" on a delivery the phone never opened fetched the order
 * alone and, with no signal, showed nothing to count; the pending list is
 * saved on the phone and carries the same order.
 */
export function orderFromLists(
  qc: QueryClient,
  id: string,
): ProcurementOrder | undefined {
  for (const key of [
    ["orders", "pending"],
    ["orders", "history"],
  ]) {
    const list = qc.getQueryData<ProcurementOrder[]>(key);
    const hit = Array.isArray(list)
      ? list.find((o) => o?.id === id)
      : undefined;
    if (hit) return hit;
  }
  return undefined;
}

/** True when the house gave no answer at all: no signal, not a refusal. */
export function noAnswer(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    (error.body as { reason?: unknown } | undefined)?.reason ===
      "refresh_not_reached"
  );
}

/** An order the phone never loaded, asked for with no signal (F-1409). */
export const NEVER_LOADED_WORDS =
  "This delivery was never opened on this phone, so it cannot be shown without signal. Count it once the phone has signal again.";

export function useOrder(id: string) {
  const { enabled } = useAuthed();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["orders", "item", id],
    queryFn: () => api<ProcurementOrder>(`/procurement/orders/${id}`),
    enabled: enabled && !!id,
    // Seeded from the lists and marked stale, so it is fetched again at once
    // and the list's copy only stands in while there is no answer.
    initialData: () => orderFromLists(qc, id),
    initialDataUpdatedAt: 0,
  });
}

export function useOrderConversations(orderId: string) {
  const { enabled } = useAuthed();
  return useQuery({
    queryKey: ["orders", "conversations", orderId],
    queryFn: async () => {
      const body = await api<any>(`/procurement/orders/${orderId}/conversations`);
      return (body.conversations ?? body) as any[];
    },
    enabled: enabled && !!orderId,
  });
}

export function useTodaySchedule() {
  const { enabled } = useAuthed();
  return useQuery({
    queryKey: ["calendar", "today"],
    queryFn: async () => {
      const body = await api<any>("/calendar/today");
      return (body.events ?? body.data ?? body) as CalendarEvent[];
    },
    enabled,
    refetchInterval: 10 * 60_000,
  });
}

export function useUpcomingSchedule() {
  const { enabled } = useAuthed();
  return useQuery({
    queryKey: ["calendar", "upcoming"],
    queryFn: async () => {
      const body = await api<any>("/calendar/upcoming");
      return (body.events ?? body.data ?? body) as CalendarEvent[];
    },
    enabled,
  });
}

/**
 * Monday of the house's current week, YYYY-MM-DD (the Team domain's week key).
 * Read in the house's zone once a week reply has named it (F-252).
 */
export function currentWeekStart(timeZone?: string | null): string {
  return mondayOfKey(houseDateKey(new Date(), timeZone));
}

/** The full rota: owners and managers only (`assertAccess(..., "manager")`). */
export function useTeamWeek(timeZone: string | null, allowed: boolean, weeksBack = 0) {
  const { enabled, restaurantId } = useAuthed();
  const weekStart = addDaysToKey(currentWeekStart(timeZone), -7 * weeksBack);
  return useQuery({
    queryKey: ["team", "week", restaurantId, weekStart],
    queryFn: () =>
      api<any>(`/restaurants/${restaurantId}/team/week?weekStart=${weekStart}`),
    enabled: enabled && !!restaurantId && allowed,
    refetchInterval: 10 * 60_000,
    retry: false,
  });
}

/**
 * The caller's own shifts this week, open to every role (F-251). `weeksBack`
 * reads an earlier week: a Monday's "tonight" still holds Sunday's late shift
 * (F-1075).
 */
export function useMyTeamWeek(timeZone: string | null, allowed: boolean, weeksBack = 0) {
  const { enabled, restaurantId } = useAuthed();
  const weekStart = addDaysToKey(currentWeekStart(timeZone), -7 * weeksBack);
  return useQuery({
    queryKey: ["team", "my-week", restaurantId, weekStart],
    queryFn: () =>
      api<any>(`/restaurants/${restaurantId}/team/my-week?weekStart=${weekStart}`),
    enabled: enabled && !!restaurantId && allowed,
    refetchInterval: 10 * 60_000,
    retry: false,
  });
}

export function useTeamMembers(allowed: boolean) {
  const { enabled, restaurantId } = useAuthed();
  return useQuery({
    queryKey: ["team", "members", restaurantId],
    queryFn: async () => {
      const body = await api<any>(`/restaurants/${restaurantId}/team/members`);
      return (body.members ?? body.data ?? body) as any[];
    },
    enabled: enabled && !!restaurantId && allowed,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Notification inbox
//
// The gateway's notifications controller is JWT-guarded but still takes the
// user id as a query param (notifications.controller.ts:83-95) — the same
// contract the web client uses (apps/web/src/services/api/notifications.ts:102).
// Mobile follows it rather than inventing a second shape.
// ---------------------------------------------------------------------------

export type InboxFilter = "unread" | "read" | "archived";

export function useNotifications(filter: InboxFilter) {
  const { enabled, restaurantId, userId } = useAuthed();
  return useQuery({
    queryKey: [...notificationsKey, "list", userId, restaurantId, filter],
    queryFn: async () => {
      const params = new URLSearchParams({
        userId: String(userId),
        status: filter,
        limit: "50",
      });
      if (restaurantId) params.set("restaurantId", restaurantId);
      const body = await api<NotificationPage | AppNotification[]>(
        `/notifications?${params.toString()}`,
      );
      return Array.isArray(body) ? body : (body.data ?? []);
    },
    enabled: enabled && !!userId,
    refetchInterval: 2 * 60_000,
    retry: false,
  });
}

export function useUnreadCount() {
  const { enabled, restaurantId, userId } = useAuthed();
  return useQuery({
    queryKey: [...notificationsKey, "unread-count", userId, restaurantId],
    queryFn: async () => {
      const params = new URLSearchParams({ userId: String(userId) });
      if (restaurantId) params.set("restaurantId", restaurantId);
      const body = await api<{ count: number }>(
        `/notifications/unread/count?${params.toString()}`,
      );
      return Number(body?.count ?? 0);
    },
    enabled: enabled && !!userId,
    refetchInterval: 2 * 60_000,
    retry: false,
  });
}

/**
 * Inbox mutations. Deliberately *not* routed through the outbox: unlike an
 * order approval, marking something read has no business consequence worth
 * replaying days later, and a queued archive that lands after the row is gone
 * is noise. The inbox screen says when one did not go through (F-1410), and
 * the list refetches.
 */
export function useNotificationActions() {
  const qc = useQueryClient();
  const { restaurantId, userId } = useAuthed();
  const settle = () => {
    qc.invalidateQueries({ queryKey: [...notificationsKey] });
    qc.invalidateQueries({ queryKey: [...feedKey] });
  };

  const markRead = useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${id}/read`, { method: "PATCH" }),
    onSettled: settle,
  });

  const markUnread = useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${id}/unread`, { method: "PATCH" }),
    onSettled: settle,
  });

  const archive = useMutation({
    mutationFn: (id: string) =>
      api(`/notifications/${id}/archive`, { method: "PATCH" }),
    onSettled: settle,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}`, { method: "DELETE" }),
    onSettled: settle,
  });

  const markAllRead = useMutation({
    mutationFn: () => {
      const params = new URLSearchParams({ userId: String(userId) });
      if (restaurantId) params.set("restaurantId", restaurantId);
      return api(`/notifications/read/all?${params.toString()}`, {
        method: "PATCH",
      });
    },
    onSettled: settle,
  });

  return { markRead, markUnread, archive, remove, markAllRead };
}

// ---------------------------------------------------------------------------
// Analytics insight engine — plain-language conclusions + goals
// ---------------------------------------------------------------------------

export interface InsightSentence {
  sentence: string;
  category: string;
  score: number;
}

/** Top plain-language insights (stored feed; server computes on cold start). */
export function useInsightFeed() {
  const { enabled, restaurantId } = useAuthed();
  return useQuery({
    queryKey: ["analytics", "insights", restaurantId],
    queryFn: async () => {
      const body = await api<any>(
        `/analytics/insights/${restaurantId}?limit=12`,
      );
      const rows: any[] = body.insights ?? [];
      return rows
        .map((r) => ({
          sentence: r.sentence,
          category: r.category,
          score: Number(r.score ?? 0),
        }))
        .filter((r) => r.sentence) as InsightSentence[];
    },
    enabled: enabled && !!restaurantId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useGoals() {
  const { enabled, restaurantId } = useAuthed();
  // Goals are kept for owners and managers (F-1181); other roles never ask.
  const readsGoals = readsHouseGoals(useSession((s) => s.user?.role));
  return useQuery({
    queryKey: ["analytics", "goals", restaurantId],
    queryFn: () => api<any[]>(`/analytics/goals/${restaurantId}`),
    enabled: enabled && !!restaurantId && readsGoals,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * Progress for every active goal, recomputed (F-1304). The list's stored
 * `current_value` is refreshed only by the hourly sweep, so a bar is never
 * drawn off it; each entry carries progressPct, pace and levers, or says the
 * goal could not be read.
 */
export function useGoalsProgress() {
  const { enabled, restaurantId } = useAuthed();
  const readsGoals = readsHouseGoals(useSession((s) => s.user?.role));
  return useQuery({
    queryKey: ["analytics", "goals-progress", restaurantId],
    queryFn: () => api<any>(`/analytics/goals/${restaurantId}/progress`),
    enabled: enabled && !!restaurantId && readsGoals,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
