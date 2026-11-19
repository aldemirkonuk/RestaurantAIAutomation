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
    expect(line).toMatch(/animation-name:\s*rp-spark-draw/);
    expect(line).toMatch(/animation-duration:\s*600ms/);
    expect(line).toMatch(/animation-timing-function:\s*cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    expect(line).toContain('animation-delay: calc(var(--rp-spark-i, 0) * 40ms)');
    const dot = rule('.rp-spark__dot');
    expect(dot).toMatch(/animation-timing-function:\s*cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    expect(dot).toContain('animation-delay: calc(520ms + var(--rp-spark-i, 0) * 40ms)');
  });
  it('no var() rides inside an `animation:` shorthand, where the timing was read back as ease', () => {
    for (const sel of ['.rp-spark__line', '.rp-spark__dot']) {
      expect(rule(sel)).not.toMatch(/\banimation:[^;]*var\(/);
    }
  });
  it('two figures stagger by their place: the second is 40 ms behind the first', () => {
    render(
      <>
        <Spark series={{ ...series, id: 'a' } as never} index={0} />
        <Spark series={{ ...series, id: 'b' } as never} index={1} />
      </>,
    );
    expect(screen.getByTestId('rp-spark-a').style.getPropertyValue('--rp-spark-i')).toBe('0');
    expect(screen.getByTestId('rp-spark-b').style.getPropertyValue('--rp-spark-i')).toBe('1');
  });
  it('only transform, opacity and clip-path move, and reduced motion draws nothing', () => {
    expect(css).not.toMatch(/\.rp-spark[^{]*{[^}]*transition:\s*all/);
    const reduced = css.slice(css.lastIndexOf('prefers-reduced-motion: reduce', css.indexOf('.rp-spark__line,\n  .rp-spark__dot')));
    expect(reduced).toMatch(/\.rp-spark__line,\s*\.rp-spark__dot\s*{\s*animation:\s*none/);
  });
  it('the skeleton sheen is 1.4 s ease-in-out and nothing is linear', () => {
    const a = rule('.rp-skel::after');
    expect(a).toMatch(/rp-sheen 1\.4s ease-in-out infinite/);
    expect(a).not.toMatch(/\blinear(?!-gradient)\b/);
  });
});
