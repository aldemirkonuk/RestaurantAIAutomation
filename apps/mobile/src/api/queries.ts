import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type {
  CalendarEvent,
  FeedResponse,
  InventoryItem,
  ProcurementOrder,
  TodayPulse,
} from "./types";
import { useSession } from "@/state/session";

export const feedKey = ["mobile", "feed"] as const;
export const pulseKey = ["mobile", "pulse"] as const;

function useAuthed() {
  const status = useSession((s) => s.status);
  const restaurantId = useSession((s) => s.user?.restaurantId);
  return { enabled: status === "signedIn", restaurantId };
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
    queryFn: () => {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      return api<TodayPulse>(
        `/mobile/today-pulse?start=${encodeURIComponent(midnight.toISOString())}`,
      );
    },
    enabled,
    refetchInterval: 5 * 60_000,
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

export function useOrder(id: string) {
  const { enabled } = useAuthed();
  return useQuery({
    queryKey: ["orders", "item", id],
    queryFn: () => api<ProcurementOrder>(`/procurement/orders/${id}`),
    enabled: enabled && !!id,
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

/** Monday of the current week, YYYY-MM-DD (the Team domain's week key). */
export function currentWeekStart(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function useTeamWeek() {
  const { enabled, restaurantId } = useAuthed();
  const weekStart = currentWeekStart();
  return useQuery({
    queryKey: ["team", "week", restaurantId, weekStart],
    queryFn: () =>
      api<any>(`/restaurants/${restaurantId}/team/week?weekStart=${weekStart}`),
    enabled: enabled && !!restaurantId,
    refetchInterval: 10 * 60_000,
    retry: false,
  });
}

export function useTeamMembers() {
  const { enabled, restaurantId } = useAuthed();
  return useQuery({
    queryKey: ["team", "members", restaurantId],
    queryFn: async () => {
      const body = await api<any>(`/restaurants/${restaurantId}/team/members`);
      return (body.members ?? body.data ?? body) as any[];
    },
    enabled: enabled && !!restaurantId,
    staleTime: 10 * 60_000,
    retry: false,
  });
}
