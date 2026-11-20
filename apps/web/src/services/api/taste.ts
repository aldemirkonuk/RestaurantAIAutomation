/**
 * The taste profile of one good (GET and POST /taste/:restaurantId/:kind/:id).
 *
 * Typed client for the gateway's taste route. It never throws: every outcome is
 * a state the card can say in words.
 *   ready   the route answered with a body this file could read
 *   absent  the route is not there (this house has no taste notes switched on)
 *   failed  anything else: nothing is shown as known (ADR 0020)
 *
 * The absent/failed line is drawn here, once:
 * - 404 is absent, because Nest answers an unregistered route with a 404 that
 *   carries a JSON message ("Cannot GET /taste/..."). Only a 404 whose body
 *   says `code: 'subject_not_in_house'` is a real answer, and it is failed.
 * - 405 and 501 are absent. 5xx, every other 4xx, a thrown network error and a
 *   200 that cannot be read are failed.
 * Parsing is defensive: an axis key this client does not know, a value outside
 * 0..10 or a missing confidence is dropped, never shown.
 */
import { apiClient, getActiveRestaurantId, getErrorStatus } from './client';
import { isUnreachable, UNREACHABLE_WORDS } from '../../lib/unreachable';

/** Copy of the gateway's AXIS_KEYS (lane B). Do not reorder or extend alone. */
export const AXIS_KEYS = [
  'sweet', 'sour', 'salty', 'bitter', 'umami',
  'fat', 'heat', 'alcohol', 'astringency', 'body', 'carbonation', 'aroma_intensity',
  'fruit', 'citrus', 'floral', 'herbal', 'spice', 'nutty', 'roasted', 'smoky', 'savoury', 'earthy', 'dairy', 'woody', 'funky',
] as const;
export type AxisKey = (typeof AXIS_KEYS)[number];

export const PROV_KINDS = ['measured', 'recipe', 'dataset', 'class_default', 'staff_note', 'staff_line', 'standard', 'ai_draft'] as const;
export type ProvKind = (typeof PROV_KINDS)[number];

/** Below this confidence an axis is said as a word only: no bar, no whisker, no summary. */
export const BAND_ONLY_BELOW = 0.4;

export type SubjectKind = 'good' | 'cocktail' | 'dish';

export interface TasteAxis {
  v: number;
  lo: number | null;
  hi: number | null;
  conf: number;
  prov: Array<{ kind: ProvKind; share: number }>;
  bandOnly: boolean;
}

export interface TasteConflict {
  axis: AxisKey;
  gap: number;
}

export interface TasteEffective {
  axes: Partial<Record<AxisKey, TasteAxis>>;
  descriptors: string[];
  texture: string[];
  conflicts: TasteConflict[];
}

/** Where a roll-up line's taste came from: the good's own, a typical one of its kind, or nothing known. */
export type LineFrom = 'good' | 'class_prior' | 'unknown';
const LINE_FROM: ReadonlySet<string> = new Set<LineFrom>(['good', 'class_prior', 'unknown']);

/** What a worked-out (recipe) layer rests on. Absent on every other layer. */
export interface TasteBasis {
  /** Axes the roll-up could not tell: said as "not known", never as "none". */
  notKnown: AxisKey[];
  lineSources: Array<{ name: string; from: LineFrom }>;
  /** Lines whose taste is not known at all (they add nothing). */
  unknownNames: string[];
  /** The tastes a cook would name first, strongest first (at most three, each at least medium). Null when the layer predates it (a stale layer). */
  lead: string[] | null;
}

export interface TasteLayer {
  source: string;
  version: number | null;
  method: string | null;
  statedByName: string | null;
  statedAt: string | null;
  hasNote: boolean;
  noteText: string | null;
  basis?: TasteBasis | null;
}

export interface TasteData {
  effective: TasteEffective | null;
  layers: TasteLayer[];
}

export type TasteRead = { state: 'ready'; data: TasteData } | { state: 'absent' } | { state: 'failed'; reason: string };

/** What a save sends: only the axes the person set; a typed 0 is a real 0. */
export interface HouseTasteBody {
  axes?: Partial<Record<AxisKey, { v: number }>>;
  descriptors?: string[];
  texture?: string[];
  note?: string;
  method: 'line' | 'cata' | 'ordinal';
}

export type TasteSave =
  | { state: 'ready'; data: TasteData }
  | { state: 'absent' }
  | { state: 'failed'; reason: string | null; status: number | null };

export const tasteKeys = {
  subject: (restaurantId: string, kind: SubjectKind, id: string) => ['taste', restaurantId, kind, id] as const,
};

const AXIS_SET: ReadonlySet<string> = new Set(AXIS_KEYS);
const PROV_SET: ReadonlySet<string> = new Set(PROV_KINDS);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const inScale = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 10;
const strOrNull = (x: unknown) => (typeof x === 'string' && x.trim() !== '' ? x : null);

function parseAxis(raw: unknown): TasteAxis | null {
  if (!isObj(raw) || !inScale(raw.v)) return null;
  const conf = raw.conf;
  if (typeof conf !== 'number' || !Number.isFinite(conf) || conf < 0 || conf > 1) return null;
  const prov = (Array.isArray(raw.prov) ? raw.prov : [])
    .filter((p): p is Record<string, unknown> => isObj(p) && typeof p.kind === 'string' && PROV_SET.has(p.kind))
    .map((p) => ({ kind: p.kind as ProvKind, share: typeof p.share === 'number' && Number.isFinite(p.share) ? p.share : 0 }))
    .sort((a, b) => b.share - a.share);
  // A value with no stated source cannot say where it came from: not shown.
  if (prov.length === 0) return null;
  const lo = inScale(raw.lo) ? raw.lo : null;
  const hi = inScale(raw.hi) ? raw.hi : null;
  const range = lo !== null && hi !== null && lo <= hi;
  return { v: raw.v, lo: range ? lo : null, hi: range ? hi : null, conf, prov, bandOnly: conf < BAND_ONLY_BELOW };
}

function parseEffective(raw: unknown): TasteEffective | null {
  if (!isObj(raw)) return null;
  const axes: TasteEffective['axes'] = {};
  if (isObj(raw.axes)) {
    for (const [k, val] of Object.entries(raw.axes)) {
      if (!AXIS_SET.has(k)) continue;
      const a = parseAxis(val);
      if (a) axes[k as AxisKey] = a;
    }
  }
  const words = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  const conflicts: TasteConflict[] = (Array.isArray(raw.conflicts) ? raw.conflicts : [])
    .filter((c): c is Record<string, unknown> => isObj(c) && typeof c.axis === 'string' && AXIS_SET.has(c.axis))
    .map((c) => ({ axis: c.axis as AxisKey, gap: typeof c.gap === 'number' ? c.gap : 0 }));
  return { axes, descriptors: words(raw.descriptors), texture: words(raw.texture), conflicts };
}

function parseBasis(raw: unknown): TasteBasis | null {
  if (!isObj(raw)) return null;
  const notKnown = (Array.isArray(raw.notKnown) ? raw.notKnown : []).filter((k): k is AxisKey => typeof k === 'string' && AXIS_SET.has(k));
  const lineSources = (Array.isArray(raw.lineSources) ? raw.lineSources : [])
    .filter((l): l is Record<string, unknown> => isObj(l) && typeof l.name === 'string' && l.name.trim() !== '' && typeof l.from === 'string' && LINE_FROM.has(l.from))
    .map((l) => ({ name: l.name as string, from: l.from as LineFrom }));
  const unknownNames = (Array.isArray(raw.unknownNames) ? raw.unknownNames : []).filter((n): n is string => typeof n === 'string' && n.trim() !== '');
  const lead = Array.isArray(raw.lead) ? raw.lead.filter((k): k is string => typeof k === 'string') : null;
  return { notKnown, lineSources, unknownNames, lead };
}

/** A body this file can read, or null. `layers` must be a list; `effective` may be null. */
export function parseTasteBody(body: unknown): TasteData | null {
  if (!isObj(body) || !Array.isArray(body.layers) || !('effective' in body)) return null;
  const effective = body.effective === null ? null : parseEffective(body.effective);
  if (body.effective !== null && effective === null) return null;
  const layers: TasteLayer[] = body.layers.filter(isObj).map((l) => ({
    source: typeof l.source === 'string' ? l.source : '',
    version: typeof l.version === 'number' ? l.version : null,
    method: strOrNull(l.method),
    statedByName: strOrNull(l.statedByName),
    statedAt: strOrNull(l.statedAt),
    hasNote: l.hasNote === true,
    noteText: strOrNull(l.noteText),
    basis: parseBasis(l.basis),
  }));
  return { effective, layers };
}

type Outcome = { kind: 'absent' } | { kind: 'failed'; status: number | null; sentence: string | null };

/** The one place a failed request becomes absent or failed (K8). */
function classify(e: unknown): Outcome {
  const status = getErrorStatus(e);
  const data = (e as { response?: { data?: unknown } } | null)?.response?.data;
  const body = isObj(data) ? data : {};
  if (status === 404) {
    return body.code === 'subject_not_in_house' ? { kind: 'failed', status, sentence: null } : { kind: 'absent' };
  }
  if (status === 405 || status === 501) return { kind: 'absent' };
  const raw = Array.isArray(body.message) ? body.message[0] : body.message;
  return { kind: 'failed', status, sentence: typeof raw === 'string' && raw.trim() !== '' ? raw : null };
}

const path = (restaurantId: string | undefined, kind: SubjectKind, id: string) => {
  const r = restaurantId || getActiveRestaurantId();
  return r ? `/taste/${r}/${kind}/${encodeURIComponent(id)}` : null;
};

const NOT_READ = 'Taste could not be read just now.';

export async function getTaste(kind: SubjectKind, id: string, restaurantId?: string): Promise<TasteRead> {
  const p = path(restaurantId, kind, id);
  if (p === null) return { state: 'failed', reason: NOT_READ };
  try {
    const res = await apiClient.get<unknown>(p);
    const data = parseTasteBody(res?.data);
    return data ? { state: 'ready', data } : { state: 'failed', reason: NOT_READ };
  } catch (e) {
    // No answer at all is said as such; every other failure is the card's own sentence.
    if (isUnreachable(e)) return { state: 'failed', reason: UNREACHABLE_WORDS };
    const o = classify(e);
    return o.kind === 'absent' ? { state: 'absent' } : { state: 'failed', reason: NOT_READ };
  }
}

export async function addHouseTaste(kind: SubjectKind, id: string, body: HouseTasteBody, restaurantId?: string): Promise<TasteSave> {
  const p = path(restaurantId, kind, id);
  if (p === null) return { state: 'failed', reason: null, status: null };
  try {
    const res = await apiClient.post<unknown>(`${p}/house`, body);
    const data = parseTasteBody(res?.data);
    // The write was accepted but the answer cannot be read: it may have landed.
    return data ? { state: 'ready', data } : { state: 'failed', reason: null, status: res?.status ?? null };
  } catch (e) {
    const o = classify(e);
    if (o.kind === 'absent') return { state: 'absent' };
    return { state: 'failed', reason: o.status !== null && o.status >= 400 && o.status < 500 ? o.sentence : null, status: o.status };
  }
}

/* ── work a cocktail's or dish's taste out of its saved recipe ─────────────
 * POST /taste/:restaurantId/:kind/:id/rollup. Every outcome is a sentence:
 * the sheet shows it and the taste stays as it was. A 404 here is NOT "route
 * not switched on" the way it is for a read: the gateway answers 404 with
 * code `recipe_not_written` when the drink has no saved recipe, and that is a
 * real answer. Only a 404 with no code (Nest's own "Cannot POST") is absent. */

export const ROLLUP_UNREACHABLE = 'Mudavym could not be reached just now. The taste is as it was.';
export const ROLLUP_RECIPES_UNAVAILABLE = 'This house cannot read recipes yet, so a taste cannot be worked out from one. The taste is as it was.';
export const ROLLUP_FAILED = 'The taste could not be worked out just now. It is as it was.';
export const ROLLUP_UNREADABLE = 'The taste may have been worked out, but the answer could not be read. Read again to see.';
export const ROLLUP_ABSENT = 'Taste notes are not switched on for this house yet.';

export type TasteRollup =
  | { state: 'ready'; data: TasteData }
  | { state: 'absent' }
  | { state: 'failed'; sentence: string };

export async function rollupTaste(kind: 'cocktail' | 'dish', id: string, restaurantId?: string): Promise<TasteRollup> {
  const p = path(restaurantId, kind, id);
  if (p === null) return { state: 'failed', sentence: ROLLUP_FAILED };
  try {
    const res = await apiClient.post<unknown>(`${p}/rollup`, {});
    const data = parseTasteBody(res?.data);
    return data ? { state: 'ready', data } : { state: 'failed', sentence: ROLLUP_UNREADABLE };
  } catch (e) {
    const sent = e as { code?: unknown; response?: unknown } | null;
    // No answer at all (axios names it "Network Error"): the transport's word is never shown.
    if (sent?.code === 'ERR_NETWORK' && !sent.response) return { state: 'failed', sentence: ROLLUP_UNREACHABLE };
    const status = getErrorStatus(e);
    const data = (e as { response?: { data?: unknown } } | null)?.response?.data;
    const body = isObj(data) ? data : {};
    if (status === 503 && body.code === 'recipes_unavailable') return { state: 'failed', sentence: ROLLUP_RECIPES_UNAVAILABLE };
    if ((status === 404 && body.code === undefined) || status === 405 || status === 501) return { state: 'absent' };
    const raw = Array.isArray(body.message) ? body.message[0] : body.message;
    // The gateway's own sentence for a refusal it chose (no recipe yet, no lines, nothing to work out).
    if (status !== null && status >= 400 && status < 500 && typeof raw === 'string' && raw.trim() !== '') return { state: 'failed', sentence: raw };
    return { state: 'failed', sentence: ROLLUP_FAILED };
  }
}
