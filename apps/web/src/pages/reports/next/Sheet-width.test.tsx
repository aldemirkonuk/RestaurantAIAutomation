/**
 * The sheet is laid out at its own measured width on the first paint (r61, c2).
 * `WidthProvider` drew the desktop ruling (1280) first on a phone; the grid
 * now receives the sheet's box width synchronously and is not drawn before it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

const grid = vi.hoisted(() => ({ widths: [] as unknown[] }));

vi.mock('react-grid-layout/legacy', () => ({
  Responsive: (props: Record<string, unknown>) => {
    grid.widths.push(props.width);
    return <div data-testid="grid">{props.children as ReactNode}</div>;
  },
}));

import Sheet from './Sheet';

const cuttings = [{ id: 'till' as const, slot: { x: 0, y: 0, w: 5, h: 9 }, body: <p>through the till</p> }];

let spy: { mockRestore: () => void } | null = null;
afterEach(() => {
  grid.widths = [];
  spy?.mockRestore();
});

describe('Sheet — first paint width', () => {
  it('[REVERT-FAILS] hands the grid the sheet box width (343) from its very first render, never 1280', () => {
    spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(343);
    const { container } = render(<Sheet cuttings={cuttings} arranging={false} onMove={() => {}} />);
    expect(grid.widths.length).toBeGreaterThan(0);
    expect(new Set(grid.widths)).toEqual(new Set([343]));
    expect(container.querySelector('.rp-sheet')).toHaveAttribute('data-measured', 'true');
  });

  it('falls back to the window width when the box reads 0, and still draws', () => {
    spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0);
    render(<Sheet cuttings={cuttings} arranging={false} onMove={() => {}} />);
    expect(new Set(grid.widths)).toEqual(new Set([window.innerWidth]));
  });
});
