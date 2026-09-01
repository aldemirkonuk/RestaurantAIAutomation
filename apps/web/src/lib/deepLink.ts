/**
 * Deep links that land.
 *
 * Roughly ten controls across the dashboard (legacy and Mudavym) navigate with
 * URL parameters — `/orders?orderId=…`, `/inventory?filter=low`,
 * `/wines?wineId=…`, `/reports?focus=revenue`, and the NEW-038/039 reorder
 * payload `/orders?draft=new&inventoryId=…&qty=…`. Until now only
 * `/calendar?openModal=true` and `/inventory?verify=…` had a receiving side;
 * every other destination mounted, ignored the query string entirely, and
 * rendered its bare default. The click looked like it worked.
 *
 * Two rules govern the receiving side, both from ADR 0020 / ADR 0051:
 *
 *  1. A parameter naming something that no longer exists is SAID IN WORDS. It
 *     is never a silently bare page, and it is never a fabricated row. The
 *     caller renders `DeepLinkNotice` for the `missing` state.
 *  2. "Not found" may only be claimed once the list has actually loaded.
 *     While the fetch is in flight the resolution is `pending` — an empty list
 *     mid-flight is not evidence of absence.
 *
 * `resolveDeepLinkTarget` is pure so both rules are testable without a router.
 */

import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export type DeepLinkResolution<T> =
  /** No parameter was supplied — the page renders exactly as it always did. */
  | { status: 'idle' }
  /** A parameter was supplied but the list it names has not loaded yet. */
  | { status: 'pending'; value: string }
  /** The named thing exists. */
  | { status: 'found'; value: string; target: T }
  /** The list loaded and the named thing is not in it. Say so. */
  | { status: 'missing'; value: string; message: string }

/**
 * The sentence shown when a link names something that is not here.
 *
 * It says three things deliberately: what was asked for, that the page did not
 * silently filter itself, and the two ordinary reasons a live id stops
 * resolving. It never guesses which one happened.
 */
export function deepLinkMissingMessage(noun: string, value: string): string {
  return (
    `This link asked for ${noun} “${value}”, and it is not in the list — ` +
    `it may have been deleted, or it may belong to a different restaurant. ` +
    `Nothing below has been filtered or hidden.`
  )
}

export function resolveDeepLinkTarget<T>(args: {
  /** The raw parameter value, or null when the link did not carry one. */
  value: string | null | undefined
  /** The list to look in. `undefined`/`null` means "not loaded". */
  items: readonly T[] | null | undefined
  /** True once the fetch has settled — the only point at which "missing" is knowable. */
  ready: boolean
  match: (item: T, value: string) => boolean
  /** Singular noun for the sentence: "an order", "a wine", "an inventory item". */
  noun: string
}): DeepLinkResolution<T> {
  const value = args.value?.trim()
  if (!value) return { status: 'idle' }
  if (!args.ready || !args.items) return { status: 'pending', value }
  const target = args.items.find((item) => args.match(item, value))
  if (target !== undefined) return { status: 'found', value, target }
  return { status: 'missing', value, message: deepLinkMissingMessage(args.noun, value) }
}

/**
 * The same shape for a parameter that names a *mode* rather than a row —
 * `?filter=low`, `?focus=revenue`. There is no list to wait for, so the answer
 * is immediate: a value outside `allowed` is a missing target, not a no-op.
 */
export function resolveDeepLinkChoice<T extends string>(args: {
  value: string | null | undefined
  allowed: readonly T[]
  /** Optional spelling variants, e.g. `low-stock` → `low`. */
  aliases?: Readonly<Record<string, T>>
  noun: string
}): DeepLinkResolution<T> {
  const raw = args.value?.trim()
  if (!raw) return { status: 'idle' }
  const canonical = (args.aliases?.[raw] ?? raw) as T
  if (args.allowed.includes(canonical)) {
    return { status: 'found', value: raw, target: canonical }
  }
  return {
    status: 'missing',
    value: raw,
    message:
      `This link asked for ${args.noun} “${raw}”, and this page has no such view. ` +
      `Nothing below has been filtered or hidden.`,
  }
}

/** Split `a,b,c` into trimmed non-empty parts. `null` → `[]`. */
export function splitCsvParam(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * Read-and-consume helper. `consume` strips the parameters a page has already
 * acted on so a refresh (or a back-navigation) does not re-open a modal the
 * user just closed — the pattern CalendarPage.tsx:236 established.
 */
export function useDeepLinkParams() {
  const [searchParams, setSearchParams] = useSearchParams()

  const consume = useCallback(
    (...keys: string[]) => {
      setSearchParams(
        (prev) => {
          let touched = false
          keys.forEach((key) => {
            if (prev.has(key)) {
              prev.delete(key)
              touched = true
            }
          })
          return touched ? prev : prev
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return { searchParams, consume }
}
