/**
 * The drawer's motion is a stylesheet fact, so the stylesheet is what is read (r102 inventory motion-1, motion-2).
 * jsdom runs no transitions; these pin the durations, the easing and the reduced-motion blocks.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/pages/inventory/next/item-drawer.css', 'utf8');
const rule = (sel: string): string => {
  const i = css.indexOf(`${sel} {`);
  if (i < 0) throw new Error(`no rule ${sel}`);
  return css.slice(i, css.indexOf('}', i));
};
const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

describe('the detail card opens by rows, closes at once', () => {
  it('opens on 200 ms cubic-bezier(0.16, 1, 0.3, 1) over rows only (the wrapper has no margin to tween), fades in 160 ms after 40 ms', () => {
    const open = rule(".ivd-evwrap[data-open='true']");
    expect(open).toContain('grid-template-rows 200ms cubic-bezier(0.16, 1, 0.3, 1)');
    expect(open).not.toContain('margin-top');
    expect(rule('.ivd-evwrap')).not.toContain('margin');
    expect(rule(".ivd-evwrap[data-open='true'] .ivd-evidence")).toContain('160ms ease-out 40ms');
  });
  it('a switch to another card replays the fade at once (no 40 ms wait) and tweens no height (r108 g15)', () => {
    expect(rule(".ivd-evwrap[data-open='true'] .ivd-evidence[data-switched='true']")).toContain('animation-delay: 0ms');
    expect(rule(".ivd-evwrap[data-open='true'] .ivd-evidence[data-switched='true']")).not.toContain('height');
  });
  it('the closed state has no transition, so closing is instant (ADR 0112: no overlay exit animation)', () => {
    const closed = rule('.ivd-evwrap');
    expect(closed).toContain('grid-template-rows: 0fr');
    expect(closed).not.toContain('transition');
  });
  it('reduced motion gets the end state at once', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ivd-evwrap\[data-open='true'\] \{\s*transition: none;/);
    expect(css).toContain("animation: none");
  });
});

describe('a KPI card answers the press', () => {
  it('eases border and background in 120 ms ease-out and scales to 0.985 on press over 120 ms', () => {
    const base = rule('button.ivd-card');
    expect(base).toContain('border-color 120ms ease-out');
    expect(base).toContain('background-color 120ms ease-out');
    expect(base).toContain('transform 120ms cubic-bezier(0.16, 1, 0.3, 1)');
    expect(rule('button.ivd-card:active')).toContain('scale(0.985)');
  });
  it('reduced motion makes both instant', () => {
    expect(reduced).toContain('button.ivd-card {\n    transition: none;');
    expect(reduced).toContain('button.ivd-card:active {\n    transform: none;');
  });
});
