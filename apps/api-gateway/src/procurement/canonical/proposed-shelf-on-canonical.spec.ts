import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { CanonicalDocumentService } from "./canonical-document.service";
import { LineMappingService } from "./line-mapping.service";

/**
 * ADR 0104 D12 slice 4 on the canonical object itself. All ids are SYNTHETIC.
 *
 *   1. A line a person ALREADY linked reads back as linked. Before slice 4 the
 *      `inventory_id` the door writes was never read onto the page, so a linked
 *      line still rendered as unlinked and a person was asked twice.
 *   2. An UNLINKED line carries the memory's proposal and its sentence — and
 *      nothing about the proposal is written anywhere.
 *   3. A LINKED line carries NO proposal. There is nothing to propose.
 *   4. A FAILED memory read is `proposalUnavailable` with a reason, NOT a line
 *      that quietly has no suggestion.
 */

const DOC_ROW = {
  id: "doc-1",
  restaurant_id: "rest-1",
  provider_id: "prov-1",
  doc_type: "invoice",
  doc_number: "SYN-TR-0002",
  doc_date: "2026-09-04",
  references_doc_number: null,
  currency: "TRY",
  subtotal: 1704,
  freight: null,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  deposit_total: null,
  tax: null,
  other_charges: null,
  discount_total: null,
  total: 1704,
  extraction_confidence: 0.8,
  extraction_model: "synthetic-model",
  direction: "issued_by_vendor",
  jurisdiction: "TR",
  source_channel: "upload",
  notes: null,
};

const line = (over: Record<string, unknown>) => ({
  id: "line-1",
  line_no: 1,
  vendor_sku: "SYN-OKZ-750",
  description: "SYNTHETIC Öküzgözü 2021",
  vintage: 2021,
  format_ml: 750,
  qty: "12",
  uom: "bottle",
  pack_size: 1,
  qty_bottles: "12",
  free_goods_qty: "0",
  unit_price: "142.0000",
  line_total: "1704.00",
  allowance: null,
  deposit: null,
  order_line_id: null,
  match_method: null,
  match_confidence: null,
  price_base_qty: null,
  price_base_uom: null,
  inventory_id: null,
  ...over,
});

const MEMORY_ROW = {
  action: "linked",
  inventory_id: "item-A",
  linked_by: "u1",
  linked_at: "2026-09-05T10:00:00.000Z",
  key_kind: "vendor_sku",
  key_value: "SYN-OKZ-750|2021",
  key_display: "SYN-OKZ-750",
};

describe("the remembered shelf on the canonical document", () => {
  let canonical: CanonicalDocumentService;
  let answers: Record<
    string,
    { data: unknown; error: { message: string } | null }
  >;

  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    const answerFor = () => answers[table] ?? { data: null, error: null };
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
      chain[verb] = jest.fn(() => {
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

  const build = async () => {
    const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
    if (!res.ok) throw new Error(`build failed: ${res.error}`);
    return res.value;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    answers = {
      procurement_documents: { data: DOC_ROW, error: null },
      procurement_document_lines: { data: [line({})], error: null },
      procurement_order_items: { data: [], error: null },
      restaurants: {
        data: { id: "rest-1", name: "SYNTHETIC Meyhane" },
        error: null,
      },
      providers: { data: { id: "prov-1", name: "SYNTHETIC Dağıtım" }, error: null },
      users: { data: [{ user_id: "u1", name: "Ayşe" }], error: null },
      document_revisions: { data: [], error: null },
      document_corrections: { data: [], error: null },
      document_line_mappings: { data: [MEMORY_ROW], error: null },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanonicalDocumentService,
        LineMappingService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    canonical = module.get(CanonicalDocumentService);
  });

  it("reads back the shelf a person already linked to the line", async () => {
    answers.procurement_document_lines = {
      data: [line({ inventory_id: "item-A" })],
      error: null,
    };
    const doc = await build();
    const l = doc.layer2.lines[0];
    expect(l.inventoryId).toBe("item-A");
    expect(l.inventoryIdSource).toBe("line");
    // Nothing to propose on a line that already names its shelf.
    expect(l.proposedInventoryId).toBeNull();
    expect(l.proposedSentence).toBeNull();
    expect(l.proposalUnavailable).toBe(false);
  });

  it("carries the memory's proposal and its sentence on an UNLINKED line", async () => {
    const doc = await build();
    const l = doc.layer2.lines[0];
    expect(l.inventoryId).toBeNull();
    expect(l.inventoryIdSource).toBeNull();
    expect(l.proposedInventoryId).toBe("item-A");
    expect(l.proposedSentence).toContain("Remembered from 1 earlier document");
    // A tick, never a number.
    expect(l.proposedSentence).not.toMatch(/%|0\.\d/);
    expect(l.proposalUnavailable).toBe(false);
  });

  it("proposes nothing when the memory's newest act for the key was an UN-LINK", async () => {
    answers.document_line_mappings = {
      data: [
        { ...MEMORY_ROW, action: "unlinked", inventory_id: null, linked_at: "2026-09-06T10:00:00.000Z" },
        MEMORY_ROW,
      ],
      error: null,
    };
    const doc = await build();
    expect(doc.layer2.lines[0].proposedInventoryId).toBeNull();
    expect(doc.layer2.lines[0].proposalUnavailable).toBe(false);
  });

  it("says the memory is UNAVAILABLE when its read failed — not that there is no suggestion", async () => {
    answers.document_line_mappings = {
      data: null,
      error: { message: "connection reset" },
    };
    const doc = await build();
    const l = doc.layer2.lines[0];
    expect(l.proposedInventoryId).toBeNull();
    expect(l.proposalUnavailable).toBe(true);
    expect(l.proposalUnavailableReason).toContain("could not be read");
    // The document still renders — the memory failing is not the document failing.
    expect(doc.layer1.lines).toHaveLength(1);
  });

  it("exposes the line id the shelf-link door is addressed by", async () => {
    const doc = await build();
    expect(doc.layer2.lines[0].lineId).toBe("line-1");
  });
});
