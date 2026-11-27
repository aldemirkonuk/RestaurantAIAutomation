/**
 * r103 FAIL 11 / r104 need 2: while a house has not stated its tax basis (every house today) a pour cost
 * said "Of the price as your list has it; ..." under EVERY row's figure, so reading the basis grew each
 * row (35 to 56 px) and /cocktails shifted 0.10-0.13. Now the figure is alone in its cell and the
 * sentence is said once, under the table, in room held from first paint.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { ShareBasisCaption, ShareFigure } from './DrinkCards';
import { taxSaid } from './listTax';

describe('the unset basis is said once, under the table', () => {
  it('a warned share cell holds the figure alone: no sentence inside the cell, so no row grows', () => {
    const { container } = render(<table><tbody><tr><td><ShareFigure text="12,5%" tax={{ basis: 'unset' }} /></td></tr></tbody></table>);
    expect(screen.queryByTestId('share-basis')).toBeNull();
    expect(container.querySelector('td')?.textContent).toBe('12,5%');
    expect(container.querySelector('[data-warn="true"]')?.getAttribute('title')).toBe(taxSaid({ basis: 'unset' }));
  });

  it('the caption says the sentence for an unset or unread basis, and is there, empty, once it is set', () => {
    const { rerender } = render(<ShareBasisCaption tax={{ basis: 'unread', failed: false }} />);
    const caption = screen.getByTestId('share-basis-caption');
    expect(caption.textContent).toBe(taxSaid({ basis: 'unread', failed: false }));
    rerender(<ShareBasisCaption tax={{ basis: 'unset' }} />);
    expect(screen.getByTestId('share-basis-caption')).toBe(caption);
    expect(caption.textContent).toBe(taxSaid({ basis: 'unset' }));
    rerender(<ShareBasisCaption tax={{ basis: 'prices_exclude_tax' }} />);
    expect(screen.getByTestId('share-basis-caption')).toBe(caption);
    expect(caption.textContent).toBe('');
    expect(caption.getAttribute('data-warn')).toBe('false');
  });

  it('a house whose prices include tax, with no rate recorded, is told once why its shares read Not known', () => {
    render(<ShareBasisCaption tax={{ basis: 'prices_include_tax', ratePct: null }} />);
    expect(screen.getByTestId('share-basis-caption').textContent).toBe('Your list prices include tax and no rate for it is recorded.');
  });

  it('its room is held in CSS, one line wide and two on a phone, with no transition (ADR 0112)', () => {
    const css = readFileSync(`${__dirname}/../cellar-next.css`, 'utf8').replace(/\s+/g, ' ');
    expect(css).toMatch(/\.cl-share-caption \{[^}]*min-height: 1\.4em;/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{ \.cl-share-caption \{ min-height: 2\.8em; \} \}/);
    expect(css.match(/\.cl-share-caption \{[^}]*\}/)?.[0]).not.toMatch(/transition|animation/);
  });
});
