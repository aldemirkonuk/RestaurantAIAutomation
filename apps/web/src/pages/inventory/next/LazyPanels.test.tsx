/**
 * The heavy /inventory panels load when asked for, and say so when their file
 * cannot load (r104 g1). The page's own spec (InventoryNext.test.tsx) pins
 * that each panel draws after its file resolves; this one pins the seam.
 */
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuctionLotStart,
  AutoLocatePreviewModal,
  CellarMapView,
  MAP_LOADING,
  MAP_LOAD_FAILED,
  ManualReceiptWorkspace,
  MapSuspense,
  MenuScannerFlow,
  PanelSuspense,
  PosMappingPanel,
  StorageLocationManager,
} from './LazyPanels';

afterEach(cleanup);

const LAZY = Symbol.for('react.lazy');
const PANEL_FILES = [
  "components/inventory/StorageLocationManager",
  "components/inventory/PosMappingPanel",
  "components/inventory/ManualReceiptWorkspace",
  "components/inventory/AutoLocatePreviewModal",
  "components/scanner/MenuScannerFlow",
  'command/AuctionLotStart',
  'command/CellarMapView',
];

describe('the heavy panels are their own files', () => {
  it('every panel is a lazy component', () => {
    for (const C of [AuctionLotStart, AutoLocatePreviewModal, CellarMapView, ManualReceiptWorkspace, MenuScannerFlow, PosMappingPanel, StorageLocationManager]) {
      expect((C as unknown as { $$typeof: symbol }).$$typeof).toBe(LAZY);
    }
  });

  it('the page does not import any of them statically', () => {
    const src = readFileSync(resolve(__dirname, 'InventoryNext.tsx'), 'utf8');
    for (const f of PANEL_FILES) {
      expect(src, f).not.toMatch(new RegExp(`from '[^']*${f}'`));
    }
    expect(src).toMatch(/from '\.\/LazyPanels'/);
  });
});

describe('a panel that could not load says so', () => {
  function Broken(): never {
    throw new Error('Failed to fetch dynamically imported module');
  }

  it('the map says it in its own place, in words', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <MapSuspense>
        <Broken />
      </MapSuspense>,
    );
    expect(screen.getByRole('alert').textContent).toBe(MAP_LOAD_FAILED);
    quiet.mockRestore();
  });

  it('an overlay panel hands the failure to its page once and draws nothing', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onFail = vi.fn();
    const { container } = render(
      <PanelSuspense onFail={onFail}>
        <Broken />
      </PanelSuspense>,
    );
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe('');
    quiet.mockRestore();
  });
});

describe('the wait', () => {
  it('the map holds its place at height, in plain text, until its file arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { lazy } = await import('react');
    const Slow = lazy(() => gate.then(() => ({ default: () => <div data-testid="arrived" /> })));
    render(
      <MapSuspense>
        <Slow />
      </MapSuspense>,
    );
    const hold = screen.getByRole('status');
    expect(hold.textContent).toBe(MAP_LOADING);
    expect((hold as HTMLElement).style.minHeight).toBe('360px');
    // ADR 0112: no animation of any kind while it waits.
    expect(hold.className).not.toMatch(/fade|spin|anim/);
    release();
    await waitFor(() => expect(screen.getByTestId('arrived')).toBeTruthy());
    expect(screen.queryByRole('status')).toBeNull();
  });
});
