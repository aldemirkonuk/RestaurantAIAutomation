/**
 * What the door counted of ONE paper, per line (r24, door-count lane).
 *
 * The r23 walk counted an invoice at its door and, after a reload, the invoice
 * still said "Nobody has counted this yet" and "Not compared — no order or door
 * count to compare against": nothing read the count back onto the paper.
 *
 * Only a count made FOR this paper is read (`extracted.countedFor`, written by
 * `POST /procurement/documents/door-count` with `forDocumentId`). Its lines keep
 * the paper's own line numbers, so line N of the count is line N of the paper —
 * an explicit link, never a match by description. A count on the same delivery
 * made for something else is not this paper's. Per line, the LATEST count that
 * has the line wins (a re-count is a new document, ADR 0104 D5); a line no
 * count has stays "not counted" (ADR 0103 A6).
 *
 * A failed read is `ok: false`, never an empty answer: "could not read the
 * count" must not render as "nobody counted".
 */

import { normalizeUom, Uom } from "../documents/document-types";
import { knownPack, PACKED_DOOR_UNITS } from "../documents/door-count-lines";

type Client = { from: (table: string) => any };

export type DoorReceived =
  | { ok: true; value: Map<number, number> }
  | { ok: false; error: string };

/** What the door counted of one paper: bottles per line, and the pack it gave per line. */
export interface DoorCount {
  received: Map<number, number>;
  /** Bottles in one case, as the door stated it, per paper line (r31 w2 F1). */
  packs: Map<number, number>;
}

export type DoorCounts =
  | { ok: true; value: Map<string, DoorCount> }
  | { ok: false; error: string };

export async function receivedAtTheDoor(
  client: Client,
  restaurantId: string,
  documentId: string,
): Promise<DoorReceived> {
  const all = await doorCountsOfPapers(client, restaurantId, [documentId]);
  if (!all.ok) return all;
  return { ok: true, value: all.value.get(documentId)?.received ?? new Map() };
}

/**
 * The door's counts of several papers at once, keyed by paper id. The same
 * rules as `receivedAtTheDoor`: only a count made FOR the paper, latest count
 * per line wins, a failed read is said. The pack a count gives a line is kept
 * too: a pack stated later wins, and a count that states none leaves an
 * earlier one standing (a case does not stop holding twelve).
 */
export async function doorCountsOfPapers(
  client: Client,
  restaurantId: string,
  paperIds: readonly string[],
): Promise<DoorCounts> {
  const fail = (what: string, e: { message: string }): DoorCounts => ({
    ok: false,
    error: `${what} could not be read (${e.message})`,
  });
  const out = new Map<string, DoorCount>();
  const papers = new Set(paperIds);
  if (!papers.size) return { ok: true, value: out };
  const mine = await client.from("document_deliveries").select("delivery_id").in("document_id", [...papers]);
  if (mine.error) return fail("the deliveries this paper is on", mine.error);
  const deliveryIds = [...new Set(((mine.data ?? []) as { delivery_id: string }[]).map((r) => r.delivery_id))];
  if (!deliveryIds.length) return { ok: true, value: out };

  const doors = await client
    .from("document_deliveries")
    .select("document_id")
    .in("delivery_id", deliveryIds)
    .eq("role", "door_count");
  if (doors.error) return fail("the door counts on its deliveries", doors.error);
  const doorIds = [...new Set(((doors.data ?? []) as { document_id: string }[]).map((r) => r.document_id))];
  if (!doorIds.length) return { ok: true, value: out };

  const docs = await client
    .from("procurement_documents")
    .select("id, extracted, created_at")
    .eq("restaurant_id", restaurantId)
    .in("id", doorIds);
  if (docs.error) return fail("the door counts", docs.error);
  type Doc = { id: string; extracted: { countedFor?: string | null; countedAt?: string | null } | null; created_at: string | null };
  const forThese = ((docs.data ?? []) as Doc[])
    .filter((d) => d.extracted?.countedFor != null && papers.has(d.extracted.countedFor))
    .sort((a, b) => String(a.extracted?.countedAt ?? a.created_at).localeCompare(String(b.extracted?.countedAt ?? b.created_at)));
  if (!forThese.length) return { ok: true, value: out };

  const lines = await client
    .from("procurement_document_lines")
    .select("document_id, line_no, qty_bottles, pack_size")
    .eq("restaurant_id", restaurantId)
    .in("document_id", forThese.map((d) => d.id));
  if (lines.error) return fail("the counted lines", lines.error);
  const rows = (lines.data ?? []) as {
    document_id: string;
    line_no: number | null;
    qty_bottles: number | string | null;
    pack_size?: number | string | null;
  }[];

  for (const d of forThese) {
    const paper = d.extracted?.countedFor as string;
    const count = out.get(paper) ?? { received: new Map<number, number>(), packs: new Map<number, number>() };
    out.set(paper, count);
    for (const r of rows) {
      if (r.document_id !== d.id || r.line_no == null) continue;
      const n = Number(r.qty_bottles);
      if (r.qty_bottles != null && Number.isFinite(n)) count.received.set(r.line_no, n);
      const pack = knownPack(r.pack_size);
      if (pack != null) count.packs.set(r.line_no, pack);
    }
  }
  return { ok: true, value: out };
}

/** A paper line as the readers see it: its unit, pack and counts. */
export interface PackableLine {
  uom?: string | null;
  pack_size?: number | string | null;
  qty?: number | string | null;
  qty_bottles?: number | string | null;
}

/**
 * A PACK STATED AT THE DOOR REACHES THE PAPER'S BILLED SIDE (r31 walk w2, F1).
 *
 * A paper that bills "2 cases" and never says how many bottles a case holds
 * stores pack 1 (the column's default, read as "unstated"). The door, holding
 * the case, says 12, and books 24 bottles. Read as stored, the paper billed 2
 * bottles: the delivery read OVER SHIP "24 against 2", the house was told it
 * differed, AGREED was refused, and the cost stayed provisional because a case
 * price has no bottles to divide by.
 *
 * Read here instead with the door's pack: billed 2 × 12 = 24 bottles, and
 * 1800 a case is 150 a bottle. The money holds whatever the pack: 24 bottles
 * at 150 and, were the door wrong, 12 at 300 are both the paper's 3600, and
 * the shelf already holds what the door said.
 *
 * Only when the paper itself says nothing: a pack the paper states is never
 * overridden from the door, and an unpacked unit is returned as it is. The
 * stored paper row is never written: a door count is not the vendor's paper.
 */
export function withTheDoorsPack<T extends PackableLine>(
  row: T,
  doorPack: number | null | undefined,
): T & { pack_from_door?: number } {
  const unit = normalizeUom(row.uom ?? "") as Uom | null;
  if (!unit || !PACKED_DOOR_UNITS.has(unit)) return row;
  if (knownPack(row.pack_size) != null) return row;
  const pack = knownPack(doorPack);
  if (pack == null) return row;
  const q = row.qty != null && row.qty !== "" ? Number(row.qty) : Number(row.qty_bottles);
  if (!Number.isFinite(q)) return row;
  return { ...row, pack_size: pack, qty_bottles: q * pack, pack_from_door: pack };
}
