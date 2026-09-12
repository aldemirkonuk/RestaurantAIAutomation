/**
 * The five procurement document write acts are REDEEMED, not asserted.
 *
 * Founder, 2026-09-06 (batch 64), asked whether procurement's write routes
 * should be sealed: **"Decide as a module: seal all three"** — verify, line edit
 * and currency restatement each take a redeemed seal like the payment and
 * register acts do. Founder, 2026-09-11 (batch 69), asked about the two acts on
 * the OTHER face of the same paper: **"Seal corrections and fields/verify
 * too"** — *"the decision then holds on both faces of the document; the guard's
 * census becomes five acts."* Cases 17-25 are that second answer.
 *
 * WHAT THIS FILE MEASURES, AND WHY EACH CASE EXISTS
 * ------------------------------------------------
 * The controller under test is the REAL one and the seal service is the REAL
 * `SealChallengeService` — only the database is a double, because the property
 * being proven is the redemption POLICY (single use, one actor, one subject,
 * one act, arguments unmoved) and a stubbed seal would prove the stub.
 *
 * Every case below fails against the pre-pass controller, which performed all
 * three writes with no seal at all:
 *
 *   1-3.  each act REFUSES without a seal, and the write is NOT performed — a
 *         test that only asserted the throw would pass against a controller
 *         that checked and then wrote anyway;
 *   4-6.  a good seal lets each act through, exactly once;
 *   7-9.  a seal minted for one act cannot be spent on another;
 *  10-12. a seal minted over one state cannot be spent after that state moved:
 *         a corrected line for verify, a different patch for the line edit, a
 *         different currency for the restatement -- both the code SENT and the
 *         code the document carried UNDER the seal (added after the audit of
 *         b6d2e4b4);
 *  13.    a seal is one person's approval and cannot be spent by another;
 *  14.    the restatement's audit row is still written BEFORE the currency
 *         lands, behind the seal rather than instead of it;
 *  15-16. the mint refuses what the write would refuse — staff, and a code that
 *         is not a currency — so a seal is never issued for an act this house
 *         will not perform.
 *  17-25. THE CANONICAL FACE (batch 69). The same five properties for
 *         `field_correct` and `field_verify`: refused with no seal and nothing
 *         appended, admitted once with a good one, refused across acts, and
 *         refused when the state moved — for the correction, a STALE REVISION
 *         (somebody else appended one in between) and a document corrected on
 *         the other face while the revision number stood still; for the tick,
 *         the value moving underneath it.
 *  26-28. ROLE BEFORE SEAL on the currency write (audit of b6d2e4b4): a manager
 *         demoted between the mint and the write is refused in the ROLE's words
 *         with the seal unspent, no seal refusal filed and no audit row; staff
 *         with no seal hear the role, not the seal; and the two canonical-face
 *         acts consult no role at all, so the seal is their first refusal.
 */

import { HttpException } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import { OrganizationsService } from "../../organizations/organizations.service";
import { DocumentIntakeService } from "./document-intake.service";
import { DocumentsController } from "./documents.controller";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const MANAGER = "22222222-2222-4222-8222-222222222222";
const OTHER_MANAGER = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";
const LINE = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;
type Authed = { userId: string; restaurantId: string };

const manager: Authed = { userId: MANAGER, restaurantId: HOUSE };

/**
 * A supabase-js double over in-memory tables.
 *
 * Deliberately generic rather than per-call: the filters, the update and the
 * insert all go through one matcher, so a route that starts filtering on a
 * different column keeps working here and the test keeps meaning what it says.
 * `ops` records the ORDER tables were written in, which is what case 14 reads.
 */
function fakeClient(tables: Record<string, Row[]>, ops: string[]) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op: "select" | "update" | "insert" = "select";
      let patch: Row = {};
      let inserted: Row | null = null;
      const rows = () => (tables[table] ??= []);
      const match = () =>
        rows().filter((r) =>
          filters.every(([c, v]) =>
            v === null ? (r[c] ?? null) === null : r[c] === v,
          ),
        );
      const run = () => {
        if (op === "insert") {
          const row = { id: `${table}-${rows().length + 1}`, ...inserted };
          rows().push(row);
          ops.push(`insert:${table}`);
          return { data: [row], error: null };
        }
        if (op === "update") {
          const hit = match();
          for (const r of hit) Object.assign(r, patch);
          ops.push(`update:${table}`);
          return { data: hit.map((r) => ({ ...r })), error: null };
        }
        return { data: match().map((r) => ({ ...r })), error: null };
      };
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filters.push([c, v]);
          return q;
        },
        is: (c: string, v: unknown) => {
          filters.push([c, v]);
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          const r = run();
          return { data: (r.data as Row[])[0] ?? null, error: r.error };
        },
        update: (p: Row) => {
          op = "update";
          patch = p;
          return q;
        },
        insert: (row: Row) => {
          op = "insert";
          inserted = row;
          return q;
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
          Promise.resolve(run()).then(res, rej),
      });
      return q;
    },
  };
}

/** A layer-1 field envelope, in the shape `CORRECTABLE_PATHS` reads. */
const env = (value: unknown) => ({
  value,
  source: "extracted",
  confidence: null,
  revision: 1,
});

function build(
  opts: { role?: string | null; docCurrency?: string | null } = {},
) {
  const role = opts.role === undefined ? "manager" : opts.role;
  const tables: Record<string, Row[]> = {
    procurement_documents: [
      {
        id: DOC,
        restaurant_id: HOUSE,
        status: "needs_review",
        currency: opts.docCurrency ?? null,
        doc_number: "INV-1",
        doc_date: "2026-09-01",
        total: 120,
        freight: null,
        fuel_surcharge: null,
        split_case_fee: null,
        delivery_fee: null,
        deposit_total: null,
        tax: null,
        other_charges: null,
        discount_total: null,
        extracted: {},
      },
    ],
    procurement_document_lines: [
      {
        id: LINE,
        document_id: DOC,
        restaurant_id: HOUSE,
        line_no: 1,
        qty: 12,
        uom: "bottle",
        pack_size: 1,
        qty_bottles: 12,
        free_goods_qty: 0,
        unit_price: 10,
        line_total: 120,
        allowance: null,
        description: "Kavaklidere Yakut",
        vintage: 2021,
        vendor_sku: "KY-21",
      },
    ],
    mcp_seal_challenges: [],
    system_audit_log: [],
    procurement_document_currency_changes: [],
  };
  const ops: string[] = [];
  const client = fakeClient(tables, ops);

  const db = {
    getClient: () => client,
    supabase: client,
  } as unknown as DatabaseService;

  const intake = {
    editLine: jest.fn(async () => ({
      line: { id: LINE, line_no: 1 },
      tieOut: { computedLinesTotal: 120, tieOutDelta: 0, tiesOut: true },
    })),
    planRefileForCurrency: jest.fn(async () => ({
      plan: {
        document: {},
        lines: [],
        source: "current_rows",
        sourceSaid: "the document as it stands",
      },
      previousTotal: 120,
    })),
    refileMoneyForCurrency: jest.fn(async () => ({
      snapshotReadable: true,
      sentence: "Its money was re-filed.",
      linesRefiled: 1,
      lineFailures: [] as string[],
    })),
  } as unknown as DocumentIntakeService;

  const organizations = {
    resolveRestaurantRole: jest.fn(async () => role),
    assertCanManageRestaurant: jest.fn(async () => {
      if (role !== "manager" && role !== "owner")
        throw new Error("Only managers and owners");
    }),
  } as unknown as OrganizationsService;

  /**
   * The CANONICAL face's state, as one mutable object the cases move (batch 69).
   *
   * Not derived from `tables` above, and deliberately so: the real
   * `buildFromDocumentId` replays every appended correction over the columns and
   * re-runs the mapper, which is a different object from the raw rows the
   * /receipts acts hash. Modelling it as its own state is what lets a case move
   * the canonical document WITHOUT moving the rows — the exact case the seal's
   * content hash exists for, since a document nobody has corrected carries no
   * revision row and its number stands still while the sheet changes.
   */
  const canonicalState = {
    revision: 1,
    layer1: {
      documentNumber: env("INV-1"),
      issueDate: env("2026-09-01"),
      currency: env(opts.docCurrency ?? null),
      seller: { name: env("SYNTHETIC Vendor"), vatIdentifier: env(null) },
      buyer: { name: env("SYNTHETIC House"), vatIdentifier: env(null) },
      lines: [
        {
          description: env("Kavaklidere Yakut"),
          quantity: env(12),
          netPrice: env(10),
          netAmount: env(120),
        },
      ],
      totals: { linesNetTotal: env(120), taxAmount: env(null) },
    } as Record<string, unknown>,
  };

  const canonical = {
    buildFromDocumentId: jest.fn(
      async (restaurantId: string, documentId: string) =>
        restaurantId === HOUSE && documentId === DOC
          ? {
              ok: true as const,
              value: {
                revision: canonicalState.revision,
                layer1: canonicalState.layer1,
              },
            }
          : {
              ok: false as const,
              error: `document ${documentId} not found for restaurant ${restaurantId}`,
            },
    ),
  };

  const corrections = {
    correct: jest.fn(async () => ({
      ok: true as const,
      value: { revision: 2, entry: {}, document: {} },
    })),
    verifyField: jest.fn(async () => ({
      ok: true as const,
      value: { revision: 2, entry: {}, document: {} },
    })),
  };

  const controller = new DocumentsController(
    intake,
    db,
    canonical as never,
    {} as never,
    corrections as never,
    {} as never,
    organizations,
    {} as never,
    // DeliveryStockService (main's ADR 0103 A1, the door's booking half; merged
    // 2026-09-11) -- stubbed, this file never books stock. tsc counts the arguments.
    {} as any,
    new SealChallengeService(db),
  );

  return {
    controller,
    tables,
    ops,
    intake,
    organizations,
    canonical,
    canonicalState,
    corrections,
  };
}

type H = ReturnType<typeof build>;

const statusOf = (h: H) => h.tables.procurement_documents[0].status;
const currencyOf = (h: H) => h.tables.procurement_documents[0].currency;

async function mintVerify(h: H, user: Authed = manager) {
  return (await h.controller.mintVerifySeal(DOC, user as never)).challenge;
}
async function mintLineEdit(h: H, patch: Row, user: Authed = manager) {
  return (
    await h.controller.mintLineEditSeal(DOC, LINE, patch, user as never)
  ).challenge;
}
async function mintCurrency(h: H, currency: string, user: Authed = manager) {
  return (
    await h.controller.mintCurrencySeal(DOC, { currency }, user as never)
  ).challenge;
}

describe("DocumentsController — the five write acts carry a redeemed seal", () => {
  // 1-3. Refused without a seal, and NOTHING is written.
  it("refuses `verify` with no seal, and does not verify the document", async () => {
    const h = build();
    await expect(h.controller.verify(DOC, manager as never)).rejects.toThrow(
      /must be proven rather than asserted/i,
    );
    expect(statusOf(h)).toBe("needs_review");
  });

  it("refuses a line correction with no seal, and does not edit the line", async () => {
    const h = build();
    await expect(
      h.controller.editLine(DOC, LINE, { qty: 14 }, manager as never),
    ).rejects.toThrow(/must be proven rather than asserted/i);
    expect(h.intake.editLine).not.toHaveBeenCalled();
  });

  it("refuses a currency restatement with no seal, and writes no audit row", async () => {
    const h = build();
    await expect(
      h.controller.restateCurrency(DOC, { currency: "EUR" }, manager as never),
    ).rejects.toThrow(/must be proven rather than asserted/i);
    expect(h.tables.procurement_document_currency_changes).toHaveLength(0);
    expect(currencyOf(h)).toBeNull();
  });

  // 4-6. A good seal lets each act through, exactly once.
  it("lets a good `verify` seal through, exactly once", async () => {
    const h = build();
    const token = await mintVerify(h);
    const out = await h.controller.verify(DOC, manager as never, token);
    expect((out as Row).status).toBe("verified");

    await expect(
      h.controller.verify(DOC, manager as never, token),
    ).rejects.toThrow(/already been spent/i);
  });

  it("lets a good line-edit seal through, exactly once", async () => {
    const h = build();
    const patch = { qty: 14 };
    const token = await mintLineEdit(h, patch);
    await h.controller.editLine(DOC, LINE, patch, manager as never, token);
    expect(h.intake.editLine).toHaveBeenCalledTimes(1);

    await expect(
      h.controller.editLine(DOC, LINE, patch, manager as never, token),
    ).rejects.toThrow(/already been spent/i);
    expect(h.intake.editLine).toHaveBeenCalledTimes(1);
  });

  it("lets a good currency seal through, exactly once", async () => {
    const h = build();
    const token = await mintCurrency(h, "EUR");
    const out = await h.controller.restateCurrency(
      DOC,
      { currency: "EUR" },
      manager as never,
      token,
    );
    expect((out as Row).currency).toBe("EUR");
    expect(currencyOf(h)).toBe("EUR");

    await expect(
      h.controller.restateCurrency(
        DOC,
        { currency: "EUR" },
        manager as never,
        token,
      ),
    ).rejects.toThrow(/already been spent/i);
    expect(h.tables.procurement_document_currency_changes).toHaveLength(1);
  });

  // 7-9. One seal, one act.
  it("refuses a line-edit seal spent on `verify`", async () => {
    const h = build();
    const token = await mintLineEdit(h, { qty: 14 });
    await expect(
      h.controller.verify(DOC, manager as never, token),
    ).rejects.toThrow(/different act/i);
    expect(statusOf(h)).toBe("needs_review");
  });

  it("refuses a `verify` seal spent on a line correction", async () => {
    const h = build();
    const token = await mintVerify(h);
    await expect(
      h.controller.editLine(DOC, LINE, { qty: 14 }, manager as never, token),
    ).rejects.toThrow(/different act/i);
    expect(h.intake.editLine).not.toHaveBeenCalled();
  });

  it("refuses a currency seal spent on `verify`", async () => {
    const h = build();
    const token = await mintCurrency(h, "EUR");
    await expect(
      h.controller.verify(DOC, manager as never, token),
    ).rejects.toThrow(/different act/i);
    expect(statusOf(h)).toBe("needs_review");
  });

  // 10-12. What was approved and what is sent have to be the same thing.
  it("refuses a `verify` seal minted before a line was corrected", async () => {
    const h = build();
    const token = await mintVerify(h);
    // Somebody else corrects the transcription between the hold and the write.
    h.tables.procurement_document_lines[0].qty = 20;
    await expect(
      h.controller.verify(DOC, manager as never, token),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(statusOf(h)).toBe("needs_review");
  });

  it("refuses a line-edit seal spent on a different correction", async () => {
    const h = build();
    const token = await mintLineEdit(h, { qty: 14 });
    await expect(
      h.controller.editLine(DOC, LINE, { qty: 140 }, manager as never, token),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.intake.editLine).not.toHaveBeenCalled();
  });

  it("refuses a line-edit seal minted before somebody else moved the line", async () => {
    const h = build();
    const patch = { qty: 14 };
    const token = await mintLineEdit(h, patch);
    // The collision `documents.ts` could previously only report AFTER the fact:
    // procurement_document_lines has no `updated_at` to precondition on.
    h.tables.procurement_document_lines[0].unit_price = 99;
    await expect(
      h.controller.editLine(DOC, LINE, patch, manager as never, token),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.intake.editLine).not.toHaveBeenCalled();
  });

  it("refuses a currency seal minted for EUR when USD is sent", async () => {
    const h = build();
    const token = await mintCurrency(h, "EUR");
    await expect(
      h.controller.restateCurrency(
        DOC,
        { currency: "USD" },
        manager as never,
        token,
      ),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.tables.procurement_document_currency_changes).toHaveLength(0);
    expect(currencyOf(h)).toBeNull();
  });

  it("refuses a currency seal minted while the invoice was unfiled, after somebody else filed it in USD", async () => {
    // `document-seal.ts`'s own promise, pinned at controller level (audit of
    // b6d2e4b4): the seal hashes the code the document carries NOW as well as
    // the code being written. The case above moves the code being SENT; this
    // one moves the code UNDER the seal -- a second manager files the held
    // invoice in USD between this manager's hold and their write.
    const h = build();
    expect(currencyOf(h)).toBeNull();
    const token = await mintCurrency(h, "EUR");
    h.tables.procurement_documents[0].currency = "USD";
    await expect(
      h.controller.restateCurrency(
        DOC,
        { currency: "EUR" },
        manager as never,
        token,
      ),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.tables.procurement_document_currency_changes).toHaveLength(0);
    expect(currencyOf(h)).toBe("USD");
  });

  // 13. One person's approval.
  it("refuses a seal issued to somebody else", async () => {
    const h = build();
    const token = await mintVerify(h);
    await expect(
      h.controller.verify(
        DOC,
        { userId: OTHER_MANAGER, restaurantId: HOUSE } as never,
        token,
      ),
    ).rejects.toThrow(/issued to somebody else/i);
    expect(statusOf(h)).toBe("needs_review");
  });

  // 14. The seal is added to the rule, not substituted for it.
  it("still writes the restatement's audit row BEFORE the currency lands", async () => {
    const h = build();
    const token = await mintCurrency(h, "EUR");
    await h.controller.restateCurrency(
      DOC,
      { currency: "EUR", reason: "the vendor bills in euro" },
      manager as never,
      token,
    );
    const log = h.ops.indexOf("insert:procurement_document_currency_changes");
    const write = h.ops.indexOf("update:procurement_documents");
    expect(log).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThan(log);
    expect(h.tables.procurement_document_currency_changes[0].reason).toBe(
      "the vendor bills in euro",
    );
  });

  // 15-16. A seal is never minted for an act this house would refuse.
  it("refuses to mint a currency seal for staff, in the same words as the write", async () => {
    const h = build({ role: "staff" });
    await expect(
      h.controller.mintCurrencySeal(DOC, { currency: "EUR" }, manager as never),
    ).rejects.toThrow(/manager's or an owner's decision/i);
    expect(h.tables.mcp_seal_challenges).toHaveLength(0);
  });

  it("refuses to mint a currency seal for a code that is not a currency", async () => {
    const h = build();
    await expect(
      h.controller.mintCurrencySeal(DOC, { currency: "ZZZ" }, manager as never),
    ).rejects.toThrow(HttpException);
    expect(h.tables.mcp_seal_challenges).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 17-25. THE CANONICAL FACE (founder, 2026-09-11, batch 69).
  // -------------------------------------------------------------------------

  // 17-18. Refused without a seal, and NOTHING is appended.
  it("refuses a field correction with no seal, and appends no revision", async () => {
    const h = build();
    await expect(
      h.controller.correctField(
        DOC,
        { path: "documentNumber", value: "INV-2" } as never,
        manager as never,
      ),
    ).rejects.toThrow(/must be proven rather than asserted/i);
    expect(h.corrections.correct).not.toHaveBeenCalled();
    // The document is not even READ when no seal was sent: the cheap, certain
    // refusal comes first, so a caller with no seal never gets a 500 about
    // Postgres instead of the sentence telling them to begin the hold.
    expect(h.canonical.buildFromDocumentId).not.toHaveBeenCalled();
  });

  it("refuses a field tick with no seal, and records no verified_by", async () => {
    const h = build();
    await expect(
      h.controller.verifyFieldTick(
        DOC,
        { path: "lines[0].netPrice" } as never,
        manager as never,
      ),
    ).rejects.toThrow(/must be proven rather than asserted/i);
    expect(h.corrections.verifyField).not.toHaveBeenCalled();
  });

  // 19-20. A good seal lets each act through, exactly once.
  it("lets a good field-correction seal through, exactly once", async () => {
    const h = build();
    const body = { path: "lines[0].netPrice", value: 132 };
    const token = (
      await h.controller.mintFieldCorrectSeal(DOC, body as never, manager as never)
    ).challenge;
    await h.controller.correctField(DOC, body as never, manager as never, token);
    expect(h.corrections.correct).toHaveBeenCalledTimes(1);

    await expect(
      h.controller.correctField(DOC, body as never, manager as never, token),
    ).rejects.toThrow(/already been spent/i);
    expect(h.corrections.correct).toHaveBeenCalledTimes(1);
  });

  it("lets a good field-tick seal through, exactly once", async () => {
    const h = build();
    const body = { path: "lines[0].netPrice" };
    const token = (
      await h.controller.mintFieldVerifySeal(DOC, body as never, manager as never)
    ).challenge;
    await h.controller.verifyFieldTick(
      DOC,
      body as never,
      manager as never,
      token,
    );
    expect(h.corrections.verifyField).toHaveBeenCalledTimes(1);

    await expect(
      h.controller.verifyFieldTick(DOC, body as never, manager as never, token),
    ).rejects.toThrow(/already been spent/i);
    expect(h.corrections.verifyField).toHaveBeenCalledTimes(1);
  });

  // 21-22. One seal, one act — across the two faces as well as within one.
  it("refuses a field-tick seal spent on a field correction", async () => {
    const h = build();
    const token = (
      await h.controller.mintFieldVerifySeal(
        DOC,
        { path: "lines[0].netPrice" } as never,
        manager as never,
      )
    ).challenge;
    await expect(
      h.controller.correctField(
        DOC,
        { path: "lines[0].netPrice", value: 132 } as never,
        manager as never,
        token,
      ),
    ).rejects.toThrow(/different act/i);
    expect(h.corrections.correct).not.toHaveBeenCalled();
  });

  it("refuses the DOCUMENT-WIDE verify seal spent on a single field's tick", async () => {
    // The reason `field_verify` is not called `verification`: these two acts are
    // one word apart in the operator's language and mean very different things.
    const h = build();
    const token = await mintVerify(h);
    await expect(
      h.controller.verifyFieldTick(
        DOC,
        { path: "lines[0].netPrice" } as never,
        manager as never,
        token,
      ),
    ).rejects.toThrow(/different act/i);
    expect(h.corrections.verifyField).not.toHaveBeenCalled();
  });

  // 23-25. What was approved and what is sent have to be the same thing.
  it("refuses a correction seal minted against a STALE revision", async () => {
    const h = build();
    const body = { path: "documentNumber", value: "INV-2" };
    const token = (
      await h.controller.mintFieldCorrectSeal(DOC, body as never, manager as never)
    ).challenge;
    // Somebody else's correction lands in between: layer 1 is append-only, so
    // the revision the hold was begun against is no longer the current one.
    h.canonicalState.revision = 2;
    await expect(
      h.controller.correctField(DOC, body as never, manager as never, token),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.corrections.correct).not.toHaveBeenCalled();
  });

  it("refuses a correction seal when the OTHER face moved the document under it", async () => {
    const h = build();
    const body = { path: "documentNumber", value: "INV-2" };
    const token = (
      await h.controller.mintFieldCorrectSeal(DOC, body as never, manager as never)
    ).challenge;
    // A `line_edit` on /receipts. It appends no revision row, so the revision
    // number stands at 1 and only the CONTENT hash can see this.
    (
      (h.canonicalState.layer1.lines as Record<string, unknown>[])[0]
        .netPrice as Record<string, unknown>
    ).value = 99;
    expect(h.canonicalState.revision).toBe(1);
    await expect(
      h.controller.correctField(DOC, body as never, manager as never, token),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.corrections.correct).not.toHaveBeenCalled();
  });

  it("refuses a field-tick seal minted while the field showed another figure", async () => {
    const h = build();
    const body = { path: "lines[0].netPrice" };
    const token = (
      await h.controller.mintFieldVerifySeal(DOC, body as never, manager as never)
    ).challenge;
    (
      (h.canonicalState.layer1.lines as Record<string, unknown>[])[0]
        .netPrice as Record<string, unknown>
    ).value = 132;
    await expect(
      h.controller.verifyFieldTick(DOC, body as never, manager as never, token),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.corrections.verifyField).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 26-28. ROLE BEFORE SEAL (audit of b6d2e4b4). `restateCurrency` asserts the
  // role and THEN redeems the seal, and the order is the point: a person who may
  // not restate anything is told so rather than told their seal is wrong, and a
  // demoted manager's token is neither spent nor filed as a seal refusal -- it
  // simply buys nothing. No harness change: `build()`'s organizations methods
  // are jest.fn, so a demotion is staged with the Once variants.
  // -------------------------------------------------------------------------

  const sealRefusals = (h: H) =>
    h.tables.system_audit_log.filter((r) => r.action === "seal_refused");

  it("refuses a manager demoted between the mint and the write in the ROLE's words, spending nothing", async () => {
    const h = build();
    const token = await mintCurrency(h, "EUR");
    expect(h.tables.mcp_seal_challenges).toHaveLength(1);

    // The demotion lands between the hold and the write.
    (
      h.organizations.resolveRestaurantRole as unknown as jest.Mock
    ).mockResolvedValueOnce("staff");
    (
      h.organizations.assertCanManageRestaurant as unknown as jest.Mock
    ).mockRejectedValueOnce(new Error("Only managers and owners"));

    const err = await h.controller
      .restateCurrency(DOC, { currency: "EUR" }, manager as never, token)
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(HttpException);
    const said = String((err as Error).message);
    expect(said).toMatch(/manager's or an owner's decision/i);
    expect(said).toMatch(/signed in as staff/i);
    expect(said).not.toMatch(/must be proven rather than asserted/i);

    // The seal was never consulted: still unspent, and nothing filed against it.
    expect(h.tables.mcp_seal_challenges[0].redeemed_at ?? null).toBeNull();
    expect(sealRefusals(h)).toHaveLength(0);
    // And nothing about the money moved.
    expect(h.tables.procurement_document_currency_changes).toHaveLength(0);
    expect(currencyOf(h)).toBeNull();
  });

  it("tells staff with NO seal about the role, not about the seal", async () => {
    const h = build({ role: "staff" });
    const err = await h.controller
      .restateCurrency(DOC, { currency: "EUR" }, manager as never)
      .catch((e: Error) => e);
    const said = String((err as Error).message);
    expect(said).toMatch(/manager's or an owner's decision/i);
    expect(said).not.toMatch(/must be proven rather than asserted/i);
    // The seal service was never asked, so no seal refusal sits on this
    // person's record for an act their role could never have performed.
    expect(sealRefusals(h)).toHaveLength(0);
    expect(h.tables.procurement_document_currency_changes).toHaveLength(0);
  });

  it("the two canonical-face acts check NO role, so their first refusal is the seal's", async () => {
    // The audit's third case is conditional: "the same two for the new acts IF
    // their writes check the role before the seal". They check no role at all --
    // neither route has had one beyond the token and the house scope, and batch
    // 69 sealed them without adding one -- so the demotion case cannot arise.
    // Pinned so that adding a role gate later is a visible change to this file.
    const h = build({ role: "staff" });
    await expect(
      h.controller.correctField(
        DOC,
        { path: "documentNumber", value: "INV-2" } as never,
        manager as never,
      ),
    ).rejects.toThrow(/must be proven rather than asserted/i);
    await expect(
      h.controller.verifyFieldTick(
        DOC,
        { path: "lines[0].netPrice" } as never,
        manager as never,
      ),
    ).rejects.toThrow(/must be proven rather than asserted/i);
    expect(h.organizations.resolveRestaurantRole).not.toHaveBeenCalled();
    expect(h.organizations.assertCanManageRestaurant).not.toHaveBeenCalled();
    expect(h.corrections.correct).not.toHaveBeenCalled();
    expect(h.corrections.verifyField).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 29-31. A MINT REFUSES WHAT THE WRITE WOULD REFUSE (auditor, 2026-09-11).
  //
  // `mintCurrencySeal` states the rule for the /receipts face: "EVERYTHING THAT
  // WOULD REFUSE THE WRITE REFUSES THE SEAL FIRST ... a manager handed a seal
  // that is going to be refused a second and a half later learns that the seal
  // is decoration." The two canonical-face mints did not follow it: a path
  // outside the closed correctable registry was minted happily and then refused
  // 400 by the write, so a person could be asked to hold a gesture that could
  // never be spent. The path is validated against the SAME registry the write
  // validates against (`CORRECTABLE_PATHS`/`splitPath`), so the two cannot drift.
  // -------------------------------------------------------------------------

  it("refuses to MINT a field-correction seal for a path the write would refuse", async () => {
    const h = build();
    await expect(
      h.controller.mintFieldCorrectSeal(
        DOC,
        { path: "constructor.prototype", value: 1 } as never,
        manager as never,
      ),
    ).rejects.toThrow(/not a correctable field|not a field path/i);
    // Nothing was issued: no token exists for an act that could never be spent.
    expect(h.tables.mcp_seal_challenges).toHaveLength(0);
    // ...and it says so, the way the currency mint does.
    const err = await h.controller
      .mintFieldCorrectSeal(
        DOC,
        { path: "constructor.prototype", value: 1 } as never,
        manager as never,
      )
      .catch((e: Error) => e);
    expect(String((err as Error).message)).toMatch(/[Nn]othing was sealed/);
  });

  it("refuses to MINT a field-tick seal for a path the write would refuse", async () => {
    const h = build();
    await expect(
      h.controller.mintFieldVerifySeal(
        DOC,
        { path: "lines[0].nope" } as never,
        manager as never,
      ),
    ).rejects.toThrow(/not a verifiable field|not a field path/i);
    expect(h.tables.mcp_seal_challenges).toHaveLength(0);
  });

  it("still lets the WRITE refuse a token minted before the state moved", async () => {
    // The other half of the pairing: refusing early at the mint must not soften
    // the redemption. A seal minted for a path the registry DOES hold is issued,
    // and the write still refuses it once the document moves underneath it.
    // (Case 23 is the fuller version of this; it is restated here so the two
    // halves of "a mint refuses what the write refuses" sit together.)
    const h = build();
    const body = { path: "documentNumber", value: "INV-2" };
    const token = (
      await h.controller.mintFieldCorrectSeal(DOC, body as never, manager as never)
    ).challenge;
    expect(h.tables.mcp_seal_challenges).toHaveLength(1);

    h.canonicalState.revision = 2;
    await expect(
      h.controller.correctField(DOC, body as never, manager as never, token),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(h.corrections.correct).not.toHaveBeenCalled();
  });

  it("files every refusal in system_audit_log before it throws", async () => {
    const h = build();
    await expect(h.controller.verify(DOC, manager as never)).rejects.toThrow();
    expect(h.tables.system_audit_log).toHaveLength(1);
    expect(h.tables.system_audit_log[0].action).toBe("seal_refused");
    expect((h.tables.system_audit_log[0].changes as Row).refusal).toBe("absent");
    expect(h.tables.system_audit_log[0].entity_type).toBe(
      "procurement_document",
    );
  });
});
