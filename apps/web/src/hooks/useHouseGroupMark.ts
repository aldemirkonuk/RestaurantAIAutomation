/**
 * The mark this house's numbers group thousands with — "." in Türkiye, "," in
 * the US — for `parseDecimal`'s one ambiguous shape ("1.250"). See
 * `lib/parseDecimal.ts` for the rule.
 *
 * Read from the house's recorded country (`GET /settings/currency` carries it)
 * once per house per page load, and shared by every field that asks. Until the
 * read lands, or when it fails or the country is unknown, the answer is null,
 * and a lone mark then reads as a decimal mark — never as a guess at the
 * house's locale.
 *
 * Deliberately a plain effect rather than a react-query hook: the price cells
 * render in places with no QueryClientProvider, and a failed read must leave
 * the field working, not throw.
 */
import { useEffect, useState } from 'react'
import { countryByName } from '@/lib/countries'
import { localeOfCountry, setHouseCurrency, setHouseLocale } from '@/lib/houseCurrency'
import { groupMarkForCountry, type GroupMark } from '@/lib/parseDecimal'
import { settingsApi } from '@/services/api/settings'

const reads = new Map<string, Promise<string | null>>()

function activeHouse(): string {
  try {
    return localStorage.getItem('activeRestaurantId') ?? ''
  } catch {
    return ''
  }
}

/** The house's ISO 3166 alpha-2 country, or null when unknown or unread. */
function readCountryCode(house: string): Promise<string | null> {
  let read = reads.get(house)
  if (!read) {
    read = settingsApi
      .houseCurrency()
      .then((h) => (h?.readable ? (countryByName(h.country)?.code ?? null) : null))
      .catch(() => {
        reads.delete(house) // a failed read is retried by the next field, not remembered
        return null
      })
    reads.set(house, read)
  }
  return read
}

function readGroupMark(house: string): Promise<GroupMark | null> {
  return readCountryCode(house).then((code) => groupMarkForCountry(code))
}

/**
 * Forget the remembered mark for one house, or for every house (F-1185, the
 * shape of `forgetHouseZones` for F-995): its country was corrected, so the
 * mark read off the old one is no longer the house's.
 */
export function forgetHouseGroupMarks(house?: string): void {
  if (house) reads.delete(house)
  else reads.clear()
}

/**
 * A house's country was corrected (F-1185). Its thousands mark is forgotten,
 * and when it is the house on screen its money and figure formats are read
 * again, so neither waits for a reload. One read serves both. A failed read
 * leaves the mark unknown and the last good money answer standing.
 */
export async function houseCountryChanged(house: string): Promise<void> {
  forgetHouseGroupMarks(house)
  if (!house || house !== activeHouse()) return
  try {
    const h = await settingsApi.houseCurrency()
    if (house !== activeHouse()) return
    reads.set(house, Promise.resolve(h?.readable ? groupMarkForCountry(countryByName(h.country)?.code) : null))
    setHouseLocale(h?.readable ? localeOfCountry(h.country) : null)
    setHouseCurrency(h?.readable ? h.code : undefined)
  } catch {
    // Nothing remembered: the next field reads the mark again itself.
  }
}

/**
 * The active house's mark outside a component (F-947: a menu CSV upload sends
 * it, so "1.250" in a Turkish house's file reads as 1250 instead of refusing
 * the file). Null when unknown, never a guess.
 */
export function houseGroupMark(): Promise<GroupMark | null> {
  return readGroupMark(activeHouse())
}

export function useHouseGroupMark(): GroupMark | null {
  const [mark, setMark] = useState<GroupMark | null>(null)
  useEffect(() => {
    let live = true
    void readGroupMark(activeHouse()).then((m) => {
      if (live && m !== null) setMark(m)
    })
    return () => {
      live = false
    }
  }, [])
  return mark
}

/**
 * The active house's country code from the same one read (F-1178: the new
 * vendor sheet shows a phone the way it will be saved). Null until the read
 * lands, and when it fails or the country is unknown — never a guess.
 */
export function useHouseCountryCode(): string | null {
  const [code, setCode] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void readCountryCode(activeHouse()).then((c) => {
      if (live && c !== null) setCode(c)
    })
    return () => {
      live = false
    }
  }, [])
  return code
}
