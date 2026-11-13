/**
 * Which page `/inventory` draws (ADR 0315, 2026-10-30 amendment).
 *
 * `inventory` is in LIVE_PAGES, so the route's PageGate always renders its
 * `next` side — that gate is what carries the house header. This picks the
 * page inside it: InventoryNext when the house's `mudavym_design_inventory_next`
 * is ON, the command page when it is OFF or failed to read (the hook resolves
 * every failure to `false`). A plain branch, not a second PageGate: a nested
 * gate would mount a second header and a second sheet stack.
 *
 * While the flag is still being read, neither page mounts: drawing the command
 * page first would start its reads and consume `?highlight=` / `?wine=` before
 * InventoryNext replaced it (#677 gate plan, 2026-10-31).
 */
import { useMudavymDesignVerdict } from '../../../lib/mudavym/useMudavymDesign';
import { InventoryCommandPage } from '../command/InventoryCommandPage';
import InventoryNext from './InventoryNext';

export function InventoryRoute() {
  const verdict = useMudavymDesignVerdict('inventory_next');
  if (verdict === null) {
    return (
      <main aria-busy="true" data-testid="inventory-route-reading">
        <p className="sr-only">Reading this house’s inventory…</p>
      </main>
    );
  }
  return verdict ? <InventoryNext /> : <InventoryCommandPage />;
}

export default InventoryRoute;
