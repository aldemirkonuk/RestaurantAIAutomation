/**
 * r104 g4: the page does not wait for recharts. A cutting's drawing loads on
 * demand and shows its outline until the module resolves.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CatPlot } from './rp-plot-lazy';
import type { CatSeries } from './rp-view';

const gate = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { open, opened };
});

vi.mock('./rp-plot', async () => {
  await gate.opened;
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

describe('the drawing loads on demand', () => {
  it('[REVERT-FAILS] shows its outline while the plot module is unresolved, and the drawing replaces it on resolve', async () => {
    render(<CatPlot series={series} kind="line" />);
    expect(screen.getByRole('status', { name: 'Drawing the chart' })).toBeInTheDocument();
    expect(screen.queryByTestId('drawn')).toBeNull();
    gate.open();
    expect(await screen.findByTestId('drawn')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Drawing the chart' })).toBeNull();
  });

  it('[REVERT-FAILS] nothing the page paints first imports recharts: only the lazy module reaches rp-plot', () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
    expect(src('./rp-plot-chrome.tsx')).not.toMatch(/from 'recharts'|from '\.\/rp-plot'/);
    for (const f of ['./Cutting.tsx', './rp-registers-house.tsx'])
      expect(src(f)).not.toMatch(/from '\.\/rp-plot'/);
    expect(src('./rp-plot-lazy.tsx')).toMatch(/import\('\.\/rp-plot'\)/);
  });
});
