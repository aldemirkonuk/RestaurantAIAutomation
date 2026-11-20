/**
 * A linked recipe line leads to its good's drawer on /inventory (founder
 * /goal 2026-11-07: a drink or a dish leads to the goods in it, each with its
 * cards and its nutrition card). Kept apart from LineRow.test.tsx so the
 * recipe chain's edits there merge without touching these cases.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import LineRow, { LineRowRead, goodHref, type DraftRow } from './LineRow';

const GIN = '33333333-3333-4333-8333-333333333333';
const blank: DraftRow = {
  key: 'r1', role: 'stocked', inventoryId: null, itemName: null, itemKind: null,
  label: '', qtyText: '30', unit: 'ml', saved: null,
};

function Harness({ start }: { start: DraftRow }) {
  const [row, setRow] = useState(start);
  return (
    <ol>
      <LineRow row={row} say={null} onChange={(p) => setRow((r) => ({ ...r, ...p }))} onRemove={() => {}} />
    </ol>
  );
}

describe('a linked line leads to its good on /inventory', () => {
  const linked: DraftRow = { ...blank, inventoryId: GIN, itemName: 'House Gin', itemKind: 'spirit', label: 'gin' };

  it('the editing line links to the good’s drawer, named for the good', () => {
    render(<Harness start={linked} />);
    const a = screen.getByRole('link', { name: 'Open House Gin in inventory' });
    expect(a.getAttribute('href')).toBe(`/inventory?open=${GIN}`);
    expect(goodHref('a b')).toBe('/inventory?open=a%20b');
  });

  it('an unlinked, not-counted, archived or deleted line has no link', () => {
    render(
      <ul>
        <LineRowRead row={{ ...blank, label: 'Campari' }} />
        <LineRowRead row={{ ...linked, role: 'untracked', inventoryId: null }} />
        {/* Not counted is never a link, even if a stale id rode along. */}
        <LineRowRead row={{ ...linked, role: 'untracked' }} />
        <LineRowRead row={{ ...linked, itemGone: 'archived' }} />
        <LineRowRead row={{ ...linked, itemGone: 'deleted' }} />
      </ul>,
    );
    expect(screen.queryByTestId('recipe-line-good')).toBeNull();
    render(<Harness start={{ ...linked, inventoryId: null, itemName: null }} />);
    expect(screen.queryByTestId('recipe-line-good')).toBeNull();
  });

  it('a staff reader’s line links too, and inside the app it moves without a reload', () => {
    render(
      <MemoryRouter initialEntries={['/cocktails']}>
        <Routes>
          <Route path="/cocktails" element={<ul><LineRowRead row={linked} /></ul>} />
          <Route path="/inventory" element={<p>the gin drawer</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Open House Gin in inventory' }));
    expect(screen.getByText('the gin drawer')).toBeTruthy();
  });
});
