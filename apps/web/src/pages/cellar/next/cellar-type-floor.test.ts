/**
 * The type floor for /cellar (r58 N-04): no text under 11px, notes at 14/22,
 * and the disclosure fade gated by prefers-reduced-motion.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;
const css = readFileSync(resolve(dir, 'cellar-next.css'), 'utf8');
// Files another open change owns are listed here and held to the floor in that change.
const HELD_ELSEWHERE = new Set(['CocktailRegister.tsx']);
const sources = readdirSync(dir)
  .filter((f) => /\.tsx$/.test(f) && !/\.test\./.test(f) && !HELD_ELSEWHERE.has(f))
  .map((f) => [f, readFileSync(resolve(dir, f), 'utf8')] as const);

describe('/cellar type floor', () => {
  it('has no font-size under 11px in the stylesheet', () => {
    const sizes = [...css.matchAll(/font-size: *([0-9.]+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(20);
    expect(sizes.filter((n) => n < 11)).toEqual([]);
  });

  it('has no inline fontSize under 11 in the page sources', () => {
    const bad = sources.flatMap(([f, t]) =>
      [...t.matchAll(/fontSize: *([0-9.]+)\b/g)].filter((m) => Number(m[1]) < 11).map(() => f),
    );
    expect(bad).toEqual([]);
  });

  it('sets the note sentence at 14px on 22px', () => {
    expect(css).toMatch(/\.cl-note \{[^}]*font-size: 14px; line-height: 22px;/);
  });

  it('gates the disclosure fade by prefers-reduced-motion and never uses transition: all', () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.cl-more\[open\] > :not\(summary\) \{ animation: none; \} \}/);
    expect(css).not.toMatch(/transition: *all/);
  });
});
