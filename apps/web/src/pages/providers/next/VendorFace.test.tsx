import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OrderSpark, ShareBar, VendorMonogram, VendorStatus } from './VendorFace';

describe('the vendor face', () => {
  it('a monogram disc is 40 px by default, round, and settles only in the sheet', () => {
    const { rerender } = render(<VendorMonogram name="Skurnik Wines" />);
    const d = screen.getByTestId('vendor-monogram');
    expect(d.textContent).toBe('SW');
    expect(d.style.width).toBe('40px');
    expect(d.hasAttribute('data-settle')).toBe(false);
    rerender(<VendorMonogram name="Skurnik Wines" size={56} settle />);
    expect(screen.getByTestId('vendor-monogram').getAttribute('data-settle')).toBe('true');
  });
  it('a sparkline is twelve bars and says its total in words', () => {
    render(<OrderSpark weekly={[0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 3, 1]} />);
    const s = screen.getByTestId('vendor-spark');
    expect(s.querySelectorAll('rect')).toHaveLength(12);
    expect(s.getAttribute('aria-label')).toBe('7 orders in the last 12 weeks');
  });
  it('an empty twelve weeks says so; an unread book draws nothing', () => {
    const { container, rerender } = render(<OrderSpark weekly={new Array(12).fill(0)} />);
    expect(screen.getByTestId('vendor-spark').getAttribute('aria-label')).toBe('No orders in the last 12 weeks');
    rerender(<OrderSpark weekly={null} />);
    expect(container.querySelector('[data-testid="vendor-spark"]')).toBeNull();
  });
  it('a status is a dot and a word, and nothing while the orders are unread', () => {
    const { container, rerender } = render(<VendorStatus open={2} />);
    expect(screen.getByTestId('vendor-status').textContent).toBe('2 open');
    expect(screen.getByTestId('vendor-status').getAttribute('data-live')).toBe('true');
    rerender(<VendorStatus open={0} />);
    expect(screen.getByTestId('vendor-status').textContent).toBe('No open orders');
    rerender(<VendorStatus open={null} />);
    expect(container.firstChild).toBeNull();
  });
  it('a share bar is a scaleX of hits over sample, for the three share lines only', () => {
    const { container, rerender } = render(<ShareBar m={{ key: 'onTime', outcome: 'answered', hits: 7, sample: 10 }} />);
    expect((container.querySelector('i') as HTMLElement).style.transform).toBe('scaleX(0.7)');
    rerender(<ShareBar m={{ key: 'replyTime', outcome: 'answered', hits: 7, sample: 10 }} />);
    expect(container.firstChild).toBeNull();
    rerender(<ShareBar m={{ key: 'onTime', outcome: 'too_few', hits: 2, sample: 2 }} />);
    expect(container.firstChild).toBeNull();
  });
  it('animates only transform, opacity and clip-path, and rests under reduced motion', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/providers/next/vendor-face.css'), 'utf8');
    expect(css).not.toMatch(/transition:\s*all/);
    // Every property inside a @keyframes block is one of the three compositor ones.
    const props = new Set<string>();
    for (const m of css.matchAll(/@keyframes [\w-]+ \{/g)) {
      let depth = 1;
      let i = (m.index ?? 0) + m[0].length;
      const start = i;
      for (; depth > 0 && i < css.length; i += 1) depth += css[i] === '{' ? 1 : css[i] === '}' ? -1 : 0;
      for (const d of css.slice(start, i).matchAll(/([a-z-]+)\s*:/g)) props.add(d[1]);
    }
    expect([...props].sort()).toEqual(['clip-path', 'opacity', 'transform']);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.pv-mono[^}]*\.pv-spark svg[^}]*\.sc-bar > i[^}]*animation:\s*none/);
    expect(css).toMatch(/clip-path:\s*inset\(0 100% 0 0\)/);
  });
});
