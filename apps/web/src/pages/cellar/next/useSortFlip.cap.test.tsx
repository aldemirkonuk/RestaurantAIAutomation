/** The slide is all or nothing: every moved row slides up to FLIP_ROW_CAP rows, none past it (r108 DD-r108-33). */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { FLIP_ROW_CAP, useSortFlip } from './useSortFlip';

const animate = vi.fn();
afterEach(() => { delete (Element.prototype as unknown as { animate?: unknown }).animate; });

function Table({ ids, expose }: { ids: string[]; expose: (before: () => void) => void }) {
  const body = useRef<HTMLTableSectionElement | null>(null);
  const flip = useSortFlip(body, ids.join(','));
  expose(flip.before);
  return <table><tbody ref={body}>{ids.map((i) => <tr key={i} data-row={i}><td>{i}</td></tr>)}</tbody></table>;
}

function slide(n: number) {
  (Element.prototype as unknown as { animate: unknown }).animate = animate;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  const real = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const at = Array.from(this.parentElement!.children).indexOf(this) * 40;
    return { top: at, bottom: at + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: at, toJSON() {} } as DOMRect;
  };
  const ids = Array.from({ length: n }, (_, i) => `r${i}`);
  let before: () => void = () => {};
  const { rerender } = render(<Table ids={ids} expose={(b) => { before = b; }} />);
  animate.mockClear();
  act(() => { before(); });
  rerender(<Table ids={[...ids].reverse()} expose={(b) => { before = b; }} />);
  HTMLElement.prototype.getBoundingClientRect = real;
}

describe('useSortFlip row cap', () => {
  it('slides every row when exactly the cap moves', () => {
    slide(FLIP_ROW_CAP);
    expect(animate).toHaveBeenCalledTimes(FLIP_ROW_CAP);
  });

  it('slides none when more than the cap move: no part-slide with rows crossing others in place (r108 fix)', () => {
    slide(100);
    expect(animate).toHaveBeenCalledTimes(0);
  });

  it('a snapshot that drew no row change is dropped, so it cannot play against a later change (r108 fix)', () => {
    (Element.prototype as unknown as { animate: unknown }).animate = animate;
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
    const real = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const at = Array.from(this.parentElement!.children).indexOf(this) * 40;
      return { top: at, bottom: at + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: at, toJSON() {} } as DOMRect;
    };
    const ids = ['a', 'b', 'c'];
    let before: () => void = () => {};
    const { rerender } = render(<Table ids={ids} expose={(b) => { before = b; }} />);
    animate.mockClear();
    // A keystroke: before() runs, the same rows are drawn.
    act(() => { before(); });
    rerender(<Table ids={ids} expose={(b) => { before = b; }} />);
    // Later a row arrives at the top (the refetch after Save): the rows below it move down, but no sort changed.
    rerender(<Table ids={['new', ...ids]} expose={(b) => { before = b; }} />);
    HTMLElement.prototype.getBoundingClientRect = real;
    expect(animate).toHaveBeenCalledTimes(0);
  });
});
