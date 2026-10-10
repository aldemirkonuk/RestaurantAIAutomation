import { PromotionExtractorService } from "./promotion-extractor.service";

/**
 * A vendor offer is deduped by WHICH offer it is, not by equal terms (F-480).
 *
 * The dedupe used to ask only "does this vendor already have an active offer
 * with the same type, percent, minimum and end date?". That let the same
 * vendor's "15% off 6+ until Oct 31" on Burgundy be dropped because Barolo had
 * those terms, and — since putting an offer away does not clear `is_active` —
 * an offer the owner dismissed once swallowed every later mail with its terms.
 * What it must still catch is the same message read twice.
 */

type Row = Record<string, any>;

function makeStore(inventory: string[]) {
  const promotions: Row[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let insertRow: Row | null = null;
    const rows = () =>
      table === "provider_promotions"
        ? promotions
        : table === "restaurant_inventory"
          ? inventory.map((wine_name) => ({ wine_name, restaurant_id: "house-A" }))
          : [];
    const run = () => {
      if (insertRow) {
        const row = { id: `promo-${promotions.length + 1}`, ...insertRow };
        promotions.push(row);
        return { data: row, error: null };
      }
      return { data: rows().filter((r) => filters.every((f) => f(r))), error: null };
    };
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v);
        return q;
      },
      contains: (col: string, v: Row) => {
        filters.push((r) =>
          Object.entries(v).every(([k, val]) => (r[col] ?? {})[k] === val),
        );
        return q;
      },
      limit: () => q,
      insert: (row: Row) => {
        insertRow = row;
        return q;
      },
      single: async () => run(),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { supabase: { from }, promotions };
}

function extractor(store: ReturnType<typeof makeStore>) {
  const gateway = { emitRoleNotification: jest.fn().mockResolvedValue(undefined) };
  return new PromotionExtractorService(store as any, gateway as any);
}

const TERMS = "15% off when you buy 6+ bottles, valid until 2026-10-31.";

describe("vendor offers are deduped by the offer, not by equal terms (F-480)", () => {
  it("the same vendor's offer on DIFFERENT wines with the same terms is kept", async () => {
    const store = makeStore(["Barolo Riserva", "Bourgogne Rouge"]);
    const svc = extractor(store);

    const first = await svc.extractAndStore({
      conversationId: "msg-1",
      restaurantId: "house-A",
      providerId: "vendor-1",
      subject: "Promotion: Barolo Riserva",
      body: TERMS,
    });
    const second = await svc.extractAndStore({
      conversationId: "msg-2",
      restaurantId: "house-A",
      providerId: "vendor-1",
      subject: "Promotion: Bourgogne Rouge",
      body: TERMS,
    });

    expect(first).toEqual({ stored: true });
    expect(second).toEqual({ stored: true });
    expect(store.promotions.map((p) => p.applicable_wines)).toEqual([
      ["Barolo Riserva"],
      ["Bourgogne Rouge"],
    ]);
  });

  it("a DISMISSED offer does not swallow a new mail with the same terms", async () => {
    const store = makeStore(["Barolo Riserva"]);
    const svc = extractor(store);
    const ctx = {
      restaurantId: "house-A",
      providerId: "vendor-1",
      subject: "Promotion: Barolo Riserva",
      body: TERMS,
    };

    await svc.extractAndStore({ ...ctx, conversationId: "msg-1" });
    // Put away by the owner: only the dismissal is stamped (promotions.service.ts).
    store.promotions[0].dismissed_at = "2026-10-02T09:00:00Z";

    const again = await svc.extractAndStore({ ...ctx, conversationId: "msg-2" });
    expect(again).toEqual({ stored: true });
    expect(store.promotions).toHaveLength(2);
  });

  it("the SAME message read twice is still one offer", async () => {
    const store = makeStore(["Barolo Riserva"]);
    const svc = extractor(store);
    const ctx = {
      conversationId: "msg-1",
      restaurantId: "house-A",
      providerId: "vendor-1",
      subject: "Promotion: Barolo Riserva",
      body: TERMS,
    };

    await svc.extractAndStore(ctx);
    const twice = await svc.extractAndStore(ctx);

    expect(twice).toEqual({ stored: false, reason: "duplicate promo" });
    expect(store.promotions).toHaveLength(1);
  });
});
