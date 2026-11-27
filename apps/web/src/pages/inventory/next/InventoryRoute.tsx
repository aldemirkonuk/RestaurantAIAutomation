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
import { Suspense } from 'react';
import { lazyWithRefresh } from '../../../lib/lazyWithRefresh';
import InventoryNext from './InventoryNext';
import { LoadBoundary, PAGE_LOAD_FAILED } from './LazyPanels';

// The command page is the OFF / failed-read side. It is its own file, so a
// house on InventoryNext does not download it, nor the panels only it draws
// (r104 g1: a static import here kept both pages and every shared panel in
// the one route file).
const InventoryCommandPage = lazyWithRefresh(() =>
  import('../command/InventoryCommandPage').then((m) => ({ default: m.InventoryCommandPage })),
);

/** The place held while a file or the flag is read: no picture, no motion. */
function Reading() {
  return (
    <main aria-busy="true" data-testid="inventory-route-reading">
      <p className="sr-only">Reading this house’s inventory…</p>
    </main>
  );
}

export function InventoryRoute() {
  const verdict = useMudavymDesignVerdict('inventory_next');
  if (verdict === null) {
    return <Reading />;
  }
  return verdict ? (
    <InventoryNext />
  ) : (
    <LoadBoundary onFail={PAGE_LOAD_FAILED}>
      <Suspense fallback={<Reading />}>
        <InventoryCommandPage />
      </Suspense>
    </LoadBoundary>
  );
}

export default InventoryRoute;
