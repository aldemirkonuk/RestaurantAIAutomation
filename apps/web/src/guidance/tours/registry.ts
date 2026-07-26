import type { PageTourId } from '../types'
import { dashboardTip, dashboardTour } from '../content/dashboard'
import { inventoryTip, inventoryTour } from '../content/inventory'
import { ordersTip, ordersTour } from '../content/orders'
import { providersTip, providersTour } from '../content/providers'

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
}

export const TOUR_REGISTRY: Record<PageTourId, TourDefinition> = {
  dashboard: dashboardTour,
  inventory: inventoryTour,
  orders: ordersTour,
  providers: providersTour,
}

export const TOUR_LABELS: Record<PageTourId, string> = {
  dashboard: 'Dashboard overview',
  inventory: 'Inventory command',
  orders: 'Orders workflow',
  providers: 'Providers & sourcing',
}
