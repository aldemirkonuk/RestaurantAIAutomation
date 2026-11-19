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
});
