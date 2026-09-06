/**
 * The policy, made checkable.
 *
 * ADR 0112 and ADR 0042 fix seven things about every house overlay: the close
 * control is WORDS, there is no glyph and no emoji, there is exactly one
 * chromatic colour and it is the seal, colour comes from tokens and never from
 * a literal, motion comes from `lib/mudavym/motion.ts` and never from a number,
 * and `prefers-reduced-motion` renders none of it.
 *
 * Six of those are stated in prose in four files and asserted nowhere, which is
 * how a policy becomes a comment. This reads the primitive family's own source
 * and holds it to them — it is the guard, not the documentation. It reads the
 * files from disk on purpose: a runtime assertion could only catch what a test
 * happened to render, and the rules are about what is WRITTEN.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const DIR = __dirname;

/** The primitive and everything that ships beside it. */
const FAMILY = [
  'Sheet.tsx',
  'sheet.css',
  'Stub.tsx',
  'Denied.tsx',
  'SheetStack.tsx',
  'HoldToApprove.tsx',
];

const src = (f: string) => readFileSync(join(DIR, f), 'utf8');

/**
 * The third argument of every `animate(...)` call in a source file, found by
 * balancing brackets rather than by a regex — the keyframe array is multi-line
 * and full of commas, and a regex reads it wrong in both directions.
 */
function motionArgs(text: string): string[] {
  const out: string[] = [];
  const needle = 'animate(';
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
    // Skip the word inside a comment or inside `cancelAnimationFrame`.
    if (/[A-Za-z0-9_$]/.test(text[at - 1] ?? '')) continue;
    let depth = 0;
    let arg = 0;
    let start = at + needle.length;
    for (let i = start; i < text.length; i += 1) {
      const c = text[i];
      if ('([{'.includes(c)) depth += 1;
      else if (')]}'.includes(c)) {
        if (depth === 0) {
          if (arg === 2) out.push(text.slice(start, i).trim());
          break;
        }
        depth -= 1;
      } else if (c === ',' && depth === 0) {
        if (arg === 2) {
          out.push(text.slice(start, i).trim());
          break;
        }
        arg += 1;
        start = i + 1;
      }
    }
  }
  return out;
}

/** The seven tokens, and nothing else, may be handed to `animate()`. */
const TOKENS = ['settle', 'ink', 'tuck', 'turn', 'pour', 'press', 'stamp', 'tally'];

describe('the house policy holds in the primitive family', () => {
  it('closes with words — the default is a word and there is no glyph', () => {
    const sheet = src('Sheet.tsx');
    expect(sheet).toContain("closeLabel = 'Close'");
    for (const f of FAMILY) {
      // The multiplication sign, the two ballot X glyphs, and lucide's `X`.
      expect(src(f).replace(/36×4/g, '')).not.toMatch(/[×✕✖⨯]/);
      expect(src(f)).not.toMatch(/from 'lucide-react'/);
    }
  });

  it('carries no emoji anywhere in the family', () => {
    // Pictographs and dingbats. `›` (the spine separator) and `·` are
    // punctuation, not pictures, and are deliberately allowed.
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const f of FAMILY) expect(src(f)).not.toMatch(emoji);
  });

  it('takes every colour from a token — no literal in the stylesheet', () => {
    const css = src('sheet.css');
    expect(css).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    // The only literals allowed are neutral: warm ink and black, for the scrim
    // and the shadows, which are the two things a token column cannot express
    // as a solid colour. Each one must be greyscale-or-warm-ink, never chromatic.
    const rgba = [...css.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1]);
    expect(rgba.length).toBeGreaterThan(0);
    for (const value of rgba) {
      const [r, g, b] = value.split(',').map((n) => Number(n.trim()));
      // Warm ink (23,19,15) and black (0,0,0) both sit inside a 12-point spread.
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(12);
    }
  });

  it('has exactly one chromatic colour, and it is the seal', () => {
    const css = src('sheet.css');
    const custom = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const chromatic = [...custom].filter(
      (name) => !/^--(paper|ink|mdv|sheet)/.test(name),
    );
    expect(chromatic.sort()).toEqual(['--seal', '--seal-deep', '--seal-ring', '--seal-tint']);
  });

  it('animates only with a token from lib/mudavym/motion.ts', () => {
    let checked = 0;
    for (const f of FAMILY.filter((x) => x.endsWith('.tsx'))) {
      const text = src(f);
      for (const token of motionArgs(text)) {
        checked += 1;
        // `TOKEN[shape]` is the three-shape map at the top of Sheet.tsx, which
        // holds nothing but `tuck`/`settle`/`ink` — asserted separately below.
        const named = /^TOKEN\[/.test(token) ? 'tuck' : token;
        expect(
          TOKENS.includes(named),
          `${f}: animate() was handed "${token}" — motion is a token, never a number`,
        ).toBe(true);
      }
    }
    // The guard must be able to fail: if the scanner stops finding calls, this
    // test would pass by measuring nothing (ADR 0020 — absence is not health).
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it('renders no motion at all under prefers-reduced-motion', () => {
    for (const f of ['Sheet.tsx', 'Stub.tsx', 'HoldToApprove.tsx']) {
      expect(src(f), `${f} animates and must read the setting`).toContain('useReducedMotion');
    }
    // Not "a shorter one": every animating effect in the primitive is guarded
    // by the flag rather than handed a smaller duration.
    expect(src('Sheet.tsx')).toContain('if (!live || reduced) return;');
    expect(src('Stub.tsx')).toContain("if (reduced || state !== 'held') return;");
  });

  it('names the three shapes and their three tokens, unchanged', () => {
    const sheet = src('Sheet.tsx');
    expect(sheet).toContain(
      "const TOKEN: Record<OverlayShape, MotionToken> = { sheet: tuck, panel: settle, popover: ink };",
    );
    expect(sheet).toContain(
      "const TOKEN_NAME: Record<OverlayShape, string> = { sheet: 'tuck', panel: 'settle', popover: 'ink' };",
    );
  });
});
