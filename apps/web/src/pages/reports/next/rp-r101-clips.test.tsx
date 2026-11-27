/**
 * r101 (r100 check 5): a sheet card is never clipped. jsdom has no layout, so each geometry is pinned at the
 * seam that decides it: the phone stack's slot is a floor, the arrange controls' rows are added to the grid
 * card (and never saved), the card reports its controls' height, and the landscape head wraps the window
 * sentence under the title.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const grid = vi.hoisted(() => ({
  props: null as null | {
    layouts?: { lg: Array<{ i: string; h: number }> };
    onResizeStop?: (l: ReadonlyArray<{ i: string; x: number; y: number; w: number; h: number }>) => void;
  },
}));
vi.mock('react-grid-layout/legacy', () => ({
  Responsive: (props: Record<string, unknown>) => {
    grid.props = props as typeof grid.props;
    return <div>{props.children as ReactNode}</div>;
  },
}));

import Sheet from './Sheet';
import Cutting from './Cutting';
import { controlRows } from './rp-fit';
import { ANALYSIS_IDS } from './rp-sheet';
import type { ArrangeApi } from './rp-arrange';

let widthSpy: { mockRestore: () => void } | null = null;
const setWidth = () => {
  Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
  widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(343);
};
const css = (f: string) => readFileSync(join(__dirname, f), 'utf8');
afterEach(() => {
  cleanup();
  widthSpy?.mockRestore();
  widthSpy = null;
});

describe('controlRows', () => {
  it('[REVERT-FAILS] counts the 48 px rows that hold the controls, rounding up', () => {
    expect(controlRows(undefined)).toBe(0);
    expect(controlRows(0)).toBe(0);
    expect(controlRows(48)).toBe(1);
    expect(controlRows(49)).toBe(2);
    expect(controlRows(170)).toBe(4);
  });
});

describe('arranging adds the controls rows to the grid card, and saves without them', () => {
  const cuttings = [
    { id: 'till' as const, slot: { x: 0, y: 0, w: 6, h: 9 }, extraRows: 3, body: <p>till</p> },
    { id: 'ledger' as const, slot: { x: 6, y: 0, w: 6, h: 9 }, body: <p>ledger</p> },
  ];
  it('[REVERT-FAILS] draws 9 + 3 rows while arranging and 9 while reading', () => {
    render(<Sheet cuttings={cuttings} arranging onMove={() => {}} />);
    expect(grid.props?.layouts?.lg.find((l) => l.i === 'till')?.h).toBe(12);
    expect(grid.props?.layouts?.lg.find((l) => l.i === 'ledger')?.h).toBe(9);
    cleanup();
    render(<Sheet cuttings={cuttings} arranging={false} onMove={() => {}} />);
    expect(grid.props?.layouts?.lg.find((l) => l.i === 'till')?.h).toBe(9);
  });
  it('[REVERT-FAILS] a resize to 14 rows is saved as 11: the controls are not part of the slot', () => {
    const onMove = vi.fn();
    render(<Sheet cuttings={cuttings} arranging onMove={onMove} />);
    grid.props?.onResizeStop?.([
      { i: 'till', x: 0, y: 0, w: 6, h: 14 },
      { i: 'ledger', x: 6, y: 0, w: 6, h: 9 },
    ]);
    expect(onMove.mock.calls[0][0].till.h).toBe(11);
    expect(onMove.mock.calls[0][0].ledger.h).toBe(9);
  });
});

describe('a card reports the height of its arrange controls', () => {
  const noop = vi.fn();
  const arrange: ArrangeApi = {
    ...{ picked: null, origin: null, message: '', cols: 12, keyDown: () => noop },
    ...{ pickUp: noop, place: noop, cancel: noop, nudge: noop, resize: noop },
  };
  const draw = (arranging: boolean, onControls: (id: string, px: number | null) => void) =>
    render(
      <MemoryRouter>
        <Cutting
          id="week"
          graph="bars"
          register={{ data: undefined, loading: true, failure: null, refetch: vi.fn() } as never}
          ctx={{ days: 30 }}
          arranging={arranging}
          swapOptions={ANALYSIS_IDS.map((id) => ({ id, taken: false }))}
          arrange={arrange}
          onGraph={vi.fn()}
          onSwap={vi.fn()}
          onRemove={vi.fn()}
          onDays={vi.fn()}
          onControls={onControls as never}
        />
      </MemoryRouter>,
    );
  it('[REVERT-FAILS] says its controls row is 132 px while arranging, and null when reading', () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(131.2);
    const seen = vi.fn();
    draw(true, seen);
    expect(seen).toHaveBeenLastCalledWith('week', 132);
    cleanup();
    const reading = vi.fn();
    draw(false, reading);
    expect(reading).toHaveBeenLastCalledWith('week', null);
    spy.mockRestore();
  });
});

describe('the stylesheets', () => {
  it('[REVERT-FAILS] only text cards (reading, goals, writing) grow; arranging adds the controls rows to a held chart', () => {
    setWidth();
    const cs = [
      { id: 'till' as const, slot: { x: 0, y: 0, w: 4, h: 8 }, extraRows: 3, body: <p>t</p> },
      { id: 'writing' as const, slot: { x: 0, y: 8, w: 4, h: 3 }, body: <p>w</p> },
    ];
    const { container } = render(<Sheet cuttings={cs} arranging={false} onMove={() => {}} />);
    const [till, writing] = Array.from(container.querySelectorAll<HTMLElement>('.rp-stack__item'));
    expect([till.style.height, till.style.minHeight]).toEqual(['370px', '']);
    expect([writing.style.height, writing.style.minHeight]).toEqual(['', '130px']);
    cleanup();
    const a = render(<Sheet cuttings={cs} arranging onMove={() => {}} />);
    expect(a.container.querySelector<HTMLElement>('.rp-stack__item')!.style.height).toBe('514px');
  });
  it('[REVERT-FAILS] a strip keeps its sentence: it never shrinks, the figure rows hide, the title never shrinks', () => {
    const t = css('reports-next.css');
    expect(t).toMatch(/\.rp-cut\[data-strip\] \.rp-empty-strip,\s*\.rp-cut\[data-strip\] \.rp-quiet \{\s*flex: 0 0 auto;/);
    expect(t).toMatch(/\.rp-cut\[data-strip\] \.rp-cut__body > :not\(\.rp-empty-strip\):not\(\.rp-quiet\) \{\s*display: none;/);
    expect(t).toMatch(/\.rp-cut\[data-strip\] \.rp-cut__title \{\s*flex: none;/);
  });
  it('[REVERT-FAILS] the phone stack card fills a slot that is only a floor, and grows past it', () => {
    const t = css('reports-next.css');
    expect(t).toMatch(/\.rp-stack__item \{[^}]*display: flex;[^}]*flex-direction: column;/);
    expect(t).toMatch(/\.rp-stack__item > \.rp-cut \{\s*flex: 1 1 auto;\s*height: auto;/);
  });
  it('[REVERT-FAILS] the landscape head stacks the window sentence under the title and never ellipsises it', () => {
    const landscape = css('reports-flat.css').split('@media (max-height: 500px) {')[1].split('@media (min-width: 900px)')[0];
    expect(landscape).toMatch(/\.rp-flat__row > div:first-child \{[^}]*flex-direction: column;/);
    expect(landscape).toMatch(/\.rp-flat__row \.rp-cut__window \{[^}]*white-space: normal;/);
    expect(landscape).not.toMatch(/\.rp-cut__window \{[^}]*text-overflow: ellipsis/);
  });
});
