/**
 * Email Recipients Management
 * Tracks frequently used email addresses and provides smart suggestions
 */

export interface EmailRecipient {
  email: string
  name?: string
  lastUsed: string
  usageCount: number
  categories: string[] // Which template categories this email is commonly used with
}

const STORAGE_KEY = 'emailRecipients'

/**
 * Get all email recipients
 */
export function getEmailRecipients(): EmailRecipient[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return []
    
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('Failed to load email recipients:', error)
    return []
  }
}

/**
 * Add or update an email recipient
 */
export function addEmailRecipient(email: string, category?: string, name?: string): void {
  const recipients = getEmailRecipients()
  const existing = recipients.find(r => r.email.toLowerCase() === email.toLowerCase())
  
  if (existing) {
    // Update existing
    existing.lastUsed = new Date().toISOString()
    existing.usageCount++
    if (category && !existing.categories.includes(category)) {
      existing.categories.push(category)
    }
    if (name && !existing.name) {
      existing.name = name
    }
  } else {
    // Add new
    recipients.push({
      email,
      name,
      lastUsed: new Date().toISOString(),
      usageCount: 1,
      categories: category ? [category] : [],
    })
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recipients))
}

/**
 * Get smart suggestions based on category and usage
 */
export function getSmartSuggestions(category?: string, limit: number = 5): string[] {
  const recipients = getEmailRecipients()
  
  // Filter by category if provided
  let filtered = category
    ? recipients.filter(r => r.categories.includes(category.toLowerCase()))
    : recipients
  
  // Sort by usage count and recency
  filtered.sort((a, b) => {
    const usageDiff = b.usageCount - a.usageCount
    if (usageDiff !== 0) return usageDiff
    
    // If usage is the same, sort by recency
    return new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime()
  })
  
  return filtered.slice(0, limit).map(r => r.email)
}

/**
 * Search recipients by email or name
 */
export function searchRecipients(query: string): EmailRecipient[] {
  if (!query) return []
  
  const recipients = getEmailRecipients()
  const lowerQuery = query.toLowerCase()
  
  return recipients.filter(r =>
    r.email.toLowerCase().includes(lowerQuery) ||
    (r.name && r.name.toLowerCase().includes(lowerQuery))
  ).sort((a, b) => b.usageCount - a.usageCount)
}

/**
 * Get default email suggestions for categories
 */
export function getDefaultSuggestions(category: string): string[] {
  const defaults: Record<string, string[]> = {
    'inventory': ['inventory@restaurant.com', 'cellar-manager@restaurant.com', 'sommelier@restaurant.com'],
    'financial': ['accounting@restaurant.com', 'finance@restaurant.com', 'owner@restaurant.com'],
    'order': ['procurement@restaurant.com', 'purchasing@restaurant.com', 'manager@restaurant.com'],
    'custom': ['team@restaurant.com', 'staff@restaurant.com']
  }
  
  return defaults[category.toLowerCase()] || defaults['custom']
}

/**
 * Combined smart suggestions: user's history + defaults
 */
export function getCombinedSuggestions(category?: string, limit: number = 8): string[] {
  const smartSuggestions = getSmartSuggestions(category, limit)
  
  // If we have enough from history, return those
  if (smartSuggestions.length >= limit) {
    return smartSuggestions
  }
  
  // Otherwise, supplement with defaults
  const defaults = category ? getDefaultSuggestions(category) : []
  const combined = [...smartSuggestions]
  
  for (const email of defaults) {
    if (!combined.includes(email) && combined.length < limit) {
      combined.push(email)
    }
  }
  
  return combined
}

