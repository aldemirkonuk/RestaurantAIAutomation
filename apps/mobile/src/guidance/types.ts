export type PageTourId = "dashboard" | "inventory" | "orders";

export type TipStatus = "unseen" | "snoozed" | "dismissed" | "completed";
export type TourStatus = "unseen" | "in_progress" | "completed" | "skipped";

export interface PageGuidanceState {
  tip: TipStatus;
  tour: TourStatus;
  snooze_until?: string;
}

export interface GuidanceState {
  global: {
    hide_all_tips: boolean;
    tips_snoozed_until?: string;
    show_wine_agent_fab: boolean;
    wine_agent_fab_unlocked?: boolean;
  };
  pages: Partial<Record<PageTourId, PageGuidanceState>>;
  guide: {
    use_cards_seen: string[];
  };
}

export const DEFAULT_GUIDANCE_STATE: GuidanceState = {
  global: {
    hide_all_tips: false,
    show_wine_agent_fab: true,
  },
  pages: {},
  guide: {
    use_cards_seen: [],
  },
};

export const PAGE_TOUR_IDS: PageTourId[] = ["dashboard", "inventory", "orders"];

/** expo-router pathname → tour id (providers: Learn-only, no auto tip) */
export const ROUTE_TO_PAGE_TOUR: Record<string, PageTourId> = {
  "/": "dashboard",
  "/cellar": "inventory",
  "/supply": "orders",
};

export const TOUR_LABELS: Record<PageTourId, string> = {
  dashboard: "Today overview",
  inventory: "Cellar command",
  orders: "Supply workflow",
};
