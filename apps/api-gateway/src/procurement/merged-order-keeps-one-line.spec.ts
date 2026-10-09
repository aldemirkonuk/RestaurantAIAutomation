/**
 * F-548: `upsertOrderLine` is delete-then-insert. When the delete of the
 * previous line failed it only warned and inserted anyway, so a merged order
 * kept its stale line next to the new one — the exact outcome its own comment
 * names ("a stale second line ... would make the matcher pair an invoice
 * against a quantity nobody ordered"). A failed clear now fails the write.
 */
import { ProcurementService } from "./procurement.service";

function fakeDb(deleteError: { message: string } | null) {
  const ops: string[] = [];
  const from = (table: string) => {
    let op = "select";
    const b: Record<string, unknown> = {};
    const answer = () => {
      if (op === "delete") return { data: null, error: deleteError };
      return { data: null, error: null };
    };
    for (const m of ["insert", "delete", "update"]) {
      b[m] = () => {
        op = m;
        ops.push(`${table}.${m}`);
        return b;
      };
    }
    for (const m of ["select", "eq"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(answer()).then(resolve, reject);
    return b;
  };
  return { db: { supabase: { from } }, ops };
}

const args = {
  restaurantId: "r-1",
  orderId: "o-1",
  dto: { inventoryId: "inv-1", quantity: 5, providerId: "p-1" },
  units: { unitType: "case", bottlesPerUnit: 12, bottlesTotal: 60 },
  finalPrice: 30,
};

function upsert(db: unknown) {
  const svc = new ProcurementService(db as never, {} as never, {} as never);
  return (
    svc as unknown as { upsertOrderLine: (a: unknown) => Promise<void> }
  ).upsertOrderLine(args);
}

describe("upsertOrderLine — a merge cannot keep its stale line (F-548)", () => {
  it("does not insert the new line when the old one could not be cleared", async () => {
    const { db, ops } = fakeDb({ message: "delete refused" });

    await expect(upsert(db)).rejects.toMatchObject({
      message: "delete refused",
    });
    expect(ops).toContain("procurement_order_items.delete");
    expect(ops).not.toContain("procurement_order_items.insert");
  });

  it("replaces the line when the clear succeeds", async () => {
    const { db, ops } = fakeDb(null);

    await upsert(db);
    expect(ops).toEqual([
      "procurement_order_items.delete",
      "procurement_order_items.insert",
    ]);
  });
});
