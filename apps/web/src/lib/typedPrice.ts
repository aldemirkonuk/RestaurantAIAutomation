/**
 * A price a person typed into a text box, as a number, or why it is not one.
 *
 * The same reading as the gateway's `parseMenuPrice` (apps/api-gateway/src/menus/
 * menus.service.ts, menu r21 #1252), so a price typed on /get-started reads the
 * way the same text reads when it is corrected on /menu:
 *   - spaces and a currency mark at either end are dropped (45 TL, $70, ₺ 1 250);
 *   - one separator followed by one or two digits is the decimal ("24,50", "24.50");
 *   - with both marks, the last is the decimal and the other groups thousands
 *     in threes ("1.250,00", "1,250.00");
 *   - one mark followed by three digits ("1,250", "1.250") is refused: it is
 *     1250 in one house and 1.25 in another, and a price is never guessed;
 *   - anything else (a minus, letters, two decimals) is refused.
 * An empty box is no price (`value: null`), never zero.
 *
 * Onboarding r22 D6: the typed-line boxes were `type=number` + parseFloat, so a
 * house that writes a decimal comma could not type "24,50" as 24.50.
 */
export type TypedPrice = { value: number | null } | { refused: string }

const MARK = /^(?:[₺$€£]|TL|TRY|USD|EUR|GBP)/i
const MARK_END = /(?:[₺$€£]|TL|TRY|USD|EUR|GBP)$/i

export function readTypedPrice(raw: string | null | undefined): TypedPrice {
  const typed = String(raw ?? '')
  const s = typed.replace(/\s+/g, '').replace(MARK, '').replace(MARK_END, '')
  const not = (why: string): TypedPrice => ({ refused: `"${typed.trim()}" is not a price: ${why}.` })
  if (typed.trim() === '') return { value: null }
  if (s === '') return not('there is no number in it')
  if (!/^\d[\d.,]*$/.test(s)) return not('a price is written in digits, with no minus, no letters and at most one decimal mark')
  const dot = s.lastIndexOf('.')
  const comma = s.lastIndexOf(',')
  const asNumber = (whole: string, frac: string): TypedPrice => ({ value: Number(`${whole}${frac ? `.${frac}` : ''}`) })
  if (dot >= 0 && comma >= 0) {
    const dec = dot > comma ? '.' : ','
    const group = dec === '.' ? ',' : '.'
    const at = s.lastIndexOf(dec)
    const whole = s.slice(0, at)
    const frac = s.slice(at + 1)
    const grouped = new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})*$`)
    if (frac.length < 1 || frac.length > 2 || !grouped.test(whole)) return not('its marks do not read as one amount')
    return asNumber(whole.split(group).join(''), frac)
  }
  const sep = dot >= 0 ? '.' : comma >= 0 ? ',' : null
  if (sep === null) return asNumber(s, '')
  const parts = s.split(sep)
  if (parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2 && parts[0] !== '') return asNumber(parts[0], parts[1])
  if (parts.length === 2 && parts[1].length === 3 && /^\d{1,3}$/.test(parts[0])) {
    const whole = `${parts[0]}${parts[1]}`
    const small = String(Number(`${parts[0]}.${parts[1]}`))
    return not(`it could be ${whole} or ${small}; write it as ${whole} or ${small}`)
  }
  if (parts.length > 2 && /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => p.length === 3)) {
    return asNumber(parts.join(''), '')
  }
  return not('its marks do not read as one amount')
}
