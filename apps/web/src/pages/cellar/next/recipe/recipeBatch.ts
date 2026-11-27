/**
 * Batch for a bottle (r109 drinks-g2): how many serves of a drink fit in one
 * bottle once water stands in for the ice a shake or stir would melt, and
 * what goes in it.
 *
 *   V = a serve's batched volume: the ml-family lines (qty_base in tenths of
 *       a ml) that are not added at service, divided by the serves the
 *       recipe makes.
 *   W = V x p, the water, p from 0 to 40 %.
 *   S = V + W, one pour from the bottle.
 *   serves = floor(C / S), C the bottle in ml.
 *
 * Invariant: serves x S <= C, and the parts as printed (each floored to a
 * whole ml, water included) sum to <= C; what is left is said as spare.
 * Lines in g or each, and lines the owner leaves out, are added at service.
 *
 * Session's calls (r109): p is an input with presets, because the published
 * ranges disagree (10-25 %); a batched line prints in whole ml, because a
 * batch is measured in a jug and the sum can only be held to C in one unit,
 * with the typed amount beside it when the line was typed in another unit.
 */
import { amountWithUnit, qtyText } from './units';

export interface BatchLine {
  id: string;
  name: string;
  qtyEntered: number;
  unitCode: string;
  qtyBase: number;
  baseUnit: string;
}

export const BOTTLES = [700, 750, 1000, 1750] as const;
export const WATER_PRESETS = [
  { pct: 0, label: 'Shaken to order 0%' },
  { pct: 20, label: 'Stirred 20%' },
  { pct: 25, label: 'Shaken 25%' },
] as const;
export const WATER_MAX = 40;
export const BOTTLE_MAX = 20_000;
export const WATER_SAID = `Water is a percent from 0 to ${WATER_MAX}.`;
export const BOTTLE_SAID = `A bottle is a whole number of ml from 1 to ${BOTTLE_MAX.toLocaleString('en-US')}.`;

/** Float slack: qty_base is whole tenths and p one decimal, so a true value is never this close below an integer. */
const EPS = 1e-9;

/** "45" or "12,5" to a percent from 0 to 40, else null. */
export function readWater(text: string): number | null {
  const s = text.trim();
  if (!/^\d{1,2}(?:[.,]\d)?$/.test(s)) return null;
  const n = Number(s.replace(',', '.'));
  return n >= 0 && n <= WATER_MAX ? n : null;
}

/** A bottle typed in whole ml, else null. */
export function readBottle(text: string): number | null {
  const s = text.trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= BOTTLE_MAX ? n : null;
}

/** "70 cl", "1 l", "1.75 l", "900 ml". */
export function bottleWords(ml: number): string {
  if (ml % 1000 === 0) return `${ml / 1000} l`;
  if (ml > 1000 && ml % 10 === 0) return `${ml / 1000} l`;
  if (ml % 10 === 0) return `${ml / 10} cl`;
  return `${ml} ml`;
}

export interface BatchPart {
  id: string;
  name: string;
  /** Whole ml in the bottle, floored. */
  ml: number;
  /** The typed amount for the batch when the line was not typed in ml ("18 dashes"), else null. */
  typed: string | null;
}

export interface BatchPlan {
  bottleMl: number;
  waterPct: number;
  /** One pour, in ml, unrounded. */
  pourMl: number;
  serves: number;
  parts: BatchPart[];
  waterMl: number;
  spareMl: number;
  /** Lines not in the bottle, with their amount for one serve. */
  atService: { id: string; name: string; amount: string }[];
}

export type BatchAnswer =
  | { kind: 'plan'; plan: BatchPlan }
  | { kind: 'nothing' }
  | { kind: 'too-big'; pourMl: number };

/**
 * The batch, or why there is none: nothing batched by volume, or one pour is
 * more than the bottle holds. `leftOut` holds the ids added at service.
 */
export function planBatch(
  lines: BatchLine[],
  yieldServes: number,
  leftOut: ReadonlySet<string>,
  waterPct: number,
  bottleMl: number,
): BatchAnswer {
  const per = Math.max(1, yieldServes);
  const kept = lines.filter((l) => l.baseUnit === 'ml10' && !leftOut.has(l.id) && Number.isFinite(l.qtyBase) && l.qtyBase > 0);
  const keptIds = new Set(kept.map((l) => l.id));
  const atService = lines
    .filter((l) => !keptIds.has(l.id))
    .map((l) => ({ id: l.id, name: l.name, amount: amountWithUnit(l.qtyEntered / per, l.unitCode as never) }));
  const v = kept.reduce((s, l) => s + l.qtyBase / 10 / per, 0);
  if (v <= 0) return { kind: 'nothing' };
  const w = (v * waterPct) / 100;
  const pour = v + w;
  let serves = Math.floor(bottleMl / pour + EPS);
  while (serves > 0 && serves * pour > bottleMl + EPS) serves -= 1;
  if (serves < 1) return { kind: 'too-big', pourMl: pour };
  const parts = kept.map((l) => ({
    id: l.id,
    name: l.name,
    ml: Math.floor(((l.qtyBase / 10) * serves) / per + EPS),
    typed: l.unitCode === 'ml' ? null : amountWithUnit((l.qtyEntered * serves) / per, l.unitCode as never),
  }));
  const waterMl = Math.floor(w * serves + EPS);
  const used = parts.reduce((s, p) => s + p.ml, 0) + waterMl;
  return {
    kind: 'plan',
    plan: { bottleMl, waterPct, pourMl: pour, serves, parts, waterMl, spareMl: bottleMl - used, atService },
  };
}

/** "1 l bottle: 9 serves, pour 108 ml." */
export function batchHead(p: BatchPlan): string {
  return `${bottleWords(p.bottleMl)} bottle: ${p.serves} ${p.serves === 1 ? 'serve' : 'serves'}, pour ${qtyText(Math.round(p.pourMl))} ml.`;
}

/** "Gin 270 ml, Bitters 8 ml (18 dashes), Water 162 ml. 28 ml spare." */
export function batchParts(p: BatchPlan): string {
  const parts = p.parts.map((x) => `${x.name} ${x.ml} ml${x.typed ? ` (${x.typed})` : ''}`);
  if (p.waterMl > 0) parts.push(`Water ${p.waterMl} ml`);
  return `${parts.join(', ')}.${p.spareMl > 0 ? ` ${p.spareMl} ml spare.` : ''}`;
}

/** "Add at service: Soda 60 ml, Orange twist 1 each." for one serve; null when nothing is. */
export function batchAtService(p: BatchPlan): string | null {
  if (!p.atService.length) return null;
  return `Add at service, each serve: ${p.atService.map((x) => `${x.name} ${x.amount}`).join(', ')}.`;
}
