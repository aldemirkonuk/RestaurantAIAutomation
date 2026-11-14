/**
 * Which page `/inventory` draws (ADR 0315, 2026-10-30 amendment).
 *
 * `inventory` is in LIVE_PAGES, so the route's PageGate always renders its
 * `next` side — that gate is what carries the house header. This picks the
 * page inside it: InventoryNext unless the house's
 * `mudavym_design_inventory_next` answers OFF, then the command page. A plain
 * branch, not a second PageGate: a nested gate would mount a second header
 * and a second sheet stack.
 *
 * [2026-11-13, inventory r28 audit gap 5: the flag is ON by default (founder
 * 2026-10-31) and ON for every house measured, so InventoryNext no longer
 * waits on the flag read before it starts its own reads, and a failed read
 * keeps InventoryNext instead of quietly handing the house the command page.
 * Only an explicit OFF swaps pages. The session's call; rejected: putting
 * `inventory_next` in LIVE_PAGES (drops the per-house switch ADR 0315 kept),
 * and keeping the wait with failure read as ON (still one round trip on every
 * first visit).]
 */
import { useMudavymDesignOnUnlessOff } from '../../../lib/mudavym/useMudavymDesign';
import { InventoryCommandPage } from '../command/InventoryCommandPage';
import InventoryNext from './InventoryNext';

export function InventoryRoute() {
  const next = useMudavymDesignOnUnlessOff('inventory_next');
  return next ? <InventoryNext /> : <InventoryCommandPage />;
}

export default InventoryRoute;
