import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../cellar-next.css'), 'utf8');
const rule = (sel: string) => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
const frames = css.match(/@keyframes cl-rcp-batch-in \{(.*)\}\n/)?.[1] ?? '';

describe('the batch box reveal (r110 drinks-g8)', () => {
  it('enters over 180 ms on the house curve', () => {
    expect(rule('.cl-rcp-batch')).toContain('animation: cl-rcp-batch-in 180ms cubic-bezier(0.16, 1, 0.3, 1)');
  });
  it('moves opacity and a 4 px transform only, never height', () => {
    expect(frames).toContain('opacity: 0');
    expect(frames).toContain('translateY(4px)');
    expect(frames).not.toMatch(/height|max-height|grid-template-rows|margin|padding/);
    expect(rule('.cl-rcp-batch')).not.toMatch(/transition/);
  });
  it('reduced motion has no animation at all', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.cl-rcp-batch \{ animation: none; \} \}/);
  });
  it('closing is not animated: the box unmounts with its toggle', () => {
    const tsx = readFileSync(resolve(__dirname, 'BatchForBottle.tsx'), 'utf8');
    expect(tsx).toMatch(/state\.open \? \(/);
  });
});
