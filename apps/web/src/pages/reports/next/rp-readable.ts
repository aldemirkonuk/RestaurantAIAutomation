/**
 * The sheet a role is handed is one it can read (r36 reports audit, gap 3).
 *
 * The default sheet and the house layouts were the same for every role. Once
 * the staff trains land, five of the nine readable cuttings on staff's first
 * page say "written for owners and managers", and "Before service", the layout
 * named for the people on the floor, is three of five held back (the room and
 * the servers are held here already). The pickers offered held analyses with
 * no mark.
 *
 * The call (r36, under the 2026-11-07 /goal):
 * - The default sheet drops what the role cannot read and fills the gap with
 *   analyses it can, in catalogue order, so staff open on a full page.
 * - A house layout keeps only what the role can read. It is not filled: a
 *   layout is a job, and padding it with unrelated cuttings changes the job.
 * - Held analyses stay in the pickers, marked with who they are written for.
 *   Hiding them would leave staff unable to learn the analysis exists.
 * - An unknown role (`null`) gets the house sheet unchanged: the role is not
 *   guessed, and the registers already say they wait for it.
 */
import type { HouseRole } from './rp-spec';
import { CATALOGUE } from './rp-catalogue';
import { ANALYSIS_IDS, DEFAULT_ON, DEFAULT_SLOTS, packSlots, type AnalysisId, type Slot } from './rp-sheet';

export type ReadersOf = (id: AnalysisId) => readonly HouseRole[] | undefined;

const catalogueReaders: ReadersOf = (id) => CATALOGUE[id].readers;

const WORDS: Record<HouseRole, string> = { owner: 'owners', manager: 'managers', staff: 'staff' };

/** True when `role` is sent this analysis. An unknown role is treated as able. */
export function readableBy(id: AnalysisId, role: HouseRole | null, readersOf: ReadersOf = catalogueReaders): boolean {
  const readers = readersOf(id);
  return !readers || role === null || readers.includes(role);
}

/** " (owners and managers)" for an analysis held from `role`, else "". */
export function heldMark(id: AnalysisId, role: HouseRole | null, readersOf: ReadersOf = catalogueReaders): string {
  if (readableBy(id, role, readersOf)) return '';
  const words = (readersOf(id) ?? []).map((r) => WORDS[r]);
  const list = words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
  return ` (${list})`;
}

/** A layout's cuttings, without the ones `role` is not sent. */
export function layoutFor(ids: readonly AnalysisId[], role: HouseRole | null, readersOf: ReadersOf = catalogueReaders): AnalysisId[] {
  return ids.filter((id) => readableBy(id, role, readersOf));
}

/**
 * The default sheet's ids and slots for `role`. Unchanged (the hand-set slots)
 * when nothing is held; otherwise the held ones are replaced by readable
 * analyses off the default sheet, kept before the writing desk, and packed.
 */
export function defaultIdsFor(
  role: HouseRole | null,
  readersOf: ReadersOf = catalogueReaders,
): { ids: AnalysisId[]; slots: Record<string, Slot> } {
  const kept = layoutFor(DEFAULT_ON, role, readersOf);
  if (kept.length === DEFAULT_ON.length) return { ids: [...DEFAULT_ON], slots: DEFAULT_SLOTS };
  const fills = ANALYSIS_IDS.filter((id) => !DEFAULT_ON.includes(id) && readableBy(id, role, readersOf));
  const room = DEFAULT_ON.length - kept.length;
  const withoutDesk = kept.filter((id) => id !== 'writing');
  const ids = [...withoutDesk, ...fills.slice(0, room), ...(kept.includes('writing') ? (['writing'] as AnalysisId[]) : [])];
  return { ids, slots: packSlots(ids) };
}
