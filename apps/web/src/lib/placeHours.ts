/**
 * The house's opening hours, read off the Google Places pick the person already
 * made on /get-started (r109 onboarding g1).
 *
 * Places gives `regularOpeningHours.periods`: each period opens on a weekday
 * (0 = Sunday .. 6 = Saturday) at an hour and minute, and closes at a later
 * point, which may be the next day. Our week is `restaurants.operating_hours`
 * (`common/operating-hours/operating-hours.ts`): seven keys mon..sun, at most
 * three ranges a day, sorted, not overlapping, and a range whose close is at
 * or before its open runs past midnight and must be the day's last.
 *
 * Unknown is null, never a guess (ADR 0020). So the answer is null, and the
 * house is asked nothing, when:
 *  - there are no periods;
 *  - a period has no close (Places' 24/7). The gateway refuses 00:00-00:00
 *    ("open equals close"), so a full day has no form to take;
 *  - a period runs 24 hours or more, or closes more than a day after it opens;
 *  - a day would hold more than three ranges, overlapping ranges, or an
 *    overnight range that is not its last;
 *  - an overnight range runs into the next day's first opening.
 */
import { WEEKDAYS, type HourRange, type OperatingHours, type Weekday } from '../services/api/restaurants'

export interface PlaceHoursPoint {
  day: number
  hour: number
  minute: number
}

export interface PlaceHoursPeriod {
  open: PlaceHoursPoint
  close: PlaceHoursPoint | null
}

/** Places' day number (0 = Sunday) to our key. */
const PLACES_DAY: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const MAX_RANGES = 3
const DAY_MINUTES = 24 * 60

function validPoint(p: PlaceHoursPoint | null | undefined): p is PlaceHoursPoint {
  return (
    !!p &&
    Number.isInteger(p.day) && p.day >= 0 && p.day <= 6 &&
    Number.isInteger(p.hour) && p.hour >= 0 && p.hour <= 23 &&
    Number.isInteger(p.minute) && p.minute >= 0 && p.minute <= 59
  )
}

const minutes = (p: PlaceHoursPoint) => p.hour * 60 + p.minute
const hhmm = (p: PlaceHoursPoint) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const crosses = (r: HourRange) => minutesOf(r.close) <= minutesOf(r.open)

export function hoursFromPlace(periods: readonly PlaceHoursPeriod[] | null | undefined): OperatingHours | null {
  if (!periods || periods.length === 0) return null
  const week = Object.fromEntries(WEEKDAYS.map((d) => [d, [] as HourRange[]])) as OperatingHours

  for (const period of periods) {
    if (!validPoint(period?.open) || !validPoint(period.close)) return null
    const dayGap = (period.close.day - period.open.day + 7) % 7
    const span = dayGap * DAY_MINUTES + minutes(period.close) - minutes(period.open)
    if (dayGap > 1 || span <= 0 || span >= DAY_MINUTES) return null
    week[PLACES_DAY[period.open.day]].push({ open: hhmm(period.open), close: hhmm(period.close) })
  }

  for (const day of WEEKDAYS) {
    const ranges = week[day].sort((a, b) => minutesOf(a.open) - minutesOf(b.open))
    if (ranges.length > MAX_RANGES) return null
    for (let i = 1; i < ranges.length; i++) {
      if (crosses(ranges[i - 1])) return null
      if (minutesOf(ranges[i].open) < minutesOf(ranges[i - 1].close)) return null
    }
  }

  // An overnight range must end before the next day's first opening.
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const today = week[WEEKDAYS[i]]
    const last = today[today.length - 1]
    if (!last || !crosses(last)) continue
    const first = week[WEEKDAYS[(i + 1) % WEEKDAYS.length]][0]
    if (first && minutesOf(first.open) < minutesOf(last.close)) return null
  }

  return week
}

const SHORT: Record<Weekday, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

const dayLine = (ranges: HourRange[]) => ranges.map((r) => `${r.open}–${r.close}`).join(', ')

/**
 * "Open Tue–Sun 17:00–01:00". Consecutive days (Mon first) that keep the same
 * hours are one run; runs are joined by "; ". Closed days are left out.
 */
export function summarizeHours(hours: OperatingHours): string {
  const runs: { from: Weekday; to: Weekday; line: string }[] = []
  for (const day of WEEKDAYS) {
    const ranges = hours[day]
    if (ranges.length === 0) continue
    const line = dayLine(ranges)
    const prev = runs[runs.length - 1]
    const prevIndex = prev ? WEEKDAYS.indexOf(prev.to) : -2
    if (prev && prev.line === line && prevIndex === WEEKDAYS.indexOf(day) - 1) prev.to = day
    else runs.push({ from: day, to: day, line })
  }
  const parts = runs.map((r) =>
    `${r.from === r.to ? SHORT[r.from] : `${SHORT[r.from]}–${SHORT[r.to]}`} ${r.line}`,
  )
  return `Open ${parts.join('; ')}`
}
