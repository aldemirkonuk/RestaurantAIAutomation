/**
 * User Template Categories Management
 * Handles manager-created custom email template categories
 */

export interface UserCategory {
  name: string
  color: string
  icon: string
  createdAt: string
  createdBy: string // Manager ID or email
}

const STORAGE_KEY = 'userTemplateCategories'

/**
 * Get all user-created categories from localStorage
 */
export function getUserCategories(): UserCategory[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return []
    
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    console.error('Failed to load user categories:', error)
    return []
  }
}

/**
 * Add a new user category
 */
export function addUserCategory(category: Omit<UserCategory, 'createdAt'>): UserCategory {
  const categories = getUserCategories()
  
  // Check if category already exists
  const exists = categories.some(c => c.name.toLowerCase() === category.name.toLowerCase())
  if (exists) {
    throw new Error('A category with this name already exists')
  }
  
  const newCategory: UserCategory = {
    ...category,
    createdAt: new Date().toISOString(),
  }
  
  categories.push(newCategory)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(categories))
  
  return newCategory
}

/**
 * Update an existing user category
 */
export function updateUserCategory(name: string, updates: Partial<Omit<UserCategory, 'createdAt' | 'createdBy'>>): void {
  const categories = getUserCategories()
  const index = categories.findIndex(c => c.name === name)
  
  if (index === -1) {
    throw new Error('Category not found')
  }
  
  categories[index] = {
    ...categories[index],
    ...updates,
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(categories))
}

/**
 * Delete a user category
 */
export function deleteUserCategory(name: string): void {
  const categories = getUserCategories()
  const filtered = categories.filter(c => c.name !== name)
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
}

/**
 * Check if a category name is available
 */
export function isCategoryNameAvailable(name: string): boolean {
  const categories = getUserCategories()
  return !categories.some(c => c.name.toLowerCase() === name.toLowerCase())
}

/**
 * Get category by name
 */
export function getUserCategoryByName(name: string): UserCategory | undefined {
  const categories = getUserCategories()
  return categories.find(c => c.name.toLowerCase() === name.toLowerCase())
}

/**
 * Available icon options for categories
 */
export const CATEGORY_ICONS = [
  'FileText',
  'Package',
  'DollarSign',
  'TrendingUp',
  'BarChart3',
  'PieChart',
  'Mail',
  'Calendar',
  'Wine',
  'Truck',
  'Users',
  'Clock',
  'Star',
  'Tag',
  'Folder',
  'BookOpen',
] as const

export type CategoryIcon = typeof CATEGORY_ICONS[number]

/**
 * Available color options for categories
 */
export const CATEGORY_COLORS = [
  { name: 'Wine Red', value: '#991B1B' },
  { name: 'Blue', value: '#2563EB' },
  { name: 'Green', value: '#16A34A' },
  { name: 'Purple', value: '#7C3AED' },
  { name: 'Amber', value: '#D97706' },
  { name: 'Pink', value: '#DB2777' },
  { name: 'Teal', value: '#0D9488' },
  { name: 'Indigo', value: '#4F46E5' },
  { name: 'Emerald', value: '#059669' },
  { name: 'Orange', value: '#EA580C' },
  { name: 'Cyan', value: '#0891B2' },
  { name: 'Gray', value: '#6B7280' },
] as const

