import {
  AXIS_KEYS, bandWord, CONFIDENCE_BY_PROV, DEFAULT_SD, PROV_KIND, TasteSource,
} from './taste-axes';

/** One current layer: the latest version for a (subject, source, stated_by). */
export interface FusionLayer {
  source: TasteSource;
  statedBy?: string | null;
  axes: Record<string, { v: number; sd?: number; conf?: number }>;
  descriptors?: string[];
  texture?: string[];
}

export interface FusedAxis {
  v: number; lo: number; hi: number; sd: number; conf: number;
  prov: Array<{ kind: string; share: number }>;
}
export interface TasteConflict { axis: string; gap: number; sources: string[] }
export interface EffectiveTaste {
  axes: Record<string, FusedAxis>;
  descriptors: string[];
  texture: string[];
  summary: string | null;
  confidence: number;
  conflicts: TasteConflict[];
}

export const SD_FLOOR = 0.3;
export const CONFLICT_GAP = 2.5;
export const SUMMARY_MIN_CONF = 0.4;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp10 = (x: number) => Math.min(10, Math.max(0, x));

/**
 * Pool the layers by precision (inverse variance). Two weak lines never look
 * like a measurement: sd is floored at 0.3, and where layers disagree by more
 * than 2.5 the axis is flagged, sd becomes the WIDEST layer's (never narrowed),
 * and it is withheld from the summary. No layers => null, never zeros.
 */
export function fuse(layers: FusionLayer[]): EffectiveTaste | null {
  if (layers.length === 0) return null;
  const axes: Record<string, FusedAxis> = {};
  const conflicts: TasteConflict[] = [];

  for (const key of AXIS_KEYS) {
    const obs = layers
      .filter((l) => l.axes[key] !== undefined)
      .map((l) => ({
        v: l.axes[key].v,
        sd: Math.max(SD_FLOOR, l.axes[key].sd ?? DEFAULT_SD[l.source]),
        source: l.source,
      }));
    if (obs.length === 0) continue;

    let wSum = 0; let vSum = 0;
    for (const o of obs) { const w = 1 / (o.sd * o.sd); wSum += w; vSum += w * o.v; }
    const mu = vSum / wSum;
    const vs = obs.map((o) => o.v);
    const gap = Math.max(...vs) - Math.min(...vs);
    const conflicted = gap > CONFLICT_GAP;
    const sd = conflicted ? Math.max(...obs.map((o) => o.sd)) : Math.max(SD_FLOOR, Math.pow(wSum, -0.5));
    const prior = Math.max(...obs.map((o) => CONFIDENCE_BY_PROV[o.source]));
    const conf = Math.min(prior, 1 - Math.min(sd, 3) / 3);

    const share = new Map<string, number>();
    for (const o of obs) {
      const k = PROV_KIND[o.source];
      share.set(k, (share.get(k) ?? 0) + 1 / (o.sd * o.sd) / wSum);
    }
    axes[key] = {
      v: r3(mu), lo: r3(clamp10(mu - 1.28 * sd)), hi: r3(clamp10(mu + 1.28 * sd)),
      sd: r3(sd), conf: r2(conf),
      prov: [...share].map(([kind, s]) => ({ kind, share: r3(s) })),
    };
    if (conflicted) {
      conflicts.push({ axis: key, gap: r2(gap), sources: [...new Set(obs.map((o) => o.source))] });
    }
  }

  const uniq = (xs: string[][]) => [...new Set(xs.flat())];
  const confs = Object.values(axes).map((a) => a.conf);
  const effective: EffectiveTaste = {
    axes,
    descriptors: uniq(layers.map((l) => l.descriptors ?? [])),
    texture: uniq(layers.map((l) => l.texture ?? [])),
    summary: null,
    confidence: confs.length ? r2(confs.reduce((a, b) => a + b, 0) / confs.length) : 0,
    conflicts,
  };
  effective.summary = tasteSummary(effective);
  return effective;
}

/**
 * One plain line from the axes the house can stand behind: conf >= 0.4, not in
 * conflict, at least a hint. Strongest first, at most four. null when nothing
 * qualifies (the line is absent, never "not much").
 */
export function tasteSummary(e: Pick<EffectiveTaste, 'axes' | 'conflicts'>): string | null {
  const withheld = new Set(e.conflicts.map((c) => c.axis));
  const picks = Object.entries(e.axes)
    .filter(([k, a]) => !withheld.has(k) && a.conf >= SUMMARY_MIN_CONF && bandWord(a.v) !== 'none')
    .sort((a, b) => b[1].v - a[1].v)
    .slice(0, 4)
    .map(([k, a]) => `${bandWord(a.v)} ${k.replace(/_/g, ' ')}`);
  if (picks.length === 0) return null;
  const line = picks.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1) + '.';
}
