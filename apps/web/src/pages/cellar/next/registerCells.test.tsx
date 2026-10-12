/**
 * F-1559: the Listed cell. A bottle the live menus give two prices for says
 * "two prices"; the glass price is never shown in its place as if it were the
 * bottle's, and the row does not sort by the glass either.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { cellFor, sortValueFor } from './registerCells';
import type { OnMenuVM, RegisterRowVM } from './useCellarNextData';

function row(onMenu: OnMenuVM): RegisterRowVM {
  return {
    key: 'k1',
    name: 'Barolo',
    producer: 'Vietti',
    catalogue: null,
    house: { books: ['menu'], firstSeen: null, onMenu, bought: null, ordered: null, quoted: null, poured: null },
  };
}

describe('the Listed cell (F-1559)', () => {
  it('says "two prices" when the bottle has two, never the glass marked /gl', () => {
    const r = row({ lines: 2, bottlePrice: null, glassPrice: 12, sections: [], priceConflict: true });
    render(<>{cellFor(r, 'listed')}</>);
    expect(screen.getByTestId('listed-two-prices')).toHaveTextContent('two prices');
    expect(screen.queryByText('/gl', { exact: false })).toBeNull();
    expect(sortValueFor(r, 'listed')).toBeNull();
  });

  it('still shows a glass-only wine by the glass, and a bottle price as it is', () => {
    const glassOnly = row({ lines: 1, bottlePrice: null, glassPrice: 12, sections: [], priceConflict: false });
    const { unmount } = render(<>{cellFor(glassOnly, 'listed')}</>);
    expect(screen.getByText('/gl', { exact: false })).toBeInTheDocument();
    expect(sortValueFor(glassOnly, 'listed')).toBe(12);
    unmount();
    const bottle = row({ lines: 3, bottlePrice: 70, glassPrice: 12, sections: [], priceConflict: false });
    render(<>{cellFor(bottle, 'listed')}</>);
    expect(screen.queryByTestId('listed-two-prices')).toBeNull();
    expect(sortValueFor(bottle, 'listed')).toBe(70);
  });
});
