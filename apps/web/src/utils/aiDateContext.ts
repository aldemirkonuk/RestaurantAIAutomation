/**
 * AI Date Context Utilities
 * 
 * This module provides utilities for storing and retrieving important dates
 * in a format that can be consumed by AI for context-aware messaging and reminders.
 */

export interface AIDateContext {
  id: number
  date: string
  title: string
  type: string
  daysUntil: number
  context: string
  priority: 'low' | 'medium' | 'high'
  source: 'manual' | 'ai_extracted' | 'calendar' | 'communication'
  relatedEntity?: {
    type: 'customer' | 'provider' | 'staff' | 'event'
    name?: string
    id?: string
  }
  metadata?: Record<string, any>
  createdAt: string
  updatedAt: string
}

const AI_DATE_STORAGE_KEY = 'wineops_ai_date_context'

/**
 * Get all dates stored for AI context
 */
export function getAIDateContext(): AIDateContext[] {
  try {
    const stored = localStorage.getItem(AI_DATE_STORAGE_KEY)
    if (!stored) return []
    return JSON.parse(stored)
  } catch (e) {
    console.error('Error reading AI date context:', e)
    return []
  }
}

/**
 * Store a new date for AI context
 */
export function storeAIDateContext(date: Omit<AIDateContext, 'createdAt' | 'updatedAt'>): AIDateContext {
  const now = new Date().toISOString()
  const newDate: AIDateContext = {
    ...date,
    createdAt: now,
    updatedAt: now,
  }

  const existing = getAIDateContext()
  const updated = [...existing, newDate]
  
  try {
    localStorage.setItem(AI_DATE_STORAGE_KEY, JSON.stringify(updated))
  } catch (e) {
    console.error('Error storing AI date context:', e)
  }

  return newDate
}

/**
 * Update an existing date in AI context
 */
export function updateAIDateContext(id: number, updates: Partial<AIDateContext>): AIDateContext | null {
  const existing = getAIDateContext()
  const index = existing.findIndex(d => d.id === id)
  
  if (index === -1) return null

  const updated: AIDateContext = {
    ...existing[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  }

  existing[index] = updated

  try {
    localStorage.setItem(AI_DATE_STORAGE_KEY, JSON.stringify(existing))
  } catch (e) {
    console.error('Error updating AI date context:', e)
  }

  return updated
}

/**
 * Remove a date from AI context
 */
export function removeAIDateContext(id: number): boolean {
  const existing = getAIDateContext()
  const filtered = existing.filter(d => d.id !== id)
  
  if (filtered.length === existing.length) return false

  try {
    localStorage.setItem(AI_DATE_STORAGE_KEY, JSON.stringify(filtered))
    return true
  } catch (e) {
    console.error('Error removing AI date context:', e)
    return false
  }
}

/**
 * Get upcoming dates within a specified number of days
 */
export function getUpcomingDates(withinDays: number = 30): AIDateContext[] {
  const dates = getAIDateContext()
  const now = new Date()
  
  return dates
    .map(d => ({
      ...d,
      daysUntil: Math.ceil((new Date(d.date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    }))
    .filter(d => d.daysUntil >= 0 && d.daysUntil <= withinDays)
    .sort((a, b) => a.daysUntil - b.daysUntil)
}

/**
 * Get dates related to a specific entity
 */
export function getDatesForEntity(entityType: string, entityId?: string): AIDateContext[] {
  const dates = getAIDateContext()
  return dates.filter(d => 
    d.relatedEntity?.type === entityType && 
    (!entityId || d.relatedEntity?.id === entityId)
  )
}

/**
 * Generate AI prompt context for dates
 * Returns a formatted string that can be included in AI prompts
 */
export function generateAIDatePromptContext(): string {
  const upcoming = getUpcomingDates(14) // Next 2 weeks
  
  if (upcoming.length === 0) {
    return 'No important dates in the next 2 weeks.'
  }

  const lines = upcoming.map(d => {
    const daysText = d.daysUntil === 0 ? 'today' : 
                     d.daysUntil === 1 ? 'tomorrow' : 
                     `in ${d.daysUntil} days`
    
    let line = `- ${d.title} (${d.type}) - ${daysText}`
    
    if (d.relatedEntity) {
      line += ` [${d.relatedEntity.type}: ${d.relatedEntity.name || d.relatedEntity.id}]`
    }
    
    if (d.context) {
      line += ` - Context: ${d.context}`
    }
    
    return line
  })

  return `Upcoming Important Dates:\n${lines.join('\n')}`
}

/**
 * Convert an ImportantDate to AIDateContext format
 */
export function importantDateToAIContext(
  date: { id: number; date: string; title: string; type: string; notes?: string; color?: string },
  source: AIDateContext['source'] = 'manual'
): Omit<AIDateContext, 'createdAt' | 'updatedAt'> {
  const dateObj = new Date(date.date)
  const now = new Date()
  const daysUntil = Math.ceil((dateObj.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  // Determine priority based on days until and type
  let priority: AIDateContext['priority'] = 'medium'
  if (daysUntil <= 1) priority = 'high'
  else if (daysUntil > 7) priority = 'low'
  
  // Higher priority for certain types
  if (['delivery', 'inventory', 'meeting'].includes(date.type)) {
    priority = daysUntil <= 3 ? 'high' : 'medium'
  }

  // Generate context string
  let context = date.notes || ''
  if (date.type === 'birthday') {
    context = context || 'Consider sending a personalized message or special offer.'
  } else if (date.type === 'delivery') {
    context = context || 'Ensure receiving area is prepared and staff is available.'
  } else if (date.type === 'tasting') {
    context = context || 'Prepare wine selections and tasting notes.'
  }

  return {
    id: date.id,
    date: date.date,
    title: date.title,
    type: date.type,
    daysUntil,
    context,
    priority,
    source,
    metadata: { color: date.color },
  }
}

/**
 * Extract potential dates from text (for AI reverse sync)
 * Returns an array of potential date mentions
 */
export interface ExtractedDateMention {
  text: string
  suggestedDate?: string
  suggestedTitle?: string
  suggestedType?: string
  confidence: number
}

export function extractDateMentionsFromText(text: string): ExtractedDateMention[] {
  const mentions: ExtractedDateMention[] = []
  
  // Common patterns for date mentions
  const patterns = [
    // "birthday is January 18" or "birthday on January 18"
    {
      regex: /(\w+)'?s?\s+birthday\s+(?:is|on)\s+(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/gi,
      type: 'birthday',
      titleExtractor: (match: RegExpMatchArray) => `${match[1]}'s Birthday`,
    },
    // "delivery on January 20" or "arriving January 20"
    {
      regex: /(?:delivery|arriving|shipment)\s+(?:on|scheduled for)?\s*(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/gi,
      type: 'delivery',
      titleExtractor: () => 'Scheduled Delivery',
    },
    // "meeting on January 22" or "appointment January 22"
    {
      regex: /(?:meeting|appointment)\s+(?:on|scheduled for)?\s*(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/gi,
      type: 'meeting',
      titleExtractor: () => 'Scheduled Meeting',
    },
    // "event on January 25" or "tasting on January 25"
    {
      regex: /(?:event|tasting|party)\s+(?:on|scheduled for)?\s*(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/gi,
      type: 'event',
      titleExtractor: () => 'Scheduled Event',
    },
    // Generic date mentions like "on January 18" or "by January 18"
    {
      regex: /(?:on|by|before|after)\s+(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/gi,
      type: 'reminder',
      titleExtractor: () => 'Date Mentioned',
    },
  ]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.regex.exec(text)) !== null) {
      const dateText = match[1] || match[2]
      const parsedDate = parseNaturalDate(dateText)
      
      mentions.push({
        text: match[0],
        suggestedDate: parsedDate,
        suggestedTitle: pattern.titleExtractor(match),
        suggestedType: pattern.type,
        confidence: parsedDate ? 0.8 : 0.5,
      })
    }
  }

  return mentions
}

/**
 * Parse natural language date string to ISO format
 */
function parseNaturalDate(dateStr: string): string | undefined {
  try {
    // Remove ordinal suffixes
    const cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/gi, '$1')
    
    // Try parsing with current year if no year specified
    let date = new Date(cleaned)
    
    if (isNaN(date.getTime())) {
      // Try adding current year
      const withYear = `${cleaned}, ${new Date().getFullYear()}`
      date = new Date(withYear)
    }
    
    if (isNaN(date.getTime())) {
      return undefined
    }

    // If date is in the past, assume next year
    const now = new Date()
    if (date < now) {
      date.setFullYear(date.getFullYear() + 1)
    }

    return date.toISOString().split('T')[0]
  } catch {
    return undefined
  }
}
