import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type FormatMode = 'compact' | 'full' | 'table'

/**
 * Format monetary values with context-appropriate display:
 * - compact: KPI cards, badges, calendar ($1.4K, $2.3M)
 * - full: default display ($845.50, $14,523)
 * - table: data tables, modals ($845.50, $14,523.80)
 */
export function formatMoney(value: number, mode: FormatMode = 'full'): string {
  if (value == null || isNaN(value)) return '$0'

  if (mode === 'compact') {
    const abs = Math.abs(value)
    const sign = value < 0 ? '-' : ''
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
    return `${sign}$${abs.toFixed(0)}`
  }

  if (mode === 'table') {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // 'full' -- general display
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

/**
 * Format plain numbers with context-appropriate display.
 */
export function formatNumber(value: number, mode: FormatMode = 'full'): string {
  if (value == null || isNaN(value)) return '0'

  if (mode === 'compact') {
    const abs = Math.abs(value)
    const sign = value < 0 ? '-' : ''
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`
    return `${sign}${abs.toFixed(0)}`
  }

  return value.toLocaleString('en-US')
}

/** @deprecated Use formatMoney instead */
export function formatCurrency(value: number, currency: string = 'USD', locale: string = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
  }).format(value)
}

export function formatDate(date: Date | string, locale: string = 'en-US', options?: Intl.DateTimeFormatOptions): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(locale, options).format(dateObj)
}

export function formatPercentage(value: number, locale: string = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value / 100)
}

