import { Test, TestingModule } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { VendorResolutionService } from "./vendor-resolution.service";

/**
 * ADR 0104 D15 — the resolver. All ids, names and numbers are SYNTHETIC.
 *
 * The adversarial pass this file encodes, in the order the rules matter:
 *
 *   1. EXACTLY ONE, OR NOTHING. Two providers sharing an identity is a refusal
 *      with a sentence, never "take the first".
 *   2. A CREATED PROVIDER CARRIES ONLY WHAT THE PAPER PRINTED, is flagged
 *      provisional, and points back at the document it was born from.
 *   3. THE SECOND DOCUMENT REUSES THE FIRST'S ROW — including when the two race
 *      (23505 → re-read → matched), so one vendor never becomes two.
 *   4. A SELF-BILLED DOCUMENT CREATES NOTHING. Three independent catches:
 *      direction, type code 389, and the seller id equalling the buyer's or the
 *      venue's own.
 *   5. A FAILED READ IS `unavailable`, NEVER `unresolved`. This is the whole
 *      absence-reported-as-health rule and it is asserted on both reads.
 *   6. NOTHING IS OVERWRITTEN. A document that already names a vendor keeps it;
 *      the disagreement is recorded instead.
 *   7. EVERY RUN APPENDS A ROW — refusals as loudly as matches.
 */

interface Answer {
  data: unknown;
  error: { message: string; code?: string } | null;
}

const RESTAURANT = "11111111-1111-1111-1111-111111111111";
const DOCUMENT = "dddddddd-0000-0000-0000-000000000001";
/** A real, checksum-valid VKN (synthetic vendor). */
const VKN = "1234567890";

describe("VendorResolutionService (ADR 0104 D15)", () => {
  let service: VendorResolutionService;
  let answers: Record<string, Answer | Answer[]>;
  let calls: Record<string, number>;
  let inserts: { table: string; payload: Record<string, unknown> }[];
  let updates: { table: string; payload: Record<string, unknown> }[];
  let filters: { table: string; column: string; value: unknown }[];

  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    const answerFor = (): Answer => {
      const a = answers[table];
      if (Array.isArray(a)) {
        const n = calls[table] ?? 0;
        calls[table] = n + 1;
        return a[Math.min(n, a.length - 1)] ?? { data: null, error: null };
      }
      return a ?? { data: null, error: null };
    };
    for (const verb of [
      "select",
      "eq",
      "neq",
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
      chain[verb] = jest.fn((...args: unknown[]) => {
        if (verb === "eq")
          filters.push({ table, column: args[0] as string, value: args[1] });
        if (verb === "insert")
          inserts.push({ table, payload: args[0] as Record<string, unknown> });
        if (verb === "update") {
          updates.push({ table, payload: args[0] as Record<string, unknown> });
          // An UPDATE resolves on its own, without .single().
          return {
            ...self(),
            then: (r: (v: unknown) => unknown) =>
              Promise.resolve({ data: null, error: answerFor().error }).then(r),
          };
        }
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

  const resolve = (over: Record<string, unknown> = {}) =>
    service.resolveVendor({
      restaurantId: RESTAURANT,
      documentId: DOCUMENT,
      jurisdiction: "TR",
      seller: {
        name: "SENTETİK ŞARAP DAĞITIM A.Ş.",
        taxId: VKN,
        taxOffice: "Kadıköy V.D.",
        address: "SYNTHETIC Caddesi 1, İstanbul",
        country: "TR",
      },
      ...over,
    } as Parameters<VendorResolutionService["resolveVendor"]>[0]);

  const resolutionRows = () =>
    inserts.filter((i) => i.table === "document_vendor_resolutions");

  beforeEach(async () => {
    jest.clearAllMocks();
    answers = {};
    calls = {};
    inserts = [];
    updates = [];
    filters = [];
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VendorResolutionService,
        { provide: DatabaseService, useValue: { getClient: () => client } },
      ],
    }).compile();
    service = module.get(VendorResolutionService);
  });

  // -------------------------------------------------------------------------
  describe("rule 1 — exactly one provider carries the identity", () => {
    it("matches, names the scheme and the value, and writes nothing new", async () => {
      answers.providers = {
        data: [
          {
            id: "prov-A",
            name: "Sentetik",
            company_name: "SENTETİK ŞARAP DAĞITIM A.Ş.",
          },
        ],
        error: null,
      };
      const r = await resolve();
      expect(r.state).toBe("matched");
      expect(r.providerId).toBe("prov-A");
      expect(r.source).toBe("matched_tax_id");
      expect(r.reason).toContain("VKN 1234567890");
      expect(inserts.filter((i) => i.table === "providers")).toHaveLength(0);
    });

    it("scopes the match to THIS restaurant and to the normalised value", async () => {
      answers.providers = { data: [{ id: "prov-A" }], error: null };
      await resolve();
      const f = filters.filter((x) => x.table === "providers");
      expect(f).toContainEqual({
        table: "providers",
        column: "restaurant_id",
        value: RESTAURANT,
      });
      expect(f).toContainEqual({
        table: "providers",
        column: "tax_id_normalized",
        value: "TR:1234567890",
      });
    });

    it("REFUSES when two providers share one identity — never takes the first", async () => {
      answers.providers = {
        data: [{ id: "prov-A" }, { id: "prov-B" }],
        error: null,
      };
      const r = await resolve();
      expect(r.state).toBe("unresolved");
      expect(r.providerId).toBeNull();
      expect(r.reason).toMatch(/2 providers on file carry the tax identity/);
    });
  });

  // -------------------------------------------------------------------------
  describe("rule 2 — create the provider from the printed identity", () => {
    it("creates it, provisional, pointing at the document it was born from", async () => {
      answers.providers = [
        { data: [], error: null },
        { data: { id: "prov-new" }, error: null },
      ];
      const r = await resolve();
      expect(r.state).toBe("created");
      expect(r.providerId).toBe("prov-new");
      expect(r.source).toBe("created_from_document");
      const p = inserts.find((i) => i.table === "providers")!.payload;
      expect(p).toMatchObject({
        name: "SENTETİK ŞARAP DAĞITIM A.Ş.",
        restaurant_id: RESTAURANT,
        tax_id: VKN,
        tax_id_normalized: "TR:1234567890",
        tax_country: "TR",
        tax_office: "Kadıköy V.D.",
        provisional_until_first_order: true,
        created_from_document_id: DOCUMENT,
      });
    });

    it("refuses to create a vendor it cannot NAME", async () => {
      answers.providers = { data: [], error: null };
      const r = await resolve({
        seller: { name: null, taxId: VKN, country: "TR" },
      });
      expect(r.state).toBe("unresolved");
      expect(r.reason).toMatch(/no seller name/);
      expect(inserts.filter((i) => i.table === "providers")).toHaveLength(0);
    });

    it("loses the race safely: 23505 then a re-read, ONE provider not two", async () => {
      answers.providers = [
        { data: [], error: null },
        { data: null, error: { message: "duplicate key", code: "23505" } },
        { data: [{ id: "prov-peer" }], error: null },
      ];
      const r = await resolve();
      expect(r.state).toBe("matched");
      expect(r.providerId).toBe("prov-peer");
      expect(r.reason).toMatch(/arriving at the same moment/);
    });

    it("says `unavailable` — not `unresolved` — when the create itself fails", async () => {
      answers.providers = [
        { data: [], error: null },
        { data: null, error: { message: "connection reset" } },
      ];
      const r = await resolve();
      expect(r.state).toBe("unavailable");
      expect(r.reason).toContain("connection reset");
    });
  });

  // -------------------------------------------------------------------------
  describe("rule 3 — anything weaker stays unresolved and says so", () => {
    it("no tax id printed", async () => {
      const r = await resolve({
        seller: { name: "SYNTHETIC Vendor", taxId: null, country: "TR" },
      });
      expect(r.state).toBe("unresolved");
      expect(r.reason).toMatch(/no vendor identity we can verify/);
      expect(r.reason).toMatch(/no tax identity is printed/);
    });

    it("a malformed tax id — the check digit refuses it", async () => {
      const r = await resolve({
        seller: { name: "SYNTHETIC Vendor", taxId: "1234567891", country: "TR" },
      });
      expect(r.state).toBe("unresolved");
      expect(r.reason).toMatch(/check digit/);
      expect(inserts.filter((i) => i.table === "providers")).toHaveLength(0);
    });

    it("never falls back on the name — a providers read is not even attempted", async () => {
      await resolve({
        seller: { name: "SENTETİK ŞARAP DAĞITIM A.Ş.", taxId: null },
      });
      expect(filters.filter((f) => f.table === "providers")).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe("a self-billed or returned document creates nothing", () => {
    it("catches it by direction", async () => {
      const r = await resolve({ direction: "issued_by_us" });
      expect(r.state).toBe("unresolved");
      expect(r.reason).toMatch(/issued by us/);
      expect(inserts.filter((i) => i.table === "providers")).toHaveLength(0);
    });

    it("catches it by the UNCL1001 type code 389", async () => {
      const r = await resolve({ typeCode: "389" });
      expect(r.state).toBe("unresolved");
      expect(r.reason).toMatch(/self-billed/);
    });

    it("catches it when the seller id equals the buyer id", async () => {
      const r = await resolve({ buyerTaxId: `VKN: ${VKN}` });
      expect(r.state).toBe("unresolved");
      expect(r.reason).toMatch(/same tax identity/);
      expect(inserts.filter((i) => i.table === "providers")).toHaveLength(0);
    });

    it("catches it when the seller id is the VENUE's own recorded identity", async () => {
      answers.restaurants = {
        data: { id: RESTAURANT, tax_id_normalized: "TR:1234567890" },
        error: null,
      };
      const r = await resolve();
      expect(r.state).toBe("unresolved");
      expect(r.reason).toMatch(/this restaurant's own tax identity/);
    });
  });

  // -------------------------------------------------------------------------
  describe("a failed read is `unavailable`, never `unresolved`", () => {
    it("the providers read", async () => {
      answers.providers = {
        data: null,
        error: { message: "relation does not exist" },
      };
      const r = await resolve();
      expect(r.state).toBe("unavailable");
      expect(r.reason).toContain("relation does not exist");
      expect(r.providerId).toBeNull();
    });

    it("the venue's own-identity read", async () => {
      answers.restaurants = { data: null, error: { message: "timeout" } };
      const r = await resolve();
      expect(r.state).toBe("unavailable");
      expect(r.reason).toMatch(/could not be checked for being self-billed/);
    });
  });

  // -------------------------------------------------------------------------
  describe("nothing is overwritten", () => {
    it("a document already filed under another vendor keeps it", async () => {
      answers.providers = {
        data: [{ id: "prov-A", company_name: "SENTETİK" }],
        error: null,
      };
      const r = await resolve({ existingProviderId: "prov-OTHER" });
      expect(r.state).toBe("unresolved");
      expect(r.reason).toMatch(/already filed under a different vendor/);
    });

    it("applyToDocument writes only where provider_id IS NULL", async () => {
      await service.applyToDocument(RESTAURANT, DOCUMENT, {
        state: "matched",
        providerId: "prov-A",
        source: "matched_tax_id",
        identity: null,
        reason: "x",
      });
      const u = updates.find((x) => x.table === "procurement_documents");
      expect(u?.payload).toEqual({ provider_id: "prov-A" });
      const chain = client.from.mock.results.at(-1)?.value as Record<
        string,
        jest.Mock
      >;
      expect(chain.is).toHaveBeenCalledWith("provider_id", null);
    });

    it("applyToDocument writes NOTHING on a refusal", async () => {
      await service.applyToDocument(RESTAURANT, DOCUMENT, {
        state: "unresolved",
        providerId: null,
        source: null,
        identity: null,
        reason: "x",
      });
      expect(updates).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // proposal-receipt §3, Phase 1A row 1.4. Stamping the vendor can make this
  // paper the second live one with the same number; the index refuses it, and
  // that refusal becomes a `duplicate` verdict naming the earlier paper.
  describe("the stamp collides with an earlier paper's number", () => {
    const EARLIER = "dddddddd-0000-0000-0000-0000000000e1";
    const MATCHED = {
      state: "matched" as const,
      providerId: "prov-A",
      source: "matched_tax_id" as const,
      identity: null,
      reason: "x",
    };
    const numberCollision = {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "uq_pd_restaurant_provider_type_number"',
      },
    };
    const docUpdates = () =>
      updates.filter((u) => u.table === "procurement_documents");

    it("writes a duplicate verdict naming the earlier paper, and no vendor", async () => {
      answers.procurement_documents = [
        numberCollision,
        { data: { doc_type: "invoice", doc_number: "SYN-0042" }, error: null },
        { data: [{ id: EARLIER, doc_number: "SYN-0042" }], error: null },
        { data: null, error: null },
      ];
      const out = await service.applyToDocument(RESTAURANT, DOCUMENT, MATCHED);
      expect(out).toEqual({
        kind: "duplicate",
        earlier: { documentId: EARLIER, docNumber: "SYN-0042" },
        reason: expect.stringContaining(EARLIER),
      });
      const u = docUpdates();
      expect(u).toHaveLength(2);
      expect(u[0].payload).toEqual({ provider_id: "prov-A" });
      expect(u[1].payload).not.toHaveProperty("provider_id");
      expect(u[1].payload.intake_verdict).toBe("duplicate");
      expect(u[1].payload.intake_reason).toContain("SYN-0042");
      expect(u[1].payload.intake_reason).toContain(EARLIER);
      // The earlier paper is looked up in this house, under the stamped
      // vendor, by this paper's own type and number.
      const pd = filters.filter((f) => f.table === "procurement_documents");
      expect(pd).toEqual(
        expect.arrayContaining([
          {
            table: "procurement_documents",
            column: "provider_id",
            value: "prov-A",
          },
          {
            table: "procurement_documents",
            column: "doc_type",
            value: "invoice",
          },
          {
            table: "procurement_documents",
            column: "doc_number",
            value: "SYN-0042",
          },
        ]),
      );
      expect(
        pd
          .filter((f) => f.column === "restaurant_id")
          .every((f) => f.value === RESTAURANT),
      ).toBe(true);
    });

    it("a failed look-up returns a sentence and writes no verdict", async () => {
      answers.procurement_documents = [
        numberCollision,
        { data: { doc_type: "invoice", doc_number: "SYN-0042" }, error: null },
        { data: null, error: { message: "boom" } },
      ];
      const out = await service.applyToDocument(RESTAURANT, DOCUMENT, MATCHED);
      expect(out.kind).toBe("failed");
      expect(out.kind === "failed" && out.error).toMatch(
        /earlier paper could not be read: boom/,
      );
      expect(docUpdates()).toHaveLength(1);
    });

    it("an earlier paper that is not there on the second read is not success", async () => {
      answers.procurement_documents = [
        numberCollision,
        { data: { doc_type: "invoice", doc_number: "SYN-0042" }, error: null },
        { data: [], error: null },
      ];
      const out = await service.applyToDocument(RESTAURANT, DOCUMENT, MATCHED);
      expect(out.kind === "failed" && out.error).toMatch(/not found/);
      expect(docUpdates()).toHaveLength(1);
    });

    it("a failed verdict write returns a sentence, never success", async () => {
      answers.procurement_documents = [
        numberCollision,
        { data: { doc_type: "invoice", doc_number: "SYN-0042" }, error: null },
        { data: [{ id: EARLIER, doc_number: "SYN-0042" }], error: null },
        { data: null, error: { message: "denied" } },
      ];
      const out = await service.applyToDocument(RESTAURANT, DOCUMENT, MATCHED);
      // Still a duplicate — the earlier paper is known — and it says the
      // record of it did not land, never success.
      expect(out.kind).toBe("duplicate");
      expect(out.kind === "duplicate" && out.earlier.documentId).toBe(EARLIER);
      expect(out.kind === "duplicate" && out.recordError).toMatch(
        /was not written on it: denied/,
      );
    });

    // QA round 3 item 3: a page verdict already on the paper is the stronger
    // fact and stays; the duplicate sentence is added to its reason.
    it.each(["blank_page", "low_resolution", "unreadable", "bundle"])(
      "keeps an earlier %s verdict and adds the duplicate to its reason",
      async (prior) => {
        answers.procurement_documents = [
          numberCollision,
          {
            data: {
              doc_type: "invoice",
              doc_number: "SYN-0042",
              intake_verdict: prior,
              intake_reason: "page 2 of 3 is blank.",
            },
            error: null,
          },
          { data: [{ id: EARLIER, doc_number: "SYN-0042" }], error: null },
          { data: null, error: null },
        ];
        const out = await service.applyToDocument(
          RESTAURANT,
          DOCUMENT,
          MATCHED,
        );
        expect(out.kind === "duplicate" && out.keptVerdict).toBe(prior);
        const u = docUpdates();
        expect(u).toHaveLength(2);
        expect(u[1].payload).not.toHaveProperty("intake_verdict");
        expect(u[1].payload).not.toHaveProperty("provider_id");
        expect(u[1].payload.intake_reason).toMatch(
          /^page 2 of 3 is blank\. Also, this vendor's paper no\. SYN-0042/,
        );
        expect(u[1].payload.intake_reason).toContain(EARLIER);
      },
    );

    it.each([null, "ok", "duplicate"])(
      "replaces a %s verdict with duplicate",
      async (prior) => {
        answers.procurement_documents = [
          numberCollision,
          {
            data: {
              doc_type: "invoice",
              doc_number: "SYN-0042",
              intake_verdict: prior,
              intake_reason: prior ? "old" : null,
            },
            error: null,
          },
          { data: [{ id: EARLIER, doc_number: "SYN-0042" }], error: null },
          { data: null, error: null },
        ];
        const out = await service.applyToDocument(
          RESTAURANT,
          DOCUMENT,
          MATCHED,
        );
        expect(out.kind === "duplicate" && out.keptVerdict).toBeUndefined();
        const u = docUpdates();
        expect(u[1].payload.intake_verdict).toBe("duplicate");
        expect(u[1].payload.intake_reason).not.toContain("old");
      },
    );

    it("a 23505 on any other constraint keeps returning the raw text", async () => {
      const other =
        'duplicate key value violates unique constraint "uq_pd_restaurant_provider_type_number_v2"';
      answers.procurement_documents = [
        { data: null, error: { code: "23505", message: other } },
      ];
      const out = await service.applyToDocument(RESTAURANT, DOCUMENT, MATCHED);
      expect(out).toEqual({ kind: "failed", error: other });
      expect(docUpdates()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("every run appends a row", () => {
    it("a match", async () => {
      answers.providers = { data: [{ id: "prov-A" }], error: null };
      await resolve();
      expect(resolutionRows()[0].payload).toMatchObject({
        document_id: DOCUMENT,
        restaurant_id: RESTAURANT,
        state: "matched",
        source: "matched_tax_id",
        provider_id: "prov-A",
        matched_tax_id_normalized: "TR:1234567890",
        tax_id_scheme: "TR_VKN",
      });
    });

    it("a refusal, just as loudly, carrying the reason", async () => {
      const r = await resolve({ seller: { name: "X", taxId: null } });
      const row = resolutionRows()[0].payload;
      expect(row).toMatchObject({ state: "unresolved", provider_id: null });
      expect(row.reason).toBe(r.reason);
    });

    it("an unavailable — so 'we could not look' is on the record too", async () => {
      answers.providers = { data: null, error: { message: "boom" } };
      await resolve();
      expect(resolutionRows()[0].payload).toMatchObject({
        state: "unavailable",
        provider_id: null,
      });
    });

    it("names the loss when the LOG itself will not take the row", async () => {
      answers.providers = { data: [{ id: "prov-A" }], error: null };
      answers.document_vendor_resolutions = {
        data: null,
        error: { message: "no such table" },
      };
      const r = await resolve();
      // The decision still stands — it is not discarded because the log broke.
      expect(r.state).toBe("matched");
      expect(r.logError).toContain("no such table");
    });
  });

  // -------------------------------------------------------------------------
  describe("latestFor", () => {
    it("returns the newest row", async () => {
      answers.document_vendor_resolutions = {
        data: [{ id: "res-2", state: "matched", reason: "r" }],
        error: null,
      };
      const r = await service.latestFor(RESTAURANT, DOCUMENT);
      expect(r.ok && r.value?.id).toBe("res-2");
    });

    it("a failed read is a failure, NEVER 'this document was never resolved'", async () => {
      answers.document_vendor_resolutions = {
        data: null,
        error: { message: "permission denied" },
      };
      const r = await service.latestFor(RESTAURANT, DOCUMENT);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toContain("permission denied");
    });
  });
});
