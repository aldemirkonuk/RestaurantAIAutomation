/**
 * Which tables a waiter may push together (ADR 0345 E1: the checker's
 * `lib/adjacency.ts` at `5958689`, ported). Positions are meant as plan
 * units 0..100 (ADR 0347 D6, `:114`); this file does not check that range
 * (the narrowing is owed, `0347:184`). A table with no place (the tray, D5)
 * is next to nothing, and so is one whose place is not a finite number. The
 * checker's distances, section rule and orientation are kept as they were;
 * new here are null places and `formsAdjacentGroup`. The checker's
 * `nextMergeOrientation`, `adjacentPairs` and `adjacencyFusePairs` are not
 * ported: nothing in the port calls them yet.
 *
 * In the checker, managers merge any unmerged same-section pair without
 * this check (`merge-actions.ts:183`); a waiter's pair must be neighbours.
 */

/** Max centre gap along the shared axis (plan units). */
export const ADJ_ALONG = 16;
/** Alignment tolerance on the perpendicular axis (plan units). */
export const ADJ_ACROSS = 9;

export interface AdjTable {
  id?: string;
  posX: number | null;
  posY: number | null;
  sectionId: string | null;
}

export type MergeOrientation = "horizontal" | "vertical" | "diagonal";

const placed = (t: AdjTable): t is AdjTable & { posX: number; posY: number } =>
  typeof t.posX === "number" &&
  Number.isFinite(t.posX) &&
  typeof t.posY === "number" &&
  Number.isFinite(t.posY);

/**
 * Two tables are neighbours when they share a section and their centres are
 * within ADJ_ALONG on both axes (cardinal or diagonal, 8-neighbour). The same
 * table, the same spot, a table without a section and a table in the tray are
 * never neighbours.
 */
export function areAdjacent(a: AdjTable, b: AdjTable): boolean {
  if (a.id && b.id && a.id === b.id) return false;
  if (!a.sectionId || !b.sectionId || a.sectionId !== b.sectionId) return false;
  if (!placed(a) || !placed(b)) return false;
  const dx = Math.abs(a.posX - b.posX);
  const dy = Math.abs(a.posY - b.posY);
  if (dx === 0 && dy === 0) return false;
  return dx <= ADJ_ALONG && dy <= ADJ_ALONG;
}

/**
 * Whether the tables form one connected group through neighbours (any
 * connected shape, not only a line). Fewer than two tables is not a group;
 * neither is a list in which a table has no id or an empty one, or names one
 * id twice.
 *
 * It sets no upper size. The checker merges exactly two tables (its
 * `mergeTables(tableAId, tableBId)`, `app/merge-actions.ts:187-194`), and
 * ADR 0347 `:236` speaks of a floor merge as two tables; how many a waiter
 * may merge is the caller's rule, not this function's.
 */
export function formsAdjacentGroup(tables: AdjTable[]): boolean {
  if (tables.length < 2) return false;
  const ids = tables.map((t) => t.id);
  if (ids.some((id) => !id)) return false;
  if (new Set(ids).size !== ids.length) return false;
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.shift() as number;
    tables.forEach((t, j) => {
      if (!seen.has(j) && areAdjacent(tables[i], t)) {
        seen.add(j);
        queue.push(j);
      }
    });
  }
  return seen.size === tables.length;
}

/**
 * How two members lie: both axes past ADJ_ACROSS → diagonal, else the larger
 * axis. Null when either has no place: an orientation is never guessed.
 */
export function inferMergeOrientation(a: AdjTable, b: AdjTable): MergeOrientation | null {
  if (!placed(a) || !placed(b)) return null;
  const dx = Math.abs(a.posX - b.posX);
  const dy = Math.abs(a.posY - b.posY);
  if (dx === 0 && dy === 0) return "horizontal";
  if (dx > ADJ_ACROSS && dy > ADJ_ACROSS) return "diagonal";
  return dx >= dy ? "horizontal" : "vertical";
}
