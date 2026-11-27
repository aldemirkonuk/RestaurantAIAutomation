/**
 * The page strip keeps a keyboard user's place and does not mistake a scroll
 * for movement (r109 review): focus survives a page reaching an end or being
 * removed, and the FLIP measures against the strip, not the viewport.
 */

import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DropZone } from './DropZone';

const page = (n: number) => new File(['x'], `p${n}.jpg`, { type: 'image/jpeg' });
const [p1, p2, p3] = [page(1), page(2), page(3)];

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:page');
  URL.revokeObjectURL = vi.fn();
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false,
    media: q,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

function Host({ start }: { start: File[] }) {
  const [files, setFiles] = useState(start);
  return <DropZone files={files} onFiles={(f) => setFiles(f)} accept="image/*" multiple inputLabel="Menu to read" />;
}

const focused = () => (document.activeElement as HTMLElement).getAttribute('aria-label');

function press(name: string) {
  const b = screen.getByRole('button', { name });
  b.focus();
  fireEvent.click(b);
}

describe('focus after a move or a removal', () => {
  it('a page moved to the first slot hands focus to its own Move later, not to the page', () => {
    render(<Host start={[p1, p2, p3]} />);
    press('Move page 2 earlier');
    expect(focused()).toBe('Move page 1 later');
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
  });

  it('a page moved to the last slot hands focus to its own Move earlier', () => {
    render(<Host start={[p1, p2, p3]} />);
    press('Move page 2 later');
    expect(focused()).toBe('Move page 3 earlier');
  });

  it('a page moved to a middle slot keeps focus on the same arrow', () => {
    render(<Host start={[p1, p2, p3]} />);
    press('Move page 3 earlier');
    expect(focused()).toBe('Move page 2 earlier');
  });

  it('Remove hands focus to the next page Remove, else the previous one', () => {
    render(<Host start={[p1, p2, p3]} />);
    press('Remove page 1');
    expect(focused()).toBe('Remove page 1');
    press('Remove page 2');
    // two held, the last removed: the strip goes, focus lands on the zone's Change
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' }));
  });

  it('Remove on the last of three focuses the previous page Remove', () => {
    render(<Host start={[p1, p2, p3]} />);
    press('Remove page 3');
    expect(focused()).toBe('Remove page 2');
  });

  it('the removal that leaves one page sends focus to Change', () => {
    render(<Host start={[p1, p2]} />);
    press('Remove page 1');
    expect(screen.queryByTestId('menu-page')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' }));
  });
});

describe('the settle measures against the strip', () => {
  it('a scroll between two changes moves no page that did not move', () => {
    let scroll = 0;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const top = 500 - scroll;
      const left = this.tagName === 'LI' ? Array.from(this.parentElement?.children ?? []).indexOf(this) * 100 : 0;
      return { left, top, right: left + 90, bottom: top + 90, width: 90, height: 90, x: left, y: top, toJSON: () => ({}) } as DOMRect;
    });
    render(<Host start={[p1, p2, p3]} />);
    scroll = 200;
    press('Move page 3 earlier');
    const first = screen.getAllByTestId('menu-page')[0] as HTMLElement;
    // a page that is played from where it was gets a transition; the one that stayed put gets none
    expect(first.style.transition).toBe('');
    expect((screen.getAllByTestId('menu-page')[1] as HTMLElement).style.transition).toContain('transform');
  });
});
