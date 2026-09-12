/**
 * The contract every catalogue entry signs.
 *
 * Split out of `rp-catalogue.tsx` so the eleven analyses can live in two files
 * without importing each other: the registers import this, the catalogue
 * imports the registers, and nothing points back up.
 */

import type { GraphType } from './rp-sheet';
import type { AnalysisView } from './rp-view';
import type { GoalsDesk } from './useGoalsDesk';

export interface ViewCtx {
  /** The till window the reader picked. Only `till` takes one. */
  days: number;
  /**
   * The one register on this sheet that WRITES.
   *
   * Every other analysis is a pure function of a payload, which is what makes
   * "Show instead" and "Draw as" safe: swapping a cutting cannot swap a side
   * effect with it. Goals is the exception the founder asked for — *"they will
   * have access to edit change as they like"* — so its handlers ride the
   * context rather than the payload, and the exception is declared here in one
   * place instead of being smuggled into a view builder. Absent (on a
   * rendering that has no desk wired) the goals cutting is read-only and says so.
   */
  goals?: GoalsDesk;
}

export interface AnalysisSpec {
  title: string;
  /** The noun a failure line uses: "the seasonality register could not be read". */
  register: string;
  /** What this analysis answers, in the reader's words. Shown while arranging. */
  answers: string;
  /** The window it is computed over. Shown under the title, always. */
  window: (ctx: ViewCtx) => string;
  /** `null` for an analysis with no endpoint — the writing desk. */
  path: ((rid: string, ctx: ViewCtx) => string) | null;
  /** Truthful drawings, best first. `graphs[0]` is the default. */
  graphs: GraphType[];
  /** One line on what is NOT offered here, and why. */
  graphNote: string;
  /** True for the one register whose endpoint takes a `days` parameter. */
  takesWindow?: boolean;
  select: (raw: unknown) => unknown;
  view: (data: unknown, ctx: ViewCtx) => AnalysisView;
}

/** Ties `select` and `view` to one payload type, then erases it for the map. */
export function analysis<T>(spec: {
  title: string;
  register: string;
  answers: string;
  window: (ctx: ViewCtx) => string;
  path: ((rid: string, ctx: ViewCtx) => string) | null;
  graphs: GraphType[];
  graphNote: string;
  takesWindow?: boolean;
  select: (raw: unknown) => T;
  view: (data: T, ctx: ViewCtx) => AnalysisView;
}): AnalysisSpec {
  return {
    ...spec,
    select: spec.select as (raw: unknown) => unknown,
    view: spec.view as (data: unknown, ctx: ViewCtx) => AnalysisView,
  };
}

/* ────────────────────────────────────────── defensive payload readers ────
   A payload is data that came off the wire. These three read it without ever
   inventing a value: a missing object is `{}`, a missing list is `[]`, a
   missing string is `''` — and every NUMBER goes through `num()` in
   `rp-format.ts`, which answers `null` rather than 0. */

export const obj = (raw: unknown): Record<string, unknown> =>
  (raw ?? {}) as Record<string, unknown>;
export const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
