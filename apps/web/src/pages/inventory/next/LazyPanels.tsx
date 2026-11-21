/**
 * The heavy panels /inventory opens on a tap (the cellar map, the menu
 * scanner, the stock-room manager, a delivery without an order, POS mapping,
 * an auction lot, Auto-Locate) load as their own files, only when the page
 * asks for one. Before this they rode in the page's file whether or not the
 * room was ever opened: ~190 KB of source on a page whose first screen is a
 * table (r104 g1).
 *
 * Two rules decide how the wait looks:
 *  - The map is in the page's flow, so its place is held at the height it
 *    will have; no fade (ADR 0112: reduced motion is no animation, opacity
 *    fades included).
 *  - A panel is an overlay with no place to hold, so it draws nothing until
 *    it can be drawn whole; nothing slides or fades in.
 * A file that cannot load says so (ADR 0020): the map in its own place, an
 * overlay as a toast and closed.
 */
import { Component, Suspense, lazy, type ReactNode } from 'react';

export const CellarMapView = lazy(() => import('../command/CellarMapView').then((m) => ({ default: m.CellarMapView })));
export const MenuScannerFlow = lazy(() => import('../../../components/scanner/MenuScannerFlow').then((m) => ({ default: m.MenuScannerFlow })));
export const StorageLocationManager = lazy(() => import('../../../components/inventory/StorageLocationManager').then((m) => ({ default: m.StorageLocationManager })));
export const ManualReceiptWorkspace = lazy(() => import('../../../components/inventory/ManualReceiptWorkspace').then((m) => ({ default: m.ManualReceiptWorkspace })));
export const PosMappingPanel = lazy(() => import('../../../components/inventory/PosMappingPanel').then((m) => ({ default: m.PosMappingPanel })));
export const AuctionLotStart = lazy(() => import('../command/AuctionLotStart').then((m) => ({ default: m.AuctionLotStart })));
export const AutoLocatePreviewModal = lazy(() => import('../../../components/inventory/AutoLocatePreviewModal').then((m) => ({ default: m.AutoLocatePreviewModal })));

/** What a panel that could not load says, as a toast. */
export const PANEL_LOAD_FAILED = 'That could not be opened. Reload the page, then try again.';
/** What the map says in its own place when its file could not load. */
export const MAP_LOAD_FAILED = 'The cellar map could not be opened. Check the connection, then reload the page.';
/** What the held place says while the map's file loads. */
export const MAP_LOADING = 'Opening the cellar map.';

interface BoundaryProps {
  children: ReactNode;
  /** Said when the file could not load. A string draws in place; a function runs once (a toast) and the panel draws nothing. */
  onFail: string | (() => void);
}

class LoadBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    if (typeof this.props.onFail === 'function') this.props.onFail();
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return typeof this.props.onFail === 'string' ? (
      <p role="alert" className="iv-panel-load-failed">
        {this.props.onFail}
      </p>
    ) : null;
  }
}

/** The map's place: held at the height the map will have, plain text, no fade. */
export function MapSuspense({ children }: { children: ReactNode }) {
  return (
    <LoadBoundary onFail={MAP_LOAD_FAILED}>
      <Suspense
        fallback={
          <div className="iv-panel-hold" role="status" style={{ minHeight: 360 }}>
            {MAP_LOADING}
          </div>
        }
      >
        {children}
      </Suspense>
    </LoadBoundary>
  );
}

/** An overlay panel: nothing until it can be drawn whole; a failed load is a toast. */
export function PanelSuspense({ children, onFail }: { children: ReactNode; onFail: () => void }) {
  return (
    <LoadBoundary onFail={onFail}>
      <Suspense fallback={null}>{children}</Suspense>
    </LoadBoundary>
  );
}
