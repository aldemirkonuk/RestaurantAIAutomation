/**
 * r41 inventory audit gap 1: the menu scanner and the shelf map are read when
 * they are first drawn, not with /inventory. The wrappers keep the props and
 * say what is opening while the chunk is read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  scannerRead: vi.fn(),
  mapRead: vi.fn(),
  gate: Promise.resolve() as Promise<void>,
}));
vi.mock('../../../components/scanner/MenuScannerFlow', async () => {
  h.scannerRead();
  await h.gate;
  return {
    MenuScannerFlow: (p: { restaurantId?: string; isOpen: boolean }) => (
      <div data-testid="scanner">{`${p.restaurantId}:${p.isOpen}`}</div>
    ),
  };
});
vi.mock('../command/CellarMapView', async () => {
  h.mapRead();
  await h.gate;
  return { CellarMapView: (p: { items: unknown[] }) => <div data-testid="map">{p.items.length}</div> };
});

async function fresh() {
  vi.resetModules();
  return import('./iv-lazy');
}

describe('iv-lazy', () => {
  beforeEach(() => {
    h.scannerRead.mockReset();
    h.mapRead.mockReset();
    h.gate = Promise.resolve();
  });

  it('reads neither panel until one is drawn', async () => {
    await fresh();
    await new Promise((r) => setTimeout(r, 10));
    expect(h.scannerRead).not.toHaveBeenCalled();
    expect(h.mapRead).not.toHaveBeenCalled();
  });

  it('says the scanner is opening, then draws it with the same props', async () => {
    let release!: () => void;
    h.gate = new Promise<void>((r) => (release = r));
    const { MenuScannerFlow } = await fresh();
    render(<MenuScannerFlow isOpen onClose={() => {}} restaurantId="r1" />);
    expect((await screen.findByTestId('inv-scanner-opening')).textContent).toBe('Opening the menu scanner…');
    release();
    expect((await screen.findByTestId('scanner')).textContent).toBe('r1:true');
    expect(screen.queryByTestId('inv-scanner-opening')).toBeNull();
    expect(h.scannerRead).toHaveBeenCalledTimes(1);
    expect(h.mapRead).not.toHaveBeenCalled();
  });

  it('says the map is being drawn, then draws it with the same props', async () => {
    let release!: () => void;
    h.gate = new Promise<void>((r) => (release = r));
    const { CellarMapView } = await fresh();
    const props = {
      items: [{}, {}] as never[],
      locations: [],
      locationsLoading: false,
      locationsUnavailable: false,
      onOpenInTable: () => {},
      onManageLocations: () => {},
    } as unknown as Parameters<typeof CellarMapView>[0];
    render(<CellarMapView {...props} />);
    expect((await screen.findByTestId('inv-map-opening')).textContent).toBe('Drawing the shelf map…');
    release();
    expect((await screen.findByTestId('map')).textContent).toBe('2');
    expect(h.mapRead).toHaveBeenCalledTimes(1);
    expect(h.scannerRead).not.toHaveBeenCalled();
  });
});
