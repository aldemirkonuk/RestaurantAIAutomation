/**
 * F-1310: "Running low" on the dashboard opens the low items, not the whole
 * cellar — the same /inventory?filter=low-stock the bell, push and digest use
 * (InventoryCommandPage reads it as "Below par").
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KpiRow } from './KpiRow';
import { LowStockPanel } from './RailPanels';

describe('Running low links open the low items (F-1310)', () => {
  it('the Running low tile goes to /inventory?filter=low-stock', () => {
    render(
      <MemoryRouter>
        <KpiRow stats={null} pendingCount={0} lowStockCount={3} />
      </MemoryRouter>,
    );
    const tile = screen.getByText('Running low').closest('a')!;
    expect(tile.getAttribute('href')).toBe('/inventory?filter=low-stock');
  });

  it("the rail's Inventory link goes to /inventory?filter=low-stock", () => {
    render(
      <MemoryRouter>
        <LowStockPanel items={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Inventory' }).getAttribute('href')).toBe('/inventory?filter=low-stock');
  });
});
