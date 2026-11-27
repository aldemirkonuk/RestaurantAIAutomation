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
});
