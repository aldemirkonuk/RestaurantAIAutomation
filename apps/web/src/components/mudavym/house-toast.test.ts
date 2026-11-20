/**
 * The house toast rises in 220 ms on transform and opacity only (design critic
 * N-20). Reads the shipped stylesheet; the 4 s life is asserted where the toast
 * is raised (CellarNext.test.tsx, the cocktail save).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'house-toast.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (sel: string) =>
  [...CSS.matchAll(new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');

describe('the toast rise', () => {
  const transition = rule('.mdv-toast').match(/transition:([^;]+);/s)?.[1] ?? '';
  const parts = [...transition.matchAll(/(^|,)\s*([a-z-]+)\s+(\d+ms)/g)].map((m) => [m[2], m[3]]);

  it('is 220 ms and moves only transform and opacity', () => {
    expect(parts.map((p) => p[0]).sort()).toEqual(['opacity', 'transform']);
    for (const p of parts) expect(p[1]).toBe('220ms');
    expect(transition).not.toMatch(/\ball\b|height/);
  });

  it('wins over the library rule that animates height and box-shadow in 400 ms', () => {
    expect(transition).toContain('!important');
  });

  it('stops moving under reduced motion', () => {
    const reduce = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduce).toMatch(/transition:\s*none\s*!important/);
  });
});
