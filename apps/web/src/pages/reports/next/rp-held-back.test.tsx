/**
 * Figures of record name the goods that hold "what it cost" back (r36
 * invoices R2): "cost known for 3 of 4 items sold" left the owner nowhere to
 * start. Each named good links to its row on the Inventory page, where its
 * cost is stated or its delivery is found. SYNTHETIC data.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { heldBackNote, ledger, readHeldBack } from './rp-registers-house';

const ctx = { days: 30, currency: 'TRY' } as never;

const WITHHELD = {
  basis: {},
  cogs: null,
  cogsCoverage: { itemsMoved: 4, itemsCosted: 2, bottlesUncosted: 7 },
  cogsHeldBack: {
    goods: [
      { inventoryId: 'inv-2', name: 'Flour' },
      { inventoryId: 'inv-9', name: null },
    ],
    more: 0,
  },
  costOfCostedItems: null,
  tillStock: null,
};

function view(raw: Record<string, unknown>) {
  return ledger.view(ledger.select(raw) as never, ctx);
}

describe('readHeldBack', () => {
  it('reads the goods and the count of the rest', () => {
    expect(readHeldBack({ goods: [{ inventoryId: 'a', name: 'Ribolla' }], more: 2 })).toEqual({
      goods: [{ inventoryId: 'a', name: 'Ribolla' }],
      more: 2,
    });
  });
  it('a good with no id is dropped; a blank name reads as no name', () => {
    expect(readHeldBack({ goods: [{ name: 'Ghost' }, { inventoryId: 'b', name: '  ' }], more: 0 })).toEqual({
      goods: [{ inventoryId: 'b', name: null }],
      more: 0,
    });
  });
  it('absent or empty is null', () => {
    expect(readHeldBack(undefined)).toBeNull();
    expect(readHeldBack(null)).toBeNull();
    expect(readHeldBack({ goods: [], more: 0 })).toBeNull();
  });
});

describe('heldBackNote', () => {
  it('names the goods, says a good off the list as such, and counts the rest', () => {
    expect(
      heldBackNote({
        goods: [
          { inventoryId: 'a', name: 'Flour' },
          { inventoryId: 'b', name: null },
        ],
        more: 3,
      }),
    ).toBe(
      'What it cost waits on these goods: Flour, a good no longer on the list, and 3 more goods. Some of them sold with no cost yet; verify their delivery, or state what they cost on the Inventory page if they came in without one.',
    );
  });
  it('one good reads in the singular', () => {
    expect(heldBackNote({ goods: [{ inventoryId: 'a', name: 'Flour' }], more: 0 })).toBe(
      'What it cost waits on this good: Flour. Some of it sold with no cost yet; verify its delivery, or state what it cost on the Inventory page if it came in without one.',
    );
  });
});

describe('figures of record — what holds what it cost back', () => {
  it('names the goods in the notes and links each named one to its row', () => {
    const v = view(WITHHELD);
    expect(v.notes.some((n) => String(n).startsWith('What it cost waits on these goods: Flour, a good no longer on the list.'))).toBe(true);
    render(<MemoryRouter>{v.node}</MemoryRouter>);
    const list = screen.getByTestId('cogs-held-back');
    expect(list.textContent).toBe('What it cost waits on: Flour, a good no longer on the list.');
    const link = screen.getByRole('link', { name: 'Flour' });
    expect(link.getAttribute('href')).toBe('/inventory?open=inv-2');
    // a good no longer on the list has no row to open
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('says nothing once what it cost is known', () => {
    const v = view({ ...WITHHELD, cogs: 420, cogsCoverage: { itemsMoved: 4, itemsCosted: 4, bottlesUncosted: 0 } });
    expect(v.notes.some((n) => String(n).startsWith('What it cost waits on'))).toBe(false);
    render(<MemoryRouter>{v.node}</MemoryRouter>);
    expect(screen.queryByTestId('cogs-held-back')).toBeNull();
  });

  it('says nothing to a caller who does not see the till', () => {
    const v = view({ ...WITHHELD, salesWithheld: true });
    expect(v.notes.some((n) => String(n).startsWith('What it cost waits on'))).toBe(false);
  });

  it('an older gateway that sends no list says nothing new', () => {
    const { cogsHeldBack: _unused, ...older } = WITHHELD;
    const v = view(older);
    expect(v.notes.some((n) => String(n).startsWith('What it cost waits on'))).toBe(false);
  });
});
