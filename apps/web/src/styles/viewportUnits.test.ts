/**
 * A page that must fit the phone's screen measures it in `svh`, the viewport
 * with the browser's toolbars still showing, not `vh`, which counts the screen
 * as if they had folded away and pushes the foot of the page under them (design
 * need N-11, the 100svh sweep). Each `100vh` declaration in the shell and page
 * stylesheets keeps its `vh` line for a browser without `svh` and is followed
 * by the same line in `svh`; Tailwind's `screen` heights carry the same pair.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
// @ts-expect-error -- the config is plain JS with no declaration file
import config from '../../tailwind.config.js';

const SRC = resolve(__dirname, '..');
const SHEETS = [
  'components/askai/ask-panel.css',
  'components/mudavym/house-page-loader.css',
  'components/mudavym/house-shell.css',
  'pages/admin/next/admin-desk.css',
  'pages/recommendations/next/rec-next.css',
  'pages/promotions/next/promotions-next.css',
  'pages/team/next/team-next.css',
  'pages/documents/next/canonical-document.css',
  'pages/cellar/next/cellar-next.css',
];

describe('100svh, not 100vh, for what must fit', () => {
  it.each(SHEETS)('%s: every 100vh declaration is followed by its 100svh twin', (rel) => {
    const lines = readFileSync(resolve(SRC, rel), 'utf8').split('\n');
    const bad: string[] = [];
    let seen = 0;
    lines.forEach((line, i) => {
      if (!/^\s+[a-z-]+:.*100vh.*;\s*$/.test(line)) return;
      seen += 1;
      if (lines[i + 1]?.trim() !== line.trim().replace(/100vh/g, '100svh')) bad.push(`${i + 1}: ${line.trim()}`);
    });
    expect(seen).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it('Tailwind min-h-screen, h-screen and max-h-screen emit vh then svh', async () => {
    const out = await postcss([
      tailwind({ ...config, content: [{ raw: 'min-h-screen h-screen max-h-screen', extension: 'html' }] }),
    ]).process('@tailwind utilities;', { from: undefined });
    for (const [cls, prop] of [
      ['min-h-screen', 'min-height'],
      ['h-screen', 'height'],
      ['max-h-screen', 'max-height'],
    ]) {
      const rule = new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`).exec(out.css)?.[1] ?? '';
      expect(rule.replace(/\s+/g, ' ').trim()).toBe(`${prop}: 100vh; ${prop}: 100svh`);
    }
  });

  it('on a phone the page inside the shell asks for what is left of the screen, not a whole one', () => {
    const css = readFileSync(resolve(SRC, 'components/mudavym/house-shell.css'), 'utf8').replace(/\s+/g, ' ');
    expect(css).toContain(
      ".mdv-shell[data-phone='true'] .mdv-shell__main > * { min-height: calc(100svh - var(--mdv-shell-top, 53px) - 64px - env(safe-area-inset-bottom, 0px)) !important; }",
    );
    expect(css).toContain(
      ".mdv-shell[data-phone='true'] .mdv-shell__page { min-height: calc(100svh - var(--mdv-shell-top, 53px)); }",
    );
  });
});
