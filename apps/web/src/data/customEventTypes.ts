/**
 * Custom Event Types Management
 * Allows managers to create custom event types for the calendar
 */

export interface CustomEventType {
  name: string // e.g., "Social Media", "Staff Training"
  color: string
  icon: string // Icon name
  createdAt: string
  createdBy: string
}

const STORAGE_KEY = 'customEventTypes'

/**
 * Get all custom event types
 */
export function getCustomEventTypes(): CustomEventType[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return []
    
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('Failed to load custom event types:', error)
    return []
  }
}

/**
 * Add a new custom event type
 */
export function addCustomEventType(eventType: Omit<CustomEventType, 'createdAt'>): CustomEventType {
  const types = getCustomEventTypes()
  
  // Check if name already exists
  const exists = types.some(t => t.name.toLowerCase() === eventType.name.toLowerCase())
  if (exists) {
    throw new Error('An event type with this name already exists')
  }
  
  const newType: CustomEventType = {
    ...eventType,
    createdAt: new Date().toISOString(),
  }
  
  types.push(newType)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(types))
  
  return newType
}

/**
 * Delete a custom event type (case-insensitive)
 */
export function deleteCustomEventType(name: string): void {
  const types = getCustomEventTypes()
  const filtered = types.filter(t => t.name.toLowerCase() !== name.toLowerCase())
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
}

/**
 * Check if an event type name is available
 */
export function isEventTypeNameAvailable(name: string): boolean {
  const types = getCustomEventTypes()
  return !types.some(t => t.name.toLowerCase() === name.toLowerCase())
}

