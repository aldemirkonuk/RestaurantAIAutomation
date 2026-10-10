/**
 * F-614: "Everything at once" offered its column menu only to a right-click,
 * the record behind a cell only to a double-click or right-click, and every
 * row was a tab stop that did nothing. These tests drive it with keys alone.
 * F-615: the caret beside each header was a 15px target with nothing larger
 * for a thumb.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('./useCellarNextData', () => ({
  useWholeCellar: () => ({
    rows: [
      { key: 'k1', name: 'Efes Pilsen', producer: 'Anadolu', catalogue: null, house: null, register: 'beer' },
      { key: 'k2', name: 'Lagavulin 16', producer: 'Lagavulin', catalogue: null, house: null, register: 'whiskey' },
    ],
    reads: [],
    loading: false,
    partial: false,
  }),
  useRowRecord: () => ({ data: null, loading: false, error: null }),
}));

import WholeCellar from './WholeCellar';

function mount() {
  render(<WholeCellar carried={['beer', 'whiskey']} defaultOpen />);
  return screen.getAllByRole('row').slice(1); // body rows
}

describe('WholeCellar from the keyboard (F-614)', () => {
  it('each header has a named caret that opens its column menu', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'What Bottle is, and how to sort it' }));
    expect(screen.getByRole('menu', { name: 'Bottle column' })).toBeInTheDocument();
  });

  it('Shift+F10 on a focused header opens its column menu', () => {
    mount();
    const sort = screen.getByRole('button', { name: 'Sort by Bottle' });
    sort.focus();
    fireEvent.keyDown(sort, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menu', { name: 'Bottle column' })).toBeInTheDocument();
  });

  it('Enter on a focused row chooses it and offers the record behind each figure', () => {
    const rows = mount();
    const efes = rows.find((r) => r.textContent?.includes('Efes Pilsen'))!;
    efes.focus();
    fireEvent.keyDown(efes, { key: 'Enter' });
    expect(efes).toHaveAttribute('data-selected', 'true');
    const bar = screen.getByRole('group', { name: 'The record behind Efes Pilsen' });
    const first = within(bar).getAllByRole('button')[0];
    fireEvent.click(first);
    expect(screen.getByTestId('series-panel')).toBeInTheDocument();
    // Enter again un-chooses it.
    fireEvent.keyDown(efes, { key: 'Enter' });
    expect(screen.queryByRole('group', { name: /The record behind/ })).not.toBeInTheDocument();
  });

  it('Shift+F10 on a focused row chooses it and moves focus to its record buttons', () => {
    const rows = mount();
    const lag = rows.find((r) => r.textContent?.includes('Lagavulin'))!;
    lag.focus();
    fireEvent.keyDown(lag, { key: 'F10', shiftKey: true });
    const bar = screen.getByRole('group', { name: 'The record behind Lagavulin 16' });
    expect(bar.contains(document.activeElement)).toBe(true);
  });

  it('with a row chosen, a figure column menu opens that row’s record', () => {
    const rows = mount();
    const efes = rows.find((r) => r.textContent?.includes('Efes Pilsen'))!;
    fireEvent.keyDown(efes, { key: ' ' });
    fireEvent.click(screen.getByRole('button', { name: 'What On the list is, and how to sort it' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Open the series for the chosen row/ }));
    expect(screen.getByTestId('series-panel')).toBeInTheDocument();
  });
});

describe('cellar touch targets (F-615)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/pages/cellar/next/cellar-next.css'), 'utf8');

  it('the column caret is at least 24px on every pointer', () => {
    const rule = /\.cl-caret \{([^}]*)\}/.exec(css)?.[1] ?? '';
    const px = (prop: string) => Number(new RegExp(`\\b${prop}: (\\d+)px`).exec(rule)?.[1] ?? 0);
    expect(px('width')).toBeGreaterThanOrEqual(24);
    expect(px('height')).toBeGreaterThanOrEqual(24);
  });

  it('a coarse pointer grows the caret and the icon-only buttons', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(css).toContain('@media (pointer: coarse)');
    expect(coarse).toMatch(/\.cl-caret \{\s*width: 40px;\s*height: 40px;/);
    expect(coarse).toMatch(/\.cl-btn:has\(> svg:only-child\) \{\s*min-width: 44px;\s*height: 44px;/);
  });
});
