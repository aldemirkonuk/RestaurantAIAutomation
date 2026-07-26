import type { PageTourId } from "./types";

export interface TipDefinition {
  pageId: PageTourId;
  title: string;
  body: string;
}

export interface TourStep {
  title: string;
  description: string;
}

export const TIP_REGISTRY: Record<PageTourId, TipDefinition> = {
  dashboard: {
    pageId: "dashboard",
    title: "Today",
    body: "Your decision feed — act on stock risk and orders without hunting menus.",
  },
  inventory: {
    pageId: "inventory",
    title: "Cellar",
    body: "See stock, low bottles, and open a wine for counts or reorder.",
  },
  orders: {
    pageId: "orders",
    title: "Supply",
    body: "Track open POs from approval through delivery.",
  },
};

export const TOUR_REGISTRY: Record<PageTourId, TourStep[]> = {
  dashboard: [
    {
      title: "Pulse strip",
      description: "Quick vitals for the shift — what needs attention first.",
    },
    {
      title: "Decision cards",
      description: "Swipe or tap to clear risks and keep the floor moving.",
    },
    {
      title: "Settings & Learn",
      description: "Avatar opens settings; Learn recovers tips and Wine Agent.",
    },
  ],
  inventory: [
    {
      title: "Filters",
      description: "Jump to low, reorder, or still stock before service.",
    },
    {
      title: "Wine rows",
      description: "Open any bottle for detail, counts, or receiving.",
    },
  ],
  orders: [
    {
      title: "Open orders",
      description: "Everything still in flight lives in Open.",
    },
    {
      title: "Done",
      description: "Recent closed orders stay handy for receiving checks.",
    },
  ],
};
