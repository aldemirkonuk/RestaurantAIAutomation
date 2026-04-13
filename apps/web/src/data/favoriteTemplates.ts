/**
 * Favorite Templates Management
 * Handles manager-level favorite templates (personal favorites)
 */

const STORAGE_KEY = 'favoriteTemplates'

/**
 * Get all favorite template IDs for the current user
 */
export function getFavoriteTemplates(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return []
    
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('Failed to load favorite templates:', error)
    return []
  }
}

/**
 * Check if a template is favorited
 */
export function isTemplateFavorite(templateId: string): boolean {
  const favorites = getFavoriteTemplates()
  return favorites.includes(templateId)
}

/**
 * Toggle favorite status for a template
 */
export function toggleTemplateFavorite(templateId: string): boolean {
  const favorites = getFavoriteTemplates()
  const index = favorites.indexOf(templateId)
  
  if (index > -1) {
    // Remove from favorites
    favorites.splice(index, 1)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
    return false
  } else {
    // Add to favorites
    favorites.push(templateId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
    return true
  }
}

/**
 * Add a template to favorites
 */
export function addToFavorites(templateId: string): void {
  const favorites = getFavoriteTemplates()
  if (!favorites.includes(templateId)) {
    favorites.push(templateId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
  }
}

/**
 * Remove a template from favorites
 */
export function removeFromFavorites(templateId: string): void {
  const favorites = getFavoriteTemplates()
  const filtered = favorites.filter(id => id !== templateId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
}

/**
 * Clear all favorites
 */
export function clearAllFavorites(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([]))
}

/**
 * Get count of favorite templates
 */
export function getFavoritesCount(): number {
  return getFavoriteTemplates().length
}

