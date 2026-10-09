/**
 * F-432: "Running low" reds a wine by the same rule the bell and /inventory
 * call "Critical" — at or under half its minimum (ADR 0129) — not only at 0.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { InventoryItem } from '@/services/api/types';
import { LowStockPanel } from './RailPanels';

const wine = (wineName: string, stockLive: number, thresholdMin: number) =>
  ({ id: wineName, wineName, stockLive, thresholdMin }) as unknown as InventoryItem;

describe('LowStockPanel — one meaning of critical (F-432)', () => {
  it('reds 2 of 5 and 0 of 5, leaves 4 of 5 plain', () => {
    render(
      <MemoryRouter>
        <LowStockPanel items={[wine('Two', 2, 5), wine('Four', 4, 5), wine('None', 0, 5)]} />
      </MemoryRouter>,
    );
    const figure = (name: string) =>
      screen.getByRole('link', { name }).closest('li')!.querySelector('span.shrink-0 > span')!;

    expect(figure('Two').className).toContain('text-seal');
    expect(figure('None').className).toContain('text-seal');
    expect(figure('Four').className).not.toContain('text-seal');
  });
});
