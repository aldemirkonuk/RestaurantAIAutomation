/**
 * The page strip of a several-photo menu (r109 g2): order, remove, turn, said
 * aloud, and no motion under reduced motion (ADR 0112).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DropZone } from './DropZone';

const css = readFileSync(join(__dirname, 'drop-pages.css'), 'utf8');

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

function mount(files = [p1, p2, p3], over: Partial<React.ComponentProps<typeof DropZone>> = {}) {
  const onFiles = vi.fn();
  const onTurn = vi.fn();
  render(<DropZone files={files} onFiles={onFiles} onTurn={onTurn} accept="image/*" multiple inputLabel="Menu to read" {...over} />);
  return { onFiles, onTurn };
}

describe('the page strip', () => {
  it('shows one page each, in order, and none for a single photo', () => {
    mount();
    expect(screen.getAllByTestId('menu-page')).toHaveLength(3);
    expect(screen.getByText('Page 3')).toBeTruthy();
    cleanup();
    mount([p1]);
    expect(screen.queryByTestId('menu-page')).toBeNull();
  });

  it('Move earlier hands over the new order and says where the page went', () => {
    const { onFiles } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Move page 3 earlier' }));
    expect(onFiles).toHaveBeenCalledWith([p1, p3, p2], 'replace');
    expect(screen.getByRole('status').textContent).toBe('Page 3 is now page 2');
  });

  it('Move later does the same the other way, and the ends cannot go further', () => {
    const { onFiles } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Move page 1 later' }));
    expect(onFiles).toHaveBeenCalledWith([p2, p1, p3], 'replace');
    expect((screen.getByRole('button', { name: 'Move page 1 earlier' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move page 3 later' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Remove drops that page and keeps the rest in order', () => {
    const { onFiles } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Remove page 2' }));
    expect(onFiles).toHaveBeenCalledWith([p1, p3], 'replace');
  });

  it('Turn adds a quarter turn, clockwise, and wraps at 360', () => {
    const { onTurn } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Turn page 2' }));
    expect(onTurn).toHaveBeenCalledWith(1, 90);
    cleanup();
    const again = mount([p1, p2], { turns: { 1: 270 } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn page 2' }));
    expect(again.onTurn).toHaveBeenCalledWith(1, 0);
  });

  it('a turned page is drawn turned on its thumb only', () => {
    mount([p1, p2], { turns: { 1: 90 } });
    const imgs = screen.getAllByTestId('menu-page').map((li) => li.querySelector('img') as HTMLImageElement);
    expect(imgs[0].style.transform).toBe('rotate(0deg)');
    expect(imgs[1].style.transform).toBe('rotate(90deg)');
    expect(css).toMatch(/\.mdv-pages__img\s*\{[^}]*transition: transform 160ms ease-out/);
  });

  it('while reading the controls are off', () => {
    mount([p1, p2], { reading: true });
    expect((screen.getByRole('button', { name: 'Remove page 1' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('motion', () => {
  it('under reduced motion the rise and the turn are instant, and no opacity fade runs', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.mdv-pages__page\s*\{[^}]*animation: none/);
    expect(block).toMatch(/\.mdv-pages__img\s*\{[^}]*transition: none/);
  });
});
