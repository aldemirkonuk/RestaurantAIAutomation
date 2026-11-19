/**
 * Connections at 375 (r74): no fixed width over 343 px may stand unless the
 * same rule caps it at `max-width: 100%`. jsdom cannot lay out, so the css is
 * read as text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'connections-next.css'), 'utf8');

describe('Connections css holds the 375 phone width', () => {
  it('every min-width or width over 343 px sits in a rule capped at 100%', () => {
    const bad: string[] = [];
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const [, sel, body] = rule;
      for (const m of body.matchAll(/(?:^|[;\s])(?:min-width|width)\s*:\s*(\d+(?:\.\d+)?)(px|em|rem)\b/g)) {
        const px = Number(m[1]) * (m[2] === 'px' ? 1 : 16);
        if (px > 343 && !/max-width:\s*100%/.test(body)) bad.push(`${sel.trim()} -> ${m[0].trim()}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the price-code form fields cannot outgrow the column', () => {
    expect(css).toMatch(/\.cx-pc-form textarea \{[^}]*max-width: 100%/);
    expect(css).toMatch(/\.cx-pc-form input\[type='text'\] \{[^}]*max-width: 100%/);
    expect(css).toMatch(/\.cx-pc-ceremony input\[type='text'\] \{[^}]*max-width: 100%/);
  });
});
