/**
 * Below 768 px the sheet is a plain CSS column (r74): react-grid-layout is not
 * mounted on a phone, and the decision needs no measurement.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

const grid = vi.hoisted(() => ({ renders: 0 }));

vi.mock('react-grid-layout/legacy', () => ({
  Responsive: (props: Record<string, unknown>) => {
    grid.renders += 1;
    return <div data-testid="grid">{props.children as ReactNode}</div>;
  },
}));

import Sheet from './Sheet';

const cuttings = [
  { id: 'week' as const, slot: { x: 0, y: 0, w: 4, h: 8 }, body: <p>the week</p> },
  { id: 'till' as const, slot: { x: 0, y: 8, w: 4, h: 3 }, body: <p>through the till</p> },
];

const innerWidth = window.innerWidth;
let spy: { mockRestore: () => void } | null = null;
afterEach(() => {
  grid.renders = 0;
  spy?.mockRestore();
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true });
});
const setWindow = (w: number) =>
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });

describe('Sheet — phone stack', () => {
  it('[REVERT-FAILS] draws a one-column stack in list order with no grid at 343', () => {
    setWindow(375);
    spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(343);
    const { container } = render(<Sheet cuttings={cuttings} arranging={false} onMove={() => {}} />);
    expect(grid.renders).toBe(0);
    const items = container.querySelectorAll<HTMLElement>('.rp-stack > .rp-stack__item');
    expect(Array.from(items).map((i) => i.textContent)).toEqual(['the week', 'through the till']);
    // 8 rows of 34 px and 7 gaps of 14; 3 rows and 2 gaps.
    expect(items[0].style.height).toBe('370px');
    expect(items[1].style.height).toBe('130px');
    expect(container.querySelector('.rp-sheet')).toHaveAttribute('data-layout', 'stack');
    expect(container.querySelector('.rp-sheet')).toHaveAttribute('data-measured', 'true');
  });

  it('[REVERT-FAILS] needs no measurement: a box that reads 0 on a 375 window is still a stack', () => {
    setWindow(375);
    spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(0);
    const { container } = render(<Sheet cuttings={cuttings} arranging onMove={() => {}} />);
    expect(grid.renders).toBe(0);
    expect(container.querySelectorAll('.rp-stack__item')).toHaveLength(2);
  });

  it('keeps the grid at desktop width', () => {
    setWindow(1280);
    spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
    const { container } = render(<Sheet cuttings={cuttings} arranging={false} onMove={() => {}} />);
    expect(grid.renders).toBeGreaterThan(0);
    expect(container.querySelector('.rp-stack')).toBeNull();
    expect(container.querySelector('.rp-sheet')).toHaveAttribute('data-layout', 'grid');
  });

  it('a wide window with a narrow sheet box (side rail) still stacks once measured', () => {
    setWindow(900);
    spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    const { container } = render(<Sheet cuttings={cuttings} arranging={false} onMove={() => {}} />);
    expect(container.querySelector('.rp-stack')).not.toBeNull();
  });
});
