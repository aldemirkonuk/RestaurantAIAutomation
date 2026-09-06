/**
 * Admitting a house-obtained catalogue — the properties the report has to keep.
 *
 * The founder, 2026-09-05 (ADR 0126, batch 56): *"Build the ingest route and the
 * panel."* The one thing that must never happen on this path is the answer
 * "0 rows" with no reasons, because the commonest cause of zero is not a bad
 * file — it is that nobody has yet said what the sender's price code means, and
 * that is a five-minute fix by the manager holding the guide.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CatalogIngestService,
  CatalogueIngestInput,
  admissionSentence,
} from "./catalog-ingest.service";
import { PriceCodeMeaning } from "./price-code-mappings";
import { looksLikeEdi832, readEdi832Header } from "./parse-edi832";

const HOUSE = "11111111-2222-3333-4444-555555555555";
const ADA = "aaaaaaaa-0000-0000-0000-000000000001";
const SENDER = "southern-glazers-il";

const CONSTRUCTED = readFileSync(
  join(__dirname, "__fixtures__", "edi832-constructed-from-spec.edi"),
  "utf8",
);
const PUBLISHED_SAMPLE = readFileSync(
  join(__dirname, "__fixtures__", "edi832-msss-guide-sample-2022-06-02.edi"),
  "utf8",
);

const LIC: PriceCodeMeaning = {
  mappingId: "m-lic",
  priceBasis: "our licence's contract price",
  declaredByName: "Ada Manager",
  declaredAt: "2026-09-05T09:00:00.000Z",
};

interface MappingsState {
  byCode: Record<string, PriceCodeMeaning>;
  conflicted: string[];
  live: number;
  withdrawn: number;
  readFailed: boolean;
  note: string;
}

function harness(
  over: {
    mappings?: Partial<MappingsState>;
    insertError?: { message: string; code?: string } | null;
    notAManager?: boolean;
  } = {},
) {
  const state = {
    inserted: [] as Array<Record<string, unknown>>,
    insertError: over.insertError ?? null,
  };
  const client = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
        return { error: state.insertError };
      },
    }),
  };
  const organizations = {
    assertCanManageRestaurant: async () => {
      if (over.notAManager) throw new Error("Only managers and owners can admit a distributor catalogue's prices to this house's register");
    },
  };
  const mappings = {
    forSender: async () => ({
      restaurantId: HOUSE,
      distributorKey: SENDER,
      rows: [],
      byCode: { LIC },
      conflicted: [],
      live: 1,
      withdrawn: 0,
      readFailed: false,
      note: "one live statement",
      ...over.mappings,
    }),
  };
  return {
    state,
    svc: new CatalogIngestService(
      { client } as never,
      mappings as never,
      organizations as never,
    ),
  };
}

function input(over: Partial<CatalogueIngestInput> = {}): CatalogueIngestInput {
  return {
    restaurantId: HOUSE,
    distributorKey: SENDER,
    raw: CONSTRUCTED,
    sha256: "f".repeat(64),
    documentId: "doc-1",
    uploadedBy: ADA,
    uploadedByName: "Ada Manager",
    receivedAt: "2026-09-05T18:00:00.000Z",
    declaredCurrency: null,
    providerId: null,
    filename: "q3-catalogue.832",
    ...over,
  };
}

describe("looksLikeEdi832 — the door's own question", () => {
  it("recognises the catalogue fixtures", () => {
    expect(looksLikeEdi832(CONSTRUCTED)).toBe(true);
    expect(looksLikeEdi832(PUBLISHED_SAMPLE)).toBe(true);
  });

  it("does not claim an invoice, a PDF or empty text", () => {
    expect(looksLikeEdi832("ISA*00*...~ST*810*0001~BIG*20260905*INV-1~")).toBe(
      false,
    );
    expect(looksLikeEdi832("%PDF-1.7 the word 832 appears here")).toBe(false);
    expect(looksLikeEdi832("")).toBe(false);
  });
});

describe("readEdi832Header — what the stored document says about itself", () => {
  it("reads the number, the currency, the sender and the line count", () => {
    const h = readEdi832Header(CONSTRUCTED);
    expect(h.catalogNumber).toBe("Q3-2026");
    expect(h.currency).toBe("USD");
    expect(h.senderName).toBe("A DISTRIBUTOR THAT DOES NOT EXIST");
    expect(h.effectiveDate).toBe("2026-07-01");
    expect(h.lineCount).toBe(8);
  });

  it("reports a missing currency as NULL and never as USD", () => {
    // The published MSSS sample carries no CUR at all — the common case.
    expect(readEdi832Header(PUBLISHED_SAMPLE).currency).toBeNull();
  });
});

describe("CatalogIngestService.admit", () => {
  it("writes the lines its house mapped, and names every line it refused", async () => {
    const { svc, state } = harness();
    const out = await svc.admit(input());

    expect(out.linesRead).toBe(8);
    expect(out.admitted).toBe(2);
    expect(state.inserted).toHaveLength(2);
    expect(out.refused).toBe(6);
    // Every refused line is in `lines` with a reason, and the tally agrees.
    const refusedLines = out.lines.filter((l) => !l.admitted);
    expect(refusedLines).toHaveLength(6);
    expect(refusedLines.every((l) => (l.detail ?? "").length > 0)).toBe(true);
    expect(
      Object.values(out.refusalsByReason).reduce((a, b) => a + b, 0),
    ).toBe(6);
  });

  it("names the unmapped code, because that is the refusal a person can fix", async () => {
    const { svc } = harness();
    const out = await svc.admit(input());
    expect(out.unmappedCodes).toEqual(["MSR"]);
    expect(out.sentence).toContain("'MSR'");
    expect(out.sentence).toContain("re-upload");
  });

  it("stamps the provenance on every row it writes — who, when, the sha256, the sender", async () => {
    const { svc, state } = harness();
    await svc.admit(input());
    const handover = (state.inserted[0].raw as Record<string, unknown>)
      .handover as Record<string, unknown>;
    expect(handover).toMatchObject({
      uploadedBy: ADA,
      uploadedByName: "Ada Manager",
      uploadedAt: "2026-09-05T18:00:00.000Z",
      fileSha256: "f".repeat(64),
      documentId: "doc-1",
      senderKey: SENDER,
    });
  });

  it("stamps the mapping that admitted the row, in a column and not only in raw", async () => {
    const { svc, state } = harness();
    await svc.admit(input());
    expect(state.inserted[0].price_code_mapping_id).toBe("m-lic");
    expect(state.inserted[0].source_type).toBe("api_catalog");
    expect(state.inserted[0].trust_tier).toBe(3);
    // THE tenancy invariant: a null restaurant_id is readable by every house.
    expect(state.inserted[0].restaurant_id).toBe(HOUSE);
  });

  it("normalises to a 750 ml equivalent, so a magnum cannot rank as a bargain", async () => {
    const { svc, state } = harness();
    await svc.admit(input());
    const magnum = state.inserted.find((r) => r.unit_volume_ml === 1500);
    expect(magnum).toBeDefined();
    // 23.40 over a 6-pack is 3.90 a magnum, which is 1.95 per 750 ml.
    expect(magnum?.normalized_unit_price).toBeCloseTo(1.95, 6);
  });

  it("REFUSES THE WHOLE FILE when the house's own statements could not be read", async () => {
    const { svc, state } = harness({
      mappings: {
        byCode: {},
        live: 0,
        readFailed: true,
        note: "the read failed",
      },
    });
    const out = await svc.admit(input());
    expect(out.refusedWhole).toContain("could not be read");
    expect(out.refusedWhole).toContain("unknown, not none");
    expect(out.admitted).toBe(0);
    expect(out.refused).toBe(0);
    // The distinction this test exists for: a failed read must NOT be reported
    // as eight lines refused for an unmapped code, which would blame the
    // distributor for our own database error.
    expect(out.unmappedCodes).toEqual([]);
    expect(state.inserted).toHaveLength(0);
  });

  it("refuses an unknown sender by name and lists the keys it does hold", async () => {
    const { svc, state } = harness();
    const out = await svc.admit(input({ distributorKey: "not-a-distributor" }));
    expect(out.refusedWhole).toContain("'not-a-distributor'");
    expect(out.refusedWhole).toContain("southern-glazers-il");
    expect(state.inserted).toHaveLength(0);
  });

  it("admits NOTHING from the published sample, and says why line by line", async () => {
    // MSSS's own guide sample prices all three lines, carries no PO4 on any of
    // them and no CUR at all. A correct parser admits zero.
    const { svc, state } = harness();
    const out = await svc.admit(input({ raw: PUBLISHED_SAMPLE }));
    expect(state.inserted).toHaveLength(0);
    expect(out.admitted).toBe(0);
    expect(out.refusedWhole).toContain("no CUR currency");
    expect(out.sentence).not.toBe("");
  });

  it("counts a repeat upload as already recorded, never as a write failure", async () => {
    const { svc } = harness({
      insertError: { message: "duplicate key value", code: "23505" },
    });
    const out = await svc.admit(input());
    expect(out.alreadyRecorded).toBe(2);
    expect(out.writeFailed).toBe(0);
    expect(out.admitted).toBe(0);
    expect(out.sentence).toContain("already on the record");
  });

  it("carries a real write failure back in words, and does not count it as admitted", async () => {
    const { svc } = harness({
      insertError: { message: "permission denied for table" },
    });
    const out = await svc.admit(input());
    expect(out.admitted).toBe(0);
    expect(out.writeFailed).toBe(2);
    expect(out.writeFailures[0]).toContain("permission denied");
    expect(out.sentence).toContain("NOT recorded");
  });

  it("reports the mapping read's own state rather than collapsing it", async () => {
    const { svc } = harness({
      mappings: { conflicted: ["CON"], live: 2, withdrawn: 1 },
    });
    const out = await svc.admit(input());
    expect(out.mappings).toEqual({
      live: 2,
      withdrawn: 1,
      conflicted: ["CON"],
      readFailed: false,
      note: "one live statement",
    });
  });
});

describe("admissionSentence", () => {
  it("never says a bare zero: a nothing-admitted run still names its reasons", () => {
    const s = admissionSentence({
      admitted: 0,
      alreadyRecorded: 0,
      refused: 3,
      writeFailed: 0,
      linesRead: 3,
      refusalsByReason: { unmapped_price_basis: 3 },
      unmappedCodes: ["CAT", "CON"],
      distributor: "A Distributor",
    });
    expect(s).toContain("3 refused");
    expect(s).toContain("a code nobody here has stated a meaning for");
    expect(s).toContain("'CAT', 'CON'");
  });

  it("says so when a file carried no priceable line at all", () => {
    const s = admissionSentence({
      admitted: 0,
      alreadyRecorded: 0,
      refused: 0,
      writeFailed: 0,
      linesRead: 0,
      refusalsByReason: {},
      unmappedCodes: [],
      distributor: "A Distributor",
    });
    expect(s).toContain("nothing to admit or refuse");
  });
});

/**
 * The door is open to staff; the price register is not.
 *
 * `POST /procurement/documents` deliberately carries no role gate — a runner
 * photographs paper at the delivery door — so the gate belongs on the act that
 * writes prices, not on the act that stores a file.
 */
describe("who may admit a catalogue's prices", () => {
  it("refuses a non-manager in words, and says the file was still stored", async () => {
    const { svc, state } = harness({ notAManager: true });
    const out = await svc.admit(input());
    expect(out.admitted).toBe(0);
    expect(state.inserted).toHaveLength(0);
    expect(out.refusedWhole).toContain("Only managers and owners");
    expect(out.refusedWhole).toContain("nothing was lost");
    expect(out.sentence).toContain("manager's act");
  });
});
