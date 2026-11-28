// The register nav holds its two-row height from first paint at a phone (r107 drinks-r107-2).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the register nav holds its two-row room from first paint', () => {
  const css = readFileSync(resolve(__dirname, 'cellar-next.css'), 'utf8');
  const tsx = readFileSync(resolve(__dirname, 'CellarNext.tsx'), 'utf8');

  it('the nav carries the room class', () => {
    expect(tsx).toMatch(/<nav aria-label="Cellar registers" className="cl-spine-nav"/);
  });

  it('the room is two 30px buttons and a 4px gap at a phone, with no motion', () => {
    const block = css.match(/@media \(max-width: 640px\) \{\s*\.cl-spine-nav \{[^}]*\}\s*\}/)?.[0] ?? '';
    expect(block).toMatch(/min-height: 64px;/);
    expect(block).not.toMatch(/transition|animation|opacity/);
  });

  it('the nav is visibility hidden while the registers read is in flight, and not after', () => {
    expect(tsx).toMatch(
      /visibility: data\.authLoading \|\| data\.registersLoading \? 'hidden' : undefined \}\}>\s*\{spine\.map/,
    );
  });

  it('the two rule notes sit in a block that holds their settled room at a phone, with no motion', () => {
    expect(tsx).toMatch(/<div className="cl-notes-hold">/);
    expect(css).toMatch(/\.cl-notes-hold \{ margin-top: 10px; min-height: 79px; \}/);
    expect(css).toMatch(/@media \(max-width: 481px\) \{ \.cl-notes-hold \{ min-height: 114px; \} \}/);
    expect(css).toMatch(/@media \(min-width: 641px\) and \(max-width: 1000px\) \{ \.cl-notes-hold \{ min-height: 114px; \} \}/);
    expect(css).toMatch(/@media \(max-width: 481px\) \{ \.cl-standing-hold \{ min-height: 50px; \} \}/);
    expect(tsx).toMatch(/className="cl-standing cl-standing-hold"/);
    expect(css).toMatch(/@media \(max-width: 481px\) \{ \.cl-said-hold \{ min-height: 3lh; \} \}/);
    expect(readFileSync(resolve(__dirname, 'Registers.tsx'), 'utf8').match(/cl-said cl-said-hold/g)).toHaveLength(2);
    const rule = css.slice(css.indexOf('.cl-notes-hold {'), css.indexOf('.cl-notes-hold {') + 400);
    expect(rule).not.toMatch(/transition|animation|opacity/);
  });

  it('the rule notes are drawn only once the registers read settles', () => {
    expect(tsx).toMatch(/<div className="cl-notes-hold">[\s\S]*?\{data\.registersLoading \? null : \(\s*<>\s*<p className="cl-note" data-testid="cellar-naming-rule">/);
  });
});
