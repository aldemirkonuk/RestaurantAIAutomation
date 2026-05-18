/**
 * Delivery date calculation utilities.
 *
 * Providers store delivery days in `regionsCovered` (string[]) as day names,
 * e.g. ['Monday', 'Wednesday', 'Saturday'], and optionally `leadTimeDays` (int).
 *
 * Algorithm:
 *   1. earliestPossible = orderDate + leadTimeDays (default 3)
 *   2. Walk forward from earliestPossible until we hit a provider delivery day
 *   3. Return that date (cap search at 30 days to avoid infinite loops)
 */

const DAY_NAME_TO_NUM: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

/** Add `days` calendar days to a Date, returning a new Date at midnight local time. */
function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export interface DeliveryDateResult {
  /** Expected delivery date, or null if no delivery days configured */
  date: Date | null
  /** Whether the provider has explicit delivery days set */
  hasSchedule: boolean
  /** Effective lead time used for the calculation */
  leadTimeDays: number
  /** Urgency signal for UI display */
  signal: 'today' | 'this-week' | 'next-week' | 'later' | 'unknown'
  /** Human-friendly label, e.g. "Thursday, Jan 23" */
  label: string
}

/**
 * Calculate the earliest expected delivery date for an order placed on `orderDate`.
 *
 * @param orderDate  Date the order is placed (defaults to today)
 * @param deliveryDays  Array of day names e.g. ['Monday','Friday']. Case-insensitive.
 * @param leadTimeDays  Minimum days before delivery (e.g. 3). Defaults to 3.
 */
export function calculateDeliveryDate(
  orderDate: Date = new Date(),
  deliveryDays: string[] = [],
  leadTimeDays = 3,
): DeliveryDateResult {
  // Normalize to midnight local time so day arithmetic is stable
  const today = new Date(orderDate)
  today.setHours(0, 0, 0, 0)

  const effectiveLead = Math.max(1, leadTimeDays)

  if (!deliveryDays.length) {
    // No schedule — estimate using lead time + next business day
    const estimated = addDays(today, effectiveLead)
    // Skip weekend if estimated lands on one
    while (estimated.getDay() === 0 || estimated.getDay() === 6) {
      estimated.setDate(estimated.getDate() + 1)
    }
    return {
      date: estimated,
      hasSchedule: false,
      leadTimeDays: effectiveLead,
      signal: daysDiff(today, estimated) <= 7 ? 'this-week' : 'next-week',
      label: formatDate(estimated) + ' (est.)',
    }
  }

  const deliveryDayNums = deliveryDays
    .map(d => DAY_NAME_TO_NUM[d.toLowerCase()])
    .filter((n): n is number => n !== undefined)

  if (!deliveryDayNums.length) {
    return { date: null, hasSchedule: false, leadTimeDays: effectiveLead, signal: 'unknown', label: 'Unknown schedule' }
  }

  // earliestPossible = orderDate + lead time
  const earliest = addDays(today, effectiveLead)

  for (let i = 0; i <= 30; i++) {
    const candidate = addDays(earliest, i)
    if (deliveryDayNums.includes(candidate.getDay())) {
      const diff = daysDiff(today, candidate)
      return {
        date: candidate,
        hasSchedule: true,
        leadTimeDays: effectiveLead,
        signal: diff === 0 ? 'today' : diff <= 7 ? 'this-week' : diff <= 14 ? 'next-week' : 'later',
        label: formatDate(candidate),
      }
    }
  }

  return { date: null, hasSchedule: true, leadTimeDays: effectiveLead, signal: 'unknown', label: 'No delivery window found' }
}

function daysDiff(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Returns a short UI signal string and color class for the result. */
export function deliverySignal(result: DeliveryDateResult): {
  icon: string
  text: string
  colorClass: string
} {
  if (!result.date || result.signal === 'unknown') {
    return { icon: '—', text: 'No schedule', colorClass: 'text-gray-400' }
  }
  if (!result.hasSchedule) {
    return { icon: '📦', text: `~${result.label}`, colorClass: 'text-gray-500' }
  }
  switch (result.signal) {
    case 'today':
      return { icon: '✅', text: `Today`, colorClass: 'text-emerald-600' }
    case 'this-week':
      return { icon: '✅', text: result.label, colorClass: 'text-emerald-600' }
    case 'next-week':
      return { icon: '⚠️', text: result.label, colorClass: 'text-amber-600' }
    case 'later':
      return { icon: '🔴', text: result.label, colorClass: 'text-red-500' }
    default:
      return { icon: '—', text: result.label, colorClass: 'text-gray-400' }
  }
}
