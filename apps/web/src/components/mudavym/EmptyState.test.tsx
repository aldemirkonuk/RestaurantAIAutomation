/**
 * The house's empty state: art, one primary action, the honest sentence, and
 * the long truth behind a disclosure (r58, N-09).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EmptyState } from './EmptyState';
import { CaughtUpCheck, EmptyArt, GhostDocument, type EmptyArtName } from './emptyArt';

const css = readFileSync(join(__dirname, 'empty-state.css'), 'utf8');

function mount(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('EmptyState', () => {
  it('draws the art, the sentence and ONE primary action', () => {
    const onClick = vi.fn();
    const { container } = mount(
      <EmptyState art="book" sentence="No orders are open." action={{ label: 'Start an order', onClick }} />,
    );
    expect(container.querySelector('svg[data-art="book"]')).toBeTruthy();
    expect(screen.getByText('No orders are open.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start an order' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('an action can be a link to a room', () => {
    mount(<EmptyState sentence="Nothing." action={{ label: 'Open Vendors', to: '/vendors' }} />);
    expect(screen.getByRole('link', { name: 'Open Vendors' }).getAttribute('href')).toBe('/vendors');
  });

  it('the art is decoration: hidden from assistive technology', () => {
    const { container } = mount(<EmptyState art="receipt" sentence="x" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the long truth behind "Why is this empty", closed until asked', () => {
    mount(<EmptyState sentence="Nothing yet." why="No order has been sent from this house." />);
    const btn = screen.getByRole('button', { name: 'Why is this empty' });
    const panel = document.getElementById(btn.getAttribute('aria-controls') as string) as HTMLElement;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(panel.getAttribute('data-open')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(panel.getAttribute('data-open')).toBe('true');
    fireEvent.click(btn);
    expect(panel.getAttribute('data-open')).toBe('false');
  });

  it('shows no disclosure when there is no long truth', () => {
    mount(<EmptyState sentence="Nothing yet." />);
    expect(screen.queryByRole('button', { name: 'Why is this empty' })).toBeNull();
  });

  it('has an illustration for each of the nine registers', () => {
    const names: EmptyArtName[] = ['book', 'receipt', 'vendor', 'glass', 'cellar', 'team', 'mail', 'till', 'menu'];
    for (const n of names) {
      const { container, unmount } = render(<EmptyArt name={n} />);
      expect(container.querySelector(`svg[data-art="${n}"] path, svg[data-art="${n}"] circle`)).toBeTruthy();
      unmount();
    }
  });

  it('the receipts ghost document is skeleton lines, hidden from assistive technology', () => {
    const { container } = render(<GhostDocument />);
    expect(container.querySelectorAll('.mdv-ghost__line').length).toBeGreaterThanOrEqual(6);
    expect(screen.getByTestId('ghost-document').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the stylesheet', () => {
  it('opens the long truth by grid rows over 280 ms, and not at all under reduced motion', () => {
    expect(css).toMatch(/grid-template-rows 280ms/);
    expect(css).toMatch(/\.mdv-empty__why\[data-open='true'\]\s*\{[^}]*grid-template-rows: 1fr/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.mdv-empty__why\s*\{\s*transition: none/);
    expect(reduced).toMatch(/\.mdv-empty__figure[\s\S]*animation: none/);
  });

  it('animates no layout property and never uses transition: all', () => {
    expect(css).not.toMatch(/transition:\s*all/);
    const frames = css.match(/@keyframes [\w-]+\s*\{[\s\S]*?\n\}/g) ?? [];
    expect(frames.length).toBe(2);
    for (const f of frames) expect(f).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
  });

  it('the ghost lines are 6% ink in OKLCH, from the ground token', () => {
    expect(css).toMatch(/color-mix\(in oklch, var\(--ink-1\) 6%, transparent\)/);
  });

  it('takes its colours from tokens the dark ground also defines', () => {
    const palette = readFileSync(join(__dirname, '../../styles/mudavym.css'), 'utf8');
    const dark = palette.slice(palette.indexOf('.mudavym[data-ground="charcoal"]'));
    for (const t of ['--ink-1', '--seal', '--paper-0']) expect(dark).toContain(`${t}:`);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

describe('CaughtUpCheck', () => {
  it('draws itself over 360 ms, or is simply there when still', () => {
    expect(css).toMatch(/animation: mdv-draw 360ms/);
    const { container } = render(<CaughtUpCheck still />);
    expect(container.querySelector('svg')?.getAttribute('data-still')).toBe('true');
    expect(css).toMatch(/\[data-still='true'\] \.mdv-caught__ring[\s\S]*?stroke-dashoffset: 0/);
  });
});
