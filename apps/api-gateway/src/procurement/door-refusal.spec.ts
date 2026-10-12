import {
  doorRefusalFor,
  doorRefusalLabel,
  readDoorRefusals,
  WRONG_VENUE_WORDS,
} from "./door-refusal";

/**
 * F-669 (founder S198): every surface shows "Refused at door — <reason>" with
 * its credit standing, never "cancelled" — and an order refused while still
 * in transit says so too, since its status never moved.
 */

type Answer = { data: unknown; error: { message: string } | null };

function fakeDb(tables: Record<string, Answer>) {
  const seen: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  return {
    seen,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      seen.push({ table, filters });
      const chain: any = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          filters.push([k, v]);
          return chain;
        },
        in: (k: string, v: unknown) => {
          filters.push([k, v]);
          return chain;
        },
        then: (ok: (a: Answer) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(tables[table] ?? { data: [], error: null }).then(
            ok,
            ko,
          ),
      };
      return chain;
    },
  };
}

const HOUSE = "house-1";

describe("readDoorRefusals", () => {
  it("labels a FAILED order from the door's reason and its credit, never 'cancelled'", async () => {
    const db = fakeDb({
      procurement_receipt_events: {
        data: [
          {
            id: "e1",
            order_id: "o1",
            outcome: "refused",
            refusal_reason: "broken_case",
            counted_qty_bottles: 12,
            rejected_qty_bottles: 12,
            occurred_at: "2026-10-10T09:00:00Z",
          },
        ],
        error: null,
      },
      procurement_credits: {
        data: [
          {
            id: "c1",
            order_id: "o1",
            state: "requested",
            created_at: "2026-10-10T10:00:00Z",
          },
        ],
        error: null,
      },
    });
    const reading = await readDoorRefusals(db, HOUSE, [
      { id: "o1", status: "FAILED" },
    ]);
    const r = doorRefusalFor(reading, "o1");
    expect(r).toEqual({
      reason: "broken case",
      credit: "requested",
      label: "Refused at door — broken case · credit requested",
    });
    expect(r?.label).not.toMatch(/cancel|fail/i);
    // Every read is scoped to the caller's house.
    for (const q of db.seen)
      expect(q.filters).toContainEqual(["restaurant_id", HOUSE]);
  });

  it("says 'Refused' for an order still in transit whose truck was turned away whole", async () => {
    const db = fakeDb({
      procurement_receipt_events: {
        data: [
          {
            id: "e1",
            order_id: "o2",
            outcome: "refused",
            refusal_reason: "temperature",
            counted_qty_bottles: 6,
            rejected_qty_bottles: 6,
            occurred_at: "2026-10-10T09:00:00Z",
          },
        ],
        error: null,
      },
    });
    const reading = await readDoorRefusals(db, HOUSE, [
      { id: "o2", status: "IN_TRANSIT" },
    ]);
    expect(doorRefusalFor(reading, "o2")?.label).toBe(
      "Refused at door — wrong temperature · no credit asked",
    );
  });

  it("names a truck meant for another restaurant from its REJECTED delivery", async () => {
    const db = fakeDb({
      deliveries: {
        data: [{ id: "d1", order_id: "o3", state: "REJECTED" }],
        error: null,
      },
    });
    const reading = await readDoorRefusals(db, HOUSE, [
      { id: "o3", status: "CONFIRMED" },
    ]);
    expect(doorRefusalFor(reading, "o3")?.reason).toBe(WRONG_VENUE_WORDS);
  });

  it("leaves an open order that kept part of its truck, and a delivered one, unrefused", async () => {
    const db = fakeDb({
      procurement_receipt_events: {
        data: [
          {
            id: "e1",
            order_id: "o4",
            outcome: "refused",
            refusal_reason: "broken_case",
            counted_qty_bottles: 12,
            rejected_qty_bottles: 2,
            occurred_at: "2026-10-10T09:00:00Z",
          },
        ],
        error: null,
      },
    });
    const reading = await readDoorRefusals(db, HOUSE, [
      { id: "o4", status: "IN_TRANSIT" },
      { id: "o5", status: "DELIVERED" },
    ]);
    expect(doorRefusalFor(reading, "o4")).toBeNull();
    expect(doorRefusalFor(reading, "o5")).toBeNull();
  });

  it("says 'Refused' for a part-delivered order whose next truck was turned away whole (F-1479)", async () => {
    const db = fakeDb({
      procurement_receipt_events: {
        data: [
          {
            id: "e1",
            order_id: "o8",
            outcome: "accepted",
            refusal_reason: null,
            counted_qty_bottles: 12,
            rejected_qty_bottles: 0,
            occurred_at: "2026-10-08T09:00:00Z",
          },
          {
            id: "e2",
            order_id: "o8",
            outcome: "refused",
            refusal_reason: "wrong_wine",
            counted_qty_bottles: 12,
            rejected_qty_bottles: 12,
            occurred_at: "2026-10-10T09:00:00Z",
          },
          {
            id: "e3",
            order_id: "o9",
            outcome: "accepted",
            refusal_reason: null,
            counted_qty_bottles: 12,
            rejected_qty_bottles: 0,
            occurred_at: "2026-10-08T09:00:00Z",
          },
        ],
        error: null,
      },
    });
    const reading = await readDoorRefusals(db, HOUSE, [
      { id: "o8", status: "PARTIALLY_RECEIVED" },
      { id: "o9", status: "PARTIALLY_RECEIVED" },
    ]);
    expect(doorRefusalFor(reading, "o8")?.label).toBe(
      "Refused at door — wrong wine · no credit asked",
    );
    // The first truck, kept in part, is not a refusal.
    expect(doorRefusalFor(reading, "o9")).toBeNull();
  });

  it("never reads a failed door as 'not refused'", async () => {
    const db = fakeDb({
      procurement_receipt_events: { data: null, error: { message: "down" } },
      procurement_credits: { data: null, error: { message: "down" } },
    });
    const reading = await readDoorRefusals(db, HOUSE, [
      { id: "o6", status: "IN_TRANSIT" },
      { id: "o7", status: "FAILED" },
    ]);
    expect(doorRefusalFor(reading, "o6")).toBeUndefined();
    expect(doorRefusalFor(reading, "o7")).toEqual({
      reason: null,
      credit: null,
      label: "Refused at door",
    });
  });

  it("says every credit standing in the owner's words", () => {
    expect(doorRefusalLabel("wrong wine", "received")).toBe(
      "Refused at door — wrong wine · credit received",
    );
    expect(doorRefusalLabel(null, "denied")).toBe(
      "Refused at door · credit denied",
    );
  });
});
