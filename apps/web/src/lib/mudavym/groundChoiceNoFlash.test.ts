/**
 * ADR 0169 — no flash of the wrong ground on first paint.
 *
 * The default (paper) needs no script at all: it is the CSS default, so a
 * first-time visitor never needs JavaScript to see it correctly. A CHARCOAL
 * choice does need one — `data-mudavym-ground="charcoal"` has to be on
 * `<html>` before the browser paints anything, or the page would render
 * paper for one frame and then jump to charcoal.
 *
 * jsdom does not paint, so this cannot observe a flash directly (the same
 * honest limit `styles/mudavym-ground.test.ts` states for its own suite).
 * What IS checkable, mechanically, from the shipped `index.html` source:
 *
 *   1. the script exists, and is a plain, synchronous, blocking script — no
 *      `type="module"`, no `defer`, no `async`, any of which would let the
 *      browser continue parsing/painting before it runs;
 *   2. it appears before the first stylesheet and before the app's own
 *      module script — later would mean CSS or the bundle can already be at
 *      work before this script has decided the ground;
 *   3. it reads the SAME storage key and writes the SAME attribute that
 *      `groundChoice.ts` uses at runtime — the module doc says these two
 *      must be kept in sync "by hand," and nothing else enforces that; a
 *      drift here would mean the pre-paint script and the React module
 *      disagree about where the choice lives, silently.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GROUND_CHOICE_ATTR, GROUND_CHOICE_STORAGE_KEY } from './groundChoice';

const INDEX_HTML = join(__dirname, '../../../index.html');

function html(): string {
  return readFileSync(INDEX_HTML, 'utf8');
}

describe('ADR 0169 — the pre-paint script avoids a flash of the wrong ground', () => {
  it('exists, inline, before the app mounts', () => {
    const src = html();
    const scriptMatch = src.match(/<script[^>]*>([\s\S]*?data-mudavym-ground[\s\S]*?)<\/script>/);
    expect(scriptMatch, 'no inline ground-choice <script> found in index.html').not.toBeNull();
  });

  it('is a plain blocking script — no type="module", defer or async', () => {
    const src = html();
    const tagMatch = src.match(/<script(\b[^>]*)>[\s\S]*?data-mudavym-ground[\s\S]*?<\/script>/);
    expect(tagMatch, 'could not find the ground-choice script tag').not.toBeNull();
    const attrs = tagMatch![1];
    expect(attrs).not.toMatch(/type\s*=\s*["']module["']/);
    expect(attrs).not.toMatch(/\bdefer\b/);
    expect(attrs).not.toMatch(/\basync\b/);
  });

  it('runs before the first stylesheet link and before the app bundle script', () => {
    const src = html();
    const scriptIdx = src.indexOf('data-mudavym-ground');
    expect(scriptIdx).toBeGreaterThan(-1);

    const firstStylesheetIdx = src.indexOf('rel="stylesheet"');
    const appScriptIdx = src.indexOf('src="/src/main.tsx"');

    if (firstStylesheetIdx !== -1) {
      expect(scriptIdx).toBeLessThan(firstStylesheetIdx);
    }
    expect(appScriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(appScriptIdx);
  });

  it('is at or near the very top of <head> — before the SEO block and fonts', () => {
    const src = html();
    const headIdx = src.indexOf('<head>');
    const scriptIdx = src.indexOf('data-mudavym-ground');
    const seoIdx = src.indexOf('seo:head:start');
    const fontsIdx = src.indexOf('fonts.googleapis.com');
    expect(headIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeGreaterThan(headIdx);
    expect(scriptIdx).toBeLessThan(seoIdx);
    expect(scriptIdx).toBeLessThan(fontsIdx);
  });

  it('reads the exact storage key groundChoice.ts uses at runtime', () => {
    const src = html();
    expect(src).toContain(`localStorage.getItem('${GROUND_CHOICE_STORAGE_KEY}')`);
  });

  it('writes the exact attribute groundChoice.ts reads at runtime', () => {
    const src = html();
    // Both branches (charcoal chosen, and the paper/error fallback) must set
    // the SAME attribute name as the runtime module, or a value applied here
    // would be invisible to `getGroundChoice()`'s CSS-consuming counterpart.
    const occurrences = src.split(`setAttribute('${GROUND_CHOICE_ATTR}'`).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2); // the charcoal branch and the fallback branch
  });

  it('never throws on a blocked localStorage — wrapped in try/catch', () => {
    const src = html();
    const scriptMatch = src.match(/<script[^>]*>([\s\S]*?data-mudavym-ground[\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();
    expect(scriptMatch![1]).toMatch(/try\s*{/);
    expect(scriptMatch![1]).toMatch(/catch/);
  });

  it('defaults to paper, never a hardcoded charcoal, on any path through the script', () => {
    const src = html();
    const scriptMatch = src.match(/<script[^>]*>([\s\S]*?data-mudavym-ground[\s\S]*?)<\/script>/);
    expect(scriptMatch, 'no inline ground-choice <script> found in index.html').not.toBeNull();
    const body = scriptMatch![1];
    // Every literal assignment of the attribute is either 'charcoal' (gated
    // behind reading the stored choice) or 'paper' (the fallback / default) —
    // never an unconditional 'charcoal'.
    const assigned = [...body.matchAll(/setAttribute\('data-mudavym-ground',\s*'([a-z]+)'\)/g)].map(
      (m) => m[1],
    );
    expect(assigned.length).toBeGreaterThan(0);
    expect(assigned.every((v) => v === 'paper' || v === 'charcoal')).toBe(true);
    expect(assigned).toContain('paper');
  });
});
