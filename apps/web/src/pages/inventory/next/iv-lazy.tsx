/**
 * Panels /inventory draws only when asked, read when they are first drawn.
 *
 * [2026-11-14, r41 inventory audit gap 1: the menu scanner (with the whole
 * wine database its results panel colours one badge from) and the shelf map
 * were downloaded with every /inventory visit. They open from a button and a
 * view switch, so they are read then. Each wrapper carries its own Suspense,
 * so InventoryNext changes only the two import lines and keeps the same
 * props. Rejected: also deferring StorageLocationManager for its
 * framer-motion; four other panels on the page import framer-motion
 * statically, so it would save nothing alone.]
 */
import { Suspense, type ComponentProps } from 'react';
import { lazyWithRefresh } from '../../../lib/lazyWithRefresh';

type ScannerProps = ComponentProps<typeof import('../../../components/scanner/MenuScannerFlow').MenuScannerFlow>;
type MapProps = ComponentProps<typeof import('../command/CellarMapView').CellarMapView>;

const ScannerChunk = lazyWithRefresh(() =>
  import('../../../components/scanner/MenuScannerFlow').then((m) => ({ default: m.MenuScannerFlow })),
);
const MapChunk = lazyWithRefresh(() =>
  import('../command/CellarMapView').then((m) => ({ default: m.CellarMapView })),
);

export function MenuScannerFlow(props: ScannerProps) {
  return (
    <Suspense
      fallback={
        <p role="status" className="sr-only" data-testid="inv-scanner-opening">
          Opening the menu scanner…
        </p>
      }
    >
      <ScannerChunk {...props} />
    </Suspense>
  );
}

export function CellarMapView(props: MapProps) {
  return (
    <Suspense
      fallback={
        <p role="status" className="iv-said" data-testid="inv-map-opening">
          Drawing the shelf map…
        </p>
      }
    >
      <MapChunk {...props} />
    </Suspense>
  );
}
