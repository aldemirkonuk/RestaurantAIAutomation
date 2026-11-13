/**
 * Every house page breaks a long word instead of widening (r26, 2026-11-13).
 *
 * jsdom has no layout engine, so this pins the rule rather than measuring a
 * width: the `.mudavym` root carries `overflow-wrap: break-word`, which every
 * house page inherits. It also pins the choice of `break-word` over
 * `anywhere`: `anywhere` changes how wide a table column asks to be, which
 * would re-flow every table on a wide screen. The real width is a browser
 * check at 375px (r26 mobile-width BUILD report).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'mudavym.css'), 'utf8')
  // Comments carry selector-like text; strip them before reading rules.
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `selector { body }` at the top level (this file has no nesting). */
function rules(css: string): Array<{ selectors: string[]; body: string }> {
  const out: Array<{ selectors: string[]; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    out.push({
      selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
      body: m[2],
    });
  }
  return out;
}

describe('mudavym.css — a long word breaks, it never widens the page', () => {
  it('gives the bare .mudavym root overflow-wrap: break-word', () => {
    const root = rules(CSS).filter(
      (r) => r.selectors.includes('.mudavym') && /overflow-wrap\s*:\s*break-word\s*;?/.test(r.body),
    );
    expect(root).toHaveLength(1);
  });

  it('never makes it `anywhere` for the whole page', () => {
    const anywhere = rules(CSS).filter((r) => /overflow-wrap\s*:\s*anywhere/.test(r.body));
    expect(anywhere).toEqual([]);
  });
});
