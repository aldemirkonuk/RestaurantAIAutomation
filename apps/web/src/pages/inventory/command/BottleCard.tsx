/**
 * One bottle on a phone, in two lines (N-11).
 *
 * Line one is the name and a status dot; line two is "12 live · par 4" and the
 * house's bottle price. The table row that was nine lines tall on a phone is
 * this card; tapping it opens the SAME expansion the table row opens, in a
 * bottom sheet (InventoryCommandPage mounts it).
 *
 * The status is said twice, in colour and in a word kept for screen readers,
 * so the dot never carries it alone. An unknown count is a dash, never zero.
 */

import { classifyStock, type StockStatusKey } from '../../../lib/inventoryStatus';
import { cn } from '../../../lib/utils';
import type { InventoryItem } from '../useInventoryPage';
import { fmtMoneyExact } from './bits';

const DOT: Record<StockStatusKey, string> = {
  healthy: 'bg-emerald-500',
  at_par: 'bg-emerald-300',
  low: 'bg-amber-500',
  critical: 'bg-rose-600',
  unknown: 'bg-gray-300',
};

export interface BottleCardProps {
  item: InventoryItem;
  open: boolean;
  onOpen: () => void;
}

export function BottleCard({ item, open, onOpen }: BottleCardProps) {
  const status = classifyStock(item.liveStock, item.threshold);
  const live = item.liveStock == null ? '–' : String(item.liveStock);
  const par = item.threshold == null ? '–' : String(item.threshold);
  const price = item.menuPriceBottle == null ? 'no price set' : fmtMoneyExact(item.menuPriceBottle);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="bottle-card"
      className={cn(
        'flex w-full min-h-[64px] flex-col justify-center gap-0.5 border-b border-gray-100 px-4 py-3 text-left',
        'transition-transform duration-[90ms] ease-out active:scale-[0.98]',
        'motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-wine-500',
        open ? 'bg-wine-50/60' : 'bg-white',
      )}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[15px] font-semibold leading-snug text-gray-900">{item.name}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span aria-hidden className={cn('h-2.5 w-2.5 rounded-full', DOT[status.key])} />
          <span className="sr-only">{status.label}</span>
        </span>
      </span>
      <span className="flex items-baseline justify-between gap-3 text-[13px] leading-snug text-gray-500">
        <span className="font-mono tabular-nums">
          {live} live · par {par}
        </span>
        <span className="shrink-0 font-mono tabular-nums">{price}</span>
      </span>
    </button>
  );
}

export default BottleCard;
