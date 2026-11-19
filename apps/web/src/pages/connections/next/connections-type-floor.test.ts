/**
 * The type floor for /connections (r58 N-04): no text below 11 px, kickers at
 * 11 px with 0.08em tracking, sentences at 14/22, and every motion in the
 * stylesheet gated by prefers-reduced-motion.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'connections-next.css'), 'utf8');
const tsx = ['AttachmentRow.tsx', 'ConnectionsNext.tsx', 'HouseServerControls.tsx', 'DistributorFeedPanel.tsx']
  .map((f) => readFileSync(resolve(__dirname, f), 'utf8'))
  .join('\n');

function decl(selector: string, prop: string): string | undefined {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${esc} *\\{([^}]*)\\}`).exec(css);
  return m ? new RegExp(`${prop}: *([^;]+);`).exec(m[1])?.[1].trim() : undefined;
}

describe('/connections type floor', () => {
  it('has no font-size under 11px in the stylesheet', () => {
    const sizes = [...css.matchAll(/font-size: *([0-9.]+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(10);
    expect(sizes.filter((n) => n < 11)).toEqual([]);
  });

  it('has no text-[Npx] under 11 in the page sources', () => {
    const bad = [...tsx.matchAll(/text-\[([0-9.]+)px\]|fontSize: *([0-9.]+)\b/g)]
      .map((m) => Number(m[1] ?? m[2]))
      .filter((n) => n < 11);
    expect(bad).toEqual([]);
  });

  it.each(['cx-eyebrow', 'cx-tally-k', 'cx-sec-n', 'cx-sec-k', 'cx-col-h', 'cx-chip', 'cx-owner'])(
    'kicker %s is 11px with 0.08em tracking',
    (c) => {
      expect(decl(`.mudavym .${c}`, 'font-size')).toBe('11px');
      expect(decl(`.mudavym .${c}`, 'letter-spacing')).toBe('0.08em');
    },
  );

  it('sets sentences at 14px on 22px', () => {
    expect(decl('.mudavym .cx-row-why', 'font-size')).toBe('14px');
    expect(decl('.mudavym .cx-row-why', 'line-height')).toBe('22px');
  });

  it('gates the disclosure fade by prefers-reduced-motion', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/cx-row-why\[open\][^}]*animation: none/);
    expect(css).not.toMatch(/transition: *all|transition-all/);
  });
});
