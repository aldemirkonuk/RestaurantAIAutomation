import type { TourDefinition } from '../tours/registry'

export const dashboardTip = {
  pageId: 'dashboard' as const,
  title: 'Dashboard',
  body: "Start with KPIs, clear today's actions, then jump from low-stock alerts or recent orders.",
}

export const dashboardTour: TourDefinition = {
  pageId: 'dashboard',
  steps: [
    {
      element: '[data-tour="dashboard-kpis"]',
      title: 'At a glance',
      description:
        'Tap a KPI card for details. Double-click jumps straight to that surface (inventory, orders, or alerts).',
    },
    {
      element: '[data-tour="dashboard-actions"]',
      title: "Clear today's work",
      description:
        'One-tap and quick actions handle the next job without hunting the sidebar.',
    },
    {
      element: '[data-tour="dashboard-alerts"]',
      title: 'Act on low stock',
      description:
        'Open Inventory from an alert. Double-click starts a reorder draft with a suggested quantity.',
    },
    {
      element: '[data-tour="dashboard-orders"]',
      title: 'Follow recent orders',
      description:
        'Open an order to check status or jump into its thread. View all opens the full Orders list.',
    },
  ],
}
