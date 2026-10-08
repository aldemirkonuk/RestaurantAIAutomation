/**
 * What a phone (360–414 px) is told so nothing sits under the shell's own
 * fixed and sticky parts: the four doors at the foot, the house header at the
 * top, and the offline bar above the doors.
 *
 * jsdom lays nothing out, so these read the rules' own text (the way
 * PublicShell.test.tsx does). `readFileSync` throws on a missing path, so a
 * failed read never arrives as an empty string every `not` would pass.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = resolve(process.cwd(), 'src');
/** Declarations only: a comment that names a rule must not pass for one. */
const rules = (rel: string) =>
  readFileSync(resolve(SRC, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the phone shell leaves room for its own parts', () => {
  it('F-224: the recommendations bulk bar rides above the four doors', () => {
    const css = rules('pages/recommendations/next/rec-next.css');
    expect(css).toMatch(
      /body:has\(\.mdv-doors\) \.rc-bulk\s*{[^}]*bottom:\s*calc\(69px \+ env\(safe-area-inset-bottom, 0px\)\);[^}]*z-index:\s*41;/,
    );
    // Above the doors (z 40), under the offline bar (z 45).
    expect(rules('components/mudavym/house-shell.css')).toMatch(/\.mdv-doors\s*{[^}]*z-index:\s*40;/);
  });

  it('F-227: the logs day heading sticks under the house header, not behind it', () => {
    const src = rules('pages/logs/next/LogsNext.tsx');
    expect(src).toMatch(/\.lg-day\s*{\s*position:\s*sticky;\s*top:\s*var\(--mdv-shell-top, 53px\);/);
    expect(src).not.toMatch(/\.lg-day\s*{\s*position:\s*sticky;\s*top:\s*0;/);
  });

  it('F-228: while the offline bar is up, the page foot clears it as well as the doors', () => {
    const css = rules('components/mudavym/house-offline-banner.css');
    expect(css).toMatch(
      /body:has\(\.mdv-offlinebar\) \.mdv-shell\[data-phone='true'\] \.mdv-shell__page\s*{\s*padding-bottom:\s*calc\(96px/,
    );
    expect(css).toMatch(
      /body:has\(\.mdv-offlinebar \+ \.mdv-offlinebar\) \.mdv-shell\[data-phone='true'\] \.mdv-shell__page\s*{\s*padding-bottom:\s*calc\(128px/,
    );
  });

  it('F-229: the header bell and account buttons are 44 px tap targets on a phone', () => {
    const css = rules('components/mudavym/house-header.css');
    expect(css).toMatch(
      /@media \(max-width: 767px\)\s*{\s*\.mdv-hdr__btn\s*{\s*min-width:\s*44px;\s*min-height:\s*44px;/,
    );
  });
});
