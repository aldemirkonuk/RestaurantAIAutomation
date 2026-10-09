/**
 * One reader for a number a person TYPED into a money or quantity field.
 *
 * WHY THIS FILE EXISTS (F-358, sim wave 6, 2026-10-09). Every free-text price
 * field read its text with a bare `Number()`. In a Turkish house "1.250"
 * (₺1,250) was saved as 1.25, "12,50" was NaN and refused, and the iOS decimal
 * keypad in a Turkish region shows only "," — so no fractional price could be
 * typed there at all. `ProposalThread` alone swapped "," for ".", which turned
 * "1.250,00" into NaN. Six fields, three behaviours.
 *
 * THE RULE, IN ORDER
 * ------------------
 *   1. Spaces, a leading or trailing currency sign ($ € ₺ £ ¥) and a trailing
 *      "TL" are dropped. A leading "-" is kept; callers refuse negatives.
 *   2. Both "." and "," present: the LAST one is the decimal mark and the other
 *      groups thousands — "1.250,00" and "1,250.00" are both 1250. The decimal
 *      mark may appear once, after every group mark.
 *   3. One mark, written more than once ("1.250.000"): it groups thousands.
 *   4. One mark, written once — the only ambiguous shape. It is a thousands
 *      group ONLY when it is followed by exactly three digits AND the house's
 *      own locale groups with that mark (`group` below): "1.250" is 1250 in a
 *      Turkish house and 1.25 in an American one. In every other case — two
 *      digits after it, four, a leading zero, or a house whose locale is not
 *      known — it is the decimal mark. "12,50" is 12.5 everywhere.
 *   5. Whenever a group mark is used, the groups must be real: one to three
 *      digits, then threes. "1.2.3" is not a number, and neither is "1,25,0".
 *
 * Anything else — letters, two decimal marks, an empty string — is `null`.
 * The caller decides what blank means; this file never turns text into 0.
 */

export type GroupMark = '.' | ','

const SIGNS = /^[$€₺£¥]+|[$€₺£¥]+$/g
const SPACES = /[\s\u00a0\u202f\u2009]/g

function escape(mark: GroupMark): string {
  return mark === '.' ? '\\.' : ','
}

/** The integer part, with its group marks removed, or null when the grouping is not real. */
function ungroup(intPart: string, mark: GroupMark | null): string | null {
  if (mark === null) return /^\d*$/.test(intPart) ? intPart : null
  const grouped = new RegExp(`^[1-9]\\d{0,2}(${escape(mark)}\\d{3})+$`)
  return grouped.test(intPart) ? intPart.split(mark).join('') : null
}

/**
 * `raw` as a number, or null when it is blank or not a number.
 * `group` is the mark the house's locale groups thousands with, when known.
 */
export function parseDecimal(raw: string, group: GroupMark | null = null): number | null {
  let s = raw.replace(SPACES, '').replace(/tl$/i, '').replace(SIGNS, '')
  let sign = 1
  if (s.startsWith('-')) {
    sign = -1
    s = s.slice(1).replace(SIGNS, '')
  }
  if (s === '' || !/^[\d.,]+$/.test(s)) return null

  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  let groupMark: GroupMark | null = null
  let decimalAt = -1

  if (lastDot >= 0 && lastComma >= 0) {
    // Rule 2: the later mark is the decimal one.
    decimalAt = Math.max(lastDot, lastComma)
    groupMark = lastDot > lastComma ? ',' : '.'
  } else if (lastDot >= 0 || lastComma >= 0) {
    const mark: GroupMark = lastDot >= 0 ? '.' : ','
    const at = Math.max(lastDot, lastComma)
    if (s.indexOf(mark) !== at) {
      groupMark = mark // Rule 3: written more than once.
    } else {
      const head = s.slice(0, at)
      const tail = s.slice(at + 1)
      // Rule 4: a lone mark groups only when the house says so.
      const groups = group === mark && /^\d{3}$/.test(tail) && /^[1-9]\d{0,2}$/.test(head)
      if (groups) groupMark = mark
      else decimalAt = at
    }
  }

  const intRaw = decimalAt >= 0 ? s.slice(0, decimalAt) : s
  const frac = decimalAt >= 0 ? s.slice(decimalAt + 1) : ''
  if (!/^\d*$/.test(frac)) return null
  const intPart = ungroup(intRaw, groupMark)
  if (intPart === null || (intPart === '' && frac === '')) return null

  const n = Number(`${intPart || '0'}.${frac || '0'}`)
  return Number.isFinite(n) ? sign * n : null
}

/**
 * The mark a country's numbers group thousands with, from the runtime's own
 * locale data (CLDR via `Intl`), or null when it is neither "." nor "," or the
 * country is unknown. `countryCode` is ISO 3166-1 alpha-2: "TR" gives ".",
 * "US" gives ",", "FR" (a space) gives null — so rule 4 never groups there.
 */
export function groupMarkForCountry(countryCode: string | null | undefined): GroupMark | null {
  if (!countryCode || !/^[A-Za-z]{2}$/.test(countryCode)) return null
  try {
    const locale = new Intl.Locale(`und-${countryCode.toUpperCase()}`).maximize().toString()
    const part = new Intl.NumberFormat(locale).formatToParts(1234567).find((p) => p.type === 'group')
    return part?.value === '.' || part?.value === ',' ? part.value : null
  } catch {
    return null
  }
}

/**
 * An optional amount field — a minimum order, a cost, a limit. Blank is
 * `value: null` (nothing stated; the caller decides what that sends); anything
 * else must read as a number of 0 or more, or the field is refused rather than
 * sent as NaN or a misread figure.
 */
export function readOptionalAmount(
  raw: string,
  group: GroupMark | null = null,
): { ok: true; value: number | null } | { ok: false } {
  if (raw.trim() === '') return { ok: true, value: null }
  const n = parseDecimal(raw, group)
  return n === null || n < 0 ? { ok: false } : { ok: true, value: n }
}
