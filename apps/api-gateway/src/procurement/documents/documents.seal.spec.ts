/**
 * The three procurement document write acts are REDEEMED, not asserted.
 *
 * Founder, 2026-09-06 (batch 64), asked whether procurement's write routes
 * should be sealed: **"Decide as a module: seal all three"** — verify, line edit
 * and currency restatement each take a redeemed seal like the payment and
 * register acts do.
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
 *         different currency for the restatement;
 *  13.    a seal is one person's approval and cannot be spent by another;
 *  14.    the restatement's audit row is still written BEFORE the currency
 *         lands, behind the seal rather than instead of it;
 *  15-16. the mint refuses what the write would refuse — staff, and a code that
 *         is not a currency — so a seal is never issued for an act this house
 *         will not perform.
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

  const controller = new DocumentsController(
    intake,
    db,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    organizations,
    {} as never,
    new SealChallengeService(db),
  );

  return { controller, tables, ops, intake, organizations };
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

describe("DocumentsController — the three write acts carry a redeemed seal", () => {
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
