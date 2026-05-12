/**
 * Fallback Data for Development
 * 
 * This file provides fallback data when the backend API is not available.
 * Used only in development mode to allow frontend development without backend.
 * 
 * DO NOT USE IN PRODUCTION - These are for development only.
 */

import type { Provider } from '../services/api/providers'
import type { CalendarEvent } from '../services/api/calendar'
import type { Notification } from '../services/api/notifications'

export const FALLBACK_PROVIDERS: Provider[] = [
  {
    id: 'PROV_001',
    name: 'Southern Glazer\'s Wine & Spirits',
    primaryBusinessType: 'Wholesaler',
    winePortfolio: 'Comprehensive portfolio: California, French, Italian, Spanish wines',
    phone: '(954) 739-9000',
    email: 'customerservice@sgws.com',
    physicalAddress: '4300 Alcoa Avenue, Fort Lauderdale, FL 33309, USA',
    website: 'https://www.southernglazers.com',
    knownPersonnel: ['Maria Rodriguez - Account Manager'],
    statesOrRegionsServed: ['All 50 states'],
    restaurantId: '550e8400-e29b-41d4-a716-446655440000',
  },
]

export const FALLBACK_CALENDAR_EVENTS: CalendarEvent[] = [
  {
    id: 'evt-1',
    title: 'Wine Delivery',
    type: 'delivery',
    date: new Date().toISOString().split('T')[0],
    startTime: '10:00',
    endTime: '11:00',
    description: 'Scheduled wine delivery',
    color: '#10B981',
    status: 'approved',
    restaurantId: '550e8400-e29b-41d4-a716-446655440000',
  },
]

export const FALLBACK_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif-1',
    userId: 'demo-user-123',
    restaurantId: '550e8400-e29b-41d4-a716-446655440000',
    type: 'inventory_low_stock',
    title: 'Low Stock Alert',
    message: 'Some wines are running low',
    status: 'unread',
    priority: 'medium',
    timestamp: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  },
]
