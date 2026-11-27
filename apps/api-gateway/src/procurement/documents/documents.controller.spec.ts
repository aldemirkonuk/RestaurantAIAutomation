import { HttpException } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";

describe("DocumentsController.detail — signed image URL (decision E48)", () => {
  let controller: DocumentsController;

  const mockMaybeSingle = jest.fn();
  const mockOrder = jest.fn();
  const mockCreateSignedUrl = jest.fn();

  const mockChain: any = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: mockOrder,
    not: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: mockMaybeSingle,
    storage: {
      from: jest.fn().mockReturnValue({ createSignedUrl: mockCreateSignedUrl }),
    },
  };

  const mockDb = { getClient: jest.fn(() => mockChain) };
  const mockIntake = {};

  const user = { userId: "u1", restaurantId: "rest-1" };

  beforeEach(() => {
    jest.clearAllMocks();
    mockChain.from.mockReturnThis();
    mockChain.select.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.storage.from.mockReturnValue({
      createSignedUrl: mockCreateSignedUrl,
    });
    mockOrder.mockResolvedValue({ data: [] });

    // Constructed directly rather than through Nest's DI container — the
    // class carries @UseGuards(JwtAuthGuard), and instantiating that guard's
    // own dependency chain (TokenBlacklistService, etc.) is unrelated to what
    // this test verifies.
    /**
     * ONE STUB PER CONSTRUCTOR DEPENDENCY, and the count is load-bearing.
     * `tsc -p tsconfig.spec.json` is what catches a missing one — `tsconfig.json`
     * excludes specs, so a branch that only typechecks the app compiles clean
     * while this file is one argument short. That is exactly how this file went
     * red on CI after the controller gained the correction door.
     */
    controller = new DocumentsController(
      mockIntake as any,
      mockDb as any,
      {} as any, // CanonicalDocumentService — unused by the routes under test
      {} as any, // DeliverySpineService
      {} as any, // DocumentCorrectionService (ADR 0104 D5)
      // CatalogIngestService (ADR 0126). Only an 832 upload reaches it, and no
      // test in this file uploads one.
      {} as any,
      // OrganizationsService — only the currency restatement reaches it, and
      // the block below builds its own controller with a real double.
      {} as any,
      {} as any, // DeliveryService (ADR 0103 — the door-count route's other half)
      {} as any, // DeliveryStockService (ADR 0103 A1 — the door's booking half)
      {} as any, // LineMappingService (ADR 0104 D12 slice 4 — the mapping memory)
      // SealChallengeService — the seal on verify / line_edit /
      // currency_restate (founder, 2026-09-06, batch 64). Stubbed here; the
      // redemption itself is proven in `documents.seal.spec.ts` against a
      // real double. `tsc -p tsconfig.spec.json` counts the arguments.
      {} as any,
    );
  });

  it("throws 404 when the document does not exist", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(controller.detail("missing", user)).rejects.toThrow(
      HttpException,
    );
  });

  it("signs the storage_path and attaches imageUrl when present", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "doc-1", storage_path: "rest-1/documents/abc/invoice.pdf" },
      error: null,
    });
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://signed.example/invoice.pdf" },
      error: null,
    });

    const result = await controller.detail("doc-1", user);

    expect(mockChain.storage.from).toHaveBeenCalledWith("vendor-attachments");
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      "rest-1/documents/abc/invoice.pdf",
      3600,
    );
    expect((result.document as any).imageUrl).toBe(
      "https://signed.example/invoice.pdf",
    );
  });

  it("returns imageUrl null without throwing when storage_path is absent (e.g. EDI)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "doc-2", storage_path: null },
      error: null,
    });

    const result = await controller.detail("doc-2", user);

    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    expect((result.document as any).imageUrl).toBeNull();
  });

  it("a reload still says what rate the paper was filed at", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "doc-4", storage_path: null, currency: "USD" }, error: null });
    mockOrder
      .mockResolvedValueOnce({ data: [] }) // the lines
      .mockResolvedValueOnce({
        data: [{ paper_currency: "EUR", new_currency: "USD", exchange_rate: "1.08400000", rate_date: "2026-11-20" }],
        error: null,
      });
    const result = await controller.detail("doc-4", user);
    expect((result.document as any).filedAt).toMatchObject({
      from: "EUR",
      to: "USD",
      rate: 1.084,
      sentence: "filed at 1 EUR = 1.0840 USD on 20 Nov",
    });
  });

  it("a rate row followed by a relabel into another money says nothing was filed at a rate (r105)", async () => {
    // The newest restatement is the relabel (no rate), so the paper is not "costed at"
    // anything: the older conversion was into a money the paper no longer sits in.
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "doc-6", storage_path: null, currency: "EUR" }, error: null });
    mockOrder
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{ paper_currency: null, new_currency: "EUR", exchange_rate: null, rate_date: null }],
        error: null,
      });
    const result: any = await controller.detail("doc-6", user);
    expect(result.document.filedAt).toBeNull();
  });

  it("a rate row into a money the paper is no longer filed in says nothing (r105)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "doc-7", storage_path: null, currency: "EUR" }, error: null });
    mockOrder
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({
        data: [{ paper_currency: "TRY", new_currency: "USD", exchange_rate: "0.03", rate_date: "2026-11-19" }],
        error: null,
      });
    const result: any = await controller.detail("doc-7", user);
    expect(result.document.filedAt).toBeNull();
  });

  it("a paper never converted has no filedAt, and a failed read says it failed", async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: "doc-5", storage_path: null }, error: null });
    mockOrder
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result: any = await controller.detail("doc-5", user);
    expect(result.document.filedAt).toBeNull();
    expect(result.document.filedAtReason).toContain("could not be read");
  });

  it("returns imageUrl null (never throws) when signing fails", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "doc-3", storage_path: "rest-1/documents/xyz/receipt.jpg" },
      error: null,
    });
    mockCreateSignedUrl.mockRejectedValueOnce(new Error("bucket unavailable"));

    const result = await controller.detail("doc-3", user);

    expect((result.document as any).imageUrl).toBeNull();
  });

  it("starts signing while the lines read is still in flight (one wave, not two)", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "doc-4", storage_path: "rest-1/documents/w/wave.pdf" },
      error: null,
    });
    let releaseLines!: (v: unknown) => void;
    mockOrder.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseLines = resolve;
      }),
    );
    mockCreateSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://signed.example/wave.pdf" },
      error: null,
    });

    const pending = controller.detail("doc-4", user);
    // Let the document read settle; the lines read is still held open.
    await new Promise((r) => setImmediate(r));
    expect(mockCreateSignedUrl).toHaveBeenCalledTimes(1);

    releaseLines({ data: [{ id: "l1" }] });
    const result = await pending;
    expect((result.document as any).imageUrl).toBe(
      "https://signed.example/wave.pdf",
    );
    expect(result.lines).toEqual([{ id: "l1" }]);
  });
});

/**
 * RULE 3 — the house deliberately restates an invoice's currency.
 *
 * Founder, 2026-09-06 (batch 63). Three things have to be true and each is
 * pinned here: staff are REFUSED in words, the change writes an audit row with
 * who / when / the previous value, and the money that rules 1 and 2 withheld is
 * put back under the currency the person named.
 *
 * The supabase double is built per call rather than shared, because this route
 * makes four different calls against three tables and a single chainable mock
 * cannot tell them apart — which is exactly how a test comes to assert that a
 * write happened when the write it saw was the read.
 */
describe("DocumentsController.restateCurrency — the deliberate change", () => {
  const DOC = {
    id: "doc-9",
    restaurant_id: "rest-1",
    // Rules 1 and 2 left it withheld: no currency, no total.
    currency: null,
    status: "needs_review",
    total: null,
    extracted: {
      docType: "invoice",
      currency: "",
      total: 11306.4,
      tax: 1834.4,
      subtotal: 9172,
      freight: 120,
      depositTotal: 180,
      lines: [
        {
          lineNo: 1,
          qty: 12,
          uom: "bottle",
          packSize: 1,
          qtyBottles: 12,
          freeGoodsQty: 0,
          unitPrice: 142,
          lineTotal: 1704,
          deposit: 60,
          priceBaseQty: null,
          priceBaseUom: null,
        },
      ],
    },
  };

  /** Records every insert/update the route makes, keyed by table. */
  function harness(
    opts: {
      doc?: any;
      docError?: any;
      logError?: any;
      /** What `DocumentIntakeService.refileMoneyForCurrency` answers. */
      refile?: any;
      refileThrows?: Error;
      /** What `DocumentIntakeService.planRefileForCurrency` answers. */
      plan?: any;
      planThrows?: Error;
      /** The latest row of procurement_document_currency_changes, if any. */
      lastChange?: any;
      lastChangeError?: any;
      /** The house's own currency; "USD" unless said. */
      house?: string | null;
      houseError?: any;
      /** Rows of the audit table that already carry a rate (a prior conversion). */
      priorRate?: any[];
      priorRateError?: any;
    } = {},
  ) {
    const refileCalls: Array<[string, string, string]> = [];
    const fxSeen: Array<{ step: string; fx: unknown }> = [];
    const inserts: Array<{ table: string; row: any }> = [];
    const updates: Array<{ table: string; row: any }> = [];

    const client = {
      from(table: string) {
        const q: any = {
          _table: table,
          select: () => q,
          eq: () => q,
          order: () => q,
          not: () => q,
          limit: () => q,
          // The read of earlier rate rows is awaited without a terminator.
          then: (res: any, rej: any) =>
            Promise.resolve({ data: opts.priorRate ?? [], error: opts.priorRateError ?? null }).then(res, rej),
          maybeSingle: async () =>
            table === "procurement_document_currency_changes"
              ? { data: opts.lastChange ?? null, error: opts.lastChangeError ?? null }
              : table === "restaurants"
              ? {
                  data: { currency: opts.house === undefined ? "USD" : opts.house },
                  error: opts.houseError ?? null,
                }
              : {
                  data: opts.doc === undefined ? DOC : opts.doc,
                  error: opts.docError ?? null,
                },
          insert: async (row: any) => {
            inserts.push({ table, row });
            return { error: opts.logError ?? null };
          },
          update(row: any) {
            updates.push({ table, row });
            const u: any = { eq: () => u, then: undefined };
            // `.update(...).eq(...).eq(...)` is awaited, so the chain has to be
            // thenable at every depth the route uses.
            u.eq = () => u;
            u.then = (res: any) => res({ error: null });
            return u;
          },
        };
        return q;
      },
    };

    /*
     * The intake service is a REAL double now, not `{}`. The three tie-out
     * columns are the machine's own proposal and ADR 0059 gives their write to
     * `DocumentIntakeService`, so this route delegates rather than writing them
     * (`scripts/check_proposal_preservation.py` failed the first version, which
     * wrote all three from the controller). What is asserted below is therefore
     * the DELEGATION and the two writes that are genuinely this route's: the
     * audit row and the currency.
     */
    const intake = {
      /*
       * READ-ONLY, and it decides WHICH reading the re-filing will use — the
       * document's current rows, or the snapshot a hold withheld. The route
       * asks it before writing the audit row, because the row records what the
       * re-filing was about to move and where those figures came from.
       */
      planRefileForCurrency: async (_i: string, _r: string, fx?: unknown) => {
        fxSeen.push({ step: "plan", fx: fx ?? null });
        if (opts.planThrows) throw opts.planThrows;
        return (
          opts.plan ?? {
            plan: {
              source: "current_rows",
              sourceSaid:
                "the figures on the document as it stands now, corrections included",
              document: { total: 11306.4 },
              lines: [{ line_no: 1, unit_price: 142, line_total: 1704 }],
            },
            previousTotal: null,
            previousCurrency: null,
          }
        );
      },
      refileMoneyForCurrency: async (
        documentId: string,
        restaurantId: string,
        currency: string,
        fx?: unknown,
      ) => {
        refileCalls.push([documentId, restaurantId, currency]);
        fxSeen.push({ step: "refile", fx: fx ?? null });
        if (opts.refileThrows) throw opts.refileThrows;
        return (
          opts.refile ?? {
            snapshotReadable: true,
            source: "current_rows",
            sentence: 'Its stated total of 11306.40 is now TRY.',
            document: { total: 11306.4 },
            lineCount: 1,
            pricedLines: 1,
            linesRefiled: 1,
            lineFailures: [],
          }
        );
      },
    };

    const controller = new DocumentsController(
      intake as any,
      { getClient: () => client } as any,
      {} as any, // CanonicalDocumentService
      {} as any, // DeliverySpineService
      {} as any, // DocumentCorrectionService (ADR 0104 D5)
      {} as any, // CatalogIngestService (ADR 0126)
      /*
       * BOTH methods, because the route now uses both and they answer
       * DIFFERENT questions: `assertCanManageRestaurant` is the GATE (one
       * implementation of "may this person manage this house", shared with
       * settings and mcp-connections), and `resolveRestaurantRole` supplies the
       * role the AUDIT ROW records. The double derives the assert from the
       * resolve exactly as `OrganizationsService` does, so a test cannot pass
       * against a gate the real service would fail.
       */
      {
        resolveRestaurantRole: async () => roleToReturn,
        assertCanManageRestaurant: async () => {
          if (roleToReturn !== "owner" && roleToReturn !== "manager")
            throw new Error("Only managers and owners can restate an invoice's currency");
        },
      } as any,
      {} as any, // DeliveryService (ADR 0103 — the door-count route's other half)
      /*
       * SealChallengeService — the seal on verify / line_edit /
       * currency_restate (founder, 2026-09-06, batch 64).
       *
       * A double that ADMITS, and it is named as such rather than left to look
       * like the real thing. These tests are about WHAT A RESTATEMENT WRITES —
       * the audit row, its ordering against the currency write, which reading
       * the figures came from. The seal's own refusals (absent, wrong act,
       * spent twice, arguments moved) are proven in `documents.seal.spec.ts`
       * against a double that refuses. Making this one refuse here would test
       * the seal twice and the audit row never.
       */
      // DeliveryStockService (main's ADR 0103 A1, the door's booking half; merged
      // 2026-09-11) -- stubbed, this file never books stock. tsc counts the arguments.
      {} as any,
      // LineMappingService (ADR 0104 D12 slice 4, merged from main 2026-09-12) --
      // stubbed: a currency restatement never asks the mapping memory, and
      // tsc -p tsconfig.spec.json counts the arguments.
      {} as any,
      { redeem: async () => ({ sealId: "seal-1" }) } as any,
    );
    return { controller, inserts, updates, refileCalls, fxSeen };
  }

  let roleToReturn: string | null = "manager";
  const user = {
    userId: "u1",
    restaurantId: "rest-1",
    name: "Ada Manager",
    email: "ada@example.test",
  };

  beforeEach(() => {
    roleToReturn = "manager";
  });

  it("refuses staff in a sentence naming what they are and who can do it", async () => {
    roleToReturn = "staff";
    const { controller, inserts, updates } = harness();

    await expect(
      controller.restateCurrency("doc-9", { currency: "TRY" }, user),
    ).rejects.toMatchObject({ status: 403 });
    // Nothing was written on the way to the refusal.
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);

    await controller
      .restateCurrency("doc-9", { currency: "TRY" }, user)
      .catch((e) => {
        expect(e.message).toContain("signed in as staff");
        expect(e.message).toContain("manager");
        expect(e.message).toContain("nothing was changed");
      });
  });

  it("refuses a session that could not be shown to hold any role", async () => {
    // `null` is a failed read AND a person with no row, and neither may pass.
    roleToReturn = null;
    const { controller } = harness();
    await controller
      .restateCurrency("doc-9", { currency: "TRY" }, user)
      .catch((e) => {
        expect(e.status).toBe(403);
        expect(e.message).toContain("could not be shown to hold any role");
      });
  });

  it("refuses anything that is not an ISO 4217 alpha-3 code", async () => {
    const { controller } = harness();
    for (const bad of ["TL", "$", "usd dollars", "", undefined])
      await expect(
        controller.restateCurrency("doc-9", { currency: bad as any }, user),
      ).rejects.toMatchObject({ status: 400 });
  });

  /*
   * MEMBERSHIP, NOT SHAPE (2026-09-06). This route asked `/^[A-Z]{3}$/`, so
   * `PATCH :id/currency` with `ZZZ` re-filed an invoice's whole money under a
   * denomination that does not exist AND wrote an append-only row saying a
   * manager had decided it. Nothing may be written on the way to this refusal.
   */
  it("refuses a well-formed code that names no currency, and writes NOTHING", async () => {
    for (const fake of ["ZZZ", "XTS", "XTT"]) {
      const { controller, inserts, updates } = harness();
      await expect(
        controller.restateCurrency("doc-9", { currency: fake }, user),
      ).rejects.toMatchObject({ status: 400 });
      expect(inserts).toHaveLength(0);
      expect(updates).toHaveLength(0);
      await controller
        .restateCurrency("doc-9", { currency: fake }, user)
        .catch((e) => {
          expect(e.message).toContain(`${fake} is not a currency`);
        });
    }
  });

  it("records WHICH reading the re-filing used on the audit row", async () => {
    // BLOCKER 2's other half. Without this the log cannot afterwards tell a
    // re-filing from a revert of somebody's correction.
    const { controller, inserts } = harness();
    await controller.restateCurrency("doc-9", { currency: "TRY" }, user);
    const row = inserts.find(
      (i) => i.table === "procurement_document_currency_changes",
    )!.row;
    expect(row.money_refiled.source).toBe("current_rows");
    expect(row.money_refiled.source_said).toContain("as it stands now");
  });

  it("a conversion carries its rate to the plan, the writer and the audit row, and says where it was filed", async () => {
    const { controller, inserts, fxSeen } = harness();
    const out = await controller.restateCurrency(
      "doc-9",
      { currency: "USD", fromCurrency: "EUR", rate: 1.084, rateDate: "2026-11-20" },
      user,
    );
    const row = inserts.find((i) => i.table === "procurement_document_currency_changes")!.row;
    expect(row.paper_currency).toBe("EUR");
    expect(row.exchange_rate).toBe(1.084);
    expect(row.rate_date).toBe("2026-11-20");
    const want = { rate: 1.084, from: "EUR", rateDate: "2026-11-20" };
    expect(fxSeen).toEqual([
      { step: "plan", fx: want },
      { step: "refile", fx: want },
    ]);
    expect((out as any).filedAt.sentence).toBe("filed at 1 EUR = 1.0840 USD on 20 Nov");
  });

  it("the rate applied is the rate kept: rounded to the 8 places the audit column holds", async () => {
    const { controller, inserts, fxSeen } = harness();
    await controller.restateCurrency(
      "doc-9",
      { currency: "USD", fromCurrency: "EUR", rate: 0.123456789, rateDate: "2026-11-20" },
      user,
    );
    const row = inserts.find((i) => i.table === "procurement_document_currency_changes")!.row;
    expect(row.exchange_rate).toBe(0.12345679);
    expect(fxSeen.map((f) => (f.fx as any).rate)).toEqual([0.12345679, 0.12345679]);
  });

  describe("a converted paper is not changed again from its converted figures (r104 reviewer)", () => {
    // 120.00 TRY converted at 0.03 reads 3.60 USD. Relabelling that to TRY files
    // 3.60 as TRY, and converting again gives 0.11.
    const converted = { paper_currency: "TRY", exchange_rate: 0.03, rate_date: "2026-11-20", new_currency: "USD" };
    const inUsd = { ...DOC, currency: "USD" };

    it("refuses to relabel it back, and writes nothing", async () => {
      const { controller, inserts, updates, refileCalls } = harness({ doc: inUsd, lastChange: converted });
      await expect(controller.restateCurrency("doc-9", { currency: "TRY" }, user)).rejects.toMatchObject({ status: 409 });
      expect([inserts.length, updates.length, refileCalls.length]).toEqual([0, 0, 0]);
    });

    it("refuses to convert it a second time", async () => {
      const { controller, inserts } = harness({ doc: inUsd, lastChange: converted });
      await expect(
        controller.restateCurrency("doc-9", { currency: "EUR", fromCurrency: "USD", rate: 0.9, rateDate: "2026-11-21" }, user),
      ).rejects.toMatchObject({ status: 409 });
      expect(inserts).toHaveLength(0);
    });

    it("says what was done, and no longer advises restating first", async () => {
      const { controller } = harness({ doc: inUsd, lastChange: converted });
      const e: any = await controller.restateCurrency("doc-9", { currency: "TRY" }, user).catch((x) => x);
      expect(e.message).toContain("already converted from TRY to USD at 0.03");
      expect(e.message).not.toMatch(/restate it as/i);
    });

    it("confirming the currency it carries is still fine", async () => {
      const { controller, inserts } = harness({ doc: inUsd, lastChange: converted });
      await controller.restateCurrency("doc-9", { currency: "USD" }, user);
      expect(inserts.find((i) => i.table === "procurement_document_currency_changes")!.row.change_kind).toBe("confirmed");
    });

    it("an unreadable history is a failure in words, never 'no earlier conversion'", async () => {
      const { controller, inserts } = harness({ doc: inUsd, lastChangeError: { message: "db down" } });
      await expect(controller.restateCurrency("doc-9", { currency: "TRY" }, user)).rejects.toMatchObject({ status: 500 });
      expect(inserts).toHaveLength(0);
    });

    it("refuses a conversion whose 'from' is not the currency the paper is filed in", async () => {
      const { controller, inserts } = harness({ doc: { ...DOC, currency: "TRY" } });
      const e: any = await controller
        .restateCurrency("doc-9", { currency: "USD", fromCurrency: "EUR", rate: 1.084, rateDate: "2026-11-20" }, user)
        .catch((x) => x);
      expect(e.status).toBe(409);
      expect(e.message).toContain("filed in TRY");
      expect(inserts).toHaveLength(0);
    });

    it("a first conversion of an un-converted paper still goes through", async () => {
      const { controller } = harness({ doc: { ...DOC, currency: "TRY" } });
      await controller.restateCurrency("doc-9", { currency: "USD", fromCurrency: "TRY", rate: 0.03, rateDate: "2026-11-20" }, user);
    });
  });

  it("refuses a second conversion of a paper that already holds a rate, and writes nothing (r105)", async () => {
    const prior = [{ paper_currency: "TRY", new_currency: "USD", exchange_rate: "0.03", rate_date: "2026-11-19" }];
    // A TRY paper converted at 0.03, then relabelled USD -> TRY: the instructed path.
    const { controller, inserts, updates } = harness({ doc: { ...DOC, currency: "TRY" }, priorRate: prior, house: "USD" });
    const call = controller.restateCurrency("doc-9", { currency: "USD", fromCurrency: "TRY", rate: 0.031, rateDate: "2026-11-20" }, user);
    await expect(call).rejects.toMatchObject({ status: 409 });
    await expect(call).rejects.toThrow(/already converted.*filed at 1 TRY = 0\.0300 USD on 19 Nov.*Nothing was changed/);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("a failed read of earlier conversions refuses the conversion and says it failed (r105)", async () => {
    const { controller, inserts } = harness({ priorRateError: { message: "boom" } });
    await expect(
      controller.restateCurrency("doc-9", { currency: "USD", fromCurrency: "EUR", rate: 1.084, rateDate: "2026-11-20" }, user),
    ).rejects.toMatchObject({ status: 500 });
    expect(inserts).toHaveLength(0);
  });

  it("the 'already filed' refusal no longer tells anyone to relabel converted money (r105)", async () => {
    const { controller } = harness({ doc: { ...DOC, currency: "USD" } });
    await expect(
      controller.restateCurrency("doc-9", { currency: "USD", fromCurrency: "TRY", rate: 0.03, rateDate: "2026-11-20" }, user),
    ).rejects.toThrow(/really in TRY and were never converted/);
  });

  it("a plain relabel stores no rate", async () => {
    const { controller, inserts, fxSeen } = harness();
    await controller.restateCurrency("doc-9", { currency: "TRY" }, user);
    const row = inserts.find((i) => i.table === "procurement_document_currency_changes")!.row;
    expect([row.paper_currency, row.exchange_rate, row.rate_date]).toEqual([null, null, null]);
    expect(fxSeen.map((f) => f.fx)).toEqual([null, null]);
  });

  it("says when the label was corrected, and the rate-less 400 says a currency was missing, not 'no currency was sent'", async () => {
    const { controller } = harness({ doc: { ...DOC, currency: "TRY" } });
    const out: any = await controller.restateCurrency(
      "doc-9",
      { currency: "USD", fromCurrency: "EUR", rate: 1.084, rateDate: "2026-11-20" },
      user,
    );
    expect(out.sentence).toContain("The paper had been filed as TRY; its own figures are in EUR");
    const agree = harness({ doc: { ...DOC, currency: "EUR" } });
    const same: any = await agree.controller.restateCurrency(
      "doc-9",
      { currency: "USD", fromCurrency: "EUR", rate: 1.084, rateDate: "2026-11-20" },
      user,
    );
    expect(same.sentence).not.toContain("had been filed as");
    await expect(
      harness().controller.restateCurrency("doc-9", { currency: "USD", rate: 1.084, rateDate: "2026-11-20" } as any, user),
    ).rejects.toThrow(/which currency the paper's own figures are in \(fromCurrency\)/);
  });

  it("refuses a conversion into a currency that is not the house's, in words, and writes nothing", async () => {
    const { controller, inserts, updates } = harness({ house: "TRY" });
    const call = controller.restateCurrency(
      "doc-9",
      { currency: "USD", fromCurrency: "EUR", rate: 1.084, rateDate: "2026-11-20" },
      user,
    );
    await expect(call).rejects.toMatchObject({ status: 400 });
    await expect(call).rejects.toThrow(/house's own money, TRY, and USD is not that/);
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("a failed house-currency read refuses the conversion and says it failed", async () => {
    const { controller, inserts } = harness({ houseError: { message: "boom" } });
    await expect(
      controller.restateCurrency("doc-9", { currency: "USD", fromCurrency: "EUR", rate: 1.084, rateDate: "2026-11-20" }, user),
    ).rejects.toMatchObject({ status: 500 });
    expect(inserts).toHaveLength(0);
  });

  it.each([
    ["no rate at all", { currency: "USD", fromCurrency: "EUR", rateDate: "2026-11-20" }],
    ["a rate that would round to zero in the audit column", { currency: "USD", fromCurrency: "EUR", rate: 1e-9, rateDate: "2026-11-20" }],
    ["a rate of zero", { currency: "USD", fromCurrency: "EUR", rate: 0, rateDate: "2026-11-20" }],
    ["no paper currency", { currency: "USD", rate: 1.084, rateDate: "2026-11-20" }],
    ["no day", { currency: "USD", fromCurrency: "EUR", rate: 1.084 }],
    ["a day that is not a date", { currency: "USD", fromCurrency: "EUR", rate: 1.084, rateDate: "2026-02-31" }],
    ["the same currency both sides", { currency: "USD", fromCurrency: "USD", rate: 1.084, rateDate: "2026-11-20" }],
  ])("refuses a half-stated conversion (%s) and writes nothing", async (_n, body) => {
    const { controller, inserts, updates } = harness();
    await expect(controller.restateCurrency("doc-9", body as any, user)).rejects.toMatchObject({ status: 400 });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("names a failed read of the FIGURES instead of changing the currency anyway", async () => {
    // A failed line read that arrived as "no lines" would look exactly like a
    // held document and would revert every correction. It must stop the act.
    const { controller, inserts, updates } = harness({
      planThrows: new Error("REFILE_READ_FAILED:connection reset"),
    });
    await expect(
      controller.restateCurrency("doc-9", { currency: "TRY" }, user),
    ).rejects.toMatchObject({ status: 500 });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("writes the audit row with who, when, the previous value and the status", async () => {
    const { controller, inserts } = harness();
    await controller.restateCurrency(
      "doc-9",
      { currency: "TRY", reason: "the paper is in lira" },
      user,
    );

    const log = inserts.find(
      (i) => i.table === "procurement_document_currency_changes",
    );
    expect(log).toBeDefined();
    expect(log!.row.previous_currency).toBeNull();
    expect(log!.row.new_currency).toBe("TRY");
    expect(log!.row.changed_by).toBe("u1");
    // The NAME the session carries, not the email address wearing its label.
    expect(log!.row.changed_by_label).toBe("Ada Manager");
    expect(log!.row.changed_by_role).toBe("manager");
    expect(log!.row.document_status).toBe("needs_review");
    expect(log!.row.reason).toBe("the paper is in lira");
    // The row records what the change was ABOUT to move, read once so the log
    // cannot describe a different re-filing from the one that happened.
    expect(log!.row.money_refiled.snapshot_readable).toBe(true);
    expect(log!.row.money_refiled.previous_total).toBeNull();
    // `changed_at` is the column's own NOW() default, so the row does not carry
    // a clock the caller could set.
    expect(log!.row.changed_at).toBeUndefined();
  });

  it("re-files the withheld money under the named currency and says what moved", async () => {
    const { controller, updates, refileCalls } = harness();
    const out = await controller.restateCurrency(
      "doc-9",
      { currency: "TRY" },
      user,
    );

    // THIS ROUTE WRITES THE PERSON'S ANSWER AND NOTHING ELSE. One update, one
    // key. The tie-out columns are the machine's proposal and belong to their
    // declared writer (ADR 0059); a controller that wrote them would also be a
    // second implementation of the arithmetic every other path runs through
    // `applyTieOut`.
    const docWrites = updates.filter((u) => u.table === "procurement_documents");
    expect(docWrites).toHaveLength(1);
    expect(docWrites[0].row).toEqual({ currency: "TRY" });
    expect(
      updates.filter((u) => u.table === "procurement_document_lines"),
    ).toHaveLength(0);

    // The figures are re-filed by DocumentIntakeService, scoped to this tenant.
    expect(refileCalls).toEqual([["doc-9", "rest-1", "TRY"]]);

    expect(out.moneyRefiled).toBe(true);
    expect(out.linesRefiled).toBe(1);
    // The person's half of the sentence and the machine's, in that order.
    expect(out.sentence).toContain("from NOT RECORDED");
    expect(out.sentence).toContain("Its stated total of 11306.40 is now TRY");
  });

  it("delegates the re-filing only AFTER the currency has landed", async () => {
    const { controller, updates, refileCalls } = harness({
      logError: { message: "log table unreachable" },
    });
    await expect(
      controller.restateCurrency("doc-9", { currency: "TRY" }, user),
    ).rejects.toMatchObject({ status: 500 });
    // Neither the label nor the figures moved when the log failed.
    expect(updates).toHaveLength(0);
    expect(refileCalls).toHaveLength(0);
  });

  it("names a failed re-filing without claiming the money moved", async () => {
    const { controller } = harness({
      refileThrows: new Error("REFILE_WRITE_FAILED:connection reset"),
    });
    await controller
      .restateCurrency("doc-9", { currency: "TRY" }, user)
      .catch((e) => {
        expect(e.status).toBe(500);
        // The gateway's own words, with the internal marker stripped.
        expect(e.message).toContain("connection reset");
        expect(e.message).not.toContain("REFILE_WRITE_FAILED");
        expect(e.message).toContain("its money is unchanged");
      });
  });

  it("does NOT change the currency when the log cannot be written", async () => {
    const { controller, updates } = harness({
      logError: { message: "log table unreachable" },
    });

    await expect(
      controller.restateCurrency("doc-9", { currency: "TRY" }, user),
    ).rejects.toMatchObject({ status: 500 });
    // The whole point: a restatement nobody recorded never lands.
    expect(updates).toHaveLength(0);
  });

  /*
   * SUPERSEDED, DELIBERATELY, on 2026-09-06 (founder, batch 64: "let them
   * approve if otherwise"). This case used to be a 409 with nothing logged, and
   * the reasoning was sound for the act rule 3 was built for: a page with a
   * sticky button must not write a log of identical rows.
   *
   * Item A changed what the act is FOR. Receiving now refuses a keyed-in unit
   * price while an invoice's money is not filed, and the thing that clears it is
   * a manager saying which currency is right — including when the right one is
   * the one the document already carries. Under the old rule that decision was
   * an error message, and the only way past the refusal was to name a currency
   * the manager did not believe in.
   *
   * The no-op protection did not go away; it moved onto `change_kind`. A row
   * calling itself a RESTATEMENT with two equal codes is still refused, by the
   * database (`20260906180000`), and the two tests below are the two halves.
   */
  it("CONFIRMS the currency it is already filed under, and logs it as a confirmation", async () => {
    const { controller, inserts, updates } = harness({
      doc: { ...DOC, currency: "TRY" },
    });
    const res = await controller.restateCurrency(
      "doc-9",
      { currency: "TRY" },
      user,
    );
    expect(res.kind).toBe("confirmed");
    expect(res.previousCurrency).toBe("TRY");
    expect(res.currency).toBe("TRY");
    // One audit row, saying which act it was, with the same author as a change.
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("procurement_document_currency_changes");
    expect(inserts[0].row).toMatchObject({
      change_kind: "confirmed",
      previous_currency: "TRY",
      new_currency: "TRY",
      changed_by: user.userId,
      changed_by_role: "manager",
    });
    // The currency still moves through the same single-key write, so a
    // confirmation and a restatement leave the row in the same shape.
    expect(updates).toHaveLength(1);
    expect(updates[0].row).toEqual({ currency: "TRY" });
    // The sentence says it did NOT change — a confirmation that reads like a
    // change is how a manager comes to believe they corrected something.
    expect(res.sentence).toContain("CONFIRMED");
    expect(res.sentence).toContain("did not change");
  });

  it("calls a change from NOT RECORDED a restatement, never a confirmation", async () => {
    // The state rules 1, 2 and B3 leave behind: currency null, money withheld.
    // There is nothing there to agree with, so naming a code is a change.
    const { controller, inserts } = harness({
      doc: { ...DOC, currency: null },
    });
    const res = await controller.restateCurrency(
      "doc-9",
      { currency: "TRY" },
      user,
    );
    expect(res.kind).toBe("restated");
    expect(inserts[0].row).toMatchObject({
      change_kind: "restated",
      previous_currency: null,
      new_currency: "TRY",
    });
  });

  it("says the money could not be re-filed rather than writing zeroes", async () => {
    const { controller, updates } = harness({
      doc: { ...DOC, extracted: { docType: "invoice" } },
      refile: {
        snapshotReadable: false,
        sentence: "The money could NOT be re-filed: ... nothing was erased.",
        document: null,
        lineCount: 0,
        pricedLines: 0,
        linesRefiled: 0,
        lineFailures: [],
      },
    });
    const out = await controller.restateCurrency(
      "doc-9",
      { currency: "TRY" },
      user,
    );

    expect(out.moneyRefiled).toBe(false);
    expect(out.sentence).toContain("could NOT be re-filed");
    // The currency is written and NOTHING else: no fabricated figures, and no
    // nulls that would erase figures already on the row.
    const docWrites = updates.filter((u) => u.table === "procurement_documents");
    expect(docWrites).toHaveLength(1);
    expect(docWrites[0].row).toEqual({ currency: "TRY" });
  });

  it("names a failed read instead of reporting the document as missing", async () => {
    const { controller } = harness({
      doc: null,
      docError: { message: "connection reset" },
    });
    await controller
      .restateCurrency("doc-9", { currency: "TRY" }, user)
      .catch((e) => {
        expect(e.status).toBe(500);
        expect(e.message).toContain("connection reset");
      });
  });
});

/** A list() controller over a thenable fake db, one canned result per table; records writes. */
function listControllerWith(results: Record<string, { data: unknown; error: unknown }>) {
  const writes: string[] = [];
  const calls: Array<[string, string, unknown[]]> = [];
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit", "in", "range", "lt", "or"])
      b[m] = jest.fn((...args: unknown[]) => {
        calls.push([table, m, args]);
        return b;
      });
    for (const m of ["insert", "update", "upsert", "delete"])
      b[m] = jest.fn(() => {
        writes.push(m);
        return b;
      });
    return b;
  };
  const db = {
    getClient: () => ({
      from: (table: string) => {
        const b = builder(table);
        b.then = (res: any, rej: any) => Promise.resolve(results[table]).then(res, rej);
        return b;
      },
    }),
  };
  const controller = new DocumentsController(
    {} as any,
    db as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { controller, writes, calls };
}

describe("DocumentsController.list — the verdict as the rule gives it now (walk-through W7, 2026-10-01)", () => {
  /**
   * A stored row read before the tie-out rule counted a tax stated only in the
   * VAT breakdown: its columns say "off by 8.63". The sheet recomputes and says
   * it adds up; the list must say the same, and write nothing.
   */
  const storedRow = {
    id: "d1",
    restaurant_id: "rest-1",
    doc_type: "invoice",
    status: "needs_review",
    subtotal: 100,
    tax: null,
    total: 108.63,
    ties_out: false,
    tie_out_delta: 8.63,
    computed_lines_total: 100,
    extracted: { taxBreakdown: [{ rate: 8.625, taxableBase: 100, amount: 8.63 }] },
  };
  const lineRow = {
    document_id: "d1",
    line_no: 1,
    description: "synthetic line",
    qty: 1,
    uom: "bottle",
    pack_size: 1,
    qty_bottles: 1,
    unit_price: 100,
    line_total: 100,
  };

  it("recomputes a stale stored verdict with the sheet's rule, and writes nothing", async () => {
    const { controller, writes } = listControllerWith({
      procurement_documents: { data: [storedRow], error: null },
      procurement_document_lines: { data: [lineRow], error: null },
    });
    const out = await controller.list({ userId: "u1", restaurantId: "rest-1" } as any, "needs_review");
    const item = out.items[0] as Record<string, unknown>;
    expect(item.ties_out).toBe(true);
    expect(item.tie_out_delta).toBe(0);
    expect(writes).toEqual([]);
  });

  it("keeps the stored verdict when the lines cannot be read, never a verdict from no lines", async () => {
    const { controller } = listControllerWith({
      procurement_documents: { data: [storedRow], error: null },
      procurement_document_lines: { data: null, error: { message: "boom" } },
    });
    const out = await controller.list({ userId: "u1", restaurantId: "rest-1" } as any, "needs_review");
    const item = out.items[0] as Record<string, unknown>;
    expect(item.ties_out).toBe(false);
    expect(item.tie_out_delta).toBe(8.63);
  });
});

describe("DocumentsController.list — who sent it (walk-through W8, 2026-10-01)", () => {
  const row = (over: Record<string, unknown>) => ({
    id: "d1",
    restaurant_id: "rest-1",
    doc_type: "invoice",
    status: "needs_review",
    provider_id: null,
    extracted: null,
    ...over,
  });
  const base = { procurement_document_lines: { data: [], error: null } };

  it("names the linked vendor as the sheet does: company name, else name", async () => {
    const { controller, writes } = listControllerWith({
      ...base,
      procurement_documents: {
        data: [
          row({ id: "d1", provider_id: "p1", extracted: { vendorName: "PAPER NAME" } }),
          row({ id: "d2", provider_id: "p2" }),
        ],
        error: null,
      },
      providers: {
        data: [
          { id: "p1", name: "Short", company_name: "SYNTHETIC VENDOR CO." },
          { id: "p2", name: "SYNTHETIC SHORT NAME", company_name: null },
        ],
        error: null,
      },
    });
    const out = await controller.list({ userId: "u1", restaurantId: "rest-1" } as any);
    expect(out.items.map((i: any) => i.vendorName)).toEqual([
      "SYNTHETIC VENDOR CO.",
      "SYNTHETIC SHORT NAME",
    ]);
    expect(writes).toEqual([]);
  });

  it("falls back to the paper's name when no vendor is linked or the vendor read fails, and to null when neither exists", async () => {
    const { controller } = listControllerWith({
      ...base,
      procurement_documents: {
        data: [
          row({ id: "d1", extracted: { vendorName: "SYNTHETIC PAPER NAME" } }),
          row({ id: "d2", provider_id: "p1", extracted: { vendorName: "SYNTHETIC PAPER TWO" } }),
          row({ id: "d3" }),
        ],
        error: null,
      },
      providers: { data: null, error: { message: "boom" } },
    });
    const out = await controller.list({ userId: "u1", restaurantId: "rest-1" } as any);
    expect(out.items.map((i: any) => i.vendorName)).toEqual([
      "SYNTHETIC PAPER NAME",
      "SYNTHETIC PAPER TWO",
      null,
    ]);
  });
});

describe("DocumentsController.list — older papers and a search (r104 g2)", () => {
  const paper = (i: number) => ({
    id: `d${i}`,
    restaurant_id: "rest-1",
    doc_type: "invoice",
    status: "verified",
    provider_id: null,
    extracted: null,
    created_at: `2026-11-${String(30 - i).padStart(2, "0")}T10:00:00Z`,
  });
  const none = { data: [], error: null };
  const user = { userId: "u1", restaurantId: "rest-1" } as any;

  it("says there are older papers when it found more than it was asked for, and hands over the cursor", async () => {
    const { controller, calls } = listControllerWith({
      procurement_documents: { data: [paper(1), paper(2), paper(3)], error: null },
      procurement_document_lines: none,
    });
    const out: any = await controller.list(user, "verified", undefined, undefined, "2");
    expect(out.items.map((i: any) => i.id)).toEqual(["d1", "d2"]);
    expect(out.hasMore).toBe(true);
    expect(out.nextBefore).toBe("2026-11-28T10:00:00Z");
    expect(calls).toContainEqual(["procurement_documents", "limit", [3]]);
  });

  it("says nothing is older when the page is not full", async () => {
    const { controller } = listControllerWith({
      procurement_documents: { data: [paper(1)], error: null },
      procurement_document_lines: none,
    });
    const out: any = await controller.list(user, "verified", undefined, undefined, "2");
    expect([out.hasMore, out.nextBefore]).toEqual([false, null]);
  });

  it("reads only papers before the cursor", async () => {
    const { controller, calls } = listControllerWith({
      procurement_documents: none,
      procurement_document_lines: none,
    });
    await controller.list(user, "verified", undefined, undefined, undefined, undefined, "2026-11-01T00:00:00Z");
    expect(calls).toContainEqual(["procurement_documents", "lt", ["created_at", "2026-11-01T00:00:00Z"]]);
  });

  it("passes the cursor's microseconds through, so no row between the cut and the stored time is lost", async () => {
    const { controller, calls } = listControllerWith({
      procurement_documents: none,
      procurement_document_lines: none,
    });
    await controller.list(user, "verified", undefined, undefined, undefined, undefined, "2026-11-01T10:00:00.123456+00:00");
    expect(calls).toContainEqual(["procurement_documents", "lt", ["created_at", "2026-11-01T10:00:00.123456+00:00"]]);
  });

  it("normalises a cursor that is a date but not an ISO time", async () => {
    const { controller, calls } = listControllerWith({
      procurement_documents: none,
      procurement_document_lines: none,
    });
    await controller.list(user, "verified", undefined, undefined, undefined, undefined, "2026-11-01");
    expect(calls).toContainEqual(["procurement_documents", "lt", ["created_at", "2026-11-01T00:00:00.000Z"]]);
  });

  it("pages by (created_at, id) with the raw timestamp, so papers sharing a millisecond are not skipped (r106 fz)", async () => {
    const { controller, calls } = listControllerWith({
      procurement_documents: none,
      procurement_document_lines: none,
    });
    const id = "11111111-2222-4333-8444-555555555555";
    await controller.list(user, "verified", undefined, undefined, undefined, undefined, "2026-11-01T10:00:00.123456+00:00", id);
    const or = calls.find((c) => c[0] === "procurement_documents" && c[1] === "or")!;
    expect(or[2][0]).toBe(
      `created_at.lt."2026-11-01T10:00:00.123456+00:00",and(created_at.eq."2026-11-01T10:00:00.123456+00:00",id.lt."${id}")`,
    );
    expect(calls).toContainEqual(["procurement_documents", "order", ["id", { ascending: false }]]);
  });

  it("refuses a beforeId that is not a paper id (it is placed in a filter)", async () => {
    const { controller } = listControllerWith({ procurement_documents: none });
    await expect(
      controller.list(user, "verified", undefined, undefined, undefined, undefined, "2026-11-01T00:00:00Z", 'x"),or=(id.neq.1'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a cursor that is not a date", async () => {
    const { controller } = listControllerWith({ procurement_documents: none });
    await expect(
      controller.list(user, "verified", undefined, undefined, undefined, undefined, "yesterday"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("searches the document number, the name the paper carried and the linked vendors", async () => {
    const { controller, calls } = listControllerWith({
      procurement_documents: none,
      procurement_document_lines: none,
      providers: { data: [{ id: "p1" }, { id: "p2" }], error: null },
    });
    await controller.list(user, "verified", undefined, undefined, undefined, "Acme, (inv)%");
    const or = calls.find((c) => c[0] === "procurement_documents" && c[1] === "or")!;
    expect(or[2][0]).toBe(
      "doc_number.ilike.%Acme inv%,extracted->>vendorName.ilike.%Acme inv%,provider_id.in.(p1,p2)",
    );
  });

  it("a search that cannot read the vendors says so instead of returning everything", async () => {
    const { controller } = listControllerWith({
      procurement_documents: none,
      providers: { data: null, error: { message: "boom" } },
    });
    await expect(
      controller.list(user, "verified", undefined, undefined, undefined, "acme"),
    ).rejects.toMatchObject({ status: 500 });
  });
});

describe("DocumentsController.list — papers filed in one instant (r105)", () => {
  /** An in-memory papers table that really orders, filters and limits like PostgREST. */
  function pagedControllerWith(all: Array<{ id: string; created_at: string }>) {
    const rows = all.map((r) => ({ restaurant_id: "rest-1", doc_type: "invoice", status: "verified", provider_id: null, extracted: null, ...r }));
    const from = (table: string) => {
      let out: any[] = table === "procurement_documents" ? [...rows] : [];
      let lim = Infinity;
      const orders: Array<[string, boolean]> = [];
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.in = () => b;
      b.range = () => b;
      b.order = (col: string, o: { ascending: boolean }) => (orders.push([col, o.ascending]), b);
      b.limit = (n: number) => ((lim = n), b);
      b.lt = (col: string, v: string) => ((out = out.filter((r) => r[col] < v)), b);
      b.or = (expr: string) => {
        const m = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)$/.exec(expr)!;
        out = out.filter((r) => r.created_at < m[1] || (r.created_at === m[2] && r.id < m[3]));
        return b;
      };
      b.then = (res: any, rej: any) => {
        const sorted = out.sort((a, c) => {
          for (const [col, asc] of orders) if (a[col] !== c[col]) return (a[col] < c[col] ? -1 : 1) * (asc ? 1 : -1);
          return 0;
        });
        return Promise.resolve({ data: sorted.slice(0, lim), error: null }).then(res, rej);
      };
      return b;
    };
    const controller = new DocumentsController({} as any, { getClient: () => ({ from }) } as any, ...(Array.from({ length: 9 }, () => ({})) as any[]));
    return controller;
  }
  const user = { userId: "u1", restaurantId: "rest-1" } as any;

  it("two pages of three over five papers filed at one time list five distinct papers", async () => {
    const at = "2026-11-20T10:00:00.123456+00:00";
    const c = pagedControllerWith(["a", "b", "c", "d", "e"].map((id) => ({ id: `0000000${id.charCodeAt(0) - 96}-0000-4000-8000-000000000000`, created_at: at })));
    const p1: any = await c.list(user, "verified", undefined, undefined, "3");
    expect(p1.hasMore).toBe(true);
    const p2: any = await c.list(user, "verified", undefined, undefined, "3", undefined, p1.nextBefore, p1.nextBeforeId);
    const ids = [...p1.items, ...p2.items].map((i: any) => i.id);
    expect(new Set(ids).size).toBe(5);
    expect(p2.hasMore).toBe(false);
  });

  it("refuses a cursor id without its time, or an id that is not one", async () => {
    const c = pagedControllerWith([]);
    await expect(c.list(user, "verified", undefined, undefined, undefined, undefined, undefined, "00000001-0000-4000-8000-000000000000")).rejects.toMatchObject({ status: 400 });
    await expect(c.list(user, "verified", undefined, undefined, undefined, undefined, "2026-11-20T10:00:00Z", "x),or(id.gt.0")).rejects.toMatchObject({ status: 400 });
  });
});

