/**
 * "Read a stretch" on the drawing (r108 g3): the readout slot is reserved
 * under every till drawing that offers a stretch and under none that does
 * not, a press-drag across days says them, Escape clears it, and a press on a
 * sheet being arranged is the cutting's drag, never a stretch.
 */
import { cloneElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { CatPlot, ComboPlot, STRETCH_HINT } from './rp-plot';
import { daysBetween, till, type TillWindow } from './rp-registers-trade';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 640, height: 320 } as never),
  };
});

const WEEK = daysBetween('2026-11-04', '2026-11-09');
const view = till.view(
  till.select({
    posConnected: true,
    revenue: 4120,
    checkCount: 212,
    from: WEEK[0],
    to: WEEK[5],
    days: 6,
    timezone: 'Europe/Istanbul',
    dailySeries: [100, 900, 400, 1200, 1000, 520].map((revenue, i) => ({
      date: WEEK[i],
      revenue,
      checks: [10, 30, 20, 40, 50, 62][i],
    })),
  }) as TillWindow,
  { days: 6, currency: 'USD' },
);
const series = view.cats!;

/** Recharts reads the pointer off pageX inside its wrapper (jsdom puts the wrapper at 0,0). */
const at = (x: number) => ({ pageX: x, pageY: 150, clientX: x, clientY: 150 });

describe('read a stretch on the drawing', () => {
  it.each(['bars', 'line', 'area'] as const)('[REVERT-FAILS] %s reserve the readout slot and say how to start', (kind) => {
    const { container } = render(<CatPlot series={series} kind={kind} />);
    const slot = container.querySelector('.rp-stretch');
    expect(slot).not.toBeNull();
    expect(slot).toHaveTextContent(STRETCH_HINT);
    expect(slot).toHaveAttribute('aria-live', 'polite');
  });

  it('[REVERT-FAILS] bars and a line reserve it too', () => {
    const { container } = render(<ComboPlot series={series} />);
    expect(container.querySelector('.rp-stretch')).toHaveTextContent(STRETCH_HINT);
  });

  it('[REVERT-FAILS] a drawing that offers no stretch reserves no slot', () => {
    const { stretch: _s, stretchFrom: _f, ...plain } = series;
    const { container } = render(<CatPlot series={plain} kind="bars" />);
    expect(container.querySelector('.rp-stretch')).toBeNull();
    expect(container.querySelector('.rp-plot')).not.toHaveAttribute('data-stretch-id');
  });

  it('[REVERT-FAILS] a press-drag says the days it crossed; Escape clears them', () => {
    const { container } = render(<CatPlot series={series} kind="bars" />);
    const wrapper = container.querySelector('.recharts-wrapper')!;
    fireEvent.mouseDown(wrapper, at(80));
    fireEvent.mouseMove(wrapper, at(600));
    fireEvent.mouseUp(wrapper, at(600));
    const slot = container.querySelector('.rp-stretch')!;
    expect(slot).toHaveAttribute('data-state', 'read');
    expect(slot.textContent).toMatch(/^Wed, Nov 4 – .* · Taken \$/);
    expect(container.querySelector('.rp-plot')).toHaveAttribute('data-stretching', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(slot).toHaveTextContent(STRETCH_HINT);
    expect(container.querySelector('.rp-plot')).toHaveAttribute('data-stretching', 'false');
  });

  it('[REVERT-FAILS] a press on a sheet being arranged marks nothing', () => {
    const { container } = render(
      <div data-arranging="true">
        <CatPlot series={series} kind="bars" />
      </div>,
    );
    const wrapper = container.querySelector('.recharts-wrapper')!;
    fireEvent.mouseDown(wrapper, at(80));
    fireEvent.mouseUp(wrapper, at(80));
    expect(container.querySelector('.rp-stretch')).toHaveTextContent(STRETCH_HINT);
  });
});
