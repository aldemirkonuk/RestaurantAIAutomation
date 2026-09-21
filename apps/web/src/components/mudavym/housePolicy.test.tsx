/**
 * The policy, made checkable.
 *
 * ADR 0112 and ADR 0042 fix seven things about every house overlay: the close
 * control is WORDS, there is no glyph and no emoji, there is exactly one
 * chromatic colour and it is the seal, colour comes from tokens and never from
 * a literal, motion comes from `lib/mudavym/motion.ts` and never from a number,
 * and `prefers-reduced-motion` renders no movement.
 *
 * Six of those are stated in prose in four files and asserted nowhere, which is
 * how a policy becomes a comment. This reads the primitive family's own source
 * and holds it to them — it is the guard, not the documentation. Most rules are
 * about what is WRITTEN, so they read the files from disk: a runtime assertion
 * could only catch what a test happened to render.
 *
 * Reduced motion is the exception, and is asserted by BEHAVIOUR (2026-09-17).
 * Its first version checked that two source strings were present, which a
 * refactor that kept the strings and lost the guard would pass — and the
 * seal's `stamp` was unguarded all along, leaning on `animate()` collapsing to
 * zero, which is "a shorter one", exactly what the rule forbids.
 *
 * CORRECTED 2026-09-21 (ADR 0134 §6, locked; CLAUDE.md §5b): "renders none of
 * it" is no longer true of an ENTRANCE — a Sheet/Panel/Popover arriving under
 * reduced motion now crosses on `REDUCED_FADE`, a 120ms opacity-only
 * cross-fade, the one disclosed exception the founder locked. The tear, the
 * lean and the seal are unaffected and still schedule nothing. `REDUCED_FADE`
 * is not one of the seven/eight named tokens (ADR 0134 §1's "no eighth token"
 * stays literally true — it is a disclosed literal, not a token), so the
 * animate()-token check below names it as the one allowed exception.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { Panel, Sheet } from './Sheet';
import { Stub } from './Stub';
import { HoldToApprove } from './HoldToApprove';
import { resetLabelWarnings, resetSheetWidth } from './overlayState';

const DIR = __dirname;

/** The primitive and everything that ships beside it. */
const FAMILY = [
  'Sheet.tsx',
  'sheet.css',
  'Stub.tsx',
  'Denied.tsx',
  'SheetStack.tsx',
  'sheetStackContext.ts',
  'overlayState.ts',
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

/** The seven tokens, and nothing else, may be handed to `animate()` — with
    exactly one named, disclosed exception: `REDUCED_FADE` (ADR 0134 §6,
    2026-09-21, locked), the entrance-only reduced-motion cross-fade declared
    in Sheet.tsx and allow-listed by file:line in
    `scripts/check_motion_tokens.py`. It is listed here, not folded into
    TOKENS, so it stays visibly an exception rather than a ninth token. */
const TOKENS = ['settle', 'ink', 'tuck', 'turn', 'pour', 'press', 'stamp', 'tally'];
const DISCLOSED_EXCEPTIONS = ['REDUCED_FADE'];

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
    // Alternation, not one class: a variation selector inside a character
    // class is a `no-misleading-character-class` error, and it is exactly the
    // codepoint that turns a glyph into an emoji.
    const emoji = /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|\u{FE0F}/u;
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
          TOKENS.includes(named) || DISCLOSED_EXCEPTIONS.includes(named),
          `${f}: animate() was handed "${token}" — motion is a token, never a number, ` +
            `unless it is a disclosed exception cited by ADR`,
        ).toBe(true);
      }
    }
    // The guard must be able to fail: if the scanner stops finding calls, this
    // test would pass by measuring nothing (ADR 0020 — absence is not health).
    expect(checked).toBeGreaterThanOrEqual(6);
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

/* ── reduced motion, by behaviour ───────────────────────────────────────── */

function setReducedMotion(reduce: boolean) {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

const LABEL = 'This holds a note on the order. Saving writes it; leaving holds it on the row.';

/** Every motion the family has, driven once: open, tear, lean, stub, seal. */
async function driveEveryMotion() {
  function Floor() {
    const [sheet, setSheet] = useState(true);
    return (
      <div className="mudavym">
        <Sheet open={sheet} onClose={() => setSheet(false)} onTear={() => {}} dirty label={LABEL}>
          <textarea defaultValue="half a sentence" />
        </Sheet>
      </div>
    );
  }
  const floor = render(<Floor />);
  fireEvent.keyDown(window, { key: 'Escape' }); // the tear
  floor.unmount();

  const panel = render(
    <Panel open onClose={() => {}} dirty label={LABEL}>
      <button type="button">body</button>
    </Panel>,
  );
  fireEvent.click(document.querySelector('.mdv-ovl__scrim') as HTMLElement); // the lean
  panel.unmount();

  const stub = render(<Stub words="a draft" onResume={() => {}} onDiscard={() => {}} />);
  stub.unmount();

  render(<HoldToApprove onApprove={async () => {}} boundSummary="Order 118" />);
  const control = screen.getByRole('button', { name: 'Hold to approve' });
  fireEvent.keyDown(control, { key: 'Enter' });
  fireEvent.keyDown(control, { key: 'Enter' });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByText('What the seal bound')).toBeInTheDocument(); // the seal landed
}

describe('prefers-reduced-motion renders no movement — measured, not read', () => {
  const original = (Element.prototype as { animate?: unknown }).animate;
  let calls: KeyframeAnimationOptions[] = [];
  // The keyframes each call was handed, index-aligned with `calls` — without
  // them "opacity only" is a claim the reduced-motion test below cannot check.
  let frames: unknown[] = [];

  beforeEach(() => {
    calls = [];
    frames = [];
    resetLabelWarnings();
    resetSheetWidth();
    document.body.style.overflow = '';
    // jsdom has no WAAPI, so `animate()` returns early and nothing is ever
    // observable. Give it one that records what it was asked to schedule.
    (Element.prototype as { animate?: unknown }).animate = function animateSpy(
      keyframes: unknown,
      options: KeyframeAnimationOptions,
    ) {
      calls.push(options);
      frames.push(keyframes);
      return { cancel() {}, finish() {}, onfinish: null } as unknown as Animation;
    };
  });
  afterEach(() => {
    (Element.prototype as { animate?: unknown }).animate = original;
    vi.useRealTimers();
  });

  it('schedules motion when motion is allowed — so the next test can fail', async () => {
    setReducedMotion(false);
    await driveEveryMotion();
    expect(calls.length).toBeGreaterThanOrEqual(4);
  });

  it('schedules only the two disclosed entrance fades under reduced motion — the tear, the lean and the seal schedule nothing', async () => {
    // Corrected 2026-09-21 (ADR 0134 §6, CLAUDE.md §5b): this used to assert
    // `calls` was empty. `driveEveryMotion` opens one Sheet and one Panel —
    // each entrance now schedules the disclosed 120ms opacity-only fade — and
    // still drives the tear, the lean and the seal, none of which call
    // `animate()` under reduced motion. Every recorded call is asserted to BE
    // that fade, not just counted, so a regression that widened the exception
    // (a longer duration, a transform, a third caller) fails here too.
    setReducedMotion(true);
    await driveEveryMotion();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.duration).toBe(120);
      expect(call.easing).toBe('linear');
      expect(call.fill).toBe('both');
    }
    // Opacity only: a keyframe carrying a transform (or anything but opacity)
    // is movement, which is exactly what reduced motion forbids.
    for (const kf of frames) {
      expect(kf).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    }
  });
});
