import {
  BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  CONFIDENCE_BY_PROV, DESCRIPTOR_KEYS, HOUSE_METHODS, HouseMethod, MAX_DESCRIPTORS,
  MAX_NOTE_CHARS, TEXTURE_KEYS, TasteSource, validateAxes,
} from './taste-axes';
import { EffectiveTaste, FusionLayer, fuse } from './taste-fusion';
import { GoodTaste, RollupBasis, RollupInput, RollupLine, rollup } from './taste-rollup';

export type SubjectKind = 'good' | 'cocktail' | 'dish';
export const SUBJECT_KINDS: readonly SubjectKind[] = ['good', 'cocktail', 'dish'];
export const isSubjectKind = (k: string): k is SubjectKind => (SUBJECT_KINDS as readonly string[]).includes(k);

const SUBJECT_COLUMN: Record<SubjectKind, 'good_id' | 'cocktail_id' | 'dish_id'> = {
  good: 'good_id', cocktail: 'cocktail_id', dish: 'dish_id',
};
/** Postgres 42P01 / PostgREST PGRST205: the table is not on this database. */
const MISSING_RELATION = new Set(['42P01', 'PGRST205']);
const UNIQUE_VIOLATION = '23505';

export interface TasteActor { userId: string; name?: string | null; email?: string | null }
export interface TasteLayerOut {
  source: string; version: number; method: string; statedByName: string | null;
  statedAt: string; hasNote: boolean; noteText: string | null;
  /** For a layer worked out from a recipe: how many lines it understood. null otherwise. */
  basis: RollupBasis | null;
}
export interface TasteRead {
  subject: { kind: SubjectKind; id: string };
  effective: EffectiveTaste | null;
  layers: TasteLayerOut[];
}
export interface ParsedHouseBody {
  axes: Record<string, { v: number; sd?: number; conf: number }>;
  descriptors: string[]; texture: string[]; note: string | null; method: HouseMethod;
}

const refuse = (m: string) => new BadRequestException(m);

/** Check a house layer's body; every refusal is one sentence. Pure. */
export function parseHouseBody(body: unknown): ParsedHouseBody {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.method !== 'string' || !(HOUSE_METHODS as readonly string[]).includes(b.method)) {
    throw refuse('Say how this was described: a line, a tick-list or a level.');
  }
  let axes: ParsedHouseBody['axes'] = {};
  if (b.axes !== undefined) {
    const v = validateAxes(b.axes);
    if (!v.ok) throw refuse(v.message);
    axes = Object.fromEntries(
      Object.entries(v.axes).map(([k, a]) => [k, { ...a, conf: CONFIDENCE_BY_PROV.house }]),
    );
  }
  const list = (raw: unknown, allowed: readonly string[], what: string): string[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) throw refuse(`${what} must be a list.`);
    const out = [...new Set(raw)];
    if (out.length > MAX_DESCRIPTORS) throw refuse(`Pick at most ${MAX_DESCRIPTORS} ${what}.`);
    for (const x of out) {
      if (typeof x !== 'string' || !allowed.includes(x)) throw refuse(`"${String(x)}" is not one of the ${what} on offer.`);
    }
    return out as string[];
  };
  const descriptors = list(b.descriptors, DESCRIPTOR_KEYS, 'flavour words');
  const texture = list(b.texture, TEXTURE_KEYS, 'texture words');
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== 'string') throw refuse('The note must be text.');
    if (b.note.length > MAX_NOTE_CHARS) throw refuse(`A note can be at most ${MAX_NOTE_CHARS} characters.`);
    if (b.note.trim() !== '') note = b.note; // stored verbatim, not trimmed
  }
  if (Object.keys(axes).length === 0 && !descriptors.length && !texture.length && note === null) {
    throw refuse('Say something about the taste: a level, a word or a note.');
  }
  return { axes, descriptors, texture, note, method: b.method as HouseMethod };
}

export const MAX_COMPONENTS = 12;
export const MAX_LINES = 60;
export const MAX_QTY = 1e6;

/** Check a preview body (a recipe typed on a sheet, not yet saved). Every refusal is one sentence. Pure. */
export function parsePreview(body: unknown): RollupInput {
  const b = (body ?? {}) as Record<string, any>;
  if (b.kind !== 'cocktail' && b.kind !== 'dish') throw refuse('Say whether this is a cocktail or a dish.');
  if (b.method !== undefined && b.method !== null && (typeof b.method !== 'string' || b.method.length > 200)) {
    throw refuse('The method must be text of at most 200 characters.');
  }
  if (!Array.isArray(b.components) || b.components.length < 1 || b.components.length > MAX_COMPONENTS) {
    throw refuse(`Give between 1 and ${MAX_COMPONENTS} parts.`);
  }
  let n = 0;
  const components = b.components.map((c: any) => {
    if (!c || typeof c.name !== 'string' || !Array.isArray(c.lines)) throw refuse('Each part needs a name and its lines.');
    const lines: RollupLine[] = c.lines.map((l: any) => {
      if (!l || typeof l.name !== 'string' || l.name.trim() === '' || l.name.length > 200) throw refuse('Each line needs a name.');
      if (l.unit !== 'g' && l.unit !== 'ml') throw refuse('A line is measured in g or ml.');
      const qty = l.qty === null || l.qty === undefined ? null : l.qty;
      if (qty !== null && (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY)) {
        throw refuse(`An amount must be a number above 0 and at most ${MAX_QTY}.`);
      }
      if (l.prep !== undefined && (typeof l.prep !== 'string' || l.prep.length > 100)) throw refuse('How it is cooked must be a few words.');
      n += 1;
      return { name: l.name, qty, unit: l.unit, prep: l.prep }; // chemistry is never taken from a body
    });
    return { name: String(c.name).slice(0, 100), lines };
  });
  if (n < 1 || n > MAX_LINES) throw refuse(`Give between 1 and ${MAX_LINES} lines.`);
  return { kind: b.kind, method: b.method ?? null, components };
}

@Injectable()
export class TasteService {
  private readonly logger = new Logger(TasteService.name);
  constructor(private readonly db: DatabaseService) {}

  /** The subject must be this house's own. A foreign or missing id is one 404 with a code. */
  private async assertSubject(restaurantId: string, kind: SubjectKind, id: string): Promise<void> {
    const gone = () => new NotFoundException({
      code: 'subject_not_in_house', message: 'That item is not in this house.',
    });
    const client = this.db.getClient();
    const table = kind === 'good' ? 'restaurant_inventory' : kind === 'cocktail' ? 'cocktails' : 'dishes';
    let q = client.from(table).select(kind === 'good' ? 'id, kind' : 'id').eq('id', id).eq('restaurant_id', restaurantId);
    if (kind !== 'good') q = q.is('deleted_at', null);
    const { data, error } = await q.maybeSingle();
    if (error) {
      // No dishes table yet means no dish is in this house; any other failure is a failure.
      if (kind === 'dish' && MISSING_RELATION.has(String(error.code))) throw gone();
      this.logger.error(`Could not check the ${kind}: ${error.message}`);
      throw new InternalServerErrorException('The item could not be checked just now.');
    }
    if (!data) throw gone();
    if (kind === 'good' && (data as { kind?: string }).kind === 'supply') {
      throw refuse('A supply is not tasted.');
    }
  }

  async read(restaurantId: string, kind: SubjectKind, id: string): Promise<TasteRead> {
    await this.assertSubject(restaurantId, kind, id);
    const { data, error } = await this.db.getClient()
      .from('taste_profile_current').select('*')
      .eq('restaurant_id', restaurantId).eq('subject_kind', kind).eq(SUBJECT_COLUMN[kind], id)
      .order('created_at', { ascending: true });
    if (error) {
      this.logger.error(`Could not read taste: ${error.message}`);
      throw new InternalServerErrorException('Taste could not be read just now.');
    }
    const rows = (data ?? []) as Array<Record<string, any>>;
    const layers: FusionLayer[] = rows.map((r) => ({
      source: r.source as TasteSource, statedBy: r.stated_by, axes: r.axes ?? {},
      descriptors: r.descriptors ?? [], texture: r.texture ?? [],
    }));
    return {
      subject: { kind, id },
      effective: fuse(layers),
      layers: rows.map((r) => ({
        source: r.source, version: r.version, method: r.method,
        statedByName: r.stated_by_name ?? null, statedAt: r.created_at,
        hasNote: typeof r.note_text === 'string' && r.note_text !== '',
        noteText: r.note_text ?? null,
        basis: r.source === 'recipe' ? (r.ext?.rollup ?? null) : null,
      })),
    };
  }

  /** Append the caller's own house layer. Author and name come from the session only. */
  async appendHouse(
    restaurantId: string, kind: SubjectKind, id: string, body: unknown, actor: TasteActor,
  ): Promise<TasteRead> {
    await this.assertSubject(restaurantId, kind, id);
    const p = parseHouseBody(body);
    const name = (actor.name ?? actor.email ?? '').trim() || null;
    const client = this.db.getClient();
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data: last, error: lastErr } = await client.from('taste_profiles')
        .select('version').eq('restaurant_id', restaurantId).eq('subject_kind', kind)
        .eq(SUBJECT_COLUMN[kind], id).eq('source', 'house').eq('stated_by', actor.userId)
        .order('version', { ascending: false }).limit(1).maybeSingle();
      if (lastErr) {
        this.logger.error(`Could not find the next version: ${lastErr.message}`);
        throw new InternalServerErrorException('The description could not be saved just now.');
      }
      const { error } = await client.from('taste_profiles').insert({
        restaurant_id: restaurantId, subject_kind: kind, [SUBJECT_COLUMN[kind]]: id,
        source: 'house', version: ((last as { version?: number } | null)?.version ?? 0) + 1,
        method: p.method, axes: p.axes, descriptors: p.descriptors, texture: p.texture,
        note_text: p.note, stated_by: actor.userId, stated_by_name: name,
      });
      if (!error) return this.read(restaurantId, kind, id);
      // Two writers at once took the same version: look again once.
      if (String(error.code) === UNIQUE_VIOLATION && attempt === 0) continue;
      this.logger.error(`Could not save taste: ${error.message}`);
      throw new InternalServerErrorException('The description could not be saved just now.');
    }
    throw new InternalServerErrorException('The description could not be saved just now.');
  }

  /** What a recipe would taste like, from the lines typed. Reads nothing, writes nothing. */
  preview(body: unknown) {
    const input = parsePreview(body);
    return rollup(input);
  }

  /**
   * Read a cocktail's or dish's current recipe and append a `recipe` layer: how it
   * should taste, worked out from the lines. The same recipe twice adds nothing.
   * A recipe that cannot be read is said, never answered with an empty profile.
   */
  async rollupSubject(restaurantId: string, kind: SubjectKind, id: string): Promise<TasteRead & { rollup: RollupBasis }> {
    if (kind === 'good') throw refuse('A taste is worked out from a recipe, so only a cocktail or a dish has one.');
    await this.assertSubject(restaurantId, kind, id);
    const client = this.db.getClient();
    const unavailable = (m: string) => new ServiceUnavailableException({ code: 'recipes_unavailable', message: m });
    const ownerCol = kind === 'cocktail' ? 'cocktail_id' : 'dish_id';
    const readFail = (e: { code?: string; message: string }) => {
      if (MISSING_RELATION.has(String(e.code))) {
        return unavailable('This house cannot read recipes yet, so a taste cannot be worked out from one.');
      }
      this.logger.error(`Could not read the recipe: ${e.message}`);
      return new InternalServerErrorException('The recipe could not be read just now.');
    };
    const cur = await client.from(kind === 'cocktail' ? 'recipe_current' : 'recipe_current_dish')
      .select('version_id').eq(ownerCol, id).eq('restaurant_id', restaurantId).maybeSingle();
    if (cur.error) throw readFail(cur.error);
    const versionId = (cur.data as { version_id?: string } | null)?.version_id;
    if (!versionId) {
      throw new NotFoundException({ code: 'recipe_not_written', message: 'This has no recipe yet, so there is nothing to work a taste from.' });
    }
    const ver = await client.from('recipe_versions').select('method').eq('id', versionId).eq('restaurant_id', restaurantId).maybeSingle();
    if (ver.error) throw readFail(ver.error);
    const rows = await client.from('recipe_lines').select('label, qty_base, base_unit, inventory_id')
      .eq('version_id', versionId).eq('restaurant_id', restaurantId).order('position', { ascending: true });
    if (rows.error) throw readFail(rows.error);
    const raw = (rows.data ?? []) as Array<{ label: string; qty_base: number; base_unit: string; inventory_id?: string | null }>;
    // A line that names a good is worked from that good's own taste first; the label's class prior is the fallback.
    const own = await this.goodTastes(restaurantId, raw.map((r) => r.inventory_id ?? null));
    const pieceG = await this.pieceGrams(restaurantId, raw.filter((r) => r.base_unit === 'each_milli').map((r) => r.inventory_id ?? null), readFail);
    const lines: RollupLine[] = raw.map((r) => {
      const o = r.inventory_id ? own.get(r.inventory_id) : undefined;
      const base = o ? { own: o } : {};
      // ml10 = tenths of a ml, mg = milligrams; a count ("1 each") has no known weight.
      if (r.base_unit === 'ml10') return { name: r.label, qty: Number(r.qty_base) / 10, unit: 'ml' as const, ...base };
      if (r.base_unit === 'mg') return { name: r.label, qty: Number(r.qty_base) / 1000, unit: 'g' as const, ...base };
      // A count weighs what the house stated for that very good (as the cost does), and nothing else: no table of what an egg weighs.
      const g = r.inventory_id ? pieceG.get(r.inventory_id) : undefined;
      if (r.base_unit === 'each_milli' && g) return { name: r.label, qty: (Number(r.qty_base) / 1000) * g, unit: 'g' as const, ...base };
      return { name: r.label, qty: null, unit: 'g' as const, ...base };
    });
    if (lines.length === 0) {
      throw refuse('This recipe has no lines, so there is nothing to work a taste from.');
    }
    // The recipe tables carry no parts for a dish yet, so a dish is one part: every line eaten together.
    const input: RollupInput = {
      kind, method: (ver.data as { method?: string | null } | null)?.method ?? null,
      components: [{ name: kind === 'cocktail' ? 'drink' : 'dish', lines }],
    };
    const result = rollup(input);
    if (Object.keys(result.axes).length === 0) throw refuse('Nothing in this recipe could be worked out yet.');

    const { data: last, error: lastErr } = await client.from('taste_profiles')
      .select('version, ext').eq('restaurant_id', restaurantId).eq('subject_kind', kind)
      .eq(SUBJECT_COLUMN[kind], id).eq('source', 'recipe').is('stated_by', null)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    if (lastErr) {
      this.logger.error(`Could not find the next version: ${lastErr.message}`);
      throw new InternalServerErrorException('The taste could not be saved just now.');
    }
    const prev = last as { version?: number; ext?: { rollup?: { inputHash?: string } } } | null;
    if (prev?.ext?.rollup?.inputHash === result.basis.inputHash) {
      return { ...(await this.read(restaurantId, kind, id)), rollup: result.basis };
    }
    const axes = Object.fromEntries(
      Object.entries(result.axes).map(([k, a]) => [k, { v: a.v, sd: a.sd, conf: a.conf }]),
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const version = (attempt === 0 ? prev?.version ?? 0 : await this.latestRecipeVersion(restaurantId, kind, id)) + 1;
      const { error } = await client.from('taste_profiles').insert({
        restaurant_id: restaurantId, subject_kind: kind, [SUBJECT_COLUMN[kind]]: id,
        source: 'recipe', version, method: 'computed', axes,
        ext: { rollup: result.basis }, stated_by: null, stated_by_name: 'Worked out from the recipe',
      });
      if (!error) return { ...(await this.read(restaurantId, kind, id)), rollup: result.basis };
      if (String(error.code) === UNIQUE_VIOLATION && attempt === 0) continue;
      this.logger.error(`Could not save taste: ${error.message}`);
      break;
    }
    throw new InternalServerErrorException('The taste could not be saved just now.');
  }

  /**
   * The current fused taste of each good a recipe draws, by id. Layers from
   * measured, dataset, standard, staff line and staff note count; an AI draft
   * never does. A good with no layer is simply absent. A failed read is said,
   * never read as "no goods have a taste".
   */
  /** The grams one piece of each good weighs, where the house stated it. A failed read is a refusal, never "no weight". */
  private async pieceGrams(restaurantId: string, ids: Array<string | null>, readFail: (e: { code?: string; message: string }) => Error): Promise<Map<string, number>> {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const out = new Map<string, number>();
    if (want.length === 0) return out;
    const { data, error } = await this.db.getClient().from('restaurant_inventory').select('id, piece_grams')
      .eq('restaurant_id', restaurantId).in('id', want);
    if (error) throw readFail(error);
    for (const r of (data ?? []) as Array<{ id: string; piece_grams: number | string | null }>) {
      const g = Number(r.piece_grams);
      if (r.piece_grams !== null && r.piece_grams !== '' && Number.isFinite(g) && g > 0) out.set(r.id, g);
    }
    return out;
  }

  private async goodTastes(restaurantId: string, ids: Array<string | null>): Promise<Map<string, GoodTaste>> {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    const out = new Map<string, GoodTaste>();
    if (want.length === 0) return out;
    const { data, error } = await this.db.getClient().from('taste_profile_current').select('*')
      .eq('restaurant_id', restaurantId).eq('subject_kind', 'good').in('good_id', want);
    if (error) {
      this.logger.error(`Could not read the goods' tastes: ${error.message}`);
      throw new InternalServerErrorException('The tastes of the goods in this recipe could not be read just now.');
    }
    const byGood = new Map<string, Array<Record<string, any>>>();
    for (const r of (data ?? []) as Array<Record<string, any>>) {
      if (r.source === 'ai_draft' || r.source === 'recipe') continue;
      byGood.set(r.good_id, [...(byGood.get(r.good_id) ?? []), r]);
    }
    for (const [id, rs] of byGood) {
      const fused = fuse(rs.map((r) => ({ source: r.source as TasteSource, statedBy: r.stated_by, axes: r.axes ?? {} })));
      if (!fused || Object.keys(fused.axes).length === 0) continue;
      const has = (...src: string[]) => rs.some((r) => src.includes(r.source));
      out.set(id, {
        prov: has('measured') ? 'measured' : has('dataset', 'standard') ? 'dataset' : 'staff',
        axes: Object.fromEntries(Object.entries(fused.axes).map(([k, a]) => [k, { v: a.v }])),
      });
    }
    return out;
  }

  private async latestRecipeVersion(restaurantId: string, kind: SubjectKind, id: string): Promise<number> {
    const { data } = await this.db.getClient().from('taste_profiles').select('version')
      .eq('restaurant_id', restaurantId).eq('subject_kind', kind).eq(SUBJECT_COLUMN[kind], id)
      .eq('source', 'recipe').is('stated_by', null).order('version', { ascending: false }).limit(1).maybeSingle();
    return (data as { version?: number } | null)?.version ?? 0;
  }
}
