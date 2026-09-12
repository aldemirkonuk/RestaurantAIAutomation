import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { CanonicalDocumentService } from "./canonical-document.service";
import { LineMappingService } from "./line-mapping.service";
import { VendorResolutionService } from "../vendor-identity/vendor-resolution.service";

/**
 * ADR 0104 D15 on the canonical object itself. All ids are SYNTHETIC.
 *
 *   1. THE SHEET FINALLY CARRIES BT-31. It was measured NULL on 2026-09-05
 *      because no table had a tax-id column; now the resolved provider's
 *      identity fills it, sourced as OUR RECORD with no `as_printed`, while the
 *      value the PAGE printed fills it (with its glyphs) when no provider has.
 *   2. THE RESOLUTION IS ON THE OBJECT, with its sentence — matched, created,
 *      unresolved and unavailable all render, and all four are distinguishable.
 *   3. A DOCUMENT NOBODY RESOLVED READS AS `null`, not as a refusal. Having
 *      never run and having run and refused are different facts.
 *   4. A FAILED READ OF THE LOG IS `unavailable`, NEVER a blank line. This is
 *      the one place where "we could not read how the vendor was resolved" and
 *      "this document predates D15" draw identically.
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
  extracted: { vendorTaxId: "VKN 1234567890", vendorName: "SENTETİK A.Ş." },
};

const LINE = {
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
};

const RESOLUTION_ROW = {
  id: "res-1",
  state: "matched",
  source: "matched_tax_id",
  provider_id: "prov-1",
  matched_tax_id_normalized: "TR:1234567890",
  matched_tax_id_printed: "1234567890",
  tax_id_scheme: "TR_VKN",
  reason:
    "Matched on VKN 1234567890 — exactly one provider on file carries it (SENTETİK ŞARAP DAĞITIM A.Ş.).",
  document_revision: 1,
  resolved_at: "2026-09-11T10:00:00.000Z",
};

describe("the resolved vendor on the canonical document (ADR 0104 D15)", () => {
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
      "is",
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

  const client = { from: jest.fn((t: string) => makeChain(t)) };

  const build = async () => {
    const res = await canonical.buildFromDocumentId("rest-1", "doc-1");
    if (!res.ok) throw new Error(`build failed: ${res.error}`);
    return res.value;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    answers = {
      procurement_documents: { data: DOC_ROW, error: null },
      procurement_document_lines: { data: [LINE], error: null },
      procurement_order_items: { data: [], error: null },
      restaurants: {
        data: { id: "rest-1", name: "SYNTHETIC Meyhane" },
        error: null,
      },
      providers: {
        data: {
          id: "prov-1",
          name: "SYNTHETIC Dağıtım",
          company_name: "SENTETİK ŞARAP DAĞITIM A.Ş.",
          tax_id: "1234567890",
          tax_id_normalized: "TR:1234567890",
          provisional_until_first_order: false,
        },
        error: null,
      },
      users: { data: [], error: null },
      document_revisions: { data: [], error: null },
      document_corrections: { data: [], error: null },
      document_line_mappings: { data: [], error: null },
      document_vendor_resolutions: { data: [RESOLUTION_ROW], error: null },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanonicalDocumentService,
        LineMappingService,
        VendorResolutionService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    canonical = module.get(CanonicalDocumentService);
  });

  describe("BT-31 — the seller's VAT identifier", () => {
    it("carries the RESOLVED provider's identity, as our record, with no as_printed", async () => {
      const doc = await build();
      const vat = doc.layer1.seller.vatIdentifier;
      expect(vat.value).toBe("1234567890");
      expect(vat.source).toBe("human_entered");
      // It was never printed as this value BY US; borrowing the page's glyphs
      // for a record-sourced value is the masquerade D1 names.
      expect(vat.as_printed ?? null).toBeNull();
    });

    it("falls back to what the PAGE printed when no provider resolved, keeping its glyphs", async () => {
      answers.procurement_documents = {
        data: { ...DOC_ROW, provider_id: null },
        error: null,
      };
      const doc = await build();
      const vat = doc.layer1.seller.vatIdentifier;
      expect(vat.value).toBe("VKN 1234567890");
      expect(vat.as_printed).toBe("VKN 1234567890");
    });

    it("stays NULL when the page printed none and none is on file", async () => {
      answers.procurement_documents = {
        data: { ...DOC_ROW, provider_id: null, extracted: {} },
        error: null,
      };
      const doc = await build();
      expect(doc.layer1.seller.vatIdentifier.value).toBeNull();
    });
  });

  describe("layer 2 carries how the vendor was resolved", () => {
    it("a match, with the sentence and what it matched on", async () => {
      const doc = await build();
      const r = doc.layer2.vendorResolution!;
      expect(r.state).toBe("matched");
      expect(r.matchedOn).toBe("1234567890");
      expect(r.scheme).toBe("TR_VKN");
      expect(r.providerName).toBe("SENTETİK ŞARAP DAĞITIM A.Ş.");
      expect(r.reason).toContain("VKN 1234567890");
      expect(r.provisional).toBe(false);
    });

    it("a vendor BORN from this document says so", async () => {
      answers.document_vendor_resolutions = {
        data: [
          {
            ...RESOLUTION_ROW,
            state: "created",
            source: "created_from_document",
            reason:
              "Created from this document's printed identity — SENTETİK ŞARAP DAĞITIM A.Ş., VKN 1234567890.",
          },
        ],
        error: null,
      };
      answers.providers = {
        data: {
          id: "prov-1",
          name: "SENTETİK ŞARAP DAĞITIM A.Ş.",
          company_name: "SENTETİK ŞARAP DAĞITIM A.Ş.",
          tax_id: "1234567890",
          provisional_until_first_order: true,
        },
        error: null,
      };
      const r = (await build()).layer2.vendorResolution!;
      expect(r.state).toBe("created");
      expect(r.provisional).toBe(true);
    });

    it("a refusal renders as `unresolved` WITH the reason, never as a blank", async () => {
      answers.procurement_documents = {
        data: { ...DOC_ROW, provider_id: null },
        error: null,
      };
      answers.document_vendor_resolutions = {
        data: [
          {
            ...RESOLUTION_ROW,
            state: "unresolved",
            source: null,
            provider_id: null,
            matched_tax_id_printed: null,
            tax_id_scheme: null,
            reason:
              "This document names no vendor identity we can verify: no tax identity is printed on this document.",
          },
        ],
        error: null,
      };
      const r = (await build()).layer2.vendorResolution!;
      expect(r.state).toBe("unresolved");
      expect(r.reason).toMatch(/no vendor identity we can verify/);
      expect(r.providerName).toBeNull();
    });

    it("a document nobody ever resolved reads as null — not as a refusal", async () => {
      answers.document_vendor_resolutions = { data: [], error: null };
      expect((await build()).layer2.vendorResolution).toBeNull();
    });

    it("a FAILED read of the log is `unavailable`, never a blank line", async () => {
      answers.document_vendor_resolutions = {
        data: null,
        error: { message: "relation does not exist" },
      };
      const r = (await build()).layer2.vendorResolution!;
      expect(r.state).toBe("unavailable");
      expect(r.reason).toContain("relation does not exist");
      // And it does NOT take the sheet down with it.
      expect((await build()).layer1.seller.name.value).toBe(
        "SENTETİK ŞARAP DAĞITIM A.Ş.",
      );
    });
  });
});
