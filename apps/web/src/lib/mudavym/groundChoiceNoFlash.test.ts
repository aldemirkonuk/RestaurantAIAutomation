/**
 * ADR 0169 — no flash of the wrong ground on first paint, and never the
 * wrong PERSON'S ground.
 *
 * The founder, 2026-09-21: "Always paper, follows account." That makes the
 * pre-paint problem harder than it was in round 4, because the truth now
 * lives on the account and the account cannot be read before the page paints.
 * The script in `index.html` therefore reads this device's MIRROR of the
 * account value — and, because a device can be shared, only the mirror under
 * the user id carried by the session's own access token.
 *
 * jsdom does not paint, so this cannot observe a flash directly (the same
 * honest limit `styles/mudavym-ground.test.ts` states for its own suite).
 * Two things ARE checkable, mechanically, and both are here:
 *
 *   A. the shape of the shipped `index.html` script — that it is blocking,
 *      first, defaults to paper, and reads the same key prefix and writes the
 *      same attribute that `groundChoice.ts` uses at runtime (the module doc
 *      says these must be kept in sync "by hand," and nothing else enforces
 *      it);
 *   B. what the script DOES, by executing its exact source out of the file
 *      against a seeded `localStorage`. A regex over the source cannot tell
 *      you that a shared terminal shows paper to the second person; running
 *      it can.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GROUND_CHOICE_ATTR, GROUND_MIRROR_KEY_PREFIX, groundMirrorKey } from './groundChoice';

const INDEX_HTML = join(__dirname, '../../../index.html');

function html(): string {
  return readFileSync(INDEX_HTML, 'utf8');
}

/** The body of the one inline script that decides the ground. */
function scriptBody(): string {
  const match = html().match(/<script[^>]*>([\s\S]*?data-mudavym-ground[\s\S]*?)<\/script>/);
  expect(match, 'no inline ground-choice <script> found in index.html').not.toBeNull();
  return match![1];
}

/** An unsigned JWT-shaped token whose payload carries `sub`. The pre-paint
 *  script reads the claim, never verifies it — the gateway does that. */
function tokenFor(sub: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub })}.signature`;
}

/** Run the shipped script exactly as the browser would. */
function runPrePaintScript(): string | null {
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
  // eslint-disable-next-line no-new-func
  new Function(scriptBody())();
  return document.documentElement.getAttribute(GROUND_CHOICE_ATTR);
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute(GROUND_CHOICE_ATTR);
});

describe('ADR 0169 — the pre-paint script is shaped to avoid a flash', () => {
  it('exists, inline, before the app mounts', () => {
    expect(scriptBody().length).toBeGreaterThan(0);
  });

  it('is a plain blocking script — no type="module", defer or async', () => {
    const tagMatch = html().match(/<script(\b[^>]*)>[\s\S]*?data-mudavym-ground[\s\S]*?<\/script>/);
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

  it('reads the exact mirror key prefix groundChoice.ts writes at runtime', () => {
    expect(scriptBody()).toContain(`'${GROUND_MIRROR_KEY_PREFIX}'`);
  });

  it('writes the exact attribute groundChoice.ts reads at runtime', () => {
    expect(scriptBody()).toContain(`setAttribute('${GROUND_CHOICE_ATTR}'`);
  });

  it('never throws on a blocked localStorage — wrapped in try/catch', () => {
    const body = scriptBody();
    expect(body).toMatch(/try\s*{/);
    expect(body).toMatch(/catch/);
  });

  it('never consults the device\'s light/dark setting', () => {
    // The founder's answer is paper on a first visit, full stop — not the OS
    // preference, and there is no third "match my device" option to serve.
    const body = scriptBody();
    expect(body).not.toMatch(/matchMedia/);
    expect(body).not.toMatch(/prefers-color-scheme/);
  });
});

describe('ADR 0169 — the pre-paint script, executed', () => {
  it('paints paper for a visitor with no session at all', () => {
    expect(runPrePaintScript()).toBe('paper');
  });

  it('paints paper for a signed-in person this device has never mirrored', () => {
    window.localStorage.setItem('accessToken', tokenFor('user-alice'));
    expect(runPrePaintScript()).toBe('paper');
  });

  it('paints charcoal for the person whose mirror this device holds', () => {
    window.localStorage.setItem('accessToken', tokenFor('user-alice'));
    window.localStorage.setItem(groundMirrorKey('user-alice'), 'charcoal');
    expect(runPrePaintScript()).toBe('charcoal');
  });

  it('paints PAPER for the next person on a shared terminal, not the last one\'s charcoal', () => {
    // Alice chose charcoal here. Bob now signs in on the same browser.
    window.localStorage.setItem(groundMirrorKey('user-alice'), 'charcoal');
    window.localStorage.setItem('accessToken', tokenFor('user-bob'));
    expect(runPrePaintScript()).toBe('paper');
  });

  it('paints paper when the token is not a token at all', () => {
    window.localStorage.setItem('accessToken', 'not-a-jwt');
    window.localStorage.setItem(groundMirrorKey('user-alice'), 'charcoal');
    expect(runPrePaintScript()).toBe('paper');
  });

  it('paints paper when the token carries no sub claim', () => {
    window.localStorage.setItem('accessToken', tokenFor(''));
    window.localStorage.setItem(groundMirrorKey('user-alice'), 'charcoal');
    expect(runPrePaintScript()).toBe('paper');
  });

  it('paints paper when the mirror holds a value this app does not know', () => {
    window.localStorage.setItem('accessToken', tokenFor('user-alice'));
    window.localStorage.setItem(groundMirrorKey('user-alice'), 'sepia');
    expect(runPrePaintScript()).toBe('paper');
  });

  it('paints paper, without throwing, when localStorage is blocked entirely', () => {
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
    Storage.prototype.getItem = () => {
      throw new Error('storage blocked');
    };
    try {
      expect(runPrePaintScript()).toBe('paper');
    } finally {
      if (original) Object.defineProperty(Storage.prototype, 'getItem', original);
    }
  });

  it('never paints a ground on a dark-mode machine that a paper person did not choose', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({ matches: true, media: query }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      window.localStorage.setItem('accessToken', tokenFor('user-alice'));
      expect(runPrePaintScript()).toBe('paper');
    } finally {
      window.matchMedia = original;
    }
  });
});
