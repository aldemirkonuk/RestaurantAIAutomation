/**
 * Calendar date helpers — avoid YYYY-MM-DD parsing as UTC (Date.parse / new Date(str))
 * and avoid toISOString() for bounds (timezone can shift the calendar day).
 */

export function parseCalendarDateString(value: string | Date): Date {
  if (value instanceof Date) return value
  const head = String(value).split('T')[0]
  const [y, m, d] = head.split('-').map(Number)
  if (!y || !m || !d) return new Date(value)
  return new Date(y, m - 1, d)
}

export function formatLocalDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
