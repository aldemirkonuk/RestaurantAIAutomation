/**
 * c3 need 15: the sparklines draw on the house ease, 40 ms apart, and the
 * skeleton's sheen breathes (ease-in-out, 1.4 s) instead of running flat.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Spark } from './rp-spark';

const css = readFileSync(resolve(__dirname, 'reports-next.css'), 'utf8');
const rule = (sel: string) => {
  const at = css.indexOf(`${sel} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

const series = { id: 'till', title: 'Till', of: 'days', last: '$1', values: [1, 2, 3] } as never;

describe('sparkline timing (c3 need 15)', () => {
  it('a line carries its place in the row so the stylesheet can stagger it', () => {
    render(<Spark series={series} index={2} />);
    expect(screen.getByTestId('rp-spark-till').style.getPropertyValue('--rp-spark-i')).toBe('2');
  });
  it('the line draws in 600 ms on the house ease, 40 ms apart; the dot follows it', () => {
    const line = rule('.rp-spark__line');
    expect(line).toMatch(/rp-spark-draw 600ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    expect(line).toContain('calc(var(--rp-spark-i, 0) * 40ms)');
    expect(rule('.rp-spark__dot')).toContain('calc(520ms + var(--rp-spark-i, 0) * 40ms)');
  });
  it('the skeleton sheen is 1.4 s ease-in-out and nothing is linear', () => {
    const a = rule('.rp-skel::after');
    expect(a).toMatch(/rp-sheen 1\.4s ease-in-out infinite/);
    expect(a).not.toMatch(/\blinear(?!-gradient)\b/);
  });
});
