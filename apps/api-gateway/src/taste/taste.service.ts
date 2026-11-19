import {
  BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  CONFIDENCE_BY_PROV, DESCRIPTOR_KEYS, HOUSE_METHODS, HouseMethod, MAX_DESCRIPTORS,
  MAX_NOTE_CHARS, TEXTURE_KEYS, TasteSource, validateAxes,
} from './taste-axes';
import { EffectiveTaste, FusionLayer, fuse } from './taste-fusion';

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
}
