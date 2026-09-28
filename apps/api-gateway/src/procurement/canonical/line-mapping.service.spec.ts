import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { LineMappingService, mappingKeyFor } from "./line-mapping.service";

/**
 * The mapping memory (ADR 0104 D12 slice 4). All ids and text are SYNTHETIC.
 *
 * The adversarial pass this file encodes, in the order the rules matter:
 *
 *   1. A VINTAGE SWAP UNDER ONE SKU IS A DIFFERENT SHELF. A distributor reusing
 *      a SKU across vintages must NOT inherit last year's pairing.
 *   2. THE MEMORY FORGETS, IT DOES NOT AVERAGE. One un-link and the proposal is
 *      gone — not outvoted, not averaged, gone.
 *   3. THE LATEST HUMAN ANSWER WINS (S8). Wrong-then-right follows the right one.
 *   4. A PAIRING IS ONE VENUE'S AND ONE VENDOR'S. Measured by inspecting the
 *      filters the read actually issued, not by trusting the code comment.
 *   5. A FAILED READ IS "MEMORY UNAVAILABLE", NEVER "NO SUGGESTION".
 *   6. A LINK THAT LANDS ON THE LINE IS NOT LOST WHEN THE MEMORY WRITE FAILS.
 */

interface Answer {
  data: unknown;
  error: { message: string } | null;
}

describe("LineMappingService — the mapping memory", () => {
  let service: LineMappingService;

  let answers: Record<string, Answer>;
  let inserts: { table: string; payload: Record<string, unknown> }[];
  let updates: { table: string; payload: Record<string, unknown> }[];
  let filters: { table: string; column: string; value: unknown }[];

  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    const answerFor = (): Answer => answers[table] ?? { data: null, error: null };
    for (const verb of [
      "select",
      "eq",
      "in",
      "order",
      "limit",
      "single",
      "maybeSingle",
      "insert",
      "update",
      "delete",
    ]) {
      chain[verb] = jest.fn((...args: unknown[]) => {
        if (verb === "eq")
          filters.push({ table, column: args[0] as string, value: args[1] });
        if (verb === "insert")
          inserts.push({ table, payload: args[0] as Record<string, unknown> });
        if (verb === "update")
          updates.push({ table, payload: args[0] as Record<string, unknown> });
        if (verb === "single" || verb === "maybeSingle") {
          const a = answerFor();
          const data = Array.isArray(a.data) ? (a.data[0] ?? null) : a.data;
          return Promise.resolve({
            data: a.error ? null : (data ?? null),
            error: a.error,
          });
        }
        return self();
      });
    }
    (chain as { then: unknown }).then = (
      resolve: (v: unknown) => unknown,
    ): unknown => {
      const a = answerFor();
      return Promise.resolve({
        data: a.error ? null : (a.data ?? null),
        error: a.error,
      }).then(resolve);
    };
    return chain;
  };

  const client = { from: jest.fn((table: string) => makeChain(table)) };

  const LINE = {
    vendorSku: "SYN-OKZ-750",
    description: "SYNTHETIC Öküzgözü 2021",
    vintage: 2021,
    formatMl: 750,
  };

  const act = (over: Record<string, unknown>) => ({
    action: "linked",
    inventory_id: "item-A",
    linked_by: "user-1",
    linked_at: "2026-09-04T10:00:00.000Z",
    key_kind: "vendor_sku",
    key_value: "SYN-OKZ-750|2021",
    key_display: "SYN-OKZ-750",
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    answers = {};
    inserts = [];
    updates = [];
    filters = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LineMappingService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    service = module.get(LineMappingService);
  });

  // -- 1. the key -----------------------------------------------------------

  it("folds the printed vintage into a SKU key, so a re-used SKU on a new vintage is a DIFFERENT key", () => {
    const y21 = mappingKeyFor({ vendorSku: "SYN-OKZ-750", vintage: 2021 });
    const y22 = mappingKeyFor({ vendorSku: "SYN-OKZ-750", vintage: 2022 });
    expect(y21?.kind).toBe("vendor_sku");
    expect(y21?.value).not.toBe(y22?.value);
    // The printed SKU is still what a person sees.
    expect(y21?.display).toBe("SYN-OKZ-750");
  });

  it("keys on the normalised description, with format and vintage, when no SKU is printed", () => {
    const a = mappingKeyFor({
      description: "Synthetic Öküzgözü 2021 750ml",
      formatMl: 750,
    });
    const b = mappingKeyFor({
      description: "SYNTHETIC ÖKÜZGÖZÜ 2021 750ML",
      formatMl: 750,
    });
    expect(a?.kind).toBe("description");
    expect(a?.value).toBe(b?.value);
    // A magnum of the same wine is a different shelf.
    const magnum = mappingKeyFor({
      description: "Synthetic Öküzgözü 2021 1500ml",
      formatMl: 1500,
    });
    expect(magnum?.value).not.toBe(a?.value);
  });

  it("has no key for a line that prints neither a SKU nor a description", () => {
    expect(mappingKeyFor({ vendorSku: "  ", description: null })).toBeNull();
  });

  // -- 2. the proposal ------------------------------------------------------

  it("proposes the remembered shelf with a SENTENCE and no number anywhere in it", async () => {
    answers.document_line_mappings = {
      data: [
        act({ linked_at: "2026-09-05T10:00:00.000Z" }),
        act({ linked_at: "2026-09-04T10:00:00.000Z" }),
        act({ linked_at: "2026-09-03T10:00:00.000Z" }),
      ],
      error: null,
    };
    const got = await service.proposalsFor({
      restaurantId: "rest-1",
      providerId: "prov-1",
      lines: [LINE],
      nameFor: () => "Ayşe",
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const p = got.value.get("vendor_sku:SYN-OKZ-750|2021");
    expect(p?.inventoryId).toBe("item-A");
    expect(p?.timesConfirmed).toBe(3);
    expect(p?.sentence).toBe(
      "Remembered from 3 earlier documents from this vendor, last confirmed by Ayşe on 2026-09-05.",
    );
    // Never a confidence to a person: no percentage and no 0.x score.
    expect(p?.sentence).not.toMatch(/%|0\.\d/);
  });

  it("FORGETS after an un-link — it does not average the wrong answer away", async () => {
    answers.document_line_mappings = {
      data: [
        act({
          action: "unlinked",
          inventory_id: null,
          linked_at: "2026-09-06T10:00:00.000Z",
        }),
        act({ linked_at: "2026-09-05T10:00:00.000Z" }),
        act({ linked_at: "2026-09-04T10:00:00.000Z" }),
      ],
      error: null,
    };
    const got = await service.proposalsFor({
      restaurantId: "rest-1",
      providerId: "prov-1",
      lines: [LINE],
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.size).toBe(0);
  });

  it("follows the LATEST human answer when two shelves were both linked (S8)", async () => {
    answers.document_line_mappings = {
      data: [
        act({ inventory_id: "item-RIGHT", linked_at: "2026-09-06T10:00:00.000Z" }),
        act({ inventory_id: "item-WRONG", linked_at: "2026-09-05T10:00:00.000Z" }),
        act({ inventory_id: "item-WRONG", linked_at: "2026-09-04T10:00:00.000Z" }),
      ],
      error: null,
    };
    const got = await service.proposalsFor({
      restaurantId: "rest-1",
      providerId: "prov-1",
      lines: [LINE],
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    const p = got.value.get("vendor_sku:SYN-OKZ-750|2021");
    expect(p?.inventoryId).toBe("item-RIGHT");
    // The two earlier ticks for the WRONG shelf do not out-vote the newest one,
    // and they do not inflate the count of the one that won.
    expect(p?.timesConfirmed).toBe(1);
  });

  it("counts confirmations only SINCE the last un-link", async () => {
    answers.document_line_mappings = {
      data: [
        act({ linked_at: "2026-09-06T10:00:00.000Z" }),
        act({
          action: "unlinked",
          inventory_id: null,
          linked_at: "2026-09-05T10:00:00.000Z",
        }),
        act({ linked_at: "2026-09-04T10:00:00.000Z" }),
        act({ linked_at: "2026-09-03T10:00:00.000Z" }),
      ],
      error: null,
    };
    const got = await service.proposalsFor({
      restaurantId: "rest-1",
      providerId: "prov-1",
      lines: [LINE],
    });
    if (!got.ok) throw new Error("unreachable");
    expect(got.value.get("vendor_sku:SYN-OKZ-750|2021")?.timesConfirmed).toBe(1);
  });

  // -- 3. tenancy -----------------------------------------------------------

  it("scopes the read to THIS restaurant and THIS vendor — measured on the filters issued", async () => {
    answers.document_line_mappings = { data: [], error: null };
    await service.proposalsFor({
      restaurantId: "rest-1",
      providerId: "prov-1",
      lines: [LINE],
    });
    const issued = filters.filter((f) => f.table === "document_line_mappings");
    expect(issued).toEqual(
      expect.arrayContaining([
        { table: "document_line_mappings", column: "restaurant_id", value: "rest-1" },
        { table: "document_line_mappings", column: "provider_id", value: "prov-1" },
      ]),
    );
  });

  it("proposes nothing when the document names no vendor, and reads nothing at all", async () => {
    const got = await service.proposalsFor({
      restaurantId: "rest-1",
      providerId: null,
      lines: [LINE],
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.size).toBe(0);
    expect(client.from).not.toHaveBeenCalled();
  });

  // -- 4. the failed read ---------------------------------------------------

  it("says the memory could not be READ — never that there is nothing to propose", async () => {
    answers.document_line_mappings = {
      data: null,
      error: { message: "connection reset" },
    };
    const got = await service.proposalsFor({
      restaurantId: "rest-1",
      providerId: "prov-1",
      lines: [LINE],
    });
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error).toContain("could not be read");
    expect(got.error).toContain("NOT the same as having nothing to propose");
  });

  // -- 5. the write ---------------------------------------------------------

  it("records a tick a person chose, with the acting user and the folded key", async () => {
    answers.document_line_mappings = { data: null, error: null };
    const got = await service.record({
      restaurantId: "rest-1",
      providerId: "prov-1",
      line: LINE,
      inventoryId: "item-A",
      source: "chosen",
      documentId: "doc-1",
      lineNo: 1,
      linkedBy: "user-1",
    });
    expect(got.ok).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({
      restaurant_id: "rest-1",
      provider_id: "prov-1",
      key_kind: "vendor_sku",
      key_value: "SYN-OKZ-750|2021",
      action: "linked",
      inventory_id: "item-A",
      source: "chosen",
      linked_by: "user-1",
    });
    // No confidence column exists to write, and none is invented.
    expect(Object.keys(inserts[0].payload)).not.toContain("confidence");
  });

  it("records an un-link as an ACT naming no shelf", async () => {
    answers.document_line_mappings = { data: null, error: null };
    await service.record({
      restaurantId: "rest-1",
      providerId: "prov-1",
      line: LINE,
      inventoryId: null,
      source: "chosen",
      documentId: "doc-1",
      lineNo: 1,
      linkedBy: "user-1",
    });
    expect(inserts[0].payload).toMatchObject({
      action: "unlinked",
      inventory_id: null,
    });
  });

  it("writes nothing, and says why, when the document names no vendor", async () => {
    const got = await service.record({
      restaurantId: "rest-1",
      providerId: null,
      line: LINE,
      inventoryId: "item-A",
      source: "chosen",
      documentId: "doc-1",
      lineNo: 1,
      linkedBy: "user-1",
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.remembered).toBe(false);
    expect(got.value.reason).toContain("names no vendor");
    expect(inserts).toHaveLength(0);
  });

  // -- 6. the door ----------------------------------------------------------

  it("writes the shelf onto the line FIRST, then remembers it", async () => {
    answers.procurement_document_lines = {
      data: {
        id: "line-1",
        line_no: 1,
        vendor_sku: "SYN-OKZ-750",
        description: "SYNTHETIC Öküzgözü 2021",
        vintage: 2021,
        format_ml: 750,
        inventory_id: "item-A",
      },
      error: null,
    };
    answers.procurement_documents = {
      data: { id: "doc-1", provider_id: "prov-1" },
      error: null,
    };
    answers.restaurant_inventory = { data: { id: "item-A" }, error: null };
    answers.document_line_mappings = { data: null, error: null };

    const got = await service.linkLineToItem({
      documentId: "doc-1",
      lineId: "line-1",
      restaurantId: "rest-1",
      userId: "user-1",
      inventoryId: "item-A",
      source: "remembered",
    });

    expect(updates).toEqual([
      {
        table: "procurement_document_lines",
        payload: { inventory_id: "item-A" },
      },
    ]);
    expect(inserts[0].payload).toMatchObject({ source: "remembered" });
    expect(got.remembered).toBe(true);
  });

  it("refuses a shelf that is not this restaurant's", async () => {
    answers.procurement_document_lines = {
      data: { id: "line-1", line_no: 1, vendor_sku: "S", description: "d" },
      error: null,
    };
    answers.procurement_documents = {
      data: { id: "doc-1", provider_id: "prov-1" },
      error: null,
    };
    answers.restaurant_inventory = { data: null, error: null };
    await expect(
      service.linkLineToItem({
        documentId: "doc-1",
        lineId: "line-1",
        restaurantId: "rest-1",
        userId: "user-1",
        inventoryId: "item-SOMEONE-ELSES",
        source: "chosen",
      }),
    ).rejects.toThrow("ITEM_NOT_FOUND");
    expect(updates).toHaveLength(0);
  });

  it("keeps the link on the line when the memory write fails, and says the memory did not record it", async () => {
    answers.procurement_document_lines = {
      data: {
        id: "line-1",
        line_no: 1,
        vendor_sku: "SYN-OKZ-750",
        description: "d",
        vintage: 2021,
        format_ml: 750,
      },
      error: null,
    };
    answers.procurement_documents = {
      data: { id: "doc-1", provider_id: "prov-1" },
      error: null,
    };
    answers.restaurant_inventory = { data: { id: "item-A" }, error: null };
    answers.document_line_mappings = {
      data: null,
      error: { message: "memory table unavailable" },
    };

    const got = await service.linkLineToItem({
      documentId: "doc-1",
      lineId: "line-1",
      restaurantId: "rest-1",
      userId: "user-1",
      inventoryId: "item-A",
      source: "chosen",
    });
    expect(got.inventoryId).toBe("item-A");
    expect(got.remembered).toBe(false);
    expect(got.memoryNote).toContain("did not record it");
  });
});
