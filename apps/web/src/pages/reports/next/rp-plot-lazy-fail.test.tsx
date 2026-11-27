/**
 * r104 review: a drawing module that does not arrive fails that one drawing,
 * not the page. The sibling card still renders, the failing one says so, and a
 * retry draws it once the module can be had.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CatPlot } from './rp-plot-lazy';
import type { CatSeries } from './rp-view';

const world = vi.hoisted(() => ({ up: false }));

vi.mock('./rp-plot', () => {
  if (!world.up) throw new Error('Failed to fetch dynamically imported module');
  return {
    CatPlot: () => <div data-testid="drawn" className="rp-plot" />,
    ComboPlot: () => null,
    PointPlot: () => null,
  };
});

const series: CatSeries = {
  data: [{ label: 'a', value: 1 }],
  xLabel: 'day',
  yLabel: 'taken',
  unit: 'taken',
  format: String,
};

describe('a drawing that cannot load', () => {
  it('[REVERT-FAILS] says so in its own card, leaves the other cards alone, and retries', async () => {
    render(
      <div>
        <p>the other card</p>
        <CatPlot series={series} kind="line" />
      </div>,
    );
    expect(await screen.findByText(/The drawing could not be read/)).toBeInTheDocument();
    expect(screen.getByText('the other card')).toBeInTheDocument();
    expect(screen.queryByTestId('drawn')).toBeNull();

    world.up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Read it again' }));
    expect(await screen.findByTestId('drawn')).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });
});
