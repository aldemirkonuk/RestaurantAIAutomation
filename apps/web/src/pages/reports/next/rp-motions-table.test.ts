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
    const unguarded: string[] = [];
    for (const r of moving) {
      for (const d of decls(r.body)) {
        const key = lastClass(r.selector);
        const off = reducedRules.some(
          (g) =>
            new RegExp(`\\.${key}(?![\\w-])`).test(g.selector) &&
            decls(g.body, { live: false }).some((x) => x.kind === d.kind && /^\s*none\b/.test(x.value)),
        );
        if (!off) unguarded.push(`${r.selector} ${d.kind}`);
      }
    }
    expect(unguarded).toEqual([]);
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
