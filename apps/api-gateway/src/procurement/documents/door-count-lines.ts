import { normalizeUom, toBottles, Uom } from "./document-types";

/**
 * WHAT A DOOR COUNT MAY PUT ON THE SHELF (r28 invoices audit, G1 and G13).
 *
 * A door count becomes bottles on the shelf: `toBottles(qty, uom, pack)`, then
 * `shelfQuantity` books that many. Two inputs used to make the wrong number
 * with nothing said:
 *
 *   1. A CASE WITH NO PACK. `recordDoorCount` took a missing pack as 1, so two
 *      cases of twelve went on the shelf as 2 bottles. The cost side already
 *      refuses an unknown pack, so the lot stayed unpriced, but the stock was
 *      wrong, and the next till sales failed with "stock would go negative".
 *      A pack of 1 on a packed unit is how this codebase already writes "the
 *      document never stated it" (`parsed-document.ts`, PACKED_UNITS; the
 *      column `procurement_document_lines.pack_size` is NOT NULL DEFAULT 1),
 *      so 1 is read as unknown here too, never as "a case of one".
 *   2. A PART OF A BOTTLE. A count of 1.5 bottles was rounded on the shelf,
 *      while weights and volumes already refuse a non-whole count.
 *
 * Both refuse the whole count, before anything is written, in a sentence that
 * says what to do. A line counted at 0 is never refused: no case of any size
 * puts anything on the shelf.
 */

/** Units whose bottles depend on how many one holds. */
export const PACKED_DOOR_UNITS: ReadonlySet<Uom> = new Set<Uom>(["case", "pack", "split_case"]);

/** Units counted in whole bottles or pieces. Kegs, volumes and weights are not. */
const WHOLE_DOOR_UNITS: ReadonlySet<Uom> = new Set<Uom>(["bottle", "each", "case", "pack", "split_case"]);

/** A pack that says how many bottles one holds: a whole number above 1. */
export function knownPack(pack: unknown): number | null {
  const n = Number(pack);
  return pack != null && pack !== "" && Number.isInteger(n) && n >= 2 ? n : null;
}

export const UNIT_WORDS: Partial<Record<Uom, string>> = {
  case: "cases",
  pack: "packs",
  split_case: "split cases",
};

export interface DoorLineInput {
  lineNo: number;
  description?: string | null;
  qty: number;
  uom: string;
  packSize?: number | null;
}

const named = (l: DoorLineInput) =>
  l.description ? `Line ${l.lineNo} ("${l.description}")` : `Line ${l.lineNo}`;

/** The first reason this count cannot go on the shelf as counted, or null. */
export function doorLineRefusal(lines: readonly DoorLineInput[]): string | null {
  for (const l of lines) {
    if (!(Number(l.qty) > 0)) continue;
    const uom = (normalizeUom(l.uom) ?? "bottle") as Uom;
    const pack = knownPack(l.packSize);
    if (PACKED_DOOR_UNITS.has(uom) && pack == null)
      return (
        `${named(l)} is counted in ${UNIT_WORDS[uom]}, and nothing says how many bottles one holds, ` +
        `so it cannot go on the shelf as bottles. Say how many bottles are in one, or count the line in bottles. Nothing was recorded.`
      );
    if (WHOLE_DOOR_UNITS.has(uom)) {
      const bottles = toBottles(l.qty, uom, pack ?? 1);
      if (!Number.isInteger(bottles)) {
        const counted = PACKED_DOOR_UNITS.has(uom)
          ? `${l.qty} ${UNIT_WORDS[uom]} of ${pack}, which is ${bottles} bottles`
          : `${l.qty} ${uom === "each" ? "pieces" : "bottles"}`;
        return (
          `${named(l)} counts ${counted}, and the shelf keeps whole ones. ` +
          `Count whole bottles or pieces. Nothing was recorded.`
        );
      }
    }
  }
  return null;
}
