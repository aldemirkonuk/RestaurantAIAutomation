import { z } from 'zod'
import { isValidPhone } from './phone'

/**
 * Validation Schemas for Mudavym Forms
 * Uses Zod for runtime validation with type inference
 */

// ==================== Wine Schemas ====================

export const wineAdditionSchema = z.object({
  name: z.string().min(2, 'Wine name must be at least 2 characters').max(200, 'Wine name is too long'),
  producer: z.string().min(2, 'Producer name is required').max(200, 'Producer name is too long'),
  type: z.enum(['red', 'white', 'rose', 'sparkling', 'dessert', 'fortified'], {
    errorMap: () => ({ message: 'Please select a wine type' }),
  }),
  vintage: z.coerce.number().int().min(1900).max(new Date().getFullYear() + 2).nullable().optional(),
  region: z.string().min(2, 'Region is required').max(200),
  grape: z.string().min(2, 'Grape variety is required').max(200),
  quantity: z.coerce.number().int().positive('Quantity must be positive').max(10000, 'Quantity seems too high'),
  threshold: z.coerce.number().int().positive('Threshold must be positive').max(1000, 'Threshold seems too high'),
  price: z.coerce.number().positive('Price must be positive').max(100000, 'Price seems too high'),
  sku: z.string().optional(),
  notes: z.string().max(1000, 'Notes are too long').optional(),
})

export type WineAdditionInput = z.infer<typeof wineAdditionSchema>

// ==================== Order Schemas ====================

export const orderCreationSchema = z.object({
  wineId: z.string().uuid('Invalid wine ID'),
  wineName: z.string().min(1, 'Wine name is required'),
  quantity: z.coerce.number().int().positive('Quantity must be positive').max(10000, 'Quantity seems too high'),
  unitType: z.enum(['bottle', 'case'], {
    errorMap: () => ({ message: 'Please select a unit type' }),
  }),
  bottlesPerCase: z.coerce.number().int().positive().optional(),
  providerId: z.string().min(1, 'Please select a provider'),
  providerName: z.string().min(1, 'Provider name is required'),
  pricePerUnit: z.coerce.number().positive('Price must be positive').optional(),
  estimatedTotal: z.coerce.number().positive().optional(),
  notes: z.string().max(1000, 'Notes are too long').optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

export type OrderCreationInput = z.infer<typeof orderCreationSchema>

export const orderApprovalSchema = z.object({
  orderId: z.string().min(1, 'Order ID is required'),
  finalPrice: z.coerce.number().positive('Price must be positive'),
  deliveryDate: z.string().optional(),
  notes: z.string().max(1000).optional(),
  approved: z.boolean(),
})

export type OrderApprovalInput = z.infer<typeof orderApprovalSchema>

// ==================== Inventory Schemas ====================

export const manualStockOverrideSchema = z.object({
  wineId: z.string().min(1, 'Wine ID is required'),
  newLiveStock: z.coerce.number().int().min(0, 'Stock cannot be negative').max(10000, 'Stock seems too high'),
  newShadowStock: z.coerce.number().int().min(0, 'Shadow stock cannot be negative').max(1000, 'Shadow stock seems too high'),
  reason: z.string().min(3, 'Reason is required').max(200, 'Reason is too long'),
  reasonCategory: z.enum(['physical_count', 'correction', 'damage', 'theft', 'transfer', 'other'], {
    errorMap: () => ({ message: 'Please select a reason category' }),
  }),
  notes: z.string().max(1000, 'Notes are too long').optional(),
  managerName: z.string().min(1, 'Manager name is required'),
})

export type ManualStockOverrideInput = z.infer<typeof manualStockOverrideSchema>

export const inventoryReconciliationSchema = z.object({
  wineId: z.string().min(1, 'Wine ID is required'),
  actualCount: z.coerce.number().int().min(0, 'Count cannot be negative'),
  expectedCount: z.coerce.number().int(),
  variance: z.coerce.number().int(),
  notes: z.string().max(1000).optional(),
})

export type InventoryReconciliationInput = z.infer<typeof inventoryReconciliationSchema>

// ==================== Provider Schemas ====================

export const providerAdditionSchema = z.object({
  name: z.string().min(2, 'Provider name must be at least 2 characters').max(200, 'Provider name is too long'),
  contactName: z.string().min(2, 'Contact name is required').max(100),
  email: z.string().email('Invalid email address'),
  phone: z
    .string()
    .optional()
    .refine((v) => !v?.trim() || isValidPhone(v), 'Invalid phone number'),
  address: z.string().max(500).optional(),
  website: z.string().url('Invalid website URL').optional(),
  type: z.enum(['distributor', 'direct_winery', 'broker', 'auction'], {
    errorMap: () => ({ message: 'Please select a provider type' }),
  }),
  isPrimary: z.boolean().default(false),
  paymentTerms: z.string().max(200).optional(),
  deliveryArea: z.string().max(200).optional(),
  minimumOrder: z.coerce.number().positive().optional(),
  notes: z.string().max(1000).optional(),
})

export type ProviderAdditionInput = z.infer<typeof providerAdditionSchema>

// ==================== Report Schemas ====================

export const reportConfigSchema = z.object({
  reportType: z.enum(['inventory', 'sales', 'procurement', 'financial'], {
    errorMap: () => ({ message: 'Please select a report type' }),
  }),
  dateRange: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  }),
  format: z.enum(['pdf', 'csv', 'excel']),
  includeCharts: z.boolean().default(true),
  includeMetrics: z.boolean().default(true),
})

export type ReportConfigInput = z.infer<typeof reportConfigSchema>

// ==================== User Profile Schemas ====================

export const userProfileSchema = z.object({
  displayName: z.string().min(2, 'Display name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  phone: z
    .string()
    .optional()
    .refine((v) => !v?.trim() || isValidPhone(v), 'Invalid phone number'),
  role: z.enum(['manager', 'staff', 'owner', 'admin']),
  notificationPreferences: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    push: z.boolean(),
  }).optional(),
})

export type UserProfileInput = z.infer<typeof userProfileSchema>

// ==================== Helper Functions ====================

/**
 * Format Zod validation errors for display
 */
export function formatZodError(error: z.ZodError): Record<string, string> {
  const formatted: Record<string, string> = {}
  error.errors.forEach((err) => {
    const path = err.path.join('.')
    formatted[path] = err.message
  })
  return formatted
}

/**
 * Validate data against schema and return formatted errors
 */
export function validateSchema<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: Record<string, string> } {
  const result = schema.safeParse(data)
  
  if (result.success) {
    return { success: true, data: result.data }
  }
  
  return { success: false, errors: formatZodError(result.error) }
}
