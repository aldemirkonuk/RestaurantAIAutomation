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

type Client = { from: (table: string) => any };

export type DoorReceived =
  | { ok: true; value: Map<number, number> }
  | { ok: false; error: string };

export async function receivedAtTheDoor(
  client: Client,
  restaurantId: string,
  documentId: string,
): Promise<DoorReceived> {
  const fail = (what: string, e: { message: string }): DoorReceived => ({
    ok: false,
    error: `${what} could not be read (${e.message})`,
  });
  const mine = await client.from("document_deliveries").select("delivery_id").eq("document_id", documentId);
  if (mine.error) return fail("the deliveries this paper is on", mine.error);
  const deliveryIds = [...new Set(((mine.data ?? []) as { delivery_id: string }[]).map((r) => r.delivery_id))];
  if (!deliveryIds.length) return { ok: true, value: new Map() };

  const doors = await client
    .from("document_deliveries")
    .select("document_id")
    .in("delivery_id", deliveryIds)
    .eq("role", "door_count");
  if (doors.error) return fail("the door counts on its deliveries", doors.error);
  const doorIds = [...new Set(((doors.data ?? []) as { document_id: string }[]).map((r) => r.document_id))];
  if (!doorIds.length) return { ok: true, value: new Map() };

  const docs = await client
    .from("procurement_documents")
    .select("id, extracted, created_at")
    .eq("restaurant_id", restaurantId)
    .in("id", doorIds);
  if (docs.error) return fail("the door counts", docs.error);
  type Doc = { id: string; extracted: { countedFor?: string | null; countedAt?: string | null } | null; created_at: string | null };
  const forThis = ((docs.data ?? []) as Doc[])
    .filter((d) => d.extracted?.countedFor === documentId)
    .sort((a, b) => String(a.extracted?.countedAt ?? a.created_at).localeCompare(String(b.extracted?.countedAt ?? b.created_at)));
  if (!forThis.length) return { ok: true, value: new Map() };

  const lines = await client
    .from("procurement_document_lines")
    .select("document_id, line_no, qty_bottles")
    .eq("restaurant_id", restaurantId)
    .in("document_id", forThis.map((d) => d.id));
  if (lines.error) return fail("the counted lines", lines.error);
  const rows = (lines.data ?? []) as { document_id: string; line_no: number | null; qty_bottles: number | string | null }[];

  const received = new Map<number, number>();
  for (const d of forThis)
    for (const r of rows) {
      const n = Number(r.qty_bottles);
      if (r.document_id === d.id && r.line_no != null && r.qty_bottles != null && Number.isFinite(n))
        received.set(r.line_no, n);
    }
  return { ok: true, value: received };
}
