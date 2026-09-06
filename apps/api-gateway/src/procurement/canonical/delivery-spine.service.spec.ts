import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { DeliverySpineService } from "./delivery-spine.service";

/**
 * The delivery spine, on mocked supabase. Every id, number and name is SYNTHETIC.
 *
 * The three shapes ADR 0103 A2 says must all work, and the one ADR 0067 says
 * must not: a document on TWO deliveries, a delivery with THREE documents, a
 * document on NO delivery (a real, empty answer — the page collapses to the
 * sheet), and a read that FAILED (never an empty spine).
 */

type Answer = { data: unknown; error: { message: string } | null };

describe("DeliverySpineService", () => {
  let service: DeliverySpineService;
  let answers: Record<string, Answer>;
  let currentTable = "";

  const chain = () => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const verb of ["select", "eq", "in", "order", "limit"])
      c[verb] = jest.fn(self);
    (c as { then: unknown }).then = (resolve: (v: unknown) => unknown) => {
      const a = answers[currentTable] ?? { data: [], error: null };
      return Promise.resolve({
        data: a.error ? null : a.data,
        error: a.error,
      }).then(resolve);
    };
    return c;
  };

  const client = {
    from: jest.fn((table: string) => {
      currentTable = table;
      return chain();
    }),
  };

  const delivery = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    state: "RECONCILING",
    provenance: "ORDERED",
    delivered_at: "2026-08-12T07:41:00Z",
    agreed_at: null,
    verified_at: null,
    jurisdiction: "TR",
    provider_id: "prov-syn",
    restaurant_id: "rest-syn",
    ...extra,
  });

  const doc = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    doc_type: "invoice",
    doc_number: `SYN-${id}`,
    doc_date: "2026-08-14",
    status: "needs_review",
    total: "170.40",
    currency: "TRY",
    created_at: "2026-08-14T09:12:00Z",
    ...extra,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    answers = {};
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliverySpineService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    service = module.get(DeliverySpineService);
  });

  it("returns both deliveries when one document sits on two (ADR 0103 A2)", async () => {
    // A consolidated weekly invoice: one document, two truckloads.
    answers.document_deliveries = {
      data: [
        { document_id: "doc-inv", delivery_id: "dl-1", role: "invoice" },
        { document_id: "doc-inv", delivery_id: "dl-2", role: "invoice" },
      ],
      error: null,
    };
    answers.deliveries = {
      data: [delivery("dl-1"), delivery("dl-2", { state: "DELIVERED" })],
      error: null,
    };
    answers.procurement_documents = { data: [doc("doc-inv")], error: null };

    const res = await service.forDocument("rest-syn", "doc-inv");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.map((d) => d.deliveryId)).toEqual(["dl-1", "dl-2"]);
    expect(res.value[0].selectedRole).toBe("invoice");
    expect(res.value[0].documents[0].isSelected).toBe(true);
  });

  it("orders a three-document delivery oldest first, and marks the selected one", async () => {
    answers.document_deliveries = {
      data: [
        { document_id: "doc-po", delivery_id: "dl-1", role: "purchase_order" },
        {
          document_id: "doc-irs",
          delivery_id: "dl-1",
          role: "despatch_advice",
        },
        { document_id: "doc-inv", delivery_id: "dl-1", role: "invoice" },
      ],
      error: null,
    };
    answers.deliveries = { data: [delivery("dl-1")], error: null };
    answers.procurement_documents = {
      data: [
        doc("doc-inv", { doc_date: "2026-08-14" }),
        doc("doc-po", { doc_type: "purchase_order", doc_date: "2026-08-05" }),
        doc("doc-irs", { doc_type: "delivery_note", doc_date: "2026-08-12" }),
      ],
      error: null,
    };

    const res = await service.forDocument("rest-syn", "doc-inv");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const spine = res.value[0];
    expect(spine.documents.map((d) => d.documentId)).toEqual([
      "doc-po",
      "doc-irs",
      "doc-inv",
    ]);
    expect(spine.documents.filter((d) => d.isSelected)).toHaveLength(1);
    // PostgREST numerics arrive as strings; the spine coerces them.
    expect(spine.documents[2].total).toBe(170.4);
  });

  it("returns an EMPTY spine — a real answer — for a document on no delivery", async () => {
    answers.document_deliveries = { data: [], error: null };
    const res = await service.forDocument("rest-syn", "doc-orphan");
    expect(res).toEqual({ ok: true, value: [] });
  });

  it("keeps an UNORDERED delivery's permanent mark", async () => {
    answers.document_deliveries = {
      data: [{ document_id: "doc-inv", delivery_id: "dl-9", role: "invoice" }],
      error: null,
    };
    answers.deliveries = {
      data: [delivery("dl-9", { provenance: "UNORDERED" })],
      error: null,
    };
    answers.procurement_documents = { data: [doc("doc-inv")], error: null };

    const res = await service.forDocument("rest-syn", "doc-inv");
    expect(res.ok && res.value[0].provenance).toBe("UNORDERED");
  });

  it("names a document whose row did not come back rather than shortening the spine", async () => {
    answers.document_deliveries = {
      data: [
        { document_id: "doc-inv", delivery_id: "dl-1", role: "invoice" },
        { document_id: "doc-gone", delivery_id: "dl-1", role: "door_count" },
      ],
      error: null,
    };
    answers.deliveries = { data: [delivery("dl-1")], error: null };
    answers.procurement_documents = { data: [doc("doc-inv")], error: null };

    const res = await service.forDocument("rest-syn", "doc-inv");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Two cards, not one. A spine that quietly drops a member under-reports the
    // event, which is the whole thing the event is the record of.
    expect(res.value[0].documents).toHaveLength(2);
    const missing = res.value[0].documents.find(
      (d) => d.documentId === "doc-gone",
    );
    expect(missing?.docNumber).toBeNull();
    expect(missing?.role).toBe("door_count");
  });

  it("fails the read instead of reporting an empty spine (ADR 0067)", async () => {
    answers.document_deliveries = {
      data: null,
      error: { message: "connection reset" },
    };
    const res = await service.forDocument("rest-syn", "doc-inv");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("connection reset");
  });

  it("fails when the deliveries read breaks, not when it is merely empty", async () => {
    answers.document_deliveries = {
      data: [{ document_id: "doc-inv", delivery_id: "dl-1", role: "invoice" }],
      error: null,
    };
    answers.deliveries = {
      data: null,
      error: { message: "statement timeout" },
    };
    const res = await service.forDocument("rest-syn", "doc-inv");
    expect(res.ok).toBe(false);
  });

  it("byId returns null only after a successful read", async () => {
    answers.deliveries = { data: [], error: null };
    const res = await service.byId("rest-syn", "dl-missing");
    expect(res).toEqual({ ok: true, value: null });

    answers.deliveries = { data: null, error: { message: "boom" } };
    const failed = await service.byId("rest-syn", "dl-1");
    expect(failed.ok).toBe(false);
  });
});
