/**
 * The taste vocabulary, owned once, here. The database checks only the SHAPE of
 * an axes object (a key is lower-case words, v in 0..10, conf in 0..1, sd > 0)
 * because a key list inside SQL would need a migration for every tweak; THIS
 * list is the closed vocabulary. The web copies it verbatim.
 *
 * Unknown is an absent key, never 0. A typed 0 ("none") is a real answer.
 * ABV, proof, IBU, SRM, pH and Brix are facts (kept in `ext.facts`), never
 * sensory scores, so none of them is an axis.
 */

/** Twelve intensity axes. `heat` is chili/pepper/pungency; `alcohol` is ethanol warmth. */
export const NUMERIC_AXIS_KEYS = [
  'sweet', 'sour', 'salty', 'bitter', 'umami', 'fat', 'heat', 'alcohol',
  'astringency', 'body', 'carbonation', 'aroma_intensity',
] as const;

/** Thirteen aroma families, each a strength. */
export const AROMA_FAMILY_KEYS = [
  'fruit', 'citrus', 'floral', 'herbal', 'spice', 'nutty', 'roasted', 'smoky',
  'savoury', 'earthy', 'dairy', 'woody', 'funky',
] as const;

export const AXIS_KEYS = [...NUMERIC_AXIS_KEYS, ...AROMA_FAMILY_KEYS] as const;
export type AxisKey = (typeof AXIS_KEYS)[number];
const AXIS_SET: ReadonlySet<string> = new Set(AXIS_KEYS);
export const isAxisKey = (k: string): k is AxisKey => AXIS_SET.has(k);

/** Controlled chips staff may tick. The web offers exactly these. */
export const DESCRIPTOR_KEYS = [
  'savoury', 'rich', 'fresh', 'bright', 'balanced', 'sharp', 'mellow',
  'sweet-and-sour', 'spicy', 'smoky', 'herby', 'tangy',
] as const;
export const TEXTURE_KEYS = [
  'crisp', 'creamy', 'chewy', 'flaky', 'juicy', 'silky', 'crunchy', 'tender',
  'grainy', 'sticky',
] as const;
export const MAX_DESCRIPTORS = 12;
export const MAX_NOTE_CHARS = 2000;

export const SOURCES = [
  'house', 'recipe', 'measured', 'standard', 'dataset', 'note', 'ai_draft',
] as const;
export type TasteSource = (typeof SOURCES)[number];
export const HOUSE_METHODS = ['line', 'cata', 'ordinal'] as const;
export type HouseMethod = (typeof HOUSE_METHODS)[number];

/** The five-step words staff pick, as numbers. Starting values, not fitted. */
export const ORDINAL_MAP = {
  none: 0, hint: 1.5, light: 3, medium: 5, pronounced: 7, dominant: 9,
} as const;

/**
 * Standard deviation assumed for a layer that did not state one. Starting
 * values (priors), to be refitted against a blind staff panel; stored layers
 * keep only what was stated, so refitting needs no data migration.
 * `house` is a staff line (1.2).
 */
export const DEFAULT_SD: Record<TasteSource, number> = {
  measured: 0.3, standard: 1.5, dataset: 1.8, recipe: 1.2, house: 1.2, note: 1.0, ai_draft: 2.5,
};

/** How much a source is believed before the numbers are looked at. Priors. */
export const CONFIDENCE_BY_PROV: Record<TasteSource, number> = {
  measured: 1.0, standard: 0.7, dataset: 0.7, recipe: 0.7, house: 0.6, note: 0.6, ai_draft: 0.35,
};

/** The provenance word a source shows as on the wire. */
export const PROV_KIND: Record<TasteSource, string> = {
  measured: 'measured', standard: 'standard', dataset: 'dataset', recipe: 'recipe',
  house: 'staff_line', note: 'staff_note', ai_draft: 'ai_draft',
};

export interface StatedAxis { v: number; sd?: number }
export type ValidatedAxes =
  | { ok: true; axes: Record<string, StatedAxis> }
  | { ok: false; message: string };

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Shape check for a stated axes object `{ axis: { v, sd? } }`. Returns the
 * cleaned axes (only `v` and `sd`) or one sentence saying what is wrong.
 * An absent key stays absent; a typed 0 is kept.
 */
export function validateAxes(input: unknown): ValidatedAxes {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'Axes must be an object of axis names.' };
  }
  const out: Record<string, StatedAxis> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!isAxisKey(key)) return { ok: false, message: `"${key}" is not a taste axis.` };
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, message: `${key} needs a value between 0 and 10.` };
    }
    const { v, sd } = raw as { v?: unknown; sd?: unknown };
    if (!isNum(v) || v < 0 || v > 10) {
      return { ok: false, message: `${key} must be a number between 0 and 10.` };
    }
    const axis: StatedAxis = { v };
    if (sd !== undefined) {
      if (!isNum(sd) || sd <= 0 || sd > 10) {
        return { ok: false, message: `${key} spread must be a number above 0 and at most 10.` };
      }
      axis.sd = sd;
    }
    out[key] = axis;
  }
  return { ok: true, axes: out };
}

/** The word for a 0..10 value. Edges 0.5 / 2 / 4 / 6 / 8. */
export function bandWord(v: number): 'none' | 'hint' | 'light' | 'medium' | 'pronounced' | 'dominant' {
  if (v < 0.5) return 'none';
  if (v < 2) return 'hint';
  if (v < 4) return 'light';
  if (v < 6) return 'medium';
  if (v < 8) return 'pronounced';
  return 'dominant';
}
