import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SheetOutlines, outlinePlace } from './rp-outlines';
import { defaultIdsFor } from './rp-readable';

/**
 * The outlines drawn while the reader's sheet is read sit on the house sheet's
 * own slots, so the sheet that replaces them does not move the page (r41 gap 7).
 */
describe('the sheet outlines', () => {
  it('draw one outline per cutting on the house sheet, each on that cutting\'s own columns and rows', () => {
    const { container } = render(<SheetOutlines />);
    const { ids, slots } = defaultIdsFor(null);
    const boxes = Array.from(container.querySelectorAll<HTMLElement>('.rp-outline'));
    expect(boxes).toHaveLength(ids.length);
    expect(ids.length).toBeGreaterThan(4);
    boxes.forEach((box, i) => {
      const s = slots[ids[i]];
      expect(box.style.gridColumn).toBe(`${s.x + 1} / span ${s.w}`);
      expect(box.style.gridRow).toBe(`${s.y + 1} / span ${s.h}`);
    });
  });

  it('still say, to a reader who cannot see them, that the arrangement is being read', () => {
    render(<SheetOutlines />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading how you arranged this sheet…');
  });

  it('a slot places a box from its 1-based grid line, spanning its width and height', () => {
    const p = outlinePlace({ x: 7, y: 9, w: 5, h: 11 });
    expect(p.gridColumn).toBe('8 / span 5');
    expect(p.gridRow).toBe('10 / span 11');
  });
});
