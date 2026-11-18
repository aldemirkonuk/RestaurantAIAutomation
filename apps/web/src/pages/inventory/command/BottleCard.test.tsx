/**
 * BottleCard — two lines, a status said twice, an honest unknown, and the
 * press motion that steps aside for reduced motion.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { BottleCard } from './BottleCard';
import { PHONE_QUERY, useIsPhone } from '../../../hooks/useIsPhone';

const item = (o: Record<string, unknown> = {}) =>
  ({ id: 'a', inventoryId: 'a', name: 'Barolo', liveStock: 12, threshold: 4, menuPriceBottle: 120, ...o }) as never;

describe('BottleCard', () => {
  it('is one button reading name, count, par and price', () => {
    const onOpen = vi.fn();
    render(<BottleCard item={item()} open={false} onOpen={onOpen} />);
    const b = screen.getByRole('button');
    expect(b.textContent).toContain('Barolo');
    expect(b.textContent).toContain('12 live · par 4');
    expect(b.textContent).toContain('$120.00');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(b);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('says low and critical in words as well as colour', () => {
    const { rerender } = render(<BottleCard item={item({ liveStock: 3, threshold: 4 })} open={false} onOpen={() => {}} />);
    expect(screen.getByText('Low')).toBeTruthy();
    rerender(<BottleCard item={item({ liveStock: 0 })} open={false} onOpen={() => {}} />);
    expect(screen.getByText('Critical')).toBeTruthy();
  });

  it('never shows an unknown count as zero, nor an unset price as free', () => {
    render(<BottleCard item={item({ liveStock: null, menuPriceBottle: null })} open={false} onOpen={() => {}} />);
    expect(screen.getByRole('button').textContent).toContain('– live');
    expect(screen.getByRole('button').textContent).toContain('no price set');
    expect(screen.getByText('Unknown')).toBeTruthy();
  });

  it('is at least 44 px tall and presses, but not under reduced motion', () => {
    render(<BottleCard item={item()} open={false} onOpen={() => {}} />);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('min-h-[64px]');
    expect(cls).toContain('active:scale-[0.98]');
    expect(cls).toContain('duration-[90ms]');
    expect(cls).toContain('motion-reduce:active:scale-100');
    expect(cls).toContain('motion-reduce:transition-none');
    expect(cls).not.toMatch(/transition-all/);
  });
});

describe('useIsPhone', () => {
  it('is false where matchMedia does not exist, true when the query matches', () => {
    const real = window.matchMedia;
    // @ts-expect-error a browser without matchMedia
    window.matchMedia = undefined;
    expect(renderHook(() => useIsPhone()).result.current).toBe(false);
    window.matchMedia = ((q: string) => ({
      matches: q === PHONE_QUERY,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    expect(renderHook(() => useIsPhone()).result.current).toBe(true);
    window.matchMedia = real;
  });
});
