/**
 * Which page `/inventory` draws (ADR 0315, 2026-10-30 amendment).
 *
 * `inventory` is in LIVE_PAGES, so the route's PageGate always renders its
 * `next` side — that gate is what carries the house header. This picks the
 * page inside it: InventoryNext when the house's `mudavym_design_inventory_next`
 * is ON, the command page when it is OFF, unread or failed to read (the hook
 * resolves every failure to `false`). A plain branch, not a second PageGate:
 * a nested gate would mount a second header and a second sheet stack.
 */
import { useMudavymDesign } from '../../../lib/mudavym/useMudavymDesign';
import { InventoryCommandPage } from '../command/InventoryCommandPage';
import InventoryNext from './InventoryNext';

export function InventoryRoute() {
  return useMudavymDesign('inventory_next') ? <InventoryNext /> : <InventoryCommandPage />;
}

export default InventoryRoute;
