/**
 * MOTIONS.md says nothing on the page moves that is not in its table. This
 * reads reports-next.css and holds the doc to it (r105 g6): every animation or
 * transition the stylesheet runs has a table row naming it with its duration,
 * and every one is switched off under prefers-reduced-motion (reduced motion
 * is no animation at all, opacity fades included).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'reports-next.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const md = readFileSync(resolve(__dirname, 'MOTIONS.md'), 'utf8');
const rows = md.split('\n').filter((l) => l.startsWith('| `'));

interface Rule {
  selector: string;
  body: string;
  reduced: boolean;
}

function parse(text: string, reduced: boolean, out: Rule[] = []): Rule[] {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const inner = text.slice(open + 1, j - 1);
    if (head.startsWith('@keyframes')) {
      // keyframe steps are not rules
    } else if (head.startsWith('@')) {
      parse(inner, reduced || /prefers-reduced-motion:\s*reduce/.test(head), out);
    } else {
      out.push({ selector: head, body: inner, reduced });
    }
    i = j;
  }
  return out;
}

const rules = parse(css, false);
const moving = rules.filter((r) => !r.reduced && /(^|[;\s])(animation|transition)\s*:/.test(r.body));
const reducedRules = rules.filter((r) => r.reduced);

/** Every `animation:` / `transition:` declaration in a rule body. */
function decls(body: string, opts = { live: true }): { kind: 'animation' | 'transition'; value: string }[] {
  const found: { kind: 'animation' | 'transition'; value: string }[] = [];
  const re = /(?:^|[;\s])(animation|transition)\s*:([^;]*)/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (opts.live && /^\s*none\b/.test(m[2])) continue;
    found.push({ kind: m[1] as 'animation' | 'transition', value: m[2] });
  }
  return found;
}

function lastClass(selector: string): string {
  const bare = selector.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*\)/g, '');
  const parts = [...bare.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  return parts[parts.length - 1];
}

/** A selector list split at its top-level commas (`:is(a, b)` stays whole). */
function parts(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of selector) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map(compound).filter(Boolean);
}

/**
 * One selector as the thing it names: attribute states (`[data-draw='drawn']`)
 * are dropped, because a reduced rule guards the element in any state, but the
 * pseudo-element (`::before`) and the combinators (`>`) stay: `.a::before` is
 * not `.a`, and `.a > *` is not `.a`.
 */
function compound(part: string): string {
  return part
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every moving rule part, with the kind of motion it runs, that no reduced rule of the SAME selector sets to none. */
function unguardedBy(moves: Rule[], reduced: Rule[]): string[] {
  const out: string[] = [];
  for (const r of moves) {
    for (const d of decls(r.body)) {
      for (const p of parts(r.selector)) {
        const off = reduced.some(
          (g) =>
            parts(g.selector).includes(p) &&
            decls(g.body, { live: false }).some((x) => x.kind === d.kind && /^\s*none\b/.test(x.value)),
        );
        if (!off) out.push(`${p} ${d.kind}`);
      }
    }
  }
  return out;
}

const guards = (text: string) => {
  const all = parse(text, false);
  return unguardedBy(
    all.filter((r) => !r.reduced && /(^|[;\s])(animation|transition)\s*:/.test(r.body)),
    all.filter((r) => r.reduced),
  );
};

/** Durations and delays a declaration names, in ms (`1.9s` reads as 1900). */
function times(value: string): number[] {
  return [...value.matchAll(/(?<![\w.-])(\d+(?:\.\d+)?)(ms|s)\b/g)].map((m) =>
    m[2] === 's' ? Math.round(Number(m[1]) * 1000) : Number(m[1]),
  );
}

function rowSays(row: string, ms: number): boolean {
  return row.includes(`${ms}ms`) || (ms % 100 === 0 && row.includes(`${ms / 1000}s`));
}

describe('MOTIONS.md covers every motion the stylesheet runs', () => {
  it('finds the motions the stylesheet runs', () => {
    expect(moving.length).toBeGreaterThanOrEqual(12);
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it('names every animation and transition, with each of its times, on one table row', () => {
    const missing: string[] = [];
    for (const r of moving) {
      for (const d of decls(r.body)) {
        const key = d.kind === 'animation' ? d.value.trim().split(/\s+/)[0] : lastClass(r.selector);
        const named = rows.filter((row) => row.includes(key));
        for (const ms of new Set(times(d.value))) {
          if (!named.some((row) => rowSays(row, ms))) missing.push(`${r.selector} ${d.kind} ${key} ${ms}ms`);
        }
        if (named.length === 0) missing.push(`${r.selector} ${d.kind} ${key} has no row`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('switches every one off under prefers-reduced-motion, opacity fades included', () => {
    expect(unguardedBy(moving, reducedRules)).toEqual([]);
  });

  it('[REVERT-FAILS] a reduced rule naming only the element does not guard its pseudo-element, a combinator, or the other half of a list', () => {
    expect(guards(css)).toEqual([]);
    const reducedAt = css.indexOf('prefers-reduced-motion');
    const mutate = (from: string, to: string) => {
      const at = css.indexOf(from, reducedAt);
      expect(at).toBeGreaterThan(-1);
      return css.slice(0, at) + to + css.slice(at + from.length);
    };
    expect(guards(mutate('.rp-sheet::before,', '.rp-sheet,'))).toContain('.rp-sheet::before transition');
    expect(guards(mutate('.rp-standin > *', '.rp-standin'))).toContain('.rp-standin > * transition');
    // In `.a, .b` the first part is checked too, not only the last.
    const list = '.a, .b { transition: opacity 1s; } @media (prefers-reduced-motion: reduce) { .b { transition: none; } }';
    expect(guards(list)).toEqual(['.a transition']);
  });

  it('never lets a reduced-motion rule keep a motion running', () => {
    const live = reducedRules.flatMap((g) =>
      decls(g.body, { live: false })
        .filter((x) => !/^\s*none\b/.test(x.value))
        .map(() => g.selector),
    );
    expect(live).toEqual([]);
  });
});
