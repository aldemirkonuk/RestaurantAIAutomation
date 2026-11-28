/**
 * r41 recipes audit, gap 1: the cellar page tells its data hook which register
 * it shows, so /cocktails (and every register but the wines) reads no wine
 * book. The hook's own gate is pinned in cellar-reads-what-it-draws.test.tsx;
 * this pins that the page passes the register, from the route or the query.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const seen = vi.hoisted(() => ({ args: [] as unknown[][] }));
vi.mock('./useCellarNextData', () => ({
  useCellarNextData: (...a: unknown[]) => {
    seen.args.push(a);
    return { authLoading: false, activeRestaurantId: 'r1', registers: null, registersLoading: true };
  },
}));
vi.mock('./Registers', () => ({ default: () => <div data-testid="overview" /> }));
vi.mock('./WineRegister', () => ({ default: () => <div data-testid="wines" /> }));
vi.mock('./CatalogueRegister', () => ({ default: ({ id }: { id: string }) => <div data-testid={`register-${id}`} /> }));

import CellarNext from './CellarNext';
import type { RegisterId } from './cellar-format';

function draw(at: string, category?: RegisterId) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <CellarNext category={category} />
    </MemoryRouter>,
  );
  return seen.args.at(-1);
}

beforeEach(() => {
  seen.args = [];
});

describe('the cellar page names the register it shows to its data hook', () => {
  it('/cocktails names the cocktails', () => {
    expect(draw('/cocktails', 'cocktails')).toEqual(['cocktails']);
  });

  it('/wines names the wines', () => {
    expect(draw('/wines', 'wines')).toEqual(['wines']);
  });

  it('the overview names none', () => {
    expect(draw('/cellar')).toEqual([null]);
  });

  it('a register asked for by query is named; an unknown one is the overview', () => {
    expect(draw('/cellar?register=cocktails')).toEqual(['cocktails']);
    expect(draw('/cellar?register=nonsense')).toEqual([null]);
  });
});
