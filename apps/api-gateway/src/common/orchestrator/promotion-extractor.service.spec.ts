import { PromotionExtractorService } from "./promotion-extractor.service";

/**
 * What the promotions lane files and who it tells, for the QA round 4 harms
 * (2026-11-07): an offer that ended before it was read is filed as ended and
 * toasts nobody, and an amount off a case is stored as off a case.
 */

type Row = Record<string, any>;

/** A thenable query chain over in-memory tables; records inserts. */
function fakeDb(tables: Record<string, Row[]>) {
  const inserted: Array<{ table: string; row: Row }> = [];
  const from = (table: string) => {
    let pending: Row | null = null;
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      contains: () => chain,
      limit: () => chain,
      insert: (row: Row) => {
        pending = row;
        inserted.push({ table, row });
        return chain;
      },
      single: async () => ({ data: { id: "promo-1", ...(pending ?? {}) }, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve),
    };
    return chain;
  };
  return { databaseService: { supabase: { from } } as any, inserted };
}

function service(tables: Record<string, Row[]> = {}) {
  const db = fakeDb({ provider_promotions: [], restaurant_inventory: [{ wine_name: "Rioja Reserva" }], ...tables });
  const emits: unknown[] = [];
  const gateway = { emitRoleNotification: jest.fn(async (...a: unknown[]) => void emits.push(a)) } as any;
  const svc = new PromotionExtractorService(db.databaseService, gateway);
  return { svc, inserted: db.inserted, gateway };
}

const ctx = (subject: string, body: string) => ({
  conversationId: "conv-1",
  restaurantId: "house-1",
  providerId: "prov-1",
  providerName: "Vintner Select",
  subject,
  body,
  transport: { bulk: true } as any,
});

describe("PromotionExtractorService.extractAndStore", () => {
  afterEach(() => jest.useRealTimers());

  it("an offer that ended before the mail was read is filed as ended and toasts nobody", async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 7, 10, 0) }); // 2026-11-07
    const { svc, inserted, gateway } = service();
    const out = await svc.extractAndStore(ctx("Last call on Rioja Reserva", "20% off Rioja Reserva. Offer ends Nov 6."));
    expect(out).toEqual({ stored: true });
    const row = inserted.find((i) => i.table === "provider_promotions")!.row;
    expect(row.end_date).toBe("2026-11-06");
    expect(row.conditions.priority).toBe("ended");
    expect(gateway.emitRoleNotification).not.toHaveBeenCalled();
  });

  it("the same offer still open is toasted to owners and managers", async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 5, 10, 0) }); // 2026-11-05
    const { svc, inserted, gateway } = service();
    await svc.extractAndStore(ctx("Last call on Rioja Reserva", "20% off Rioja Reserva. Offer ends Nov 6."));
    const row = inserted.find((i) => i.table === "provider_promotions")!.row;
    expect(row.end_date).toBe("2026-11-06");
    expect(row.conditions.priority).not.toBe("ended");
    expect(gateway.emitRoleNotification).toHaveBeenCalledTimes(1);
  });

  it("a passed date the mail does not name as the offer's end leaves a live offer open and toasted", async () => {
    jest.useFakeTimers({ now: new Date(2026, 10, 7, 10, 0) }); // 2026-11-07
    const { svc, inserted, gateway } = service();
    await svc.extractAndStore(ctx("Special offer", "Special offer: 20% off Rioja Reserva. Harvest finished Sept 3"));
    const row = inserted.find((i) => i.table === "provider_promotions")!.row;
    expect(row.end_date ?? null).toBeNull();
    expect(row.conditions.priority).not.toBe("ended");
    expect(gateway.emitRoleNotification).toHaveBeenCalledTimes(1);
  });

  it("a new-arrivals mail quoting ABV is not filed as a percentage off", async () => {
    const { svc, inserted } = service();
    await svc.extractAndStore(ctx("New arrivals from Barolo", "Our 2019 Barolo 14.5% ABV is just arrived. Stock limited."));
    const row = inserted.find((i) => i.table === "provider_promotions")!.row;
    expect(row.discount_value.percent).toBeUndefined();
  });

  it('"$15 off per case" is stored as off a case, with the case\'s bottles when stated', async () => {
    const { svc, inserted } = service();
    await svc.extractAndStore(ctx("By the case", "Rioja Reserva 12 x 750ml at $15 off per case this month."));
    const row = inserted.find((i) => i.table === "provider_promotions")!.row;
    expect(row.discount_value).toMatchObject({ amount: 15, amount_unit: "case", pack_size: 12, currency: "USD" });
  });
});

/**
 * The digest line says the money the stored offer names, or none: the
 * fallback for anything not EUR or GBP was `$`, so a lira offer, or one that
 * named no currency, read as dollars (r9 left list, 2026-11-12).
 */
describe("a digest line never borrows a dollar sign", () => {
  const line = (dv: Record<string, unknown>) =>
    (service().svc as any).digestLine({ providers: { name: "Acme" }, discount_value: dv });

  it("names a stated EUR, GBP or USD by its sign", () => {
    expect(line({ amount: 15, currency: "EUR" })).toBe("Acme — €15 off");
    expect(line({ amount: 15, currency: "GBP" })).toBe("Acme — £15 off");
    expect(line({ amount: 15, currency: "USD" })).toBe("Acme — $15 off");
  });

  it("puts another stated code after the figure", () => {
    expect(line({ amount: 200, currency: "TRY" })).toBe("Acme — 200 TRY off");
  });

  it("prints the figure bare when the offer names no currency", () => {
    expect(line({ amount: 15, currency: null })).toBe("Acme — 15 off");
    expect(line({ amount: 15 })).not.toContain("$");
  });
});
