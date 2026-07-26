import type { TourDefinition } from '../tours/registry'

export const dashboardTip = {
  pageId: 'dashboard' as const,
  title: 'Dashboard',
  body: 'Your ops hub — stock risk, pending orders, and what needs attention today.',
}

export const dashboardTour: TourDefinition = {
  pageId: 'dashboard',
  steps: [
    {
      element: '[data-tour="dashboard-kpis"]',
      title: 'At a glance',
      description: 'KPIs summarize cellar health, open orders, and alerts.',
    },
    {
      element: '[data-tour="dashboard-alerts"]',
      title: 'Act on risk',
      description: 'Low-stock and service risks surface here so you can reorder fast.',
    },
    {
      element: '[data-tour="dashboard-alerts"]',
      title: 'From alert to action',
      description: 'Open Inventory from here when you need the full command surface.',
    },
  ],
}
