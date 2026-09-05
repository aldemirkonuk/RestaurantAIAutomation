/**
 * The manager statement: reading a set of them, and the service that writes
 * one, withdraws one, and counts what a withdrawn one admitted.
 *
 * The founder, 2026-09-05 (ADR 0126 Q3): "Manager maps it, recorded on every
 * row." These are the properties that sentence has to keep true.
 */

import {
  CODE_FIELD_EDI_832,
  PriceCodeMapping,
  attributionFor,
  liveMappingsByCode,
  normalisePriceCode,
} from "./price-code-mappings";
import { PriceCodeMappingsService } from "./price-code-mappings.service";

const HOUSE = "11111111-2222-3333-4444-555555555555";
const ADA = "aaaaaaaa-0000-0000-0000-000000000001";

function mapping(over: Partial<PriceCodeMapping> = {}): PriceCodeMapping {
  return {
    id: "m-1",
    restaurantId: HOUSE,
    distributorKey: "southern-glazers-il",
    codeField: CODE_FIELD_EDI_832,
    priceCode: "CON",
    priceBasis: "contract price to this licence",
    evidence: "the rep sent the implementation guide",
    declaredBy: ADA,
    declaredByName: "Ada Manager",
    declaredAt: "2026-09-05T09:00:00.000Z",
    withdrawnBy: null,
    withdrawnAt: null,
    withdrawnReason: null,
    ...over,
  };
}

describe("normalisePriceCode", () => {
  it("upper-cases and trims, so one code cannot wear two rows", () => {
    expect(normalisePriceCode(" con ")).toBe("CON");
    expect(normalisePriceCode("C01")).toBe("C01");
  });

  it("refuses what is not an X12 identifier code, rather than storing it", () => {
    for (const bad of ["", "   ", null, undefined, "CON;DROP", "a".repeat(17), "CON-1"]) {
      expect(normalisePriceCode(bad as string)).toBeNull();
    }
  });
});

describe("liveMappingsByCode", () => {
  it("is EMPTY for a house that has mapped nothing — the safe refusal is the default", () => {
    const out = liveMappingsByCode([]);
    expect(out.byCode).toEqual({});
    expect(out.live).toBe(0);
  });

  it("carries the mapping id and the manager's name into the parser's map", () => {
    const out = liveMappingsByCode([mapping()]);
    expect(out.byCode.CON).toEqual({
      mappingId: "m-1",
      priceBasis: "contract price to this licence",
      declaredByName: "Ada Manager",
      declaredAt: "2026-09-05T09:00:00.000Z",
    });
    expect(out.live).toBe(1);
  });

  it("drops a withdrawn statement from the map and keeps counting it", () => {
    const out = liveMappingsByCode([
      mapping({
        id: "m-old",
        withdrawnAt: "2026-09-06T00:00:00.000Z",
        withdrawnBy: ADA,
        withdrawnReason: "the rep had sent the wrong guide",
      }),
    ]);
    expect(out.byCode).toEqual({});
    expect(out.withdrawn).toBe(1);
    expect(out.live).toBe(0);
  });

  it("REFUSES a code with two live meanings rather than taking the newest", () => {
    const out = liveMappingsByCode([
      mapping({ id: "m-1", priceBasis: "one reading" }),
      mapping({ id: "m-2", priceBasis: "another reading" }),
    ]);
    expect(out.conflicted).toEqual(["CON"]);
    // Not present at all: the parser then refuses the line as unmapped, which
    // is correct — nobody has said WHICH of the two is the trade level.
    expect(out.byCode.CON).toBeUndefined();
  });

  it("normalises on the way in, so a stored oddity cannot shadow a good code", () => {
    const out = liveMappingsByCode([mapping({ priceCode: " con " })]);
    expect(Object.keys(out.byCode)).toEqual(["CON"]);
  });
});

describe("attributionFor", () => {
  it("names the meaning, the code, the person and the day", () => {
    expect(
      attributionFor(liveMappingsByCode([mapping()]).byCode.CON, "CON"),
    ).toBe(
      'Priced as "contract price to this licence" because this house mapped the sender\'s code CON by Ada Manager on 2026-09-05.',
    );
  });
});

/* ── the service ───────────────────────────────────────────────────────── */

function db(overrides: Record<string, unknown> = {}) {
  const state = {
    selectRows: [] as unknown[],
    selectError: null as { message: string } | null,
    insertError: null as { message: string } | null,
    updateRow: { id: "m-1" } as { id: string } | null,
    updateError: null as { message: string } | null,
    countError: null as { message: string } | null,
    count: 2,
    inserted: null as Record<string, unknown> | null,
    updated: null as Record<string, unknown> | null,
    updateFilters: [] as Array<[string, unknown]>,
    ...overrides,
  };
  const client = {
    from: (table: string) => {
      if (table === "vendor_price_observations") {
        return {
          select: () => ({
            eq: async () =>
              state.countError
                ? { count: null, error: state.countError }
                : { count: state.count, error: null },
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: async () =>
                state.selectError
                  ? { data: null, error: state.selectError }
                  : { data: state.selectRows, error: null },
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          state.inserted = row;
          return {
            select: () => ({
              single: async () =>
                state.insertError
                  ? { data: null, error: state.insertError }
                  : { data: { id: "m-new" }, error: null },
            }),
          };
        },
        update: (row: Record<string, unknown>) => {
          state.updated = row;
          const chain = {
            eq: (col: string, val: unknown) => {
              state.updateFilters.push([col, val]);
              return chain;
            },
            is: () => chain,
            select: () => ({
              maybeSingle: async () =>
                state.updateError
                  ? { data: null, error: state.updateError }
                  : { data: state.updateRow, error: null },
            }),
          };
          return chain;
        },
      };
    },
  };
  return { state, svc: new PriceCodeMappingsService({ client } as never) };
}

const asRow = (m: PriceCodeMapping) => ({
  id: m.id,
  restaurant_id: m.restaurantId,
  distributor_key: m.distributorKey,
  code_field: m.codeField,
  price_code: m.priceCode,
  price_basis: m.priceBasis,
  evidence: m.evidence,
  declared_by: m.declaredBy,
  declared_by_name: m.declaredByName,
  declared_at: m.declaredAt,
  withdrawn_by: m.withdrawnBy,
  withdrawn_at: m.withdrawnAt,
  withdrawn_reason: m.withdrawnReason,
});

describe("PriceCodeMappingsService.forSender", () => {
  it("reads the house's live statements and says how many there are", async () => {
    const { svc } = db({ selectRows: [asRow(mapping())] });
    const out = await svc.forSender(HOUSE, "southern-glazers-il");
    expect(out.readFailed).toBe(false);
    expect(out.byCode.CON.mappingId).toBe("m-1");
    expect(out.note).toContain("1 live meaning");
  });

  it("says a failed read is UNKNOWN, never that the house mapped nothing", async () => {
    const { svc } = db({ selectError: { message: "boom" } });
    const out = await svc.forSender(HOUSE, "southern-glazers-il");
    expect(out.readFailed).toBe(true);
    expect(out.note).toContain("This is unknown, not none");
    expect(out.byCode).toEqual({});
  });

  it("tells a house that has mapped nothing that the refusal is the safe answer", async () => {
    const { svc } = db();
    const out = await svc.forSender(HOUSE, "southern-glazers-il");
    expect(out.note).toContain("safe answer, not a fault");
  });
});

describe("PriceCodeMappingsService.declare", () => {
  const good = {
    restaurantId: HOUSE,
    distributorKey: "southern-glazers-il",
    priceCode: "con",
    priceBasis: "contract price to this licence",
    evidence: "page 7 of the implementation guide",
    declaredBy: ADA,
    declaredByName: "Ada Manager",
  };

  it("writes the statement, normalised, under the manager's name", async () => {
    const { svc, state } = db();
    const out = await svc.declare(good);
    expect(out.ok).toBe(true);
    expect(state.inserted).toMatchObject({
      restaurant_id: HOUSE,
      distributor_key: "southern-glazers-il",
      code_field: CODE_FIELD_EDI_832,
      price_code: "CON",
      price_basis: "contract price to this licence",
      declared_by: ADA,
      declared_by_name: "Ada Manager",
    });
    // Explicit keys, every one: no conditional spread, nothing computed.
    expect(Object.keys(state.inserted as object).sort()).toEqual([
      "code_field",
      "declared_by",
      "declared_by_name",
      "distributor_key",
      "evidence",
      "price_basis",
      "price_code",
      "restaurant_id",
    ]);
  });

  it("refuses a meaning with no words, and never defaults one", async () => {
    const { svc, state } = db();
    const out = await svc.declare({ ...good, priceBasis: "   " });
    expect(out.ok).toBe(false);
    expect(out.refusedBecause).toContain("no default trade level");
    expect(state.inserted).toBeNull();
  });

  it("refuses a statement with no evidence", async () => {
    const { svc } = db();
    expect((await svc.declare({ ...good, evidence: "" })).refusedBecause).toContain(
      "say how you know",
    );
  });

  it("refuses an unsigned statement", async () => {
    const { svc } = db();
    expect(
      (await svc.declare({ ...good, declaredByName: " " })).refusedBecause,
    ).toContain("name the person making it");
  });

  it("refuses a code that is not an X12 identifier", async () => {
    const { svc } = db();
    expect((await svc.declare({ ...good, priceCode: "CON;--" })).refusedBecause).toContain(
      "not a price-identifier code",
    );
  });

  it("refuses a second live meaning and points at the withdrawal", async () => {
    const { svc, state } = db({ selectRows: [asRow(mapping())] });
    const out = await svc.declare(good);
    expect(out.ok).toBe(false);
    expect(out.refusedBecause).toContain("Withdraw it first");
    expect(state.inserted).toBeNull();
  });

  it("writes NOTHING when the existing statements could not be read", async () => {
    const { svc, state } = db({ selectError: { message: "boom" } });
    const out = await svc.declare(good);
    expect(out.ok).toBe(false);
    expect(out.refusedBecause).toContain("Nothing was written");
    expect(state.inserted).toBeNull();
  });
});

describe("PriceCodeMappingsService.withdraw", () => {
  it("records who, when and why", async () => {
    const { svc, state } = db();
    const out = await svc.withdraw({
      mappingId: "m-1",
      restaurantId: HOUSE,
      withdrawnBy: ADA,
      reason: "the rep had sent the wrong guide",
    });
    expect(out.ok).toBe(true);
    expect(state.updated).toMatchObject({
      withdrawn_by: ADA,
      withdrawn_reason: "the rep had sent the wrong guide",
    });
    expect(typeof (state.updated as Record<string, string>).withdrawn_at).toBe("string");
  });

  it("filters the write on the caller's own house, not only the id", async () => {
    const { svc, state } = db();
    await svc.withdraw({
      mappingId: "m-1",
      restaurantId: HOUSE,
      withdrawnBy: ADA,
      reason: "r",
    });
    expect(state.updateFilters).toContainEqual(["restaurant_id", HOUSE]);
  });

  it("refuses a withdrawal with no reason", async () => {
    const { svc, state } = db();
    const out = await svc.withdraw({
      mappingId: "m-1",
      restaurantId: HOUSE,
      withdrawnBy: ADA,
      reason: "  ",
    });
    expect(out.ok).toBe(false);
    expect(out.refusedBecause).toContain("say why");
    expect(state.updated).toBeNull();
  });

  it("does not overwrite an existing withdrawal's reason", async () => {
    const { svc } = db({ updateRow: null });
    const out = await svc.withdraw({
      mappingId: "m-1",
      restaurantId: HOUSE,
      withdrawnBy: ADA,
      reason: "again",
    });
    expect(out.ok).toBe(false);
    expect(out.refusedBecause).toContain("already have been withdrawn");
  });
});

describe("PriceCodeMappingsService.rowsAdmittedBy", () => {
  it("counts the rows a statement admitted, in one query", async () => {
    const { svc } = db({ count: 42 });
    expect(await svc.rowsAdmittedBy("m-1")).toEqual({ count: 42, unreadable: null });
  });

  it("returns NULL, never 0, when the count could not be read", async () => {
    const { svc } = db({ countError: { message: "boom" } });
    const out = await svc.rowsAdmittedBy("m-1");
    expect(out.count).toBeNull();
    expect(out.unreadable).toBe("boom");
  });
});
