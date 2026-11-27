import { formatMoney } from '@/lib/currency'
import type { PrintedSize } from '../../../services/api/menus'

/**
 * Every size a menu line prints (r109 menu-g3, DD-r109-24), listed as printed:
 * "20 cl 450 · 35 cl 700 · 70 cl 1,200". Shown, never carried: the line's
 * glass and bottle price are the only prices a menu sets (ADR 0193), so no
 * size enters the plan, its fingerprint or a house price, and the sentence
 * says what does not move them. Layout only, no motion.
 */
export const SIZES_STAY = 'Shown as printed. Raise prices and the downloaded sheet leave these sizes as they are.'

export function PrintedSizes({ sizes, currency }: { sizes: PrintedSize[] | null | undefined; currency: string | null }) {
  if (!sizes || sizes.length < 2) return null
  const said = sizes.map((s) => `${s.label} ${formatMoney(s.price, currency)}`)
  return (
    <span className="mdv-line-sizes" data-testid="menu-line-sizes" aria-label={`Sizes as printed on the menu: ${said.join(', ')}`}>
      <span>{said.join(' · ')}</span>
      <span className="cl-note" title={SIZES_STAY}>
        {SIZES_STAY}
      </span>
    </span>
  )
}
