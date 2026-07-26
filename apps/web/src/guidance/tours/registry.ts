import type { PageTourId } from '../types'
import { dashboardTip, dashboardTour } from '../content/dashboard'
import { inventoryTip, inventoryTour } from '../content/inventory'
import { ordersTip, ordersTour } from '../content/orders'
import { providersTip, providersTour } from '../content/providers'
import { ordersCreateTip, ordersCreateTour } from '../content/orders-create'
import { communicationsTip, communicationsTour } from '../content/communications'
import { reportsTip, reportsTour } from '../content/reports'
import { sommelierTip, sommelierTour } from '../content/sommelier'
import { settingsServicesTip, settingsServicesTour } from '../content/settings-services'
import { calendarTip, calendarTour } from '../content/calendar'

export interface TourStep {
  element: string
  title: string
  description: string
}

export interface TourDefinition {
  pageId: PageTourId
  steps: TourStep[]
}

export interface TipDefinition {
  pageId: PageTourId
  title: string
  body: string
}

export const TIP_REGISTRY: Record<PageTourId, TipDefinition> = {
  dashboard: dashboardTip,
  inventory: inventoryTip,
  orders: ordersTip,
  providers: providersTip,
  'orders-create': ordersCreateTip,
  communications: communicationsTip,
  reports: reportsTip,
  sommelier: sommelierTip,
  'settings-services': settingsServicesTip,
  calendar: calendarTip,
}

export const TOUR_REGISTRY: Record<PageTourId, TourDefinition> = {
  dashboard: dashboardTour,
  inventory: inventoryTour,
  orders: ordersTour,
  providers: providersTour,
  'orders-create': ordersCreateTour,
  communications: communicationsTour,
  reports: reportsTour,
  sommelier: sommelierTour,
  'settings-services': settingsServicesTour,
  calendar: calendarTour,
}

export const TOUR_LABELS: Record<PageTourId, string> = {
  dashboard: 'Dashboard overview',
  inventory: 'Inventory command',
  orders: 'Orders workflow',
  providers: 'Providers & sourcing',
  'orders-create': 'Building an order',
  communications: 'Communications',
  reports: 'Reports dashboard',
  sommelier: 'Sommelier AI',
  'settings-services': 'Services & permissions',
  calendar: 'Calendar',
}
