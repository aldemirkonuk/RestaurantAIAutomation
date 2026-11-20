import { createHash } from 'crypto';
import {
  ABV_FLOOR, ABV_SPAN, AromaFamilyKey, BITE_EXPONENT, Chem, CLASS_PRIORS, DILUTION_BY_METHOD,
  DILUTION_DEFAULT, DILUTION_SD, DILUTION_SD_ASSUMED, DRAWS, K, METHODS, Method, PRIORS_VERSION,
  NONE_BY_CLASS, Q_BY_PROV, RollupProv, ROAST_K, SOLID_SALT_RELEASE, SUPPRESS, YAMAGUCHI,
} from './taste-priors';

/**
 * Work out how a recipe tastes from its lines (R3-DERIVE.md steps 1-8, minus
 * fusion, which taste-fusion.ts does when the layer is read). PURE: no I/O, no
 * clock, no Math.random. The interval is 200 draws from a generator seeded by
 * the input, so the same recipe always shows the same interval.
 *
 * Unknown stays unknown: a line whose chemistry is not known adds nothing to
 * the pool and lowers the confidence of every axis; a quantity that is not a
 * number ("salt to taste", "1 each") is left out and lowers it too.
 */
export interface RollupLine {
  name: string; qty: number | null; unit: 'g' | 'ml';
  /** Free words about how it is cooked ("seared", "charred"). */
  prep?: string;
  /** Chemistry the house stated or measured; beats the class prior. */
  chem?: Chem; chemProv?: 'measured' | 'dataset';
  /**
   * The good this line draws, as the house currently tastes it (its fused
   * layers: measured, dataset, staff). Each axis it states beats the class prior
   * read from the label; an axis it does not state falls back to that prior.
   */
  own?: GoodTaste;
}
/** A good's current taste, 0-10 as the good is tasted on its own. `prov` is its strongest layer. */
export interface GoodTaste { prov: 'measured' | 'dataset' | 'staff'; axes: Record<string, { v: number }> }
/** Where a line's profile came from, for the card: the good itself, a class prior, or nowhere. */
export type LineFrom = 'good' | 'class_prior' | 'unknown';
export interface RollupComponent { name: string; lines: RollupLine[] }
export interface RollupInput { kind: 'cocktail' | 'dish'; method?: string | null; components: RollupComponent[] }

export interface RollupAxis { v: number; lo: number; hi: number; sd: number; conf: number }
export interface RollupBasis {
  kind: 'cocktail' | 'dish'; lines: number; classPrior: number; dataset: number; measured: number;
  unknown: number; unquantified: number; unknownNames: string[];
  /** How many lines drew their profile from the good's own layers (staff included). */
  staff: number;
  /** One row per line: which profile it used. The good's own, or the class prior from its label. */
  lineSources: Array<{ name: string; from: LineFrom; prov: RollupProv }>;
  /** Core axes the roll-up will not state, because a line's value on them is not known. */
  notKnown: string[];
  dilution: number | null; dilutionAssumed: boolean; method: string | null;
  mean: Record<string, number>; contrast: Record<string, number>;
  inputHash: string; priorsVersion: number;
}
export interface RollupResult { axes: Record<string, RollupAxis>; basis: RollupBasis }

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0131/g, 'i').toLowerCase().trim();
const sat = (x: number, k: number) => 10 * (1 - Math.exp(-Math.max(0, x) / k));
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp10 = (x: number) => Math.min(10, Math.max(0, x));
const SOLUTES = ['se', 'ce', 'nacl', 'glu', 'nuc', 'be', 'fat'] as const;
const CORE = ['sweet', 'sour', 'salty', 'bitter', 'umami', 'fat', 'alcohol'] as const;
const FIELD: Record<string, keyof Chem> = {
  sweet: 'se', sour: 'ce', salty: 'nacl', bitter: 'be', umami: 'glu', fat: 'fat', alcohol: 'abv',
};

interface Resolved {
  name: string; mass: number | null; chem: Chem; prov: RollupProv; q: number; rsd: number;
  /** Fields whose value is known for this line (a stated zero counts; absent does not). */
  known: ReadonlySet<keyof Chem>; from: LineFrom;
  aroma: Partial<Record<AromaFamilyKey, number>>; method?: Method; protein: boolean; solid: boolean;
}

const OWN_CAP = 9.5;
/** Undo the saturating curve: the pooled amount that tastes like `v` on its own. */
const unsat = (v: number, k: number) => -k * Math.log(1 - Math.min(OWN_CAP, Math.max(0, v)) / 10);
const OWN_CHEM: Record<string, (v: number) => [keyof Chem, number]> = {
  sweet: (v) => ['se', unsat(v, K.sweet)],
  sour: (v) => ['ce', unsat(v, K.sour) / 10],
  salty: (v) => ['nacl', unsat(v, K.salty)],
  bitter: (v) => ['be', unsat(v, K.bitter)],
  umami: (v) => ['glu', unsat(v, K.umami)],
  fat: (v) => ['fat', unsat(v, K.fat)],
  alcohol: (v) => ['abv', v <= 0 ? 0 : ABV_FLOOR + (Math.min(10, v) / 10) * ABV_SPAN],
};
const AROMA_KEYS: readonly string[] = ['fruit', 'citrus', 'floral', 'herbal', 'spice', 'nutty', 'roasted', 'smoky', 'savoury', 'earthy', 'dairy', 'woody', 'funky'];
/** What a class prior is sure of: the fields it gives and the ones it says are absent. */
const priorKnown = (c: { id: string; chem: Chem }): Set<keyof Chem> =>
  new Set<keyof Chem>([...(Object.keys(c.chem) as Array<keyof Chem>), ...(NONE_BY_CLASS[c.id] ?? [])]);

function resolve(l: RollupLine): Resolved {
  const mass = l.qty !== null && Number.isFinite(l.qty) && l.qty > 0 ? l.qty : null;
  const method = METHODS.find((m) => m.match.test(fold(`${l.name} ${l.prep ?? ''}`)));
  const base = { name: l.name, mass, method };
  if (l.chem) {
    const prov: RollupProv = l.chemProv ?? 'dataset';
    return { ...base, chem: { ...l.chem }, prov, q: Q_BY_PROV[prov], rsd: prov === 'measured' ? 0.03 : 0.12, aroma: {}, protein: false, solid: false, known: new Set(Object.keys(l.chem) as Array<keyof Chem>), from: 'good' };
  }
  const cls = CLASS_PRIORS.find((c) => c.match.test(fold(l.name)));
  const ownAxes = Object.entries(l.own?.axes ?? {}).filter(([k, a]) => (k in OWN_CHEM || AROMA_KEYS.includes(k)) && Number.isFinite(a.v));
  if (l.own && ownAxes.length > 0) {
    const chem: Chem = { ...(cls?.chem ?? {}) };
    const known = cls ? priorKnown(cls) : new Set<keyof Chem>();
    const aroma: Partial<Record<AromaFamilyKey, number>> = { ...(cls?.aroma ?? {}) };
    const ownFields = new Set<keyof Chem>();
    for (const [k, a] of ownAxes) {
      if (AROMA_KEYS.includes(k)) { aroma[k as AromaFamilyKey] = Math.min(1, Math.max(0, a.v / 10)); continue; }
      const [field, val] = OWN_CHEM[k](a.v);
      chem[field] = val; known.add(field); ownFields.add(field);
    }
    // Belief drops toward the prior's only while the prior still supplies a field the good did not state.
    const borrowed = !!cls && (Object.keys(cls.chem) as Array<keyof Chem>).some((f) => !ownFields.has(f));
    const qOwn = Q_BY_PROV[l.own.prov];
    return { ...base, chem, prov: l.own.prov, q: borrowed && cls ? (qOwn + cls.q) / 2 : qOwn, rsd: l.own.prov === 'measured' ? 0.03 : 0.12, aroma, protein: !!cls?.protein, solid: !!cls?.solid, known, from: 'good' };
  }
  if (!cls) return { ...base, chem: {}, prov: 'unknown', q: 0, rsd: 0, aroma: {}, protein: false, solid: false, known: new Set(), from: 'unknown' };
  return { ...base, chem: { ...cls.chem }, prov: 'class_prior', q: cls.q, rsd: cls.rsd, aroma: cls.aroma ?? {}, protein: !!cls.protein, solid: !!cls.solid, known: priorKnown(cls), from: 'class_prior' };
}

/** Cooking: solutes concentrate by 1 / yield; frying takes up fat. Alcohol is left alone. */
function cook(r: Resolved): Chem {
  const m = r.method;
  if (!m) return r.chem;
  const out: Chem = { ...r.chem };
  for (const k of SOLUTES) if (out[k] !== undefined) out[k] = out[k]! / m.y;
  if (m.fatUp) out.fat = (out.fat ?? 0) + m.fatUp;
  if (m.umamiX && out.glu !== undefined) out.glu *= m.umamiX;
  return out;
}

export function dilutionFor(kind: 'cocktail' | 'dish', method: string | null | undefined): { d: number; sd: number; assumed: boolean } {
  if (kind !== 'cocktail') return { d: 0, sd: 0, assumed: false };
  const hit = method ? DILUTION_BY_METHOD.find((x) => x.match.test(fold(method))) : undefined;
  return hit ? { d: hit.d, sd: DILUTION_SD, assumed: false } : { d: DILUTION_DEFAULT, sd: DILUTION_SD_ASSUMED, assumed: true };
}

interface CompOut { mass: number; vals: Record<string, number>; infl: Record<string, number[]> }

/** One pass over one component with the given per-line scale factors and water added. */
function component(rs: Resolved[], factor: number[], d: number): CompOut {
  const cooked = rs.map((r, i) => {
    const c = cook(r);
    const o: Chem = {};
    for (const k of Object.keys(c) as Array<keyof Chem>) o[k] = (c[k] ?? 0) * factor[i];
    return o;
  });
  const m = rs.map((r) => r.mass ?? 0);
  const total = m.reduce((a, b) => a + b, 0);
  const vol = total * (1 + d);
  const pool = (k: keyof Chem) => (vol > 0 ? m.reduce((a, mi, i) => a + mi * (cooked[i][k] ?? 0), 0) / vol : 0);
  const solid = total > 0 && rs.reduce((a, r, i) => a + (r.solid ? m[i] : 0), 0) / total > 0.5;
  const glu = pool('glu'); const nuc = pool('nuc');
  const euc = glu + YAMAGUCHI * glu * nuc;
  let sweet = sat(pool('se'), K.sweet); let sour = sat(pool('ce') * 10, K.sour);
  const salty = sat((solid ? SOLID_SALT_RELEASE : 1) * pool('nacl'), K.salty);
  let bitter = sat(pool('be'), K.bitter);
  const abv = pool('abv');
  const vals: Record<string, number> = {
    umami: sat(euc, K.umami), fat: sat(pool('fat'), K.fat),
    alcohol: 10 * Math.min(1, Math.max(0, (abv - ABV_FLOOR) / ABV_SPAN)),
  };
  const sw = sweet; const so = sour;
  sweet = sw * (1 - SUPPRESS.sweetBySour * so); sour = so * (1 - SUPPRESS.sourBySweet * sw);
  bitter = bitter * (1 - SUPPRESS.bitterBySweet * sw) * (1 - SUPPRESS.bitterBySalt * salty);
  // Browning and char: scored over the cooked lines' share of the component.
  let roast = 0; let smoke = 0; let char = 0;
  const known = total || 1;
  rs.forEach((r, i) => {
    if (!r.method || r.method.B <= 0) return;
    const share = m[i] / known;
    roast += share * r.method.B * (r.protein ? ROAST_K.protein : ROAST_K.other);
    if (r.method.smoky) { smoke += share * r.method.B * ROAST_K.smoke; char = Math.max(char, r.method.B); }
  });
  if (char > 0) bitter += 2 * char * char;
  Object.assign(vals, { sweet, sour, salty, bitter: clamp10(bitter), roasted: 10 * roast, smoky: 10 * smoke });
  // Aroma: sub-additive p-norm (p = 2) of strength x dose, per family.
  const fam: Record<string, number> = {};
  rs.forEach((r, i) => {
    const dose = 1 - Math.exp(-m[i] / K.aromaRef);
    for (const [f, s] of Object.entries(r.aroma)) fam[f] = (fam[f] ?? 0) + (s! * dose) ** 2;
  });
  for (const [f, s2] of Object.entries(fam)) vals[f] = 10 * Math.sqrt(s2);
  // Who drove each axis (for confidence): mass x field, or browning, or aroma dose.
  const infl: Record<string, number[]> = {};
  for (const [ax, fld] of Object.entries(FIELD)) infl[ax] = m.map((mi, i) => mi * (cooked[i][fld] ?? 0));
  infl.umami = m.map((mi, i) => mi * (cooked[i].glu ?? 0));
  infl.roasted = rs.map((r, i) => (r.method ? m[i] * r.method.B : 0));
  infl.smoky = rs.map((r, i) => (r.method?.smoky ? m[i] * r.method.B : 0));
  for (const f of Object.keys(fam)) infl[f] = rs.map((r, i) => (r.aroma[f as AromaFamilyKey] ?? 0) * (1 - Math.exp(-m[i] / K.aromaRef)));
  return { mass: total, vals, infl };
}

/** Bites of a dish: weights mass^0.7; mean is the average bite, peak the strongest. */
function combine(parts: CompOut[]): { peak: Record<string, number>; mean: Record<string, number> } {
  const w = parts.map((p) => Math.pow(Math.max(p.mass, 1e-9), BITE_EXPONENT));
  const W = w.reduce((a, b) => a + b, 0);
  const keys = new Set(parts.flatMap((p) => Object.keys(p.vals)));
  const peak: Record<string, number> = {}; const mean: Record<string, number> = {};
  for (const k of keys) {
    const xs = parts.map((p) => p.vals[k] ?? 0);
    mean[k] = xs.reduce((a, x, i) => a + w[i] * x, 0) / W;
    peak[k] = Math.pow(xs.reduce((a, x, i) => a + w[i] * x ** 3, 0) / W, 1 / 3);
  }
  return { peak, mean };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInput(input: RollupInput): string {
  return createHash('sha1').update(JSON.stringify({ v: PRIORS_VERSION, ...input })).digest('hex');
}

export function rollup(input: RollupInput): RollupResult {
  const comps = input.components.filter((c) => c.lines.length > 0).map((c) => c.lines.map(resolve));
  const flat = comps.flat();
  const dil = dilutionFor(input.kind, input.method);
  const inputHash = hashInput(input);
  const run = (factors: number[][], d: number) => {
    const parts = comps.map((rs, ci) => component(rs, factors[ci], d));
    return { parts, ...combine(parts) };
  };
  const ones = comps.map((rs) => rs.map(() => 1));
  const base = run(ones, dil.d);

  // Interval: 200 draws; each line's chemistry moves together by its own relative sd.
  const rnd = mulberry32(parseInt(inputHash.slice(0, 8), 16));
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rnd(), 1e-12))) * Math.cos(2 * Math.PI * rnd());
  const draws: Array<Record<string, number>> = [];
  for (let n = 0; n < DRAWS; n++) {
    const f = comps.map((rs) => rs.map((r) => Math.max(0, 1 + r.rsd * gauss())));
    draws.push(run(f, Math.max(0, dil.d + dil.sd * gauss())).peak);
  }
  const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];

  // Confidence: belief in the lines that drove each axis, times how much of the recipe was understood.
  const nullQty = flat.filter((r) => r.mass === null).length;
  const massOf = (r: Resolved) => r.mass ?? 0;
  const knownMass = flat.reduce((a, r) => a + massOf(r), 0) || 1;
  const unknownShare = flat.filter((r) => r.prov === 'unknown').reduce((a, r) => a + massOf(r), 0) / knownMass;
  const complete = (1 - nullQty / Math.max(1, flat.length)) * (1 - unknownShare);
  const meanQ = flat.reduce((a, r) => a + massOf(r) * r.q, 0) / knownMass;
  const axes: Record<string, RollupAxis> = {};
  const notKnown: string[] = [];
  for (const key of Object.keys(base.peak)) {
    const v = base.peak[key];
    const isCore = (CORE as readonly string[]).includes(key);
    if (!isCore && v < 0.05) continue;
    // "None" (under half a point) is only stated when every line's value on this axis is known.
    if (isCore && v < 0.5 && !flat.every((r) => r.mass !== null && r.known.has(FIELD[key]))) { notKnown.push(key); continue; }
    let num = 0; let den = 0;
    base.parts.forEach((p, ci) => {
      p.infl[key]?.forEach((x, i) => { num += x * comps[ci][i].q; den += x; });
    });
    const conf = (den > 0 ? num / den : meanQ) * complete;
    const xs = draws.map((x) => x[key] ?? 0).sort((a, b) => a - b);
    const lo = pct(xs, 0.05); const hi = pct(xs, 0.95);
    const sd = Math.min(3, Math.max(0.3, (hi - lo) / 3.29, 3 * (1 - conf)));
    axes[key] = { v: r1(clamp10(v)), lo: r1(clamp10(lo)), hi: r1(clamp10(hi)), sd: r2(sd), conf: r2(Math.max(0, Math.min(1, conf))) };
  }
  const count = (p: RollupProv) => flat.filter((r) => r.prov === p).length;
  const rd = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).filter(([, x]) => x >= 0.05).map(([k, x]) => [k, r1(x)]));
  return {
    axes,
    basis: {
      kind: input.kind, lines: flat.length, classPrior: count('class_prior'), dataset: count('dataset'),
      measured: count('measured'), unknown: count('unknown'), unquantified: nullQty,
      staff: count('staff'),
      lineSources: flat.map((r) => ({ name: r.name, from: r.from, prov: r.prov })),
      notKnown,
      unknownNames: flat.filter((r) => r.prov === 'unknown').map((r) => r.name).slice(0, 5),
      dilution: input.kind === 'cocktail' ? dil.d : null, dilutionAssumed: dil.assumed,
      method: input.method ?? null, mean: rd(base.mean),
      contrast: rd(Object.fromEntries(Object.keys(base.peak).map((x) => [x, base.peak[x] - base.mean[x]]))),
      inputHash, priorsVersion: PRIORS_VERSION,
    },
  };
}
