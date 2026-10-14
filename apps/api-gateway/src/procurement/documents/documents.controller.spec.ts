import { HttpException } from "@nestjs/common";
import { DocumentsController } from "./documents.controller";
import {
  DOCUMENT_LINE_MONEY_COLUMNS,
  DOCUMENT_MONEY_COLUMNS,
  isMoneyPath,
} from "./document-money-gate";

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

    const result = await controller.detail("doc-1", {
      ...user,
      role: "manager",
    });

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

  it("returns imageUrl null (never throws) when signing fails", async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "doc-3", storage_path: "rest-1/documents/xyz/receipt.jpg" },
      error: null,
    });
    mockCreateSignedUrl.mockRejectedValueOnce(new Error("bucket unavailable"));

    const result = await controller.detail("doc-3", user);

    expect((result.document as any).imageUrl).toBeNull();
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
    } = {},
  ) {
    const refileCalls: Array<[string, string, string]> = [];
    const inserts: Array<{ table: string; row: any }> = [];
    const updates: Array<{ table: string; row: any }> = [];

    const client = {
      from(table: string) {
        const q: any = {
          _table: table,
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({
            data: opts.doc === undefined ? DOC : opts.doc,
            error: opts.docError ?? null,
          }),
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
      planRefileForCurrency: async () => {
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
      ) => {
        refileCalls.push([documentId, restaurantId, currency]);
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
    return { controller, inserts, updates, refileCalls };
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
  const builder = () => {
    const b: any = {};
    for (const m of ["select", "eq", "order", "limit", "in", "range"]) b[m] = jest.fn(() => b);
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
        const b = builder();
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
  return { controller, writes };
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
    const out = await controller.list(
      { userId: "u1", restaurantId: "rest-1", role: "manager" } as any,
      "needs_review",
    );
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
    const out = await controller.list(
      { userId: "u1", restaurantId: "rest-1", role: "manager" } as any,
      "needs_review",
    );
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

/**
 * MONEY-POLICY M2: THE DOCUMENT READS. `GET /procurement/documents`, `GET :id`
 * and `GET :id/canonical` gave every signed-in member each price, total and
 * tie-out on the house's vendor paper. A non-holder now gets the same paper
 * without its amounts and `amountsWithheld: true`; the door's counts stay.
 */

const M2_HOUSE = "11111111-1111-4111-8111-111111111111";
const M2_DOC = "44444444-4444-4444-8444-444444444444";
const asRole = (role: string | null) => ({
  userId: "22222222-2222-4222-8222-222222222222",
  restaurantId: M2_HOUSE,
  role,
});

const m2DocRow = () => ({
  id: M2_DOC,
  restaurant_id: M2_HOUSE,
  provider_id: null,
  doc_type: "invoice",
  doc_number: "INV-7",
  status: "needs_review",
  currency: "USD",
  storage_path: null,
  subtotal: 240,
  freight: 12,
  tax: 20,
  total: 272,
  computed_lines_total: 240,
  tie_out_delta: 0,
  ties_out: true,
  notes: "Lines sum to 240.00 against a stated 272.00",
  raw_payload: "INV-7 ... 24.00",
  extracted: {
    docType: "invoice",
    docNumber: "INV-7",
    total: 272,
    lines: [
      {
        lineNo: 1,
        qty: 10,
        uom: "bottle",
        packSize: 1,
        qtyBottles: 10,
        unitPrice: 24,
      },
    ],
  },
});
const m2LineRow = () => ({
  id: "l1",
  document_id: M2_DOC,
  line_no: 1,
  description: "Barolo",
  qty: 10,
  uom: "bottle",
  pack_size: 1,
  qty_bottles: 10,
  unit_price: 24,
  line_total: 240,
  allowance: 0,
  deposit: 0,
  printed: { unitPrice: "24.00" },
});

/** A PostgREST stand-in: every chain resolves to the table's rows. */
function m2FakeDb(tables: Record<string, unknown[]>) {
  const builder = (table: string) => {
    const result = { data: tables[table] ?? [], error: null };
    const b: any = {};
    for (const m of ["select", "eq", "in", "order", "limit", "range"])
      b[m] = () => b;
    b.maybeSingle = async () => ({
      data: (tables[table] ?? [])[0] ?? null,
      error: null,
    });
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, ko);
    return b;
  };
  return {
    getClient: () => ({
      from: builder,
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: null, error: null }),
        }),
      },
    }),
  };
}

function m2Controller(
  extra: { canonical?: unknown; spine?: unknown; corrections?: unknown } = {},
) {
  const none = {} as never;
  return new DocumentsController(
    none,
    m2FakeDb({
      procurement_documents: [m2DocRow()],
      procurement_document_lines: [m2LineRow()],
      procurement_document_links: [{ document_id: M2_DOC, order_id: "o1" }],
    }) as never,
    (extra.canonical ?? none) as never,
    (extra.spine ?? none) as never,
    (extra.corrections ?? none) as never,
    none,
    none,
    none,
    none,
    none,
    none,
  );
}

const canonicalDeps = () => ({
  canonical: {
    buildFromDocumentId: async () => ({
      ok: true,
      value: {
        documentId: M2_DOC,
        layer1: {
          documentNumber: { value: "INV-7" },
          totals: { taxInclusiveAmount: { value: 272 } },
          allowancesCharges: [{ amount: { value: 12 } }],
          vatBreakdown: [{ taxAmount: { value: 20 } }],
          lines: [
            {
              description: { value: "Barolo" },
              quantity: { value: 10 },
              netPrice: { value: 24 },
              netAmount: { value: 240 },
              allowancesCharges: [],
            },
          ],
        },
        layer2: { lines: [] },
        layer3: {
          tiesOut: true,
          tieOutDeltaCents: 0,
          verdicts: [{ id: "BR-CO-15", expected: 272, found: 272 }],
          lines: [{ lineIndex: 0, billed: 10, moneyAtRisk: 0 }],
        },
      },
    }),
  },
  spine: {
    forDocument: async () => ({
      ok: true,
      value: [
        {
          deliveryId: "d1",
          documents: [
            { documentId: M2_DOC, total: 272 },
            { documentId: "slip", total: null },
          ],
        },
      ],
    }),
  },
  corrections: {
    correctionLog: async () => ({
      ok: true,
      value: [
        {
          path: "lines[0].netPrice",
          before: { value: 23 },
          after: { value: 24 },
        },
        {
          path: "lines[0].quantity",
          before: { value: 9 },
          after: { value: 10 },
        },
      ],
    }),
  },
});

describe("M2 — staff read vendor paper without its money", () => {
  it("the list keeps each paper's name, status and the door's count, and drops every amount", async () => {
    const out = (await m2Controller().list(asRole("staff") as never)) as any;
    expect(out.amountsWithheld).toBe(true);
    const row = out.items[0];
    for (const k of DOCUMENT_MONEY_COLUMNS) expect(row).not.toHaveProperty(k);
    expect(row).toMatchObject({
      doc_number: "INV-7",
      status: "needs_review",
      ties_out: true,
    });
    expect(row.extracted).toEqual({
      docType: "invoice",
      docNumber: "INV-7",
      lines: [
        { lineNo: 1, qty: 10, uom: "bottle", packSize: 1, qtyBottles: 10 },
      ],
    });
  });

  it("one paper keeps its lines' quantities and drops their prices and totals", async () => {
    const out = (await m2Controller().detail(
      M2_DOC,
      asRole("staff") as never,
    )) as any;
    expect(out.amountsWithheld).toBe(true);
    expect(out.document).not.toHaveProperty("total");
    for (const k of DOCUMENT_LINE_MONEY_COLUMNS)
      expect(out.lines[0]).not.toHaveProperty(k);
    expect(out.lines[0]).toMatchObject({
      qty: 10,
      qty_bottles: 10,
      description: "Barolo",
    });
    expect(out.links).toHaveLength(1);
  });

  it("the canonical sheet drops prices, totals, money at risk and money corrections", async () => {
    const out = (await m2Controller(canonicalDeps()).canonicalDocument(
      M2_DOC,
      asRole("staff") as never,
    )) as any;
    expect(out.amountsWithheld).toBe(true);
    expect(out.canonical.amountsWithheld).toBe(true);
    const l1 = out.canonical.layer1;
    expect(l1).not.toHaveProperty("totals");
    expect(l1).not.toHaveProperty("allowancesCharges");
    expect(l1).not.toHaveProperty("vatBreakdown");
    expect(l1.lines[0]).not.toHaveProperty("netPrice");
    expect(l1.lines[0]).not.toHaveProperty("netAmount");
    expect(l1.lines[0].quantity).toEqual({ value: 10 });
    const l3 = out.canonical.layer3;
    expect(l3).not.toHaveProperty("tieOutDeltaCents");
    expect(l3).not.toHaveProperty("verdicts");
    expect(l3.tiesOut).toBe(true);
    expect(l3.lines[0]).toEqual({ lineIndex: 0, billed: 10 });
    expect(
      out.deliveries[0].documents.every((d: object) => !("total" in d)),
    ).toBe(true);
    expect(out.siblings.every((d: object) => !("total" in d))).toBe(true);
    expect(out.corrections).toEqual([
      { path: "lines[0].quantity", before: { value: 9 }, after: { value: 10 } },
    ]);
  });

  it.each(["owner", "manager"])("a %s reads every amount", async (role) => {
    const list = (await m2Controller().list(asRole(role) as never)) as any;
    expect(list).not.toHaveProperty("amountsWithheld");
    expect(list.items[0]).toMatchObject({ total: 272, freight: 12 });
    const one = (await m2Controller().detail(
      M2_DOC,
      asRole(role) as never,
    )) as any;
    expect(one.lines[0].unit_price).toBe(24);
    const sheet = (await m2Controller(canonicalDeps()).canonicalDocument(
      M2_DOC,
      asRole(role) as never,
    )) as any;
    expect(sheet).not.toHaveProperty("amountsWithheld");
    expect(sheet.canonical.layer1.lines[0].netPrice).toEqual({ value: 24 });
    expect(sheet.corrections[0].before).toEqual({ value: 23 });
  });

  it("names a money path by an allowlist", () => {
    expect(isMoneyPath("totals.taxAmount")).toBe(true);
    expect(isMoneyPath("lines[3].netPrice")).toBe(true);
    expect(isMoneyPath("lines[3].quantity")).toBe(false);
    expect(isMoneyPath("seller.name")).toBe(false);
    expect(isMoneyPath("somethingNew")).toBe(true);
  });
});

/**
 * F-1299: the vendor's original paper. `GET :id` and `GET :id/canonical`
 * signed a one-hour link to the stored invoice or price list for every member,
 * so staff opened through /receipts the same file `GET /procurement/orders/
 * :id/attachments` withholds from them (F-1176). The link now goes to the
 * house's money holders and to whoever may send to the vendor; a paper the
 * reader brought in themselves (their door photo) stays theirs.
 */
describe("F-1299 — the vendor's paper opens for owners, managers and the sender only", () => {
  const SIGNED = "https://signed.example/invoice.pdf";
  const STAFF = asRole("staff");

  function controllerFor(
    row: Record<string, unknown>,
    maySend: boolean | null,
  ) {
    const db = m2FakeDb({
      procurement_documents: [row],
      procurement_document_lines: [],
      procurement_document_links: [],
    }) as any;
    const client = db.getClient();
    client.storage.from = () => ({
      createSignedUrl: async () => ({
        data: { signedUrl: SIGNED },
        error: null,
      }),
    });
    db.getClient = () => client;
    const none = {} as never;
    const deps = canonicalDeps();
    return new DocumentsController(
      none,
      db as never,
      deps.canonical as never,
      deps.spine as never,
      deps.corrections as never,
      none,
      none,
      none,
      none,
      none,
      none,
      maySend === null
        ? undefined
        : ({ readout: async () => ({ maySend }) } as never),
    );
  }

  const vendorPaper = () => ({
    ...m2DocRow(),
    storage_path: "house/vendor/invoice.pdf",
    source_channel: "email",
    source_ref: "conversation_attachment:a1",
  });

  it.each([
    ["no send standing", false],
    ["no send authority wired", null],
  ])("staff with %s get no link, and are told why", async (_l, maySend) => {
    const c = controllerFor(vendorPaper(), maySend as boolean | null);
    const one = (await c.detail(M2_DOC, STAFF as never)) as any;
    expect(one.document.imageUrl).toBeNull();
    expect(one.document.imageUrlReason).toBe(
      "the paper is kept for owners and managers",
    );
    const sheet = (await c.canonicalDocument(M2_DOC, STAFF as never)) as any;
    expect(sheet.original.imageUrl).toBeNull();
    expect(sheet.original.reason).toBe(
      "the paper is kept for owners and managers",
    );
  });

  it("staff who may send to the vendor open it", async () => {
    const c = controllerFor(vendorPaper(), true);
    const one = (await c.detail(M2_DOC, STAFF as never)) as any;
    expect(one.document.imageUrl).toBe(SIGNED);
  });

  it("staff open the door photo they took themselves", async () => {
    const c = controllerFor(
      {
        ...vendorPaper(),
        source_channel: "photo",
        source_ref: `user:${STAFF.userId}`,
      },
      false,
    );
    const one = (await c.detail(M2_DOC, STAFF as never)) as any;
    expect(one.document.imageUrl).toBe(SIGNED);
  });

  it.each(["owner", "manager"])("the %s opens it", async (role) => {
    const c = controllerFor(vendorPaper(), false);
    const sheet = (await c.canonicalDocument(
      M2_DOC,
      asRole(role) as never,
    )) as any;
    expect(sheet.original.imageUrl).toBe(SIGNED);
  });
});

describe("DocumentsController.detail — each paired line names its own order item (F-1566)", () => {
  /** One invoice billing two orders: line 1 is paired to order o1, line 2 to o2. */
  const items = [
    {
      id: "item-raki",
      order_id: "o1",
      wine_name: "Yeni Rakı 70cl",
      quantity: 12,
      unit_type: "bottle",
    },
    {
      id: "item-wine",
      order_id: "o2",
      wine_name: "Kavaklıdere Yakut 75cl",
      quantity: 6,
      unit_type: "case",
    },
  ];
  const controllerWith = (orderItems: unknown) => {
    const tables: Record<string, unknown[]> = {
      procurement_documents: [m2DocRow()],
      procurement_document_lines: [
        { ...m2LineRow(), id: "l1", order_line_id: "item-raki" },
        { ...m2LineRow(), id: "l2", line_no: 2, order_line_id: "item-wine" },
      ],
      procurement_document_links: [
        { document_id: M2_DOC, order_id: "o1" },
        { document_id: M2_DOC, order_id: "o2" },
      ],
    };
    const seen: [string, unknown][] = [];
    const base = m2FakeDb(tables).getClient();
    const from = (table: string) => {
      if (table !== "procurement_order_items") return base.from(table);
      const b: any = {};
      b.select = () => b;
      b.eq = (c: string, v: unknown) => (seen.push([c, v]), b);
      b.in = (c: string, v: unknown) => (seen.push([c, v]), b);
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(orderItems).then(ok, ko);
      return b;
    };
    const none = {} as never;
    const c = new DocumentsController(
      none,
      { getClient: () => ({ ...base, from }) } as never,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
      none,
    );
    return { c, seen };
  };

  it.each(["owner", "staff"])(
    "sends the item each line is paired to, from every linked order, to a %s",
    async (role) => {
      const { c, seen } = controllerWith({ data: items, error: null });
      const out = (await c.detail(M2_DOC, asRole(role) as never)) as any;
      expect(out.orderLines).toEqual(items);
      expect(seen).toContainEqual(["id", ["item-raki", "item-wine"]]);
      expect(seen).toContainEqual(["restaurant_id", M2_HOUSE]);
    },
  );

  it("says null, not an empty list, when the items could not be read", async () => {
    const { c } = controllerWith({ data: null, error: { message: "down" } });
    const out = (await c.detail(M2_DOC, asRole("owner") as never)) as any;
    expect(out.orderLines).toBeNull();
  });
});

/**
 * F-1635 (sim 53): `paid_at` / `paid_by` existed (ADR 0103 A3) with no
 * writer, so no invoice could be marked paid. `markPaid` did not exist; every
 * case here failed on a build without it.
 */
describe("DocumentsController.markPaid — payment is a fact on the invoice (F-1635)", () => {
  const PAID_DOC = "66666666-6666-4666-8666-666666666666";
  function paidHarness(
    role: string | null,
    doc: Record<string, unknown> | null,
  ) {
    const writes: Array<{ table: string; op: string; row: any; eqs: any[] }> =
      [];
    const client = {
      from: (table: string) => {
        const eqs: any[] = [];
        let op = "select";
        let row: any = null;
        const chain: any = {
          select: () => chain,
          update: (r: any) => {
            op = "update";
            row = r;
            return chain;
          },
          insert: (r: any) => {
            writes.push({ table, op: "insert", row: r, eqs });
            return Promise.resolve({ error: null });
          },
          eq: (...a: any[]) => {
            eqs.push(a);
            return chain;
          },
          maybeSingle: () => Promise.resolve({ data: doc, error: null }),
          then: (res: any, rej: any) => {
            if (op === "update") writes.push({ table, op, row, eqs });
            return Promise.resolve({ error: null }).then(res, rej);
          },
        };
        return chain;
      },
    };
    const none = {} as any;
    const controller = new DocumentsController(
      none,
      { getClient: () => client } as any,
      none,
      none,
      none,
      none,
      {
        resolveRestaurantRole: async () => role,
        assertCanManageRestaurant: async () => {
          if (role !== "owner" && role !== "manager") throw new Error("no");
        },
      } as any,
      none,
      none,
      none,
      none,
    );
    return { controller, writes };
  }
  const user = { userId: "u-1", restaurantId: "r-1" } as any;
  const invoice = {
    id: PAID_DOC,
    doc_type: "invoice",
    doc_number: "A-1",
    paid_at: null,
  };

  it("[REVERT-FAILS] a manager marks an invoice paid, in this house only, and it is logged", async () => {
    const { controller, writes } = paidHarness("manager", invoice);
    const out = await controller.markPaid(PAID_DOC, { paid: true }, user);
    expect(out.paidBy).toBe("restaurant");
    expect(typeof out.paidAt).toBe("string");
    const update = writes.find((w) => w.op === "update")!;
    expect(update.table).toBe("procurement_documents");
    expect(update.row).toEqual({ paid_at: out.paidAt, paid_by: "restaurant" });
    expect(update.eqs).toContainEqual(["restaurant_id", "r-1"]);
    const audit = writes.find((w) => w.table === "system_audit_log")!;
    expect(audit.row.action).toBe("invoice_marked_paid");
    expect(audit.row.actor_id).toBe("u-1");
  });

  it("[REVERT-FAILS] an owner marks it not paid again, clearing both facts", async () => {
    const { controller, writes } = paidHarness("owner", {
      ...invoice,
      paid_at: "2026-10-01T09:00:00Z",
    });
    const out = await controller.markPaid(PAID_DOC, { paid: false }, user);
    expect(out).toEqual({ id: PAID_DOC, paidAt: null, paidBy: null });
    expect(writes.find((w) => w.op === "update")!.row).toEqual({
      paid_at: null,
      paid_by: null,
    });
  });

  it("refuses staff in words, before any read or write", async () => {
    const { controller, writes } = paidHarness("staff", invoice);
    await expect(
      controller.markPaid(PAID_DOC, { paid: true }, user),
    ).rejects.toThrow("manager's or an owner's call");
    expect(writes).toHaveLength(0);
  });

  it("refuses a credit note, and a way of paying the column does not hold", async () => {
    const credit = paidHarness("owner", {
      ...invoice,
      doc_type: "credit_memo",
    });
    await expect(
      credit.controller.markPaid(PAID_DOC, { paid: true }, user),
    ).rejects.toThrow("Only an invoice can be marked paid");
    expect(credit.writes).toHaveLength(0);
    const odd = paidHarness("owner", invoice);
    await expect(
      odd.controller.markPaid(PAID_DOC, { paid: true, paidBy: "cash" }, user),
    ).rejects.toThrow("not a way an invoice can be paid");
  });
});

/**
 * F-1635 remainder (S230): ADR 0103 A3 names "paid while disputed" as a
 * condition with its own notification. Marking a disputed invoice paid told
 * nobody; every [REVERT-FAILS] case here failed on a build without the notice.
 */
describe("DocumentsController.markPaid — paid while disputed tells the owners and managers (F-1635)", () => {
  const DOC = "77777777-7777-4777-8777-777777777777";
  const ORDER = "88888888-8888-4888-8888-888888888888";
  function disputeHarness(opts: {
    links?: Array<{ order_id: string }>;
    claims?: Array<{ id: string }>;
    positions?: Array<{ id: string }>;
    claimError?: string;
  }) {
    const reads: Array<{ table: string; calls: any[] }> = [];
    const client = {
      from: (table: string) => {
        const calls: any[] = [];
        reads.push({ table, calls });
        let op = "select";
        const result = () => {
          if (op !== "select") return { error: null };
          if (table === "procurement_document_links")
            return { data: opts.links ?? [], error: null };
          if (table === "procurement_credits")
            return opts.claimError
              ? { data: null, error: { message: opts.claimError } }
              : { data: opts.claims ?? [], error: null };
          if (table === "delivery_proposals")
            return { data: opts.positions ?? [], error: null };
          return { data: [], error: null };
        };
        const chain: any = {
          select: () => chain,
          update: () => {
            op = "update";
            return chain;
          },
          insert: () => Promise.resolve({ error: null }),
          eq: (...a: any[]) => {
            calls.push(["eq", ...a]);
            return chain;
          },
          in: (...a: any[]) => {
            calls.push(["in", ...a]);
            return chain;
          },
          or: (...a: any[]) => {
            calls.push(["or", ...a]);
            return chain;
          },
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: DOC,
                doc_type: "invoice",
                doc_number: "B-7",
                paid_at: null,
              },
              error: null,
            }),
          then: (res: any, rej: any) =>
            Promise.resolve(result()).then(res, rej),
        };
        return chain;
      },
    };
    const told: any[] = [];
    const notifications = {
      persistForRestaurant: async (house: string, payload: any, o: any) => {
        told.push({ house, payload, o });
        return { inserted: 2, ids: ["n1", "n2"] };
      },
    };
    const none = {} as any;
    const controller = new DocumentsController(
      none,
      { getClient: () => client } as any,
      none,
      none,
      none,
      none,
      {
        resolveRestaurantRole: async () => "manager",
        assertCanManageRestaurant: async () => undefined,
      } as any,
      none,
      none,
      none,
      none,
      {
        ownersAndManagers: async () => ({
          owners: ["o-1"],
          managers: ["m-1", "o-1"],
        }),
      } as any,
      notifications as any,
    );
    return { controller, told, reads };
  }
  const user = { userId: "u-1", restaurantId: "r-1" } as any;

  it("[REVERT-FAILS] a claim still open on the invoice's order tells the owners and managers, only them", async () => {
    const { controller, told, reads } = disputeHarness({
      links: [{ order_id: ORDER }],
      claims: [{ id: "c-1" }],
    });
    await controller.markPaid(DOC, { paid: true }, user);
    expect(told).toHaveLength(1);
    expect(told[0].house).toBe("r-1");
    expect(told[0].payload.type).toBe("invoice_paid_while_disputed");
    expect(told[0].payload.title).toBe(
      "Invoice B-7 was marked paid while disputed",
    );
    expect(told[0].payload.actionUrl).toBe(`/receipts?doc=${DOC}`);
    expect(told[0].o.onlyUserIds.sort()).toEqual(["m-1", "o-1"]);
    const claims = reads.find((r) => r.table === "procurement_credits")!;
    expect(claims.calls).toContainEqual(["eq", "restaurant_id", "r-1"]);
    expect(claims.calls).toContainEqual([
      "in",
      "state",
      ["open", "requested", "promised"],
    ]);
    expect(claims.calls).toContainEqual([
      "or",
      `document_id.eq.${DOC},order_id.in.(${ORDER})`,
    ]);
  });

  it("[REVERT-FAILS] an open position on the invoice at the door is a dispute too", async () => {
    const { controller, told } = disputeHarness({ positions: [{ id: "p-1" }] });
    await controller.markPaid(DOC, { paid: true }, user);
    expect(told).toHaveLength(1);
    expect(told[0].payload.metadata).toEqual({
      documentId: DOC,
      disputed: "yes",
    });
  });

  it("[REVERT-FAILS] a dispute that could not be read is said, never taken as settled", async () => {
    const { controller, told } = disputeHarness({ claimError: "timeout" });
    const out = await controller.markPaid(DOC, { paid: true }, user);
    expect(out.paidBy).toBe("restaurant");
    expect(told).toHaveLength(1);
    expect(told[0].payload.message).toContain("could not be checked");
  });

  it("an invoice with nothing disputed, or one marked not paid, tells nobody", async () => {
    const quiet = disputeHarness({});
    await quiet.controller.markPaid(DOC, { paid: true }, user);
    expect(quiet.told).toHaveLength(0);
    const undo = disputeHarness({ claims: [{ id: "c-1" }] });
    await undo.controller.markPaid(DOC, { paid: false }, user);
    expect(undo.told).toHaveLength(0);
  });
});
