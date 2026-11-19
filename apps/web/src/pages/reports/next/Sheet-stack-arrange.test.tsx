/**
 * Arranging on a phone (r74 follow-up). Below 768 px the sheet is a plain
 * one-column CSS stack, so the keyboard and the buttons must offer only what
 * that stack can show: up and down (list order), shorter and taller. No column
 * is on screen, so none is offered, announced or saved.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useRef, useState, type ReactNode } from 'react';

vi.mock('react-grid-layout/legacy', () => ({
  Responsive: (props: Record<string, unknown>) => (
    <div data-testid="grid">{props.children as ReactNode}</div>
  ),
}));

import Sheet from './Sheet';
import { ArrangeAnnouncer, ArrangeHelp, Grip, PlacingBar } from './Placing';
import { useArrange } from './rp-arrange';
import type { AnalysisId, Cutting } from './rp-sheet';

const START: Cutting[] = [
  { id: 'week', slot: { x: 0, y: 0, w: 5, h: 8 } },
  { id: 'till', slot: { x: 5, y: 0, w: 7, h: 6 } },
  { id: 'ledger', slot: { x: 0, y: 8, w: 12, h: 4 } },
] as Cutting[];
const TITLES: Record<string, string> = { week: 'The week', till: 'The till', ledger: 'The ledger' };

let saved: Cutting[] = START;
function Harness({ arranging = true }: { arranging?: boolean }) {
  const [cuttings, setCuttings] = useState<Cutting[]>(START);
  saved = cuttings;
  const el = useRef<HTMLElement | null>(null);
  const hold = useCallback((n: HTMLDivElement | null) => {
    el.current = n;
  }, []);
  const arrange = useArrange({ cuttings, apply: setCuttings, sheetRef: el, arranging });
  return (
    <>
      <ArrangeHelp stacked={arrange.cols === 1} />
      <Sheet
        arranging={arranging}
        onMove={() => {}}
        containerRef={hold}
        cuttings={cuttings.map((c) => ({
          id: c.id as AnalysisId,
          slot: c.slot,
          body: (
            <div data-cut={c.id}>
              <Grip id={c.id as AnalysisId} title={TITLES[c.id]} arrange={arrange} />
              {arrange.picked === c.id && <PlacingBar title={TITLES[c.id]} arrange={arrange} />}
            </div>
          ),
        }))}
      />
      <ArrangeAnnouncer message={arrange.message} />
    </>
  );
}

const innerWidth = window.innerWidth;
let spy: { mockRestore: () => void } | null = null;
afterEach(() => {
  spy?.mockRestore();
  Object.defineProperty(window, 'innerWidth', { value: innerWidth, configurable: true });
});
function phone(w = 375, box = 343) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(box);
}
const order = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>('.rp-stack [data-cut]')).map((n) => n.dataset.cut);
const said = () => screen.getByRole('status').textContent ?? '';

describe('Sheet arranging while stacked', () => {
  it('[REVERT-FAILS] picks up, reorders by ArrowDown, and names no column', () => {
    phone();
    const { container } = render(<Harness />);
    expect(order(container)).toEqual(['week', 'till', 'ledger']);
    const grip = screen.getByRole('button', { name: 'Move The till' });
    fireEvent.click(grip);
    expect(said()).toContain('position 2 of 3');
    expect(said()).not.toMatch(/column/i);
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    expect(order(container)).toEqual(['week', 'ledger', 'till']);
    expect(said()).toContain('position 3 of 3');
    expect(said()).not.toMatch(/column/i);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Placing The till' }), { key: 'ArrowUp' });
    expect(order(container)).toEqual(['week', 'till', 'ledger']);
  });

  it('[REVERT-FAILS] offers no left, right, narrower or wider, and keeps the rest', () => {
    phone();
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Move The till' }));
    for (const gone of [/left one column/, /right one column/, /narrower/, /wider/]) {
      expect(screen.queryByRole('button', { name: gone })).toBeNull();
    }
    for (const kept of [/past the cutting below/, /past the cutting above/, /shorter/, /taller/, /Place it/, /Put it back/]) {
      expect(screen.getByRole('button', { name: kept })).toBeTruthy();
    }
    expect(screen.getByText(/Or reach a cutting with the keyboard/).textContent).not.toMatch(/column/i);
  });

  it('[REVERT-FAILS] Shift+Left/Right do nothing, and the saved desktop slots are not collapsed', () => {
    phone();
    render(<Harness />);
    const grip = screen.getByRole('button', { name: 'Move The till' });
    fireEvent.click(grip);
    const before = said();
    fireEvent.keyDown(grip, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(grip, { key: 'ArrowLeft' });
    expect(said()).toBe(before);
    expect(saved).toEqual(START);
    // Taller / shorter and a reorder rewrite height and order only.
    fireEvent.click(screen.getByRole('button', { name: /one row taller/ }));
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    const till = saved.find((c) => c.id === 'till')!;
    expect(till.slot.h).toBe(7);
    expect(saved.map((c) => [c.id, c.slot.x, c.slot.w])).toEqual(
      expect.arrayContaining([['week', 0, 5], ['till', 5, 7], ['ledger', 0, 12]]),
    );
  });

  it('keeps every column control at desktop width', () => {
    spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Move The till' }));
    expect(screen.getByRole('button', { name: /left one column/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /wider/ })).toBeTruthy();
    expect(said()).toContain('of 12');
  });
});
