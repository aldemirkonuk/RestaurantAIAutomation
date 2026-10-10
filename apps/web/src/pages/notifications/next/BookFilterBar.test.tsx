/**
 * F-817 — goal lines reach owners and managers only (the gateway's
 * goal-readers), so the register filter offers Goals only to them.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BookFilterBar from './BookFilterBar';
import { typeChoicesFor } from './nt-book';

function draw(role: string | null, withChoices = true) {
  return render(
    <BookFilterBar
      filters={{ type: null, status: null, day: null }}
      onFilters={vi.fn()}
      query=""
      onQuery={vi.fn()}
      hideRead={false}
      onHideRead={vi.fn()}
      matching={null}
      registerTotal={null}
      typeChoices={withChoices ? typeChoicesFor(role) : undefined}
    />,
  );
}

describe('BookFilterBar — the Goals register filter (F-817)', () => {
  it('an owner is offered Goals', () => {
    draw('owner');
    expect(screen.getByRole('button', { name: 'Goals' })).toBeInTheDocument();
  });

  it('staff are not offered Goals, and keep the other registers', () => {
    draw('staff');
    expect(screen.queryByRole('button', { name: 'Goals' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stock' })).toBeInTheDocument();
  });

  it('with no choices handed in, Goals is not offered', () => {
    draw(null, false);
    expect(screen.queryByRole('button', { name: 'Goals' })).toBeNull();
  });
});
