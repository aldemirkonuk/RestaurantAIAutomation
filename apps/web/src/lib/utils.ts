import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatHouseMoney } from './houseCurrency'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export type FormatMode = 'compact' | 'full' | 'table'

/**
 * Format monetary values with context-appropriate display:
 * - compact: KPI cards, badges, calendar (€1.4K, $2.3M)
 * - full: default display (€845.50, $14,523)
 * - table: data tables, modals (€845.50, $14,523.80)
 *
 * `currency` omitted means the house's own (`lib/houseCurrency.ts`); it used to
 * be a literal `$`, so every house read its money in dollars (sim F-341).
 */
export function formatMoney(value: number, mode: FormatMode = 'full', currency?: string | null): string {
  if (value == null || isNaN(value)) return formatHouseMoney(0, currency, { maximumFractionDigits: 0 })

  if (mode === 'compact') {
    return formatHouseMoney(value, currency, { compact: true, minimumFractionDigits: 0, maximumFractionDigits: 0 })
  }

  if (mode === 'table') {
    return formatHouseMoney(value, currency)
  }

  // 'full' -- general display
  return formatHouseMoney(value, currency, { minimumFractionDigits: 0 })
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

/**
 * @deprecated Use `formatMoney` from `lib/currency` instead.
 *
 * The `currency = 'USD'` default is gone (ADR 0117 Q25/Q30, 2026-09-05). It was
 * the same fault as `restaurants.currency DEFAULT 'USD'`, one layer up: a caller
 * that never thought about currency got dollars, and after Q30 cleared every
 * unattributable value to NULL there are live houses whose currency is not
 * recorded at all. A caller with nothing to pass now gets the number and a
 * caveat, which is legible; it used to get a dollar sign, which was a claim.
 */
export function formatCurrency(
  value: number,
  currency: string | null = null,
  locale: string = 'en-US',
): string {
  if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) {
    return `${value.toLocaleString(locale)} (currency not recorded)`
  }
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

