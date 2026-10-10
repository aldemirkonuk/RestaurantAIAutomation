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
import { groupMarkForCountry, type GroupMark } from '@/lib/parseDecimal'
import { settingsApi } from '@/services/api/settings'

const reads = new Map<string, Promise<GroupMark | null>>()

function activeHouse(): string {
  try {
    return localStorage.getItem('activeRestaurantId') ?? ''
  } catch {
    return ''
  }
}

function readGroupMark(house: string): Promise<GroupMark | null> {
  let read = reads.get(house)
  if (!read) {
    read = settingsApi
      .houseCurrency()
      .then((h) => (h?.readable ? groupMarkForCountry(countryByName(h.country)?.code) : null))
      .catch(() => {
        reads.delete(house) // a failed read is retried by the next field, not remembered
        return null
      })
    reads.set(house, read)
  }
  return read
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
