import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'group-rail.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('group-rail.css motion contract (r73 c3)', () => {
  it('never uses transition: all', () => {
    expect(css).not.toMatch(/transition:\s*all/);
  });

  it('transitions only transform, opacity, grid-template-rows and the two colour ink states', () => {
    const allowed = new Set(['transform', 'opacity', 'grid-template-rows', 'background-color', 'color', 'none']);
    const props = [...css.matchAll(/transition:\s*([^;]+);/g)].flatMap((m) =>
      m[1].split(/,(?![^(]*\))/).map((part) => part.trim().split(/\s+/)[0]),
    );
    expect(props.length).toBeGreaterThan(0);
    for (const p of props) expect(allowed.has(p), `transition on ${p}`).toBe(true);
  });

  it('drops every transition under prefers-reduced-motion', () => {
    const block = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(block).toMatch(/\.gr-body/);
    expect(block).toMatch(/transition:\s*none/);
  });

  it('has a 44 px sticky head and a 0fr -> 1fr body', () => {
    expect(css).toMatch(/\.gr-head \{[^}]*position: sticky/);
    expect(css).toMatch(/\.gr-head-btn \{[^}]*height: 44px/);
    expect(css).toMatch(/grid-template-rows: 0fr/);
    expect(css).toMatch(/grid-template-rows: 1fr/);
  });

  it('keeps every font size at or above 11 px', () => {
    for (const m of css.matchAll(/font:\s*(?:\d+\s+)?(\d+(?:\.\d+)?)px/g)) expect(+m[1]).toBeGreaterThanOrEqual(11);
  });

  // r74 walk: the shell header is sticky and 53 px tall, so a head, a rail or a
  // scroll target at top 0 sat underneath it and the group's name was hidden.
  it('keeps the sticky head, the sticky rail and the scroll target below the shell header', () => {
    expect(css).toMatch(/\.gr-layout \{[^}]*--gr-top:\s*53px/);
    expect(css).toMatch(/\.gr-head \{[^}]*top:\s*var\(--gr-top/);
    expect(css).toMatch(/\.gr-rail \{[^}]*top:\s*calc\(var\(--gr-top\)/);
    expect(css).toMatch(/\.gr-pane \{[^}]*scroll-margin-top:\s*calc\(var\(--gr-top\)/);
  });

  it('sets the phone select at 16 px so iOS does not zoom the page on focus', () => {
    expect(css).toMatch(/\.gr-select select \{[^}]*font:\s*600 16px/);
  });

  it('scrolls without easing under reduced motion (html scroll-behavior: smooth would ease "auto")', () => {
    const src = readFileSync(join(__dirname, 'GroupRail.tsx'), 'utf8');
    expect(src).toMatch(/behavior:\s*reduced \? 'instant' : 'smooth'/);
  });

  // r74 walk: an implicit auto column grew to the widest control inside (a 309 px select in
  // Distributor feeds), so the pane was 355 px in a 327 px column and the page scrolled sideways.
  it('pins the body to one column that cannot outgrow its container', () => {
    expect(css).toMatch(/\.gr-body \{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});
