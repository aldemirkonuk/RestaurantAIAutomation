/** r109 onboarding g1: Places periods onto the house's week. */
import { describe, expect, it } from 'vitest'
import { hoursFromPlace, summarizeHours, type PlaceHoursPeriod } from './placeHours'

const pt = (day: number, hour: number, minute = 0) => ({ day, hour, minute })
const p = (od: number, oh: number, cd: number, ch: number, om = 0, cm = 0): PlaceHoursPeriod => ({
  open: pt(od, oh, om),
  close: pt(cd, ch, cm),
})
const closed = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }

describe('hoursFromPlace', () => {
  it('maps Places Sunday (0) onto sun and Monday (1) onto mon', () => {
    expect(hoursFromPlace([p(0, 10, 0, 16), p(1, 9, 1, 17)])).toEqual({
      ...closed,
      sun: [{ open: '10:00', close: '16:00' }],
      mon: [{ open: '09:00', close: '17:00' }],
    })
  })

  it('a close on the next day is the open day’s overnight range', () => {
    expect(hoursFromPlace([p(5, 17, 6, 1, 0, 30)])).toEqual({ ...closed, fri: [{ open: '17:00', close: '01:30' }] })
  })

  it('Saturday into Sunday wraps the week', () => {
    expect(hoursFromPlace([p(6, 20, 0, 2)])).toEqual({ ...closed, sat: [{ open: '20:00', close: '02:00' }] })
  })

  it('a close at midnight is an overnight range ending 00:00', () => {
    expect(hoursFromPlace([p(3, 18, 4, 0)])).toEqual({ ...closed, wed: [{ open: '18:00', close: '00:00' }] })
  })

  it('keeps a split lunch and dinner, sorted', () => {
    expect(hoursFromPlace([p(2, 18, 2, 23), p(2, 12, 2, 15)])).toEqual({
      ...closed,
      tue: [{ open: '12:00', close: '15:00' }, { open: '18:00', close: '23:00' }],
    })
  })

  it('is null when an overnight range is not the last of its day', () => {
    expect(hoursFromPlace([p(2, 1, 2, 3), p(2, 20, 3, 0, 0, 30)])).not.toBeNull()
    expect(hoursFromPlace([p(2, 22, 3, 2), p(2, 23, 2, 23, 0, 30)])).toBeNull()
  })

  it('is null when an overnight range runs into the next day’s first opening', () => {
    expect(hoursFromPlace([p(5, 20, 6, 3), p(6, 2, 6, 10)])).toBeNull()
  })

  it('is null for a span of 24 h or more', () => {
    expect(hoursFromPlace([p(1, 10, 2, 10)])).toBeNull()
    expect(hoursFromPlace([p(1, 10, 3, 1)])).toBeNull()
  })

  it('is null for empty or missing periods', () => {
    expect(hoursFromPlace([])).toBeNull()
    expect(hoursFromPlace(null)).toBeNull()
    expect(hoursFromPlace(undefined)).toBeNull()
  })

  it('is null for 24/7 (a period with no close): the gateway refuses 00:00-00:00', () => {
    expect(hoursFromPlace([{ open: pt(0, 0), close: null }])).toBeNull()
  })

  it('is null for overlapping ranges or more than three a day', () => {
    expect(hoursFromPlace([p(1, 10, 1, 15), p(1, 14, 1, 18)])).toBeNull()
    expect(hoursFromPlace([p(1, 7, 1, 8), p(1, 9, 1, 10), p(1, 11, 1, 12), p(1, 13, 1, 14)])).toBeNull()
  })

  it('is null for a point out of range', () => {
    expect(hoursFromPlace([p(7, 10, 7, 12)])).toBeNull()
  })
})

describe('summarizeHours', () => {
  it('folds consecutive days that keep the same hours', () => {
    const night = [{ open: '17:00', close: '01:00' }]
    expect(summarizeHours({ ...closed, tue: night, wed: night, thu: night, fri: night, sat: night, sun: night })).toBe(
      'Open Tue–Sun 17:00–01:00',
    )
  })

  it('keeps runs apart when the hours differ or a day is closed', () => {
    const day = [{ open: '12:00', close: '15:00' }, { open: '18:00', close: '23:00' }]
    expect(summarizeHours({ ...closed, mon: day, tue: day, thu: day, sat: [{ open: '18:00', close: '02:00' }] })).toBe(
      'Open Mon–Tue 12:00–15:00, 18:00–23:00; Thu 12:00–15:00, 18:00–23:00; Sat 18:00–02:00',
    )
  })
})
