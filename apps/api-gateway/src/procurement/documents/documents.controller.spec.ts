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
      { resolveRestaurantRole: async () => roleToReturn } as any,
      {} as any, // DeliveryService (ADR 0103 — the door-count route's other half)
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
