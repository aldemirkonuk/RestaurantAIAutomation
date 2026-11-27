/**
 * The drawer under /cocktails (and the dish leaf, which shares it) opens without animating a layout
 * property (r109 drinks-5, walk N5): it was `grid-template-rows` 0fr to 1fr over 320 ms, so the page under
 * it re-flowed on every frame. Now the room is taken at once and the content settles in with a transform,
 * 280 ms ease-out, clipped by the box; reduced motion is no animation at all (ADR 0112), and closing has no
 * exit animation. jsdom has no animation engine to ask `getAnimations`, so the pins read the stylesheet's
 * own rules, media blocks included; the trace is the walk's.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'cellar-next.css'), 'utf8');
const rule = (sel: string) => css.match(new RegExp(`${sel.replace(/[.[\]()>*']/g, '\\$&')} \\{[^}]*\\}`))?.[0] ?? '';
const settle = rule(".cl-stand[data-open='true'] > * > *");
const keyframes = css.match(/@keyframes cl-stand-settle \{[\s\S]*?\n\}\n/)?.[0] ?? '';
const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^@]*?\.cl-stand\[data-open='true'\] > \* > \* \{[^}]*\}/)?.[0] ?? '';

describe('the drawer room is taken at once', () => {
  it('no rule for the stand transitions or animates the rows', () => {
    const stands = css.match(/^\.cl-stand[^{]*\{[^}]*\}/gm) ?? [];
    expect(stands.length).toBeGreaterThanOrEqual(3);
    for (const r of stands.filter((x) => !x.includes('> * > *'))) {
      expect(r).not.toMatch(/transition|animation/);
    }
    expect(css).not.toMatch(/transition:[^;]*grid-template-rows[^;]*;[^}]*\n[^}]*cl-stand/);
    expect(rule('.cl-stand')).toMatch(/grid-template-rows: 0fr;/);
    expect(rule(".cl-stand[data-open='true']")).toMatch(/grid-template-rows: 1fr;/);
  });

  it('the box still clips what is inside it', () => {
    expect(rule('.cl-stand > *')).toMatch(/overflow: hidden;/);
  });
});

describe('the content settles by a transform, 280 ms, ease-out', () => {
  it('the open stand animates its content with the settle keyframes', () => {
    expect(settle).toMatch(/animation: cl-stand-settle 280ms ease-out;/);
  });

  it('the keyframes move a transform and nothing that lays out or fades', () => {
    expect(keyframes).toMatch(/translateY\(-8px\)/);
    expect(keyframes).not.toMatch(/opacity|height|grid|margin|padding|top|max-/);
  });

  it('reduced motion is no animation at all', () => {
    expect(reduced).toMatch(/animation: none;/);
  });

  it('there is no exit animation: the closed state carries none', () => {
    expect(rule(".cl-stand[data-open='false'] > * > *")).toBe('');
    expect(rule('.cl-stand')).not.toMatch(/animation|transition/);
  });
});
